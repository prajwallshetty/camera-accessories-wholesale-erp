'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  FileText,
  Printer,
  Mail,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Building2,
  Calendar,
  Clock,
  DollarSign,
  Share2,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ServiceInvoice } from '@/types/erp';
import { formatUSD, formatDate } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { Button, IconButton, LinkButton } from '@/components/ui/Button';

export default function ServiceInvoiceDetailPage() {
  const params = useParams();
  const { toast } = useToast();
  const router = useRouter();
  const id = params.id as string;
  const [invoice, setInvoice] = useState<ServiceInvoice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchInvoice = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/service-invoices/${id}`);
      if (res.ok) {
        const data = await res.json();
        setInvoice(data);
      }
    } catch (err) {
      console.error('Error fetching service invoice detail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoice();
  }, [id]);

  const handleSendEmail = async () => {
    if (!invoice) return;
    setIsSendingEmail(true);

    try {
      const res = await fetch(`/api/service-invoices/${invoice.id}/email`, {
        method: 'POST',
      });
      const data = await res.json();

      if (res.ok) {
        const isSimulated = Boolean(data.simulated);
        toast({
          title: isSimulated ? 'Email Logged (SMTP not configured)' : 'Service Invoice Emailed',
          description:
            data.message ||
            (isSimulated
              ? 'SMTP is not configured, so the email was logged but not delivered. Add SMTP credentials in Settings.'
              : `Invoice emailed successfully to ${invoice.customerEmail}`),
          variant: isSimulated ? 'warning' : 'success',
        });
        setInvoice((prev) => (prev ? { ...prev, emailStatus: 'SENT', status: prev.status === 'DRAFT' ? 'SENT' : prev.status } : null));
      } else {
        toast({
          title: 'Delivery Failed',
          description: data.error || 'Unable to send email',
          variant: 'error',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Email delivery failed',
        variant: 'error',
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!invoice) return;
    setIsUpdatingStatus(true);

    try {
      const res = await fetch(`/api/service-invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update status');
      }

      toast({
        title: 'Status Updated',
        description: `Invoice status changed to ${newStatus}`,
        variant: 'success',
      });
      setInvoice((prev) => (prev ? { ...prev, status: newStatus as any } : null));
    } catch (err: any) {
      toast({
        title: 'Update Error',
        description: err.message || 'Failed to update status',
        variant: 'error',
      });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDelete = async () => {
    if (!invoice) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/service-invoices/${invoice.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete service invoice');
      }
      toast({ title: 'Service invoice deleted', variant: 'success' });
      router.push('/service-invoices');
    } catch (err: any) {
      toast({ title: err.message || 'Delete failed', variant: 'error' });
      setIsDeleting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center bg-white rounded-2xl border border-line max-w-4xl mx-auto my-8">
        <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto" />
        <p className="text-xs text-muted mt-2">Loading service invoice details...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-12 text-center bg-white rounded-2xl border border-line max-w-4xl mx-auto my-8 space-y-3">
        <FileText className="h-10 w-10 text-danger mx-auto" />
        <h2 className="text-base font-bold text-ink">Service Invoice Not Found</h2>
        <LinkButton href="/service-invoices" iconLeft={<ArrowLeft className="h-4 w-4" />}>
          Return to Service Invoices
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-24 animate-fade-in print:p-0 print:m-0 print:max-w-none">
      {/* Top Action Bar (Hidden when printing) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-line print:hidden">
        <Link
          href="/service-invoices"
          className="flex items-center gap-2 text-xs font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Service Invoices</span>
        </Link>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={invoice.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={isUpdatingStatus}
            className="h-10 px-3.5 rounded-full bg-surface border border-line text-xs font-semibold text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring"
          >
            <option value="DRAFT">DRAFT</option>
            <option value="ISSUED">ISSUED</option>
            <option value="SENT">SENT</option>
            <option value="PAID">PAID</option>
            <option value="PARTIALLY_PAID">PARTIALLY PAID</option>
            <option value="OVERDUE">OVERDUE</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>

          <Button variant="outline" onClick={handlePrint} iconLeft={<Printer className="h-4 w-4" />}>
            Print PDF
          </Button>

          <Button
            onClick={handleSendEmail}
            loading={isSendingEmail}
            iconLeft={!isSendingEmail ? <Mail className="h-4 w-4" /> : undefined}
          >
            Email Customer
          </Button>

          {(invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') && (
            <IconButton
              label="Delete Service Invoice"
              className="border border-line text-muted hover:text-danger hover:bg-danger-soft"
              onClick={() => setIsDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Printable Service Invoice Document */}
      <div className="bg-white rounded-2xl border border-line p-8 sm:p-12 space-y-8 print:border-none print:shadow-none print:p-0">
        {/* Header Branding */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 pb-6 border-b border-[#E5E7EB]">
          <div>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pdflogo.png" alt="ARIB GLOBAL" className="h-10 w-auto object-contain" />
              <div>
                <div className="text-xl font-bold tracking-tight text-[#005E82]">ARIB GLOBAL</div>
                <div className="text-[10px] text-[#6B7280] uppercase tracking-wider font-mono">
                  General Trading LLC • Corporate Services
                </div>
              </div>
            </div>
            <p className="text-xs text-[#6B7280] mt-3">
              Office 402, Business Bay, Dubai, United Arab Emirates<br />
              TRN: 100889218200001 • Contact: contact@growthbridge.com
            </p>
          </div>

          <div className="sm:text-right">
            <span className="px-3 py-1 rounded-lg bg-[#005E82] text-white text-xs font-mono font-bold tracking-widest uppercase inline-block mb-2">
              SERVICE INVOICE
            </span>
            <div className="text-xl font-mono font-bold text-[#111827]">#{invoice.invoiceNumber}</div>
            <div className="text-xs text-[#6B7280] font-mono mt-1">Issue Date: {formatDate(invoice.issueDate)}</div>
            <div className="text-xs font-mono text-red-600 font-bold">Payment Due: {formatDate(invoice.dueDate)}</div>
          </div>
        </div>

        {/* Billed To / Company Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-6 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] text-xs">
          <div>
            <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider font-mono block mb-1">
              Billed To Customer:
            </span>
            <div className="font-bold text-[#111827] text-sm">{invoice.customerCompany}</div>
            <div className="text-[#6B7280]">{invoice.customerName}</div>
            <div className="text-[#6B7280] font-mono">{invoice.customerEmail}</div>
            {invoice.billingAddress && <div className="text-[#6B7280] mt-1">{invoice.billingAddress}</div>}
          </div>

          <div className="sm:text-right space-y-1 font-mono">
            <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider font-mono block mb-1">
              Payment Terms & Currency:
            </span>
            <div>Payment Terms: <span className="font-bold text-[#111827]">{invoice.paymentTerms}</span></div>
            <div>Billing Currency: <span className="font-bold text-[#005E82]">USD ($)</span></div>
            <div>Status: <span className="font-bold text-[#15803D]">{invoice.status}</span></div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-[#6B7280] uppercase tracking-wider font-mono">
            Billed Business Services
          </h3>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-y border-[#E5E7EB] text-[11px] font-bold text-[#6B7280] uppercase tracking-wider font-mono">
                  <th className="py-3 px-3">#</th>
                  <th className="py-3 px-3">Service Description</th>
                  <th className="py-3 px-3 text-center">Category</th>
                  <th className="py-3 px-3 text-center">Qty</th>
                  <th className="py-3 px-3 text-right">Unit Rate</th>
                  <th className="py-3 px-3 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {(invoice.items || []).map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td className="py-3.5 px-3 font-mono text-[#6B7280]">{idx + 1}</td>
                    <td className="py-3.5 px-3 font-semibold text-[#111827]">{item.description}</td>
                    <td className="py-3.5 px-3 text-center font-mono">
                      <span className="px-2 py-0.5 rounded bg-[#005E82]/10 text-[#005E82] text-[10px] font-bold">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono font-bold">{item.quantity}</td>
                    <td className="py-3.5 px-3 text-right font-mono">{formatUSD(item.unitPrice)}</td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold text-[#005E82]">
                      {formatUSD(item.totalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2.5">
            {(invoice.items || []).map((item, idx) => (
              <div key={item.id || idx} className="rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] p-3.5 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold text-[#111827]">
                    <span className="font-mono text-[#6B7280] mr-1.5">{idx + 1}.</span>
                    {item.description}
                  </div>
                  <span className="shrink-0 px-2 py-0.5 rounded bg-[#005E82]/10 text-[#005E82] text-[10px] font-bold">
                    {item.category}
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[#6B7280] pt-1.5 border-t border-[#E5E7EB]">
                  <span>Qty <span className="font-bold text-[#111827]">{item.quantity}</span> × {formatUSD(item.unitPrice)}</span>
                  <span className="font-bold text-[#005E82]">{formatUSD(item.totalPrice)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totals Breakdown */}
        <div className="flex flex-col sm:flex-row justify-between gap-6 pt-4 border-t border-[#E5E7EB]">
          <div className="space-y-2 text-xs text-[#6B7280] max-w-xs">
            <span className="font-bold text-[#111827] block">Notes & Conditions:</span>
            <p>{invoice.notes || 'Payment due strictly as per terms. Please reference invoice number on remittance.'}</p>
          </div>

          <div className="w-full sm:w-72 space-y-2 text-xs font-mono p-4 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB]">
            <div className="flex justify-between text-[#6B7280]">
              <span>Subtotal:</span>
              <span className="font-bold text-[#111827]">{formatUSD(invoice.subtotal)}</span>
            </div>
            {invoice.discountAmount > 0 && (
              <div className="flex justify-between text-[#15803D]">
                <span>Discount:</span>
                <span className="font-bold">-{formatUSD(invoice.discountAmount)}</span>
              </div>
            )}
            {invoice.taxAmount > 0 && (
              <div className="flex justify-between text-[#6B7280]">
                <span>Tax:</span>
                <span className="font-bold">+{formatUSD(invoice.taxAmount)}</span>
              </div>
            )}
            {invoice.otherCharges > 0 && (
              <div className="flex justify-between text-[#6B7280]">
                <span>Other Surcharges:</span>
                <span className="font-bold">+{formatUSD(invoice.otherCharges)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-[#E5E7EB] flex justify-between text-base font-bold text-[#005E82]">
              <span>Grand Total:</span>
              <span>{formatUSD(invoice.grandTotal)} USD</span>
            </div>
          </div>
        </div>

        {/* Sign-off & Official Company Seal or Draft Signatory Line */}
        <div className="flex flex-col sm:flex-row justify-between items-end gap-6 pt-6 border-t border-[#E5E7EB] mt-6">
          <div className="space-y-1 text-xs text-[#6B7280]">
            <div className="font-bold uppercase tracking-wider text-[#111827]">
              For ARIB GLOBAL GENERAL TRADING L.L.C
            </div>
            <div>Corporate Services & Wholesale Division</div>
            <div className="font-mono text-[10px]">TRN: 100889218200001 • Dubai, United Arab Emirates</div>
            <div className="text-[10px] italic text-[#9CA3AF] pt-2">
              {invoice.status === 'SENT' || invoice.status === 'PAID'
                ? 'THIS IS A COMPUTER GENERATED SERVICE INVOICE • OFFICIALLY AUTHENTICATED'
                : invoice.status === 'CANCELLED'
                ? 'CANCELLED SERVICE INVOICE • VOID & UNOFFICIAL'
                : 'PRELIMINARY DRAFT SERVICE INVOICE • PENDING OFFICIAL ISSUANCE'}
            </div>
          </div>

          <div className="flex flex-col items-center justify-end text-center shrink-0">
            {invoice.status === 'SENT' || invoice.status === 'PAID' ? (
              <>
                <div className="relative flex items-center justify-center mb-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/arib-seal.png"
                    alt="ARIB GLOBAL Official Company Seal"
                    className="h-28 w-28 object-contain shrink-0 select-none print:h-28 print:w-28"
                    style={{ aspectRatio: '1 / 1' }}
                  />
                </div>
                <div className="border-t border-[#9CA3AF] pt-1 w-36 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#111827]">
                    Official Company Seal
                  </div>
                  <div className="text-[9px] text-[#6B7280] uppercase tracking-widest font-mono">
                    Authorized Signatory
                  </div>
                </div>
              </>
            ) : (
              <div className="w-36">
                <div className="h-16 border-b border-line border-dashed mb-1 flex items-end justify-center pb-1">
                  <span className="text-[10px] text-muted italic">Signature</span>
                </div>
                <div className="border-t border-line pt-1 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#111827]">
                    Authorized Signatory
                  </div>
                  <div className="text-[9px] text-[#6B7280] uppercase tracking-widest font-mono">
                    {invoice.status === 'CANCELLED' ? 'Void / Cancelled' : 'Preliminary / Unsealed'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        title={`Delete Service Invoice #${invoice.invoiceNumber}?`}
        description="Are you sure you want to permanently delete this service invoice? This cannot be undone."
        confirmLabel="Delete Invoice"
        destructive
        loading={isDeleting}
      />
    </div>
  );
}
