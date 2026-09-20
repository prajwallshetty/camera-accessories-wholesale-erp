'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Receipt,
  Printer,
  Building2,
  Boxes,
  Truck,
  CheckCircle2,
  Package,
  Barcode,
  FolderLock,
  UploadCloud,
  ExternalLink,
  CreditCard,
  X,
  XCircle,
  Scale,
  PieChart,
} from 'lucide-react';
import { formatUSD, formatDate } from '@/lib/utils';
import { TaxInvoice, Shipment, CloudDocument, User } from '@/types/erp';
import { fetchCurrentUserCached, getCurrentUserCachedSync } from '@/lib/client-cache';
import PrintableDocumentModal from '@/components/pdf/PrintableDocumentModal';
import CloudinaryUploadModal from '@/components/documents/CloudinaryUploadModal';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmDialog, Drawer } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { FreightSummaryPanel } from '@/components/freight/FreightSummaryPanel';
import { FreightAllocationModal, FreightAllocationItem } from '@/components/freight/FreightAllocationModal';
import { FreightAllocationMethod } from '@/lib/freight';

export default function InvoiceDetailPage() {
  const { toast } = useToast();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [currentUser, setCurrentUser] = useState<User>(
    () => (getCurrentUserCachedSync()?.user as User) || ({
      id: 'usr-admin',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      email: 'admin@arib.com',
      status: 'ACTIVE',
    } as User)
  );
  const [invoice, setInvoice] = useState<TaxInvoice | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [documents, setDocuments] = useState<CloudDocument[]>([]);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isPackingModalOpen, setIsPackingModalOpen] = useState(false);
  const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPicking, setIsPicking] = useState(false);
  const [isPacking, setIsPacking] = useState(false);
  const [isShipping, setIsShipping] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isFreightEditOpen, setIsFreightEditOpen] = useState(false);
  const [isSavingFreight, setIsSavingFreight] = useState(false);
  const [freightActualWeightKg, setFreightActualWeightKg] = useState(0);
  const [freightVolumetricWeightKg, setFreightVolumetricWeightKg] = useState(0);
  const [freightRatePerKg, setFreightRatePerKg] = useState(0);
  const [additionalFreightCharges, setAdditionalFreightCharges] = useState(0);
  const [isFreightManualOverride, setIsFreightManualOverride] = useState(false);
  const [manualTotalFreight, setManualTotalFreight] = useState(0);
  const [isAllocateModalOpen, setIsAllocateModalOpen] = useState(false);
  const [isSavingAllocation, setIsSavingAllocation] = useState(false);

  // Packing modal fields
  const [packedBy, setPackedBy] = useState('');
  const [boxCount, setBoxCount] = useState(1);
  const [totalWeight, setTotalWeight] = useState(4.5);
  const [lengthCm, setLengthCm] = useState(40);
  const [widthCm, setWidthCm] = useState(30);
  const [heightCm, setHeightCm] = useState(25);
  const [packagePhotoUrl, setPackagePhotoUrl] = useState('');

  // Shipping modal fields
  const [courier, setCourier] = useState('DHL_EXPRESS');
  const [awbNumber, setAwbNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [shippingCost, setShippingCost] = useState(180);
  const [awbDocUrl, setAwbDocUrl] = useState('');

  const loadData = async () => {
    try {
      const authData = await fetchCurrentUserCached();
      if (authData?.authenticated && authData.user) {
        setCurrentUser(authData.user);
      }

      const res = await fetch(`/api/invoices/${id}`);
      if (res.ok) {
        const inv = await res.json();
        setInvoice(inv);
        setFreightActualWeightKg(inv.actualWeightKg || 0);
        setFreightVolumetricWeightKg(inv.volumetricWeightKg || 0);
        setFreightRatePerKg(inv.freightRatePerKg || 0);
        setAdditionalFreightCharges(inv.additionalFreightCharges || 0);
        setIsFreightManualOverride(Boolean(inv.freightIsManualOverride));
        setManualTotalFreight(inv.freightIsManualOverride ? inv.shippingCost || 0 : 0);
        if (inv.shipment) {
          setShipment(inv.shipment);
        } else if (inv.shipmentId) {
          try {
            const shpRes = await fetch(`/api/shipments/${inv.shipmentId}`);
            if (shpRes.ok) {
              const shp = await shpRes.json();
              setShipment(shp);
            }
          } catch {}
        }

        try {
          const docsRes = await fetch(`/api/documents?entityId=${inv.id}`);
          if (docsRes.ok) {
            const docs = await docsRes.json();
            setDocuments(Array.isArray(docs) ? docs : []);
          }
        } catch {}

        if (!packedBy && authData?.user?.name) setPackedBy(authData.user.name);
        if (!awbNumber) setAwbNumber(`DHL-${Math.floor(1000000000 + Math.random() * 9000000000)}`);
      } else {
        setInvoice(null);
      }
    } catch (error) {
      console.error('Error loading invoice:', error);
      setInvoice(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  if (isLoading) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-xs animate-pulse">Loading tax invoice document...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-sm font-semibold">Tax Invoice Not Found</div>
        <LinkButton href="/invoices" variant="outline" size="sm">
          Back to Invoices
        </LinkButton>
      </div>
    );
  }

  const isDepotUser = currentUser.role === 'DEPOT_USER';
  const isClosedInvoice = invoice.fulfilmentStatus === 'CANCELLED' || invoice.fulfilmentStatus === 'DELIVERED';
  const hasFreightAllocation = (invoice.items || []).some((it) => (it.allocatedFreight || 0) > 0);
  const canAllocateFreight = !isDepotUser && (invoice.shippingCost || 0) > 0 && (invoice.items?.length || 0) > 0;

  const handlePickAll = async () => {
    if (!invoice) return;
    setIsPicking(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to mark items as picked');
      }
      setInvoice((prev) => (prev ? { ...prev, ...(data.invoice || data) } : data.invoice || data));
      toast({ title: 'Items picked', variant: 'success' });
    } catch (err: any) {
      toast({ title: err.message || 'Could not mark items as picked', variant: 'error' });
    } finally {
      setIsPicking(false);
      loadData();
    }
  };

  const handlePackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    setIsPacking(true);
    try {
      const payload = {
        packedBy,
        packageCount: Number(boxCount),
        totalWeightKg: Number(totalWeight),
        lengthCm: Number(lengthCm),
        widthCm: Number(widthCm),
        heightCm: Number(heightCm),
        packagePhotoUrl,
      };
      const res = await fetch(`/api/invoices/${invoice.id}/pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record packing details');
      }
      setInvoice((prev) => (prev ? { ...prev, ...(data.invoice || data) } : data.invoice || data));
      toast({ title: 'Packing details saved', variant: 'success' });
      setIsPackingModalOpen(false);
    } catch (err: any) {
      toast({ title: err.message || 'Could not save packing details', variant: 'error' });
    } finally {
      setIsPacking(false);
      loadData();
    }
  };

  const handleShipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    setIsShipping(true);
    try {
      const payload = {
        courier,
        airwayBillNumber: awbNumber,
        trackingUrl,
        shippingCost: Number(shippingCost),
        weightKg: Number(totalWeight),
        packageCount: Number(boxCount),
        airwayBillDocUrl: awbDocUrl,
      };
      const res = await fetch(`/api/invoices/${invoice.id}/ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record shipment details');
      }
      if (data.invoice) setInvoice(data.invoice);
      if (data.shipment) setShipment(data.shipment);
      toast({ title: 'Shipment recorded', variant: 'success' });
      setIsShippingModalOpen(false);
    } catch (err: any) {
      toast({ title: err.message || 'Could not record shipment details', variant: 'error' });
    } finally {
      setIsShipping(false);
      loadData();
    }
  };

  const handleSaveFreight = async () => {
    if (!invoice) return;
    setIsSavingFreight(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          freight: {
            actualWeightKg: freightActualWeightKg,
            volumetricWeightKg: freightVolumetricWeightKg,
            freightRatePerKg,
            additionalFreightCharges,
            isManualOverride: isFreightManualOverride,
            manualTotalFreight,
          },
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update freight');
      }
      toast({ title: 'Freight updated', variant: 'success' });
      setIsFreightEditOpen(false);
      loadData();
    } catch (err: any) {
      toast({ title: err.message || 'Could not update freight', variant: 'error' });
    } finally {
      setIsSavingFreight(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-16">
      {/* Header Bar */}
      <PageHeader
        breadcrumbs={[{ label: 'Tax Invoices', href: '/invoices' }, { label: invoice.invoiceNumber }]}
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="font-mono">{invoice.invoiceNumber}</span>
            <StatusBadge status={invoice.fulfilmentStatus} />
          </span>
        }
        description={
          <>
            Customer: <strong className="text-ink">{invoice.customerCompany || invoice.customerName}</strong> · Assigned Hub: <strong className="text-ink">{invoice.depotName || 'Depot'}</strong>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              iconLeft={<Printer className="h-3.5 w-3.5 text-muted" />}
              onClick={() => setIsPrintModalOpen(true)}
            >
              Print Invoice
            </Button>

            <Button
              size="sm"
              variant="outline"
              iconLeft={<UploadCloud className="h-3.5 w-3.5 text-primary" />}
              onClick={() => setIsUploadModalOpen(true)}
            >
              Attach Document
            </Button>

            {invoice.fulfilmentStatus === 'READY_FOR_PACKING' && (
              <Button
                size="sm"
                loading={isPicking}
                iconLeft={<Boxes className="h-3.5 w-3.5" />}
                onClick={handlePickAll}
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs"
              >
                Confirm Picked
              </Button>
            )}

            {invoice.fulfilmentStatus === 'PROCESSING' && (
              <Button
                size="sm"
                loading={isPacking}
                iconLeft={<Package className="h-3.5 w-3.5" />}
                onClick={() => setIsPackingModalOpen(true)}
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs"
              >
                Pack Order
              </Button>
            )}

            {invoice.fulfilmentStatus === 'PACKED' && (
              <Button
                size="sm"
                loading={isShipping}
                iconLeft={<Truck className="h-3.5 w-3.5" />}
                onClick={() => setIsShippingModalOpen(true)}
                className="bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs"
              >
                Ship Order
              </Button>
            )}

            {invoice.fulfilmentStatus !== 'DELIVERED' &&
              invoice.fulfilmentStatus !== 'SHIPPED' &&
              invoice.fulfilmentStatus !== 'CANCELLED' && (
                <Button
                  size="sm"
                  variant="outline"
                  iconLeft={<XCircle className="h-3.5 w-3.5 text-red-500" />}
                  onClick={() => setIsCancelModalOpen(true)}
                  className="text-red-600 border-red-200 hover:bg-red-50 text-xs font-semibold"
                >
                  Cancel Invoice
                </Button>
              )}
          </>
        }
      />

      {/* Financial Document View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Document Body */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-line-soft bg-surface flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                Tax Invoice Items ({invoice.items?.length || 0})
              </h3>
              <span className="text-xs font-mono font-semibold text-ink-secondary">Currency: USD ($)</span>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface border-b border-line text-muted uppercase tracking-wider font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4">Item & SKU</th>
                    <th className="py-2.5 px-4">Serial Numbers</th>
                    <th className="py-2.5 px-4 text-center">Qty</th>
                    {!isDepotUser && <th className="py-2.5 px-4 text-right">Unit Price</th>}
                    {!isDepotUser && <th className="py-2.5 px-4 text-right">Total</th>}
                    {!isDepotUser && hasFreightAllocation && (
                      <th className="py-2.5 px-4 text-right">Allocated Freight</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {(invoice.items || []).map((item, idx) => (
                    <tr key={idx} className="hover:bg-surface transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-ink">{item.productName}</div>
                        <div className="text-[11px] font-mono text-muted mt-0.5">
                          SKU: {item.productSku} · Brand: {item.brand}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {item.allocatedSerials && item.allocatedSerials.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {item.allocatedSerials.map((sn) => (
                              <span
                                key={sn}
                                className="px-1.5 py-0.5 rounded bg-primary-soft border border-primary/15 text-primary font-mono text-[10px] font-semibold"
                              >
                                {sn}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted italic">Non-serialized</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-ink">
                        {item.quantity}
                      </td>
                      {!isDepotUser && (
                        <td className="py-3 px-4 text-right font-mono text-ink-secondary">
                          {formatUSD(item.unitPrice)}
                        </td>
                      )}
                      {!isDepotUser && (
                        <td className="py-3 px-4 text-right font-mono text-ink-secondary">
                          {formatUSD(item.totalPrice)}
                        </td>
                      )}
                      {!isDepotUser && hasFreightAllocation && (
                        <td className="py-3 px-4 text-right font-mono text-ink-secondary">
                          {item.allocatedFreight ? formatUSD(item.allocatedFreight) : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-line-soft">
              {(invoice.items || []).map((item, idx) => (
                <div key={idx} className="p-4 space-y-2 text-xs">
                  <div className="font-semibold text-ink text-sm">{item.productName}</div>
                  <div className="text-[11px] font-mono text-muted">
                    SKU: {item.productSku} · Brand: {item.brand}
                  </div>
                  {item.allocatedSerials && item.allocatedSerials.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {item.allocatedSerials.map((sn) => (
                        <span
                          key={sn}
                          className="px-1.5 py-0.5 rounded bg-primary-soft border border-primary/15 text-primary font-mono text-[10px] font-semibold"
                        >
                          {sn}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted italic">Non-serialized</span>
                  )}
                  <div className="flex items-center justify-between pt-1.5 border-t border-line-soft">
                    <span className="text-muted">
                      Qty <span className="font-mono font-bold text-ink">{item.quantity}</span>
                      {!isDepotUser && <> × {formatUSD(item.unitPrice)}</>}
                    </span>
                    {!isDepotUser && (
                      <span className="font-mono font-bold text-ink">{formatUSD(item.totalPrice)}</span>
                    )}
                  </div>
                  {!isDepotUser && hasFreightAllocation && (
                    <div className="flex items-center justify-between text-muted">
                      <span>Allocated Freight</span>
                      <span className="font-mono text-ink-secondary">
                        {item.allocatedFreight ? formatUSD(item.allocatedFreight) : '—'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!isDepotUser && (
              <div className="p-4 bg-surface border-t border-line-soft flex flex-col items-end space-y-1.5 text-xs font-mono">
                <div className="flex justify-between w-full sm:w-64 text-ink-secondary">
                  <span>Subtotal:</span>
                  <span className="text-ink font-medium">{formatUSD(invoice.subtotal)}</span>
                </div>
                {invoice.discountAmount > 0 && (
                  <div className="flex justify-between w-full sm:w-64 text-emerald-700">
                    <span>Discount:</span>
                    <span>-{formatUSD(invoice.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between w-full sm:w-64 text-ink-secondary">
                  <span>VAT / Tax (5%):</span>
                  <span className="text-ink">{formatUSD(invoice.taxAmount)}</span>
                </div>
                <div className="flex justify-between w-full sm:w-64 text-ink-secondary items-center">
                  <span className="flex items-center gap-1.5">
                    Shipping / Freight:
                    {invoice.freightIsManualOverride && <Badge tone="warning">Manual Override</Badge>}
                  </span>
                  <span className="text-ink">{formatUSD(invoice.shippingCost)}</span>
                </div>
                <div className="flex justify-between w-full sm:w-64 pt-2 border-t border-line text-sm font-bold text-ink">
                  <span>Grand Total (USD):</span>
                  <span className="text-primary font-bold">{formatUSD(invoice.grandTotal)}</span>
                </div>
              </div>
            )}
          </Card>

          {/* Documents Attachment Card */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                Cloudinary Documents ({documents.length})
              </h3>
              <button onClick={() => setIsUploadModalOpen(true)} className="text-xs text-primary font-medium hover:underline">
                + Upload Attachment
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {documents.length === 0 ? (
                <p className="text-xs text-muted italic col-span-2">No documents attached yet.</p>
              ) : (
                documents.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.cloudinaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 rounded-md border border-line bg-surface hover:bg-surface flex items-center justify-between group transition-colors"
                  >
                    <div>
                      <div className="text-xs font-semibold text-ink group-hover:text-primary">{doc.title}</div>
                      <span className="text-[10px] text-muted font-mono">{doc.category}</span>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted group-hover:text-primary shrink-0" />
                  </a>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Customer Profile</h3>
            <div>
              <h4 className="text-sm font-bold text-ink">{invoice.customerCompany || invoice.customerName}</h4>
              <p className="text-xs text-muted mt-0.5">{invoice.customerName}</p>
              <p className="text-xs text-muted">{invoice.customerEmail}</p>
            </div>
            <div className="pt-3 border-t border-line-soft space-y-2 text-xs text-ink-secondary">
              <div>
                <span className="font-semibold text-ink-secondary block mb-0.5">Shipping Address:</span>
                <span className="text-[11px] leading-relaxed text-muted">{invoice.shippingAddress}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Fulfilment Depot Hub</h3>
            <div>
              <h4 className="text-sm font-bold text-ink">{invoice.depotName || 'Central Depot'}</h4>
              <p className="text-xs text-muted mt-0.5">Responsible for physical warehouse dispatch</p>
            </div>
          </Card>

          {!isDepotUser && ((invoice.chargeableWeightKg || 0) > 0 || canAllocateFreight) && (
            <Card className="p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-muted" /> Freight Breakdown
                </h3>
                {invoice.freightIsManualOverride && <Badge tone="warning">Manual Override</Badge>}
              </div>
              {(invoice.chargeableWeightKg || 0) > 0 && (
                <div className="space-y-2 text-ink-secondary">
                  <div className="flex justify-between">
                    <span>Actual Weight:</span>
                    <span className="text-ink font-mono">{(invoice.actualWeightKg || 0).toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Volumetric Weight:</span>
                    <span className="text-ink font-mono">{(invoice.volumetricWeightKg || 0).toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Chargeable Weight:</span>
                    <span className="text-ink font-mono font-semibold">{(invoice.chargeableWeightKg || 0).toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Freight Rate:</span>
                    <span className="text-ink font-mono">{formatUSD(invoice.freightRatePerKg || 0)} / kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Freight Charge:</span>
                    <span className="text-ink font-mono">{formatUSD(invoice.freightCharge || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Additional Shipping Charges:</span>
                    <span className="text-ink font-mono">{formatUSD(invoice.additionalFreightCharges || 0)}</span>
                  </div>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-line-soft font-semibold">
                <span className="text-ink">Total Freight:</span>
                <span className="text-primary font-mono">{formatUSD(invoice.shippingCost)}</span>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                {!isClosedInvoice && (
                  <Button
                    variant="outline"
                    size="sm"
                    iconLeft={<Scale className="h-3.5 w-3.5 text-primary" />}
                    onClick={() => setIsFreightEditOpen(true)}
                  >
                    Recalculate Freight
                  </Button>
                )}
                {canAllocateFreight && (
                  <Button
                    variant="outline"
                    size="sm"
                    iconLeft={<PieChart className="h-3.5 w-3.5 text-primary" />}
                    onClick={() => setIsAllocateModalOpen(true)}
                  >
                    Allocate Freight to Products
                  </Button>
                )}
              </div>
            </Card>
          )}

          {shipment && (
            <Card className="p-5 space-y-3 border-primary/20 bg-primary-soft/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Shipment Dispatched</span>
                <StatusBadge status={shipment.status} />
              </div>
              <div className="space-y-1.5 text-xs text-ink-secondary font-mono">
                <div className="flex justify-between">
                  <span>Courier:</span>
                  <span className="font-semibold text-ink">{shipment.courier.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span>AWB Number:</span>
                  <span className="font-bold text-primary">{shipment.airwayBillNumber}</span>
                </div>
              </div>
              <a
                href={shipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-1.5 mt-2 py-1.5 rounded-md bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
              >
                Track Shipment <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Card>
          )}
        </div>
      </div>

      {/* Printable Modal */}
      {isPrintModalOpen && invoice && (
        <PrintableDocumentModal
          isOpen={true}
          onClose={() => setIsPrintModalOpen(false)}
          documentType="TAX_INVOICE"
          data={invoice}
        />
      )}

      {/* Cloudinary Upload Modal */}
      {isUploadModalOpen && invoice && (
        <CloudinaryUploadModal
          isOpen={true}
          onClose={() => setIsUploadModalOpen(false)}
          defaultEntityType="INVOICE"
          defaultEntityId={invoice.id}
          defaultEntityLabel={invoice.invoiceNumber}
          onUploaded={() => loadData()}
        />
      )}

      {/* Cancel Invoice Confirmation */}
      <ConfirmDialog
        open={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={async () => {
          if (!invoice) return;
          setIsCancelling(true);
          try {
            const res = await fetch(`/api/invoices/${invoice.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fulfilmentStatus: 'CANCELLED' }),
            });
            if (!res.ok) {
              const d = await res.json().catch(() => ({}));
              throw new Error(d.error || 'Failed to cancel invoice');
            }
            toast({ title: 'Invoice cancelled and stock restored to depot', variant: 'success' });
            setIsCancelModalOpen(false);
            loadData();
          } catch (err: any) {
            toast({ title: err.message || 'Could not cancel invoice', variant: 'error' });
          } finally {
            setIsCancelling(false);
          }
        }}
        title={`Cancel Invoice ${invoice?.invoiceNumber}?`}
        description="This will cancel the invoice, restore allocated inventory units back to the depot, and release all reserved serial numbers."
        confirmLabel="Cancel Invoice"
        destructive
        loading={isCancelling}
      />

      {/* Packing Modal */}
      {isPackingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-xl border border-line bg-white shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-line-soft">
              <h3 className="text-sm font-bold text-ink">Record Package & Box Specs</h3>
              <button onClick={() => setIsPackingModalOpen(false)} className="text-muted hover:text-ink-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handlePackSubmit} className="flex flex-col gap-3 text-xs text-ink-secondary">
              <Input label="Packed By Operator" required value={packedBy} onChange={(e) => setPackedBy(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Box Count" type="number" min={1} value={boxCount} onChange={(e) => setBoxCount(Number(e.target.value))} />
                <Input label="Total Weight (kg)" type="number" step="0.1" value={totalWeight} onChange={(e) => setTotalWeight(Number(e.target.value))} />
              </div>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-soft">
                <Button type="button" variant="outline" onClick={() => setIsPackingModalOpen(false)}>Cancel</Button>
                <Button type="submit" loading={isPacking}>Confirm Packing Complete</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shipping Modal */}
      {isShippingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-xl border border-line bg-white shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-line-soft">
              <h3 className="text-sm font-bold text-ink">Dispatch Order & Attach Airway Bill</h3>
              <button onClick={() => setIsShippingModalOpen(false)} className="text-muted hover:text-ink-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleShipSubmit} className="flex flex-col gap-3 text-xs text-ink-secondary">
              <div>
                <label className="block text-xs font-semibold text-ink-secondary mb-1">Carrier / Courier</label>
                <select
                  value={courier}
                  onChange={(e) => setCourier(e.target.value as Shipment['courier'])}
                  className="w-full rounded-md border border-line bg-white px-3 py-1.5 text-xs text-ink"
                >
                  <option value="DHL_EXPRESS">DHL Express Worldwide</option>
                  <option value="FEDEX_INTERNATIONAL">FedEx International Priority</option>
                  <option value="ARAMEX">Aramex Global Priority</option>
                  <option value="EMIRATES_SKYCARGO">Emirates SkyCargo Freight</option>
                </select>
              </div>
              <Input label="Airway Bill (AWB) Number *" required value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} />
              <Input label="Tracking URL (Optional)" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} />
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-soft">
                <Button type="button" variant="outline" onClick={() => setIsShippingModalOpen(false)}>Cancel</Button>
                <Button type="submit" loading={isShipping}>Dispatch Shipment</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recalculate Freight Drawer */}
      <Drawer
        open={isFreightEditOpen}
        onClose={() => setIsFreightEditOpen(false)}
        title="Recalculate Freight"
        description="Adjust freight rate, additional charges, or apply a manual override."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsFreightEditOpen(false)} disabled={isSavingFreight}>
              Cancel
            </Button>
            <Button onClick={handleSaveFreight} loading={isSavingFreight}>
              Save Freight
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <FreightSummaryPanel
            compact
            actualWeightKg={freightActualWeightKg}
            volumetricWeightKg={freightVolumetricWeightKg}
            volumetricDivisor={invoice.freightVolumetricDivisor || 0}
            freightRatePerKg={freightRatePerKg}
            onFreightRateChange={setFreightRatePerKg}
            additionalFreightCharges={additionalFreightCharges}
            onAdditionalChargesChange={setAdditionalFreightCharges}
            isManualOverride={isFreightManualOverride}
            onManualOverrideChange={setIsFreightManualOverride}
            manualTotalFreight={manualTotalFreight}
            onManualTotalFreightChange={setManualTotalFreight}
          />
          <p className="text-[11px] text-muted">
            Actual/Volumetric Weight were set when this invoice was created or last packed. To correct them
            (e.g. after weighing the package), edit the values above before saving.
          </p>
        </div>
      </Drawer>

      {isAllocateModalOpen && (
        <FreightAllocationModal
          isOpen={isAllocateModalOpen}
          onClose={() => setIsAllocateModalOpen(false)}
          documentLabel={invoice.invoiceNumber}
          totalFreight={invoice.shippingCost}
          isSaving={isSavingAllocation}
          items={(invoice.items || []).map(
            (it): FreightAllocationItem => ({
              id: it.id,
              label: it.productName,
              sku: it.productSku,
              quantity: it.quantity,
              unitWeightKg: it.unitWeightKg || 0,
              totalPrice: it.totalPrice,
              allocatedFreight: it.allocatedFreight,
            })
          )}
          onSave={async (method: FreightAllocationMethod, allocations) => {
            setIsSavingAllocation(true);
            try {
              const res = await fetch(`/api/invoices/${invoice.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  freightAllocation: {
                    method,
                    allocations: allocations.map((a) => ({ itemId: a.id, allocatedFreight: a.allocatedFreight })),
                  },
                }),
              });
              if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || 'Failed to save freight allocation');
              }
              toast({ title: 'Freight allocation saved', variant: 'success' });
              setIsAllocateModalOpen(false);
              loadData();
            } catch (err: any) {
              toast({ title: err.message || 'Could not save allocation', variant: 'error' });
            } finally {
              setIsSavingAllocation(false);
            }
          }}
        />
      )}
    </div>
  );
}
