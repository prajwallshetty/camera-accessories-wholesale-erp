'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Boxes,
  CheckCircle2,
  Printer,
  Search,
  RefreshCw,
  Barcode,
  CheckSquare,
  Square,
  Package,
  Layers,
  ArrowRight,
  ChevronRight,
  Filter,
  AlertTriangle,
} from 'lucide-react';
import { User, TaxInvoice } from '@/types/erp';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchWithCache } from '@/lib/client-cache';
import { formatUSD, formatDate } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';

function DepotPickContent() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentUserCachedSync()?.user || null);
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Batch Multi-Select
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [isBatchPicking, setIsBatchPicking] = useState(false);
  const [pickingInFlight, setPickingInFlight] = useState<Record<string, boolean>>({});

  // Item-level check states (invoiceId-itemId -> boolean)
  const [pickedItems, setPickedItems] = useState<Record<string, boolean>>({});

  const loadData = async (query = '') => {
    let user: User | null = currentUser;

    try {
      const userData = await fetchCurrentUserCached();
      if (userData?.authenticated && userData.user) {
        user = userData.user;
        setCurrentUser(user);
      }
    } catch {}

    try {
      const qParams = new URLSearchParams();
      qParams.set('fulfilmentStatus', 'READY_FOR_PACKING');
      if (query.trim()) qParams.set('q', query.trim());
      const allInvoices = await fetchWithCache<TaxInvoice[]>(`/api/invoices?${qParams.toString()}`, undefined, 5000);
      if (Array.isArray(allInvoices)) {
        const filtered = allInvoices.filter(
          (inv: any) =>
            inv.fulfilmentStatus === 'READY_FOR_PACKING' &&
            (!user?.assignedDepotId || inv.depotId === user.assignedDepotId)
        );
        setInvoices(filtered);
      }
    } catch {}

    setIsLoading(false);
  };

  useEffect(() => {
    loadData(debouncedSearch);
  }, [debouncedSearch]);

  // Filtered Orders
  const filteredInvoices = invoices.filter((inv) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchId = inv.id.toLowerCase() === q;
      const matchInv = inv.invoiceNumber?.toLowerCase().includes(q);
      const matchCompany = inv.customerCompany?.toLowerCase().includes(q);
      const matchItem = inv.items?.some(
        (item: any) =>
          item.productName?.toLowerCase().includes(q) ||
          item.productSku?.toLowerCase().includes(q) ||
          item.allocatedSerials?.some((s: string) => s.toLowerCase().includes(q))
      );
      return matchId || matchInv || matchCompany || matchItem;
    }
    return true;
  });

  // Single Order Pick Confirmation
  const handlePickOrder = async (inv: TaxInvoice) => {
    if (pickingInFlight[inv.id]) return;
    setPickingInFlight((prev) => ({ ...prev, [inv.id]: true }));

    const itemPicks = (inv.items || []).map((i) => ({ id: i.id, isPicked: true }));
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemPicks }),
      });

      if (res.ok) {
        const data = await res.json();
        setInvoices((items) => items.filter((i) => i.id !== inv.id));
        setSelectedInvoiceIds((prev) => {
          const next = new Set(prev);
          next.delete(inv.id);
          return next;
        });

        toast({
          title: 'Order Picked Successfully',
          description: `Invoice #${inv.invoiceNumber} has been moved to the Packing Workbench.`,
          variant: 'success',
        });
      } else {
        const err = await res.json();
        toast({
          title: 'Picking Error',
          description: err.error || 'Failed to complete picking',
          variant: 'error',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Network Error',
        description: err.message || 'Picking request failed',
        variant: 'error',
      });
    } finally {
      setPickingInFlight((prev) => ({ ...prev, [inv.id]: false }));
    }
  };

  // Batch Pick All Selected Orders at Once
  const handleBatchPickSelected = async () => {
    if (selectedInvoiceIds.size === 0) return;
    setIsBatchPicking(true);

    try {
      const selectedInvoices = invoices.filter((i) => selectedInvoiceIds.has(i.id));
      const succeededIds: string[] = [];
      const failures: { invoiceNumber?: string; error: string }[] = [];

      for (const inv of selectedInvoices) {
        const itemPicks = (inv.items || []).map((i) => ({ id: i.id, isPicked: true }));
        try {
          const res = await fetch(`/api/invoices/${inv.id}/pick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemPicks }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            failures.push({ invoiceNumber: inv.invoiceNumber, error: data.error || 'Failed to pick' });
            continue;
          }
          succeededIds.push(inv.id);
        } catch (err: any) {
          failures.push({ invoiceNumber: inv.invoiceNumber, error: err.message || 'Network error' });
        }
      }

      setInvoices((items) => items.filter((i) => !succeededIds.includes(i.id)));
      setSelectedInvoiceIds((prev) => {
        const next = new Set(prev);
        succeededIds.forEach((id) => next.delete(id));
        return next;
      });

      if (succeededIds.length > 0) {
        toast({
          title: 'Batch Pick Completed',
          description: `${succeededIds.length} order${succeededIds.length === 1 ? '' : 's'} picked and forwarded to packing bench.`,
          variant: 'success',
        });
      }
      if (failures.length > 0) {
        toast({
          title: `${failures.length} order${failures.length === 1 ? '' : 's'} could not be picked`,
          description: failures.map((f) => `${f.invoiceNumber || 'Order'}: ${f.error}`).join('; '),
          variant: 'error',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Batch Pick Error',
        description: err.message || 'Some orders could not be picked',
        variant: 'error',
      });
    } finally {
      setIsBatchPicking(false);
    }
  };

  const toggleSelectInvoice = (id: string) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedInvoiceIds.size === filteredInvoices.length && filteredInvoices.length > 0) {
      setSelectedInvoiceIds(new Set());
    } else {
      setSelectedInvoiceIds(new Set(filteredInvoices.map((i) => i.id)));
    }
  };

  const toggleItemPick = (invId: string, itemId: string) => {
    const key = `${invId}-${itemId}`;
    setPickedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Boxes className="h-6 w-6 text-warning" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">
              Warehouse Picking Queue
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-warning-soft text-warning border border-warning-border font-bold">
              {invoices.length} Pending
            </span>
          </div>
          <p className="text-xs sm:text-sm text-ink-secondary mt-1">
            Depot picking station: Locate items on shelves, scan serial numbers, and verify stock before moving to packing workbench.
          </p>
        </div>

        <button
          onClick={() => loadData()}
          className="flex items-center gap-1.5 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-xl border border-line bg-white text-ink-secondary hover:text-ink text-xs hover:bg-surface self-start sm:self-auto transition-colors shadow-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Search & Batch Select Bar */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white border border-line space-y-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Quick Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search by Invoice #, Customer Name, SKU code, or Serial Barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 min-h-11 sm:min-h-0 rounded-2xl bg-surface border border-line text-ink placeholder-muted text-xs focus:border-primary focus:bg-white focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>

          <div className="text-xs font-mono text-muted self-end sm:self-auto">
            {filteredInvoices.length} matching orders
          </div>
        </div>

        {/* Select All Toggle */}
        {filteredInvoices.length > 0 && (
          <div className="pt-2 border-t border-line flex items-center justify-between text-xs">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-ink-secondary hover:text-ink font-medium"
            >
              {selectedInvoiceIds.size > 0 && selectedInvoiceIds.size === filteredInvoices.length ? (
                <CheckSquare className="h-4 w-4 text-warning" />
              ) : (
                <Square className="h-4 w-4 text-muted" />
              )}
              <span>Select all visible pick orders ({filteredInvoices.length})</span>
            </button>

            {selectedInvoiceIds.size > 0 && (
              <span className="text-warning font-mono font-bold">
                {selectedInvoiceIds.size} orders selected for batch picking
              </span>
            )}
          </div>
        )}
      </div>

      {/* Orders List */}
      {isLoading ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-line space-y-3 shadow-xs">
          <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-xs text-muted">Loading picking queue...</p>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-line space-y-3 shadow-xs">
          <CheckCircle2 className="h-12 w-12 text-success mx-auto opacity-80" />
          <h3 className="text-base font-bold text-ink">Picking Queue Clear</h3>
          <p className="text-xs text-muted max-w-md mx-auto">
            {searchQuery
              ? `No picking orders matched "${searchQuery}". Clear your search.`
              : 'All confirmed orders at this depot have been picked and forwarded to packing.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredInvoices.map((invoice) => {
            const isSelected = selectedInvoiceIds.has(invoice.id);

            return (
              <div
                key={invoice.id}
                className={`bg-white rounded-3xl border p-5 sm:p-6 space-y-5 shadow-xs transition-all ${
                  isSelected
                    ? 'border-warning ring-1 ring-warning/40 bg-warning/5'
                    : 'border-line hover:border-primary/30 hover:shadow-md'
                }`}
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleSelectInvoice(invoice.id)}
                      className="mt-1 p-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center rounded-lg hover:bg-surface text-muted hover:text-ink transition-colors"
                      title="Select for batch picking"
                    >
                      {isSelected ? (
                        <CheckSquare className="h-5 w-5 text-warning" />
                      ) : (
                        <Square className="h-5 w-5 text-muted" />
                      )}
                    </button>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-primary">
                          #{invoice.invoiceNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-warning-soft text-warning border border-warning-border">
                          READY TO PICK
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-ink mt-1">
                        {invoice.customerCompany}
                      </h3>
                      <p className="text-xs text-muted">
                        Customer Contact: {invoice.customerName || 'N/A'} • Created: {formatDate(invoice.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="flex items-center gap-1.5 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-xl border border-line bg-white hover:bg-surface text-ink-secondary hover:text-ink text-xs font-semibold transition-colors shadow-xs"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>Print Pick Slip</span>
                    </button>
                  </div>
                </div>

                {/* Line Items to Pick */}
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-muted uppercase tracking-wider font-mono">
                    Items to Retrieve from Depot Shelves ({invoice.items?.length || 0})
                  </div>

                  <div className="space-y-2">
                    {invoice.items?.map((item, idx) => {
                      const isItemChecked = pickedItems[`${invoice.id}-${item.id}`];

                      return (
                        <div
                          key={idx}
                          onClick={() => toggleItemPick(invoice.id, item.id)}
                          className={`flex items-center justify-between p-3.5 rounded-2xl border text-xs cursor-pointer transition-all ${
                            isItemChecked
                              ? 'bg-success-soft border-success/30 text-success'
                              : 'bg-surface border-line hover:bg-surface-muted'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-5 w-5 rounded-md border flex items-center justify-center ${
                                isItemChecked
                                  ? 'bg-success border-success text-white'
                                  : 'border-line bg-white'
                              }`}
                            >
                              {isItemChecked && <CheckCircle2 className="h-4 w-4 text-white" />}
                            </div>

                            <div>
                              <div className={`font-semibold ${isItemChecked ? 'text-success line-through' : 'text-ink'}`}>
                                {item.productName}
                              </div>
                              <div className="text-[11px] text-muted font-mono mt-0.5">
                                SKU: {item.productSku} • {item.brand}
                              </div>
                              {item.allocatedSerials && item.allocatedSerials.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {item.allocatedSerials.map((sn: string, sidx: number) => (
                                    <span
                                      key={sidx}
                                      className="px-1.5 py-0.5 rounded bg-primary-soft border border-primary/20 text-primary font-mono text-[10px]"
                                    >
                                      SN: {sn}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-right font-mono font-bold shrink-0 ml-3">
                            <span className="px-3 py-1.5 rounded-xl bg-white border border-line text-ink shadow-xs">
                              Qty: {item.quantity}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Confirm Pick Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handlePickOrder(invoice)}
                    disabled={Boolean(pickingInFlight[invoice.id])}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-primary hover:bg-primary-hover text-white text-sm font-bold shadow-xs transition-all disabled:opacity-50 active:scale-98"
                  >
                    {pickingInFlight[invoice.id] ? (
                      <>
                        <RefreshCw className="h-5 w-5 animate-spin text-white" />
                        <span>Confirming Picking...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-5 w-5" />
                        <span>Confirm All Items Picked → Send to Packing</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Batch Picking Action Bar */}
      {selectedInvoiceIds.size > 0 && (
        <div className="fixed bottom-6 inset-x-4 sm:inset-x-auto sm:right-8 sm:left-auto max-w-xl z-40 bg-white/95 backdrop-blur-xl border border-line p-4 rounded-3xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in ring-1 ring-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-primary text-white flex items-center justify-center font-bold font-mono shadow-xs shrink-0">
              {selectedInvoiceIds.size}
            </div>
            <div>
              <div className="text-xs font-bold text-ink">
                {selectedInvoiceIds.size} Orders Selected for Batch Pick
              </div>
              <p className="text-[11px] text-muted">
                Confirm all items retrieved from shelves and forward directly to packing.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={() => setSelectedInvoiceIds(new Set())}
              className="px-3 py-2 min-h-11 sm:min-h-0 rounded-xl text-xs font-semibold text-muted hover:text-ink"
            >
              Deselect All
            </button>
            <button
              onClick={handleBatchPickSelected}
              disabled={isBatchPicking}
              className="flex items-center gap-2 px-5 py-2 min-h-11 sm:min-h-0 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-xs transition-all disabled:opacity-50"
            >
              {isBatchPicking ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Batch Picking...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Pick All ({selectedInvoiceIds.size})</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DepotPickPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center bg-white rounded-2xl border border-line">
          <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-xs text-muted mt-2">Loading picking queue...</p>
        </div>
      }
    >
      <DepotPickContent />
    </Suspense>
  );
}
