'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileCheck2,
  PlusCircle,
  Printer,
  CheckCircle,
  Plus,
  Trash2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/Modal';
import { formatUSD, formatDate } from '@/lib/utils';
import { Proforma } from '@/types/erp';
import PrintableDocumentModal from '@/components/pdf/PrintableDocumentModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton, IconButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchInput } from '@/components/ui/Input';
import { Toolbar, ToolbarGroup, FilterPillGroup } from '@/components/ui/FilterBar';
import { fetchWithCache } from '@/lib/client-cache';

export default function ProformasPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedDoc, setSelectedDoc] = useState<Proforma | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [deletingProforma, setDeletingProforma] = useState<Proforma | null>(null);
  const [cancellingProforma, setCancellingProforma] = useState<Proforma | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadData = async (force = false, activeRef?: { current: boolean }) => {
    setIsLoading(true);
    setError(null);
    try {
      const qParams = new URLSearchParams();
      if (debouncedSearch) qParams.set('q', debouncedSearch);
      if (filterStatus && filterStatus !== 'ALL') qParams.set('status', filterStatus);
      const url = `/api/proformas${qParams.toString() ? `?${qParams.toString()}` : ''}`;
      const data = await fetchWithCache<Proforma[]>(url, undefined, force ? 0 : 5000);
      if (activeRef && !activeRef.current) return;
      if (Array.isArray(data)) {
        setProformas(data);
      } else {
        setProformas([]);
      }
    } catch (err: any) {
      if (activeRef && !activeRef.current) return;
      if (err?.message?.includes('401')) {
        router.push('/login?next=/proformas');
        return;
      }
      setError(err?.message || 'Something went wrong. Please try again.');
      setProformas([]);
    } finally {
      if (!activeRef || activeRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const activeRef = { current: true };
    loadData(true, activeRef);
    return () => {
      activeRef.current = false;
    };
  }, [debouncedSearch, filterStatus]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/events');
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'PROFORMA_UPDATED' || payload.type === 'PROFORMA_CONFIRMED') {
            loadData(true);
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  const handleApprove = async (proformaId: string) => {
    setApprovingId(proformaId);
    try {
      const res = await fetch(`/api/proformas/${proformaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CONFIRMED' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to approve proforma');
      }
      toast({ title: 'Proforma approved', variant: 'success' });
      loadData(true);
    } catch (err: any) {
      toast({ title: err.message || 'Could not approve proforma', variant: 'error' });
    } finally {
      setApprovingId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancellingProforma) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/proformas/${cancellingProforma.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to cancel proforma');
      }
      toast({ title: 'Proforma quotation cancelled', variant: 'success' });
      setCancellingProforma(null);
      loadData(true);
    } catch (err: any) {
      toast({ title: err.message || 'Could not cancel proforma', variant: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingProforma) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/proformas/${deletingProforma.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete proforma');
      }
      toast({ title: 'Proforma deleted', variant: 'success' });
      setDeletingProforma(null);
      loadData(true);
    } catch (err: any) {
      toast({ title: err.message || 'Could not delete proforma', variant: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredProformas = proformas.filter((pf) => {
    if (filterStatus !== 'ALL' && pf.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        (pf.proformaNumber || '').toLowerCase().includes(q) ||
        (pf.customerCompany || '').toLowerCase().includes(q) ||
        (pf.customerName || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const totalProformaValue = filteredProformas.reduce((sum, pf) => sum + pf.grandTotal, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-muted text-xs font-medium">Loading proforma quotations...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Proformas"
        description="Create, approve, and convert customer quotations and sales proposals into tax invoices."
        actions={
          <LinkButton href="/proformas/new" iconLeft={<PlusCircle className="h-4 w-4" />}>
            New Proforma
          </LinkButton>
        }
      />

      {error && (
        <div className="p-3 rounded-2xl bg-danger-soft border border-danger-border text-danger text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Compact summary indicators */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-ink text-white px-4 h-9 text-xs font-semibold">
          Total <span className="tabular-nums">{filteredProformas.length}</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft text-primary px-4 h-9 text-xs font-semibold">
          Pipeline Value <span className="tabular-nums">{formatUSD(totalProformaValue)}</span>
        </div>
      </div>

      {/* Filters + Search + Actions */}
      <Toolbar>
        <ToolbarGroup>
          <FilterPillGroup
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { label: 'All', value: 'ALL' },
              { label: 'Draft', value: 'DRAFT' },
              { label: 'Sent', value: 'SENT' },
              { label: 'Confirmed', value: 'CONFIRMED' },
              { label: 'Converted', value: 'CONVERTED' },
              { label: 'Cancelled', value: 'CANCELLED' },
            ]}
          />
        </ToolbarGroup>
        <SearchInput
          placeholder="Search proforma #, customer..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="w-full lg:w-72"
        />
      </Toolbar>

      {/* Table */}
      <div>
        {filteredProformas.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white">
            <EmptyState
              icon={FileCheck2}
              title="No Proformas Found"
              description="Create a new proforma quotation to start tracking wholesale pipeline orders."
              action={
                <LinkButton href="/proformas/new" iconLeft={<Plus className="h-4 w-4" />}>
                  New Proforma
                </LinkButton>
              }
            />
          </div>
        ) : (
          <>
          <div className="md:hidden space-y-3">
            {filteredProformas.map((pf) => (
              <Card
                key={pf.id}
                className="p-4 space-y-2.5 cursor-pointer"
                onClick={() => router.push(`/proformas/${pf.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/proformas/${pf.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-primary hover:underline text-sm"
                    >
                      {pf.proformaNumber}
                    </Link>
                    <div className="font-medium text-ink text-sm truncate">{pf.customerCompany}</div>
                    <div className="text-xs text-muted truncate">{pf.customerName}</div>
                  </div>
                  <StatusBadge status={pf.status} className="shrink-0" />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-ink tabular-nums">{formatUSD(pf.grandTotal)}</span>
                  <span className="text-xs text-muted">{formatDate(pf.issueDate)}</span>
                </div>

                {pf.convertedToInvoiceNumber && (
                  <div className="text-[11px] text-success flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    <span>Inv: {pf.convertedToInvoiceNumber}</span>
                  </div>
                )}

                <div
                  className="flex items-center justify-end gap-1.5 pt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {(pf.status === 'DRAFT' || pf.status === 'SENT') && (
                    <Button
                      size="sm"
                      onClick={() => handleApprove(pf.id)}
                      loading={approvingId === pf.id}
                    >
                      Approve
                    </Button>
                  )}
                  {pf.status === 'CONFIRMED' && (
                    <LinkButton href={`/proformas/${pf.id}`} size="sm" className="bg-success text-white hover:bg-success/90">
                      Convert
                    </LinkButton>
                  )}
                  <IconButton label="Print / PDF" onClick={() => setSelectedDoc(pf)}>
                    <Printer className="h-3.5 w-3.5 text-muted" />
                  </IconButton>
                  <LinkButton href={`/proformas/${pf.id}`} size="sm" variant="secondary">
                    View
                  </LinkButton>
                  {pf.status !== 'CONVERTED' && pf.status !== 'CANCELLED' && (
                    <IconButton
                      label="Cancel Proforma"
                      onClick={() => setCancellingProforma(pf)}
                      className="text-muted hover:text-warning hover:bg-warning-soft"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                  {(pf.status === 'DRAFT' || pf.status === 'CANCELLED') && (
                    <IconButton
                      label="Delete Proforma"
                      onClick={() => setDeletingProforma(pf)}
                      className="text-muted hover:text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </div>
              </Card>
            ))}
          </div>
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableHead>Proforma #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead align="right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableHeader>
            <TableBody>
              {filteredProformas.map((pf) => (
                <TableRow key={pf.id}>
                  <TableCell>
                    <Link
                      href={`/proformas/${pf.id}`}
                      className="font-semibold text-primary hover:underline text-sm"
                    >
                      {pf.proformaNumber}
                    </Link>
                    {pf.convertedToInvoiceNumber && (
                      <div className="text-[11px] text-success flex items-center gap-1 mt-0.5">
                        <CheckCircle className="h-3 w-3" />
                        <span>Inv: {pf.convertedToInvoiceNumber}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-ink text-sm">{pf.customerCompany}</div>
                    <div className="text-xs text-muted">{pf.customerName}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-ink-secondary">{pf.managerName}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted">{formatDate(pf.issueDate)}</span>
                  </TableCell>
                  <TableCell align="right" className="font-semibold text-sm text-ink tabular-nums">
                    {formatUSD(pf.grandTotal)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={pf.status} />
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-1.5">
                      {(pf.status === 'DRAFT' || pf.status === 'SENT') && (
                        <Button
                          size="sm"
                          onClick={() => handleApprove(pf.id)}
                          loading={approvingId === pf.id}
                        >
                          Approve
                        </Button>
                      )}

                      {pf.status === 'CONFIRMED' && (
                        <LinkButton href={`/proformas/${pf.id}`} size="sm" className="bg-success text-white hover:bg-success/90">
                          Convert
                        </LinkButton>
                      )}

                      <IconButton label="Print / PDF" onClick={() => setSelectedDoc(pf)}>
                        <Printer className="h-3.5 w-3.5 text-muted" />
                      </IconButton>
                      <LinkButton href={`/proformas/${pf.id}`} size="sm" variant="secondary">
                        View
                      </LinkButton>

                      {pf.status !== 'CONVERTED' && pf.status !== 'CANCELLED' && (
                        <IconButton
                          label="Cancel Proforma"
                          onClick={() => setCancellingProforma(pf)}
                          className="text-muted hover:text-warning hover:bg-warning-soft"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </IconButton>
                      )}

                      {(pf.status === 'DRAFT' || pf.status === 'CANCELLED') && (
                        <IconButton
                          label="Delete Proforma"
                          onClick={() => setDeletingProforma(pf)}
                          className="text-muted hover:text-danger hover:bg-danger-soft"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          </>
        )}
      </div>

      {/* Printable Modal */}
      {selectedDoc && (
        <PrintableDocumentModal
          isOpen={!!selectedDoc}
          onClose={() => setSelectedDoc(null)}
          documentType="PROFORMA"
          data={selectedDoc}
        />
      )}

      <ConfirmDialog
        open={cancellingProforma !== null}
        onClose={() => setCancellingProforma(null)}
        onConfirm={confirmCancel}
        title={`Cancel Proforma ${cancellingProforma?.proformaNumber}?`}
        description="This will mark the proforma as CANCELLED. It can no longer be converted to a Tax Invoice."
        confirmLabel="Cancel Quotation"
        destructive
        loading={isProcessing}
      />

      <ConfirmDialog
        open={deletingProforma !== null}
        onClose={() => setDeletingProforma(null)}
        onConfirm={confirmDelete}
        title={`Delete Proforma ${deletingProforma?.proformaNumber}?`}
        description="Are you sure you want to permanently delete this quotation record? This action cannot be undone."
        confirmLabel="Delete Proforma"
        destructive
        loading={isProcessing}
      />
    </div>
  );
}
