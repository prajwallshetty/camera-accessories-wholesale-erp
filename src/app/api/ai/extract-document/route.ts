import { NextRequest, NextResponse } from 'next/server';
import { extractDocumentWithAzure } from '@/lib/azure-document-intelligence';
import { uploadToCloudinary } from '@/lib/cloudinary';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s timeout for OCR polling

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'documents.write');
  if (!auth.ok) return auth.response;

  try {
    let fileBuffer: Buffer | null = null;
    let fileName = 'Uploaded_Document.pdf';
    let fileDataUri: string = '';
    let category = 'PROFORMA';
    let mimeType = 'application/pdf';

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided in form data' }, { status: 400 });
      }
      fileName = file.name || 'document.pdf';
      const cat = formData.get('category') as string;
      if (cat) category = cat;

      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      const base64String = fileBuffer.toString('base64');
      mimeType = file.type || 'application/pdf';
      fileDataUri = `data:${mimeType};base64,${base64String}`;
    } else {
      const body = await req.json();
      const { fileData, fileName: reqFileName, category: reqCat } = body;

      if (!fileData) {
        return NextResponse.json({ error: 'fileData (Base64 string or data URI) is required' }, { status: 400 });
      }

      if (reqFileName) fileName = reqFileName;
      if (reqCat) category = reqCat;

      fileDataUri = fileData;
      // Extract raw base64 data if it is a data URI
      const base64Match = fileData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (base64Match) {
        mimeType = base64Match[1];
        fileBuffer = Buffer.from(base64Match[2], 'base64');
      } else {
        fileBuffer = Buffer.from(fileData, 'base64');
        fileDataUri = `data:application/pdf;base64,${fileData}`;
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return NextResponse.json({ error: 'File data could not be processed' }, { status: 400 });
    }

    // 1. Upload original document to Cloudinary to ensure document retention
    let uploadRes: any = null;
    try {
      uploadRes = await uploadToCloudinary(
        fileDataUri,
        'camera-erp-dev2/ai-extractions',
        'auto'
      );
    } catch (cloudErr: any) {
      console.warn('[AI Extraction] Cloudinary upload fallback:', cloudErr?.message);
    }

    // 2. Register in Centralized Documents Repository
    const format = uploadRes?.format || fileName.split('.').pop() || 'pdf';
    const isImage = mimeType.startsWith('image/');
    const fileType = mimeType;

    const docData = {
      title: `AI Extracted: ${fileName.replace(/\.[^/.]+$/, '')}`,
      fileName,
      fileType,
      fileFormat: format,
      fileSize: uploadRes?.bytes || fileBuffer.length,
      cloudinaryUrl: uploadRes?.secure_url || uploadRes?.url || fileDataUri,
      cloudinaryPublicId: uploadRes?.public_id || `ai_doc_${Date.now()}`,
      category: (category as any) || 'PROFORMA',
      relatedEntityType: 'PROFORMA' as any,
      relatedEntityId: '',
      relatedEntityLabel: 'Pending Confirmation',
      tags: ['AI-EXTRACTED', 'AZURE-OCR', format.toUpperCase()],
      uploadedBy: auth.user.id,
      uploadedByName: auth.user.name,
      depotId: depotIdFilter(auth.user) || null,
      notes: 'Extracted using Azure Document Intelligence AI OCR engine',
    };

    let cloudDoc: any = null;
    try {
      cloudDoc = await prisma.cloudDocument.create({
        data: docData,
      });
      dataStore.createDocument(cloudDoc);
    } catch {
      cloudDoc = dataStore.createDocument(docData);
    }

    // 3. Run Azure Document Intelligence extraction
    console.log(`[AI Extraction] Processing "${fileName}" (${fileBuffer.length} bytes, ${mimeType}) via Azure AI...`);
    const extractedData = await extractDocumentWithAzure(fileBuffer, fileName, mimeType);

    return NextResponse.json({
      success: true,
      extractedData,
      document: cloudDoc,
      cloudinary: {
        secure_url: uploadRes?.secure_url || cloudDoc?.cloudinaryUrl,
        public_id: uploadRes?.public_id || cloudDoc?.cloudinaryPublicId,
      },
    });
  } catch (error: any) {
    console.error('[AI Document Extraction Route Error]:', error);
    return NextResponse.json(
      {
        error: error?.message || 'Failed to extract document via Azure Document Intelligence',
      },
      { status: 500 }
    );
  }
}
