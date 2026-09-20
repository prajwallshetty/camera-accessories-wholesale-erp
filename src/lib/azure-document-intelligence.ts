/**
 * Azure AI Document Intelligence Service
 * Handles PDF data extraction for standard & scanned documents using prebuilt invoice/document models.
 */

export interface ExtractedLineItem {
  id: string;
  description: string;
  productCode?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  taxAmount?: number;
  amount: number;
}

export interface ExtractedDocumentData {
  documentType: 'PROFORMA' | 'TAX_INVOICE' | 'PURCHASE_INVOICE' | 'OTHER';
  invoiceNumber: string;
  proformaNumber?: string;
  customerName: string;
  supplierName?: string;
  companyName: string;
  email?: string;
  phone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency: string;
  paymentTerms?: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  shippingCharges: number;
  otherCharges: number;
  grandTotal: number;
  lineItems: ExtractedLineItem[];
  rawConfidence?: number;
  isScannedOcr?: boolean;
  pageCount?: number;
  notes?: string;
  isDemoFallback?: boolean;
}

export function getAzureConfig() {
  const endpoint =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ||
    process.env.AZURE_FORM_RECOGNIZER_ENDPOINT ||
    '';
  const key =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ||
    process.env.AZURE_FORM_RECOGNIZER_KEY ||
    '';

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    key: key.trim(),
    isConfigured: Boolean(endpoint && key),
  };
}

/**
 * Polls the Azure Operation-Location URL until completion
 */
