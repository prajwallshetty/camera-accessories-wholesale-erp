'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Building2,
  DollarSign,
  Calendar,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Save,
  ExternalLink,
  ShieldCheck,
  Cpu,
  FileCode2,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ExtractedDocumentData, ExtractedLineItem } from '@/lib/azure-document-intelligence';
import { useExtraction } from '@/context/ExtractionContext';

interface AzurePdfExtractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onApplyToProforma?: (data: ExtractedDocumentData) => void;
}

export default function AzurePdfExtractionModal({
  isOpen,
  onClose,
  onSuccess,
  onApplyToProforma,
}: AzurePdfExtractionModalProps) {
  const router = useRouter();
  const { startExtraction, pendingReviewExtraction, clearPendingReview } = useExtraction();

  // Step state: 'upload' -> 'review' -> 'confirm' -> 'success'
  const [step, setStep] = useState<'upload' | 'review' | 'confirm' | 'success'>('upload');

  // File & Upload state
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Extracted and Editable State
  const [extractedData, setExtractedData] = useState<ExtractedDocumentData | null>(null);
  const [cloudDocument, setCloudDocument] = useState<any | null>(null);
  const [saveType, setSaveType] = useState<'PROFORMA' | 'TAX_INVOICE'>('PROFORMA');
  const [savedResult, setSavedResult] = useState<any | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate from pending review extraction if launched from floating background widget
  useEffect(() => {
    if (pendingReviewExtraction && pendingReviewExtraction.result) {
      setExtractedData(pendingReviewExtraction.result.extractedData);
      setCloudDocument(pendingReviewExtraction.result.document);
      setSaveType(pendingReviewExtraction.result.extractedData.documentType === 'TAX_INVOICE' ? 'TAX_INVOICE' : 'PROFORMA');
      setFileName(pendingReviewExtraction.fileName);
      setStep('review');
      clearPendingReview();
    }
  }, [pendingReviewExtraction, clearPendingReview]);

  const isAcceptedFile = (f: File) =>
    f.type.includes('pdf') ||
    f.type.startsWith('image/') ||
    /\.(pdf|jpe?g|png|bmp|tiff?|heif)$/i.test(f.name);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!isAcceptedFile(selectedFile)) {
      setErrorMessage('Please select a valid PDF, JPG, PNG, BMP, or TIFF document.');
      return;
    }

    setErrorMessage(null);
    setFile(selectedFile);
    setFileName(selectedFile.name);
    setFileSize(selectedFile.size);

    const reader = new FileReader();
    reader.onload = (event) => {
      setFileData(event.target?.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;

    if (!isAcceptedFile(droppedFile)) {
      setErrorMessage('Please drop a valid PDF, JPG, PNG, BMP, or TIFF file.');
      return;
    }

    setErrorMessage(null);
    setFile(droppedFile);
    setFileName(droppedFile.name);
    setFileSize(droppedFile.size);

    const reader = new FileReader();
    reader.onload = (event) => {
      setFileData(event.target?.result as string);
    };
    reader.readAsDataURL(droppedFile);
  };

  // Trigger Azure Document Intelligence Extraction
  const handleAnalyze = async (runInBackground = false) => {
    if (!fileData) {
      setErrorMessage('Please choose or drop a PDF file first.');
      return;
    }

    if (runInBackground) {
      startExtraction(fileData, fileName, 'PROFORMA');
      onClose();
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);

    // Register with global extraction manager so it persists if modal is dismissed
    startExtraction(fileData, fileName, 'PROFORMA');

    try {
      const res = await fetch('/api/ai/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData,
          fileName,
          category: 'PROFORMA',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to extract data via Azure Document Intelligence');
      }

      setExtractedData(data.extractedData);
      setCloudDocument(data.document);
      setSaveType(data.extractedData.documentType === 'TAX_INVOICE' ? 'TAX_INVOICE' : 'PROFORMA');
      setStep('review');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error occurred during Azure AI analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Recalculate totals helper
  const recalculateTotals = (
    items: ExtractedLineItem[],
    disc: number,
    shipping: number,
    other: number
  ) => {
    let subtotal = 0;
    let taxTotal = 0;

    items.forEach((item) => {
      const lineSub = Number(item.quantity) * Number(item.unitPrice);
      const lineTax = lineSub * ((Number(item.taxRate) || 0) / 100);
      subtotal += lineSub;
      taxTotal += lineTax;
    });

    const grand = subtotal - Number(disc) + taxTotal + Number(shipping) + Number(other);

    return {
      subtotal: Number(subtotal.toFixed(2)),
      taxAmount: Number(taxTotal.toFixed(2)),
      grandTotal: Number(grand.toFixed(2)),
    };
  };

  // Edit line item handler
  const handleLineItemChange = (index: number, field: keyof ExtractedLineItem, value: any) => {
    if (!extractedData) return;
    const updatedItems = [...extractedData.lineItems];
    const currentItem = { ...updatedItems[index], [field]: value };

    // Auto-compute line amount
    if (field === 'quantity' || field === 'unitPrice') {
      const q = field === 'quantity' ? Number(value) : currentItem.quantity;
      const p = field === 'unitPrice' ? Number(value) : currentItem.unitPrice;
      currentItem.amount = Number((q * p).toFixed(2));
    }

    updatedItems[index] = currentItem;

    const recalculated = recalculateTotals(
      updatedItems,
      extractedData.discountAmount,
      extractedData.shippingCharges,
      extractedData.otherCharges
    );

    setExtractedData({
      ...extractedData,
      lineItems: updatedItems,
      ...recalculated,
    });
  };

  // Add line item
  const handleAddLineItem = () => {
    if (!extractedData) return;
    const newItem: ExtractedLineItem = {
      id: `item-${Date.now()}`,
      description: 'New Camera Equipment Line Item',
      sku: 'CUSTOM-SKU',
      quantity: 1,
      unitPrice: 100,
      taxRate: 5,
      amount: 100,
    };
    const updatedItems = [...extractedData.lineItems, newItem];
    const recalculated = recalculateTotals(
      updatedItems,
      extractedData.discountAmount,
      extractedData.shippingCharges,
      extractedData.otherCharges
    );

    setExtractedData({
      ...extractedData,
      lineItems: updatedItems,
      ...recalculated,
    });
  };

  // Delete line item
  const handleDeleteLineItem = (index: number) => {
    if (!extractedData || extractedData.lineItems.length <= 1) return;
    const updatedItems = extractedData.lineItems.filter((_, i) => i !== index);
    const recalculated = recalculateTotals(
      updatedItems,
      extractedData.discountAmount,
      extractedData.shippingCharges,
      extractedData.otherCharges
    );

    setExtractedData({
      ...extractedData,
      lineItems: updatedItems,
      ...recalculated,
    });
  };

  // Update root field
  const handleFieldChange = (field: keyof ExtractedDocumentData, value: any) => {
    if (!extractedData) return;
    let nextState = { ...extractedData, [field]: value };

    if (field === 'discountAmount' || field === 'shippingCharges' || field === 'otherCharges') {
      const recalculated = recalculateTotals(
        nextState.lineItems,
        field === 'discountAmount' ? Number(value) : nextState.discountAmount,
        field === 'shippingCharges' ? Number(value) : nextState.shippingCharges,
        field === 'otherCharges' ? Number(value) : nextState.otherCharges
      );
      nextState = { ...nextState, ...recalculated };
    }

    setExtractedData(nextState);
  };

  // Apply directly to Proforma builder if on proforma page
  const handleApplyToBuilder = () => {
    if (extractedData && onApplyToProforma) {
      onApplyToProforma(extractedData);
      onClose();
    }
  };

  // Final Confirmation & Save into ERP
  const handleConfirmSave = async () => {
    if (!extractedData) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        saveType,
        documentNumber: extractedData.invoiceNumber || extractedData.proformaNumber,
        customerName: extractedData.customerName,
        companyName: extractedData.companyName,
        email: extractedData.email,
        phone: extractedData.phone,
        billingAddress: extractedData.billingAddress,
        shippingAddress: extractedData.shippingAddress,
        currency: extractedData.currency || 'USD',
        paymentTerms: extractedData.paymentTerms,
        subtotal: extractedData.subtotal,
        taxAmount: extractedData.taxAmount,
        discountAmount: extractedData.discountAmount,
        shippingCharges: extractedData.shippingCharges,
        otherCharges: extractedData.otherCharges,
        grandTotal: extractedData.grandTotal,
        dueDate: extractedData.dueDate,
        lineItems: extractedData.lineItems,
        cloudDocumentId: cloudDocument?.id,
      };

      const res = await fetch('/api/ai/save-extracted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save document to ERP');
      }

      setSavedResult(data);
      setStep('success');
      if (onSuccess) onSuccess(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save document.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setFileData(null);
    setFileName('');
    setFileSize(0);
    setExtractedData(null);
    setCloudDocument(null);
    setSavedResult(null);
    setErrorMessage(null);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="3xl"
      title="Azure AI Document Intelligence"
      description="Extract commercial invoice and quotation data from digital PDFs, scanned OCR PDFs, or photographed documents (JPG/PNG) with review & confirmation."
    >
      <div className="flex flex-col gap-5">
        {/* Step indicator */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step === 'upload' ? 'bg-primary text-white' : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {step !== 'upload' ? '✓' : '1'}
            </span>
            <span className={`text-xs font-medium ${step === 'upload' ? 'text-ink font-bold' : 'text-muted'}`}>
              Upload PDF
            </span>
            <span className="text-slate-300">/</span>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step === 'review'
                  ? 'bg-primary text-white'
                  : step === 'confirm' || step === 'success'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-surface-muted text-muted'
              }`}
            >
              {step === 'confirm' || step === 'success' ? '✓' : '2'}
            </span>
            <span className={`text-xs font-medium ${step === 'review' ? 'text-ink font-bold' : 'text-muted'}`}>
              Review & Edit
            </span>
            <span className="text-slate-300">/</span>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step === 'confirm'
                  ? 'bg-primary text-white'
                  : step === 'success'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-surface-muted text-muted'
              }`}
            >
              {step === 'success' ? '✓' : '3'}
            </span>
            <span
              className={`text-xs font-medium ${
                step === 'confirm' || step === 'success' ? 'text-ink font-bold' : 'text-muted'
              }`}
            >
              Confirm & Save
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Badge tone="primary" icon={<Cpu className="h-3 w-3" />} className="text-[11px] py-0.5">
              Azure Form Recognizer / Prebuilt-Invoice
            </Badge>
          </div>
        </div>

        {/* Error notification banner */}
        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* ----------------- STEP 1: UPLOAD ----------------- */}
        {step === 'upload' && (
          <div className="flex flex-col gap-4 py-2">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-line hover:border-primary/70 rounded-xl p-8 flex flex-col items-center justify-center gap-3 bg-slate-50/50 hover:bg-surface cursor-pointer transition-colors text-center"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/bmp,image/tiff,image/heif,.pdf,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.heif"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <UploadCloud className="h-6 w-6" />
              </div>

              <div>
                <p className="text-sm font-semibold text-ink">
                  {file ? file.name : 'Click to select or drag & drop a PDF or image document'}
                </p>
                <p className="text-xs text-muted mt-1">
                  Supports standard digital PDFs, high-resolution scanned/OCR PDFs, and photographed
                  documents (JPG, PNG, BMP, TIFF).
                </p>
              </div>

              {file && (
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-line text-xs text-ink-secondary mt-1 shadow-sm">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-muted font-mono">({(file.size / 1024).toFixed(0)} KB)</span>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-blue-50/60 border border-blue-200/80 p-3 text-xs text-blue-900 flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">User Confirmation Safety Guarantee:</span> Extracted data is strictly
                staged for your review. The system will never write to or create an ERP record until you inspect, edit,
                and explicitly click confirm.
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-line-soft">
              <div className="text-[11px] text-muted">
                {isAnalyzing ? (
                  <span className="text-sky-600 font-medium animate-pulse">
                    Azure AI OCR processing in background...
                  </span>
                ) : (
                  <span>Non-blocking async workflow</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isAnalyzing ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onClose()}
                  >
                    Continue Working in ERP (Background)
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleAnalyze()}
                      disabled={!fileData || isAnalyzing}
                      loading={isAnalyzing}
                      iconLeft={<Sparkles className="h-4 w-4" />}
                    >
                      Extract Data from PDF
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ----------------- STEP 2: REVIEW & EDIT ----------------- */}
        {step === 'review' && extractedData && (
          <div className="flex flex-col gap-5">
            {/* Header info bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-amber-950">Review & Edit Required:</span>
                <span>Verify all extracted fields. Every field can be modified before confirmation.</span>
              </div>
              <div className="flex items-center gap-2">
                {extractedData.isDemoFallback && (
                  <Badge tone="warning">
                    Fallback Extractor Mode
                  </Badge>
                )}
                {extractedData.rawConfidence && (
                  <Badge tone="success">
                    Confidence: {(extractedData.rawConfidence * 100).toFixed(0)}%
                  </Badge>
                )}
                {cloudDocument?.cloudinaryUrl && (
                  <a
                    href={cloudDocument.cloudinaryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    View Original PDF <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Document Header Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl border border-line bg-slate-50/40">
              <div>
                <label className="block text-[11px] font-semibold text-ink-secondary mb-1">Target ERP Document Type</label>
                <select
                  value={saveType}
                  onChange={(e) => setSaveType(e.target.value as any)}
                  className="w-full text-xs rounded-md border border-line bg-white px-2.5 py-1.5 focus:border-primary"
                >
                  <option value="PROFORMA">Proforma Quotation (PI)</option>
                  <option value="TAX_INVOICE">Commercial Tax Invoice (INV)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-secondary mb-1">Extracted Document / Ref #</label>
                <input
                  type="text"
                  value={extractedData.invoiceNumber}
                  onChange={(e) => handleFieldChange('invoiceNumber', e.target.value)}
                  className="w-full text-xs rounded-md border border-line bg-white px-2.5 py-1.5 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-secondary mb-1">Currency</label>
                <select
                  value={extractedData.currency}
                  onChange={(e) => handleFieldChange('currency', e.target.value)}
                  className="w-full text-xs rounded-md border border-line bg-white px-2.5 py-1.5 focus:border-primary"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="AED">AED (د.إ)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="JPY">JPY (¥)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-secondary mb-1">Invoice Date</label>
                <input
                  type="date"
                  value={extractedData.invoiceDate?.slice(0, 10) || ''}
                  onChange={(e) => handleFieldChange('invoiceDate', e.target.value)}
                  className="w-full text-xs rounded-md border border-line bg-white px-2.5 py-1.5 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-secondary mb-1">Due Date</label>
                <input
                  type="date"
                  value={extractedData.dueDate?.slice(0, 10) || ''}
                  onChange={(e) => handleFieldChange('dueDate', e.target.value)}
                  className="w-full text-xs rounded-md border border-line bg-white px-2.5 py-1.5 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-secondary mb-1">Payment Terms</label>
                <input
                  type="text"
                  value={extractedData.paymentTerms || ''}
                  onChange={(e) => handleFieldChange('paymentTerms', e.target.value)}
                  className="w-full text-xs rounded-md border border-line bg-white px-2.5 py-1.5 focus:border-primary"
                />
              </div>
            </div>

            {/* Customer & Address Information */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl border border-line bg-white">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" /> Customer / Client Details
                </span>
                <div>
                  <label className="block text-[11px] text-ink-secondary mb-0.5">Company Name</label>
                  <input
                    type="text"
                    value={extractedData.companyName || ''}
                    onChange={(e) => handleFieldChange('companyName', e.target.value)}
                    className="w-full text-xs rounded-md border border-line px-2.5 py-1.5 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-ink-secondary mb-0.5">Contact Person</label>
                  <input
                    type="text"
                    value={extractedData.customerName || ''}
                    onChange={(e) => handleFieldChange('customerName', e.target.value)}
                    className="w-full text-xs rounded-md border border-line px-2.5 py-1.5 focus:border-primary"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-ink-secondary mb-0.5">Email</label>
                    <input
                      type="email"
                      value={extractedData.email || ''}
                      onChange={(e) => handleFieldChange('email', e.target.value)}
                      className="w-full text-xs rounded-md border border-line px-2.5 py-1.5 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-secondary mb-0.5">Phone</label>
                    <input
                      type="text"
                      value={extractedData.phone || ''}
                      onChange={(e) => handleFieldChange('phone', e.target.value)}
                      className="w-full text-xs rounded-md border border-line px-2.5 py-1.5 focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" /> Billing & Shipping Addresses
                </span>
                <div>
                  <label className="block text-[11px] text-ink-secondary mb-0.5">Billing Address</label>
                  <textarea
                    rows={2}
                    value={extractedData.billingAddress || ''}
                    onChange={(e) => handleFieldChange('billingAddress', e.target.value)}
                    className="w-full text-xs rounded-md border border-line px-2.5 py-1.5 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-ink-secondary mb-0.5">Shipping Address</label>
                  <textarea
                    rows={2}
                    value={extractedData.shippingAddress || ''}
                    onChange={(e) => handleFieldChange('shippingAddress', e.target.value)}
                    className="w-full text-xs rounded-md border border-line px-2.5 py-1.5 focus:border-primary"
                  />
                </div>
              </div>
            </div>

            {/* Editable Line Items Table */}
            <div className="border border-line rounded-xl overflow-hidden bg-white">
              <div className="flex items-center justify-between px-4 py-2.5 bg-surface border-b border-line">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink">Extracted Line Items</span>
                  <Badge tone="neutral" className="text-[11px]">
                    {extractedData.lineItems.length} items
                  </Badge>
                </div>
                <Button size="sm" variant="outline" onClick={handleAddLineItem} iconLeft={<Plus className="h-3.5 w-3.5" />}>
                  Add Item
                </Button>
              </div>

              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50/70 text-ink-secondary font-semibold border-b border-line sticky top-0">
                    <tr>
                      <th className="py-2 px-3 w-10">#</th>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3 w-28">SKU / Code</th>
                      <th className="py-2 px-3 w-20 text-right">Qty</th>
                      <th className="py-2 px-3 w-28 text-right">Unit Price</th>
                      <th className="py-2 px-3 w-20 text-right">Tax %</th>
                      <th className="py-2 px-3 w-28 text-right">Line Total</th>
                      <th className="py-2 px-2 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {extractedData.lineItems.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-slate-50/50">
                        <td className="py-1.5 px-3 font-mono text-muted">{idx + 1}</td>
                        <td className="py-1.5 px-3">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => handleLineItemChange(idx, 'description', e.target.value)}
                            className="w-full text-xs rounded border border-transparent hover:border-line focus:border-primary px-2 py-1 bg-transparent focus:bg-white"
                          />
                        </td>
                        <td className="py-1.5 px-3">
                          <input
                            type="text"
                            value={item.sku || item.productCode || ''}
                            onChange={(e) => handleLineItemChange(idx, 'sku', e.target.value)}
                            className="w-full text-xs font-mono rounded border border-transparent hover:border-line focus:border-primary px-2 py-1 bg-transparent focus:bg-white"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleLineItemChange(idx, 'quantity', Number(e.target.value))}
                            className="w-16 text-right text-xs rounded border border-transparent hover:border-line focus:border-primary px-2 py-1 bg-transparent focus:bg-white"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => handleLineItemChange(idx, 'unitPrice', Number(e.target.value))}
                            className="w-24 text-right text-xs rounded border border-transparent hover:border-line focus:border-primary px-2 py-1 bg-transparent focus:bg-white"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <input
                            type="number"
                            step="0.1"
                            value={item.taxRate ?? 5}
                            onChange={(e) => handleLineItemChange(idx, 'taxRate', Number(e.target.value))}
                            className="w-16 text-right text-xs rounded border border-transparent hover:border-line focus:border-primary px-2 py-1 bg-transparent focus:bg-white"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono font-medium text-ink">
                          {extractedData.currency} {Number(item.amount || item.quantity * item.unitPrice).toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteLineItem(idx)}
                            disabled={extractedData.lineItems.length <= 1}
                            className="p-1 text-muted hover:text-rose-600 disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Financial Totals Breakdown */}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-4 p-4 rounded-xl border border-line bg-slate-50/70">
              <div className="flex-1 text-xs text-muted">
                <span className="font-semibold text-ink-secondary">Financial Summary Check:</span>
                <p className="mt-1">
                  Adjust shipping, tax, or discounts if needed. Totals recompute dynamically and will be saved to the
                  ERP ledger.
                </p>
              </div>

              <div className="w-full sm:w-80 flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between items-center text-ink-secondary">
                  <span>Subtotal:</span>
                  <span className="font-mono font-medium">
                    {extractedData.currency} {Number(extractedData.subtotal).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-ink-secondary">
                  <span>Tax Amount:</span>
                  <span className="font-mono font-medium">
                    {extractedData.currency} {Number(extractedData.taxAmount).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-ink-secondary">
                  <span>Shipping Charges:</span>
                  <div className="flex items-center gap-1">
                    <span className="text-muted font-mono">{extractedData.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={extractedData.shippingCharges}
                      onChange={(e) => handleFieldChange('shippingCharges', Number(e.target.value))}
                      className="w-20 text-right text-xs rounded border border-line bg-white px-2 py-0.5"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-ink-secondary">
                  <span>Discount:</span>
                  <div className="flex items-center gap-1">
                    <span className="text-muted font-mono">{extractedData.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={extractedData.discountAmount}
                      onChange={(e) => handleFieldChange('discountAmount', Number(e.target.value))}
                      className="w-20 text-right text-xs rounded border border-line bg-white px-2 py-0.5"
                    />
                  </div>
                </div>
                <div className="border-t border-line pt-1.5 flex justify-between items-center font-bold text-ink text-sm">
                  <span>Grand Total:</span>
                  <span className="font-mono text-primary">
                    {extractedData.currency} {Number(extractedData.grandTotal).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions for Step 2 */}
            <div className="flex items-center justify-between pt-2 border-t border-line">
              <Button variant="outline" onClick={() => setStep('upload')} iconLeft={<ArrowLeft className="h-4 w-4" />}>
                Back to Upload
              </Button>

              <div className="flex items-center gap-2">
                {onApplyToProforma && (
                  <Button variant="secondary" onClick={handleApplyToBuilder}>
                    Apply to Proforma Form
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => setStep('confirm')}
                  iconRight={<ArrowRight className="h-4 w-4" />}
                >
                  Proceed to Confirm & Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ----------------- STEP 3: STRICT CONFIRMATION ----------------- */}
        {step === 'confirm' && extractedData && (
          <div className="flex flex-col gap-4 py-2">
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Save className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink">
                  Confirm ERP Record Creation ({saveType === 'PROFORMA' ? 'Proforma Invoice' : 'Tax Invoice'})
                </h4>
                <p className="text-xs text-ink-secondary mt-1">
                  You are about to save this document into the ERP database. Please confirm the key details below:
                </p>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-line bg-surface">
                <span className="text-muted text-[11px] block">Document Type</span>
                <span className="font-bold text-ink">
                  {saveType === 'PROFORMA' ? 'Proforma Quotation' : 'Commercial Tax Invoice'}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-line bg-surface">
                <span className="text-muted text-[11px] block">Customer</span>
                <span className="font-bold text-ink truncate block">{extractedData.companyName}</span>
              </div>
              <div className="p-3 rounded-lg border border-line bg-surface">
                <span className="text-muted text-[11px] block">Line Items Count</span>
                <span className="font-bold text-ink">{extractedData.lineItems.length} lines</span>
              </div>
              <div className="p-3 rounded-lg border border-line bg-surface">
                <span className="text-muted text-[11px] block">Grand Total</span>
                <span className="font-bold text-primary font-mono">
                  {extractedData.currency} {Number(extractedData.grandTotal).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>
                Original PDF is secured in Cloud Documents repository (ID: {cloudDocument?.id || 'CloudDoc'}).
              </span>
            </div>

            {/* Actions for Step 3 */}
            <div className="flex items-center justify-between pt-3 border-t border-line">
              <Button variant="outline" onClick={() => setStep('review')} disabled={isSaving}>
                Back to Edit
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={handleConfirmSave}
                  disabled={isSaving}
                  loading={isSaving}
                  iconLeft={<CheckCircle2 className="h-4 w-4" />}
                >
                  {isSaving ? 'Saving to ERP...' : `Confirm & Save as ${saveType === 'PROFORMA' ? 'Proforma' : 'Invoice'}`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ----------------- STEP 4: SUCCESS ----------------- */}
        {step === 'success' && savedResult && (
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div>
              <h3 className="text-base font-bold text-ink">Successfully Saved to ERP</h3>
              <p className="text-xs text-muted mt-1">
                The document has been created with number <span className="font-mono font-bold text-ink">{savedResult.number}</span>.
              </p>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <Button variant="outline" onClick={handleReset}>
                Process Another PDF
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                  if (savedResult.redirectUrl) router.push(savedResult.redirectUrl);
                }}
              >
                View in ERP
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