async function pollOperationResult(operationLocation: string, apiKey: string, maxAttempts = 35): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const res = await fetch(operationLocation, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Azure polling failed with status ${res.status}: ${errText}`);
    }

    const data = await res.json();
    if (data.status === 'succeeded') {
      return data.analyzeResult;
    }
    if (data.status === 'failed') {
      throw new Error(data.error?.message || 'Azure Document Intelligence analysis failed');
    }
  }

  throw new Error('Azure Document Intelligence analysis timed out after 45 seconds');
}

/**
 * Safe field value extractor from Azure analyzeResult
 */
function getFieldValue(fields: Record<string, any> | undefined, fieldName: string): any {
  if (!fields || !fields[fieldName]) return undefined;
  const field = fields[fieldName];

  if (field.valueCurrency) {
    return {
      amount: field.valueCurrency.amount,
      currencyCode: field.valueCurrency.currencyCode || field.valueCurrency.currencySymbol,
    };
  }
  if (field.valueDate !== undefined) return field.valueDate;
  if (field.valueNumber !== undefined) return field.valueNumber;
  if (field.valueString !== undefined) return field.valueString;
  if (field.valueAddress !== undefined) {
    const a = field.valueAddress;
    return (
      a.streetAddress ||
      [a.houseNumber, a.road, a.city, a.state, a.postalCode, a.countryRegion]
        .filter(Boolean)
        .join(', ') ||
      field.content
    );
  }
  return field.content || undefined;
}

/**
 * Parses Azure analyzeResult into normalized ExtractedDocumentData
 */
function parseAzureAnalyzeResult(analyzeResult: any, fileName?: string, isImageSource?: boolean): ExtractedDocumentData {
  const document = analyzeResult?.documents?.[0];
  const fields = document?.fields || {};

  const invoiceNumber =
    getFieldValue(fields, 'InvoiceId') ||
    getFieldValue(fields, 'PurchaseOrder') ||
    `INV-${Date.now().toString().slice(-6)}`;

  const customerName =
    getFieldValue(fields, 'CustomerName') ||
    getFieldValue(fields, 'CustomerAddressRecipient') ||
    'Commercial Customer';

  const companyName =
    getFieldValue(fields, 'CustomerName') ||
    getFieldValue(fields, 'CustomerAddressRecipient') ||
    customerName;

  const supplierName =
    getFieldValue(fields, 'VendorName') ||
    getFieldValue(fields, 'VendorAddressRecipient') ||
    'ARIB GLOBAL Wholesale';

  const billingAddress =
    getFieldValue(fields, 'BillingAddress') ||
    getFieldValue(fields, 'CustomerAddress') ||
    '';

  const shippingAddress =
    getFieldValue(fields, 'ShippingAddress') ||
    billingAddress ||
    '';

  const invoiceDate =
    getFieldValue(fields, 'InvoiceDate') ||
    new Date().toISOString().split('T')[0];

  const dueDate =
    getFieldValue(fields, 'DueDate') ||
    new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const paymentTerms =
    getFieldValue(fields, 'PaymentTerm') ||
    'NET 30 Days';

  // Currency & Totals
  const totalObj = getFieldValue(fields, 'InvoiceTotal');
  const grandTotal = typeof totalObj === 'object' ? totalObj.amount || 0 : Number(totalObj) || 0;
  const currency = (typeof totalObj === 'object' ? totalObj.currencyCode : null) || 'USD';

  const subtotalObj = getFieldValue(fields, 'SubTotal');
  const subtotal = typeof subtotalObj === 'object' ? subtotalObj.amount || 0 : Number(subtotalObj) || grandTotal;

  const taxObj = getFieldValue(fields, 'TotalTax');
  const taxAmount = typeof taxObj === 'object' ? taxObj.amount || 0 : Number(taxObj) || 0;

  const shippingCostObj = getFieldValue(fields, 'ShippingCost');
  const shippingCharges = typeof shippingCostObj === 'object' ? shippingCostObj.amount || 0 : Number(shippingCostObj) || 0;

  // Extract Line items
  const itemsField = fields.Items?.valueArray || [];
  const lineItems: ExtractedLineItem[] = [];

  for (let i = 0; i < itemsField.length; i++) {
    const itemObj = itemsField[i]?.valueObject || {};
    const description = getFieldValue(itemObj, 'Description') || `Product / Equipment Line #${i + 1}`;
    const productCode = getFieldValue(itemObj, 'ProductCode') || '';
    const quantity = Number(getFieldValue(itemObj, 'Quantity')) || 1;
    const unitPriceObj = getFieldValue(itemObj, 'UnitPrice');
    const unitPrice = typeof unitPriceObj === 'object' ? unitPriceObj.amount || 0 : Number(unitPriceObj) || 0;
    const amountObj = getFieldValue(itemObj, 'Amount');
    const amount = typeof amountObj === 'object' ? amountObj.amount || 0 : Number(amountObj) || quantity * unitPrice;
    const taxRate = Number(getFieldValue(itemObj, 'TaxRate')) || 5;

    lineItems.push({
      id: `item-${i + 1}-${Date.now()}`,
      description,
      productCode,
      sku: productCode || `SKU-${description.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
      quantity,
      unitPrice,
      taxRate,
      amount: amount || quantity * unitPrice,
    });
  }

  // Infer Document Type
  const lowerName = (fileName || '').toLowerCase();
  let documentType: 'PROFORMA' | 'TAX_INVOICE' | 'PURCHASE_INVOICE' | 'OTHER' = 'PROFORMA';
  if (lowerName.includes('tax') || lowerName.includes('commercial')) {
    documentType = 'TAX_INVOICE';
  } else if (lowerName.includes('purchase') || lowerName.includes('po-')) {
    documentType = 'PURCHASE_INVOICE';
  } else if (lowerName.includes('proforma') || lowerName.includes('quote') || lowerName.includes('pi-')) {
    documentType = 'PROFORMA';
  }

  return {
    documentType,
    invoiceNumber: String(invoiceNumber),
    proformaNumber: documentType === 'PROFORMA' ? String(invoiceNumber) : undefined,
    customerName,
    companyName,
    supplierName,
    billingAddress,
    shippingAddress,
    invoiceDate,
    dueDate,
    currency: currency.toUpperCase(),
    paymentTerms,
    subtotal: subtotal || grandTotal,
    taxAmount,
    discountAmount: 0,
    shippingCharges,
    otherCharges: 0,
    grandTotal: grandTotal || subtotal + taxAmount + shippingCharges,
    lineItems: lineItems.length > 0 ? lineItems : [
      {
        id: `item-1-${Date.now()}`,
        description: 'Camera / Optical Equipment',
        sku: 'OPTIC-EQP-01',
        quantity: 1,
        unitPrice: grandTotal || 1000,
        amount: grandTotal || 1000,
        taxRate: 5,
      },
    ],
    pageCount: analyzeResult?.pages?.length || 1,
    rawConfidence: document?.confidence || 0.95,
    isScannedOcr: Boolean(isImageSource),
  };
}

/**
 * High-quality fallback/mock extraction for demonstration or when Azure credentials are not yet set
 */
function getFallbackExtraction(fileName?: string): ExtractedDocumentData {
  const cleanName = (fileName || 'Commercial_Invoice.pdf').replace(/\.[^/.]+$/, '');
  const now = new Date().toISOString().split('T')[0];
  const due = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  return {
    documentType: cleanName.toLowerCase().includes('tax') ? 'TAX_INVOICE' : 'PROFORMA',
    invoiceNumber: `PI-${Date.now().toString().slice(-6)}`,
    proformaNumber: `PI-${Date.now().toString().slice(-6)}`,
    customerName: 'Aero Cine Productions LLC',
    companyName: 'Aero Cine Productions LLC',
    supplierName: 'ARIB GLOBAL Cine Equipment',
    email: 'purchasing@aerocine.com',
    phone: '+971 4 398 2200',
    billingAddress: 'Studio City, Building 4, Office 302, Dubai, UAE',
    shippingAddress: 'Central Logistics Hub, Free Zone Area, Dubai, UAE',
    invoiceDate: now,
    dueDate: due,
    currency: 'USD',
    paymentTerms: 'NET 30 Days from Dispatch',
    subtotal: 5800,
    taxAmount: 290,
    discountAmount: 0,
    shippingCharges: 150,
    otherCharges: 0,
    grandTotal: 6240,
    lineItems: [
      {
        id: `item-1-${Date.now()}`,
        description: 'Sony FX3 Full-Frame Cinema Line Camera Body',
        sku: 'SONY-FX3',
        productCode: 'ILME-FX3',
        quantity: 1,
        unitPrice: 3899,
        taxRate: 5,
        amount: 3899,
      },
      {
        id: `item-2-${Date.now()}`,
        description: 'Sony FE 24-70mm f/2.8 GM II E-Mount Zoom Lens',
        sku: 'SONY-2470-GM2',
        productCode: 'SEL2470GM2',
        quantity: 1,
        unitPrice: 1901,
        taxRate: 5,
        amount: 1901,
      },
    ],
    pageCount: 1,
    rawConfidence: 0.98,
    isDemoFallback: true,
    notes: 'Parsed via Azure Document Intelligence mock runner. Add AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY to .env to connect live Azure Cloud OCR.',
  };
}

/**
 * Main Extraction Entrypoint
 */
const SUPPORTED_AZURE_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/bmp',
  'image/tiff',
  'image/heif',
]);

/** Normalizes an arbitrary file mime type to one Azure Document Intelligence accepts. */
function resolveAzureContentType(mimeType?: string): string {
  const normalized = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_AZURE_CONTENT_TYPES.has(normalized)) return normalized;
  return 'application/pdf';
}

export async function extractDocumentWithAzure(
  fileBuffer: Buffer | Uint8Array,
  fileName?: string,
  mimeType?: string
): Promise<ExtractedDocumentData> {
  const { endpoint, key, isConfigured } = getAzureConfig();

  if (!isConfigured) {
    console.warn(
      '[Azure Document Intelligence] AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT or AZURE_DOCUMENT_INTELLIGENCE_KEY not set. Using structured fallback demonstration extractor.'
    );
    return getFallbackExtraction(fileName);
  }

  const contentType = resolveAzureContentType(mimeType);
  // Scanned PDFs are handled by ocrHighResolution below; the flag is invalid for
  // plain image analysis, so only request it when we're actually sending a PDF.
  const ocrFeatureQuery = contentType === 'application/pdf' ? '&features=ocrHighResolution' : '';

  try {
    // Try latest 2024-11-30 API first, fallback to 2023-07-31
    const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30${ocrFeatureQuery}`;

    let postRes = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': contentType,
      },
      body: fileBuffer as any,
    });

    if (!postRes.ok && postRes.status === 404) {
      // Fallback to 2023-07-31 formrecognizer API endpoint
      const fallbackUrl = `${endpoint}/formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=2023-07-31`;
      postRes = await fetch(fallbackUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': contentType,
        },
        body: fileBuffer as any,
      });
    }

    if (!postRes.ok) {
      const errText = await postRes.text().catch(() => '');
      throw new Error(`Azure API error (${postRes.status}): ${errText}`);
    }

    const operationLocation = postRes.headers.get('Operation-Location');
    if (!operationLocation) {
      throw new Error('Azure response did not include an Operation-Location header for polling');
    }

    const analyzeResult = await pollOperationResult(operationLocation, key);
    return parseAzureAnalyzeResult(analyzeResult, fileName, contentType !== 'application/pdf');
  } catch (err: any) {
    console.error('[Azure Document Intelligence Extraction Error]:', err.message);
    throw err;
  }
}
