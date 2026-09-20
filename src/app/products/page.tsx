'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  Package,
  Plus,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { formatUSD, cloudinaryThumb } from '@/lib/utils';
import { Product, Depot } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton, IconButton } from '@/components/ui/Button';
import { MarginBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { SearchInput, Input, Select, Textarea } from '@/components/ui/Input';
import { Drawer, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { fetchWithCache } from '@/lib/client-cache';

const BulkProductImportModal = dynamic(() => import('@/components/products/BulkProductImportModal'), { ssr: false });

interface ProductFormState {
  name: string;
  sku: string;
  brand: string;
  model: string;
  categoryName: string;
  description: string;
  barcode: string;
  imageUrl: string;
  purchasePrice: number;
  wholesalePrice: number;
  sellingPrice: number;
  taxRate: number;
  trackSerial: boolean;
  minStockLevel: number;
  depotBreakdown: Record<string, number>;
}

const EMPTY_FORM: ProductFormState = {
  name: '',
  sku: '',
  brand: '',
  model: '',
  categoryName: '',
  description: '',
  barcode: '',
  imageUrl: '',
  purchasePrice: 0,
  wholesalePrice: 0,
  sellingPrice: 0,
  taxRate: 5,
  trackSerial: true,
  minStockLevel: 10,
  depotBreakdown: {},
};

export default function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'IN_STOCK' | 'OUT_OF_STOCK' | 'LOW_STOCK'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 300);

  const loadData = async (query = '', activeRef?: { current: boolean }) => {
    setError(null);
    try {
      const prodUrl = query ? `/api/products?q=${encodeURIComponent(query)}` : '/api/products';
      const [productsData, depotsData] = await Promise.all([
        fetchWithCache<Product[]>(prodUrl, undefined, 3000),
        fetchWithCache<Depot[]>('/api/depots', undefined, 60000),
      ]);

      if (activeRef && !activeRef.current) return;

      if (Array.isArray(productsData)) {
        setProducts(productsData);
      } else {
        setError('Unable to load the product catalog.');
      }
      if (Array.isArray(depotsData)) {
        setDepots(depotsData);
      }
    } catch {
      if (activeRef && !activeRef.current) return;
      setError('Something went wrong. Please try again.');
    } finally {
      if (!activeRef || activeRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const activeRef = { current: true };
    loadData(debouncedSearch, activeRef);
    return () => {
      activeRef.current = false;
    };
  }, [debouncedSearch]);

  const emptyDepotBreakdown = () =>
    depots.reduce<Record<string, number>>((acc, d) => {
      acc[d.id] = 0;
      return acc;
    }, {});

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, depotBreakdown: emptyDepotBreakdown() });
    setFormError('');
    setDrawerMode('create');
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setForm({
      name: p.name,
      sku: p.sku,
      brand: p.brand,
      model: p.model || '',
      categoryName: p.categoryName || '',
      description: p.description || '',
      barcode: p.barcode || '',
      imageUrl: p.imageUrl || '',
      purchasePrice: p.purchasePrice,
      wholesalePrice: p.wholesalePrice,
      sellingPrice: p.sellingPrice,
      taxRate: p.taxRate ?? 5,
      trackSerial: p.trackSerial ?? true,
      minStockLevel: p.minStockLevel ?? 10,
      depotBreakdown: depots.reduce<Record<string, number>>((acc, d) => {
        acc[d.id] = p.depotBreakdown?.[d.id] ?? 0;
        return acc;
      }, {}),
    });
    setFormError('');
    setDrawerMode('edit');
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingProduct(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const isEdit = drawerMode === 'edit' && editingProduct;

    if (!form.name.trim() || !form.brand.trim() || (!isEdit && !form.sku.trim())) {
      setFormError(isEdit ? 'Product name and brand are required.' : 'Product name, SKU, and brand are required.');
      return;
    }
    if (form.purchasePrice < 0 || form.wholesalePrice < 0 || form.sellingPrice < 0) {
      setFormError('Pricing fields cannot be negative.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        model: form.model.trim(),
        categoryName: form.categoryName.trim(),
        description: form.description.trim(),
        imageUrl: '/placeholder-product.svg',
        purchasePrice: Number(form.purchasePrice),
        wholesalePrice: Number(form.wholesalePrice),
        sellingPrice: Number(form.sellingPrice),
        taxRate: Number(form.taxRate),
        trackSerial: form.trackSerial,
        minStockLevel: Number(form.minStockLevel),
        depotBreakdown: form.depotBreakdown,
        ...(isEdit ? {} : { sku: form.sku.trim().toUpperCase(), barcode: form.barcode.trim() }),
      };

      const res = await fetch(isEdit ? `/api/products/${editingProduct.id}` : '/api/products', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data: any = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned error status ${res.status}. Please check your connection or try again.`);
      }

      if (!res.ok) throw new Error(data.error || `Failed to ${isEdit ? 'update' : 'create'} product`);

      toast({ title: isEdit ? 'Product updated' : 'Product created', variant: 'success' });
      await loadData(debouncedSearch);
      closeDrawer();
    } catch (err: any) {
      setFormError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProduct) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/products/${deletingProduct.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete product');
      }
      toast({ title: `${deletingProduct.name} deleted`, variant: 'success' });
      setDeletingProduct(null);
      await loadData();
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  const availableBrands = ['ALL', ...Array.from(new Set(products.map((p) => p.brand).filter((b): b is string => !!b)))];
  const availableCategories = [
    'ALL',
    ...Array.from(new Set(products.map((p) => p.categoryName).filter((c): c is string => !!c))),
  ];

  const filteredProducts = products.filter((p) => {
    if (selectedBrand !== 'ALL' && p.brand !== selectedBrand) return false;
    if (selectedCategory !== 'ALL' && p.categoryName !== selectedCategory) return false;
    const stock = p.totalStock ?? 0;
    if (stockFilter === 'IN_STOCK' && stock <= 0) return false;
    if (stockFilter === 'OUT_OF_STOCK' && stock > 0) return false;
    if (stockFilter === 'LOW_STOCK' && (stock > (p.minStockLevel ?? 10) || stock === 0)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalUnits = products.reduce((acc, p) => acc + (p.totalStock || 0), 0);
  const totalValuation = products.reduce((acc, p) => acc + (p.totalStock || 0) * (p.purchasePrice || 0), 0);
  const lowStockCount = products.filter((p) => (p.totalStock || 0) <= (p.minStockLevel ?? 0)).length;

  const marginFor = (p: Product) =>
    p.sellingPrice > 0 ? ((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100 : 0;

  const formMargin =
    form.sellingPrice > 0 ? (((form.sellingPrice - form.purchasePrice) / form.sellingPrice) * 100).toFixed(1) : '0.0';

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Product Catalog"
        description="Product master with stock distribution, wholesale margins, serials and barcodes."
        actions={
          <>
            <Button variant="outline" iconLeft={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setIsImportOpen(true)}>
              Import (CSV/Excel)
            </Button>
            <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
              New Product
            </Button>
          </>
        }
      />

      {/* Catalog metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-line rounded-2xl divide-x divide-y lg:divide-y-0 divide-line bg-surface overflow-hidden">
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Catalog SKUs</div>
          <div className="text-2xl font-semibold text-ink mt-1.5">{products.length}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Total Units</div>
          <div className="text-2xl font-semibold text-ink mt-1.5">{totalUnits.toLocaleString()}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Stock Valuation</div>
          <div className="text-2xl font-semibold text-ink mt-1.5">{formatUSD(totalValuation)}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">0 / Low Stock</div>
          <div className={`text-2xl font-semibold mt-1.5 ${lowStockCount > 0 ? 'text-warning' : 'text-ink'}`}>
            {lowStockCount}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput
          placeholder="Search SKU, name, brand, or barcode..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="w-full sm:w-80"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Select
            options={availableBrands.map((b) => ({ label: b === 'ALL' ? 'All brands' : b, value: b }))}
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            wrapperClassName="w-36"
          />
          <Select
            options={availableCategories.map((c) => ({ label: c === 'ALL' ? 'All categories' : c, value: c }))}
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            wrapperClassName="w-44"
          />
          <Select
            options={[
              { label: 'All Stock (incl. 0)', value: 'ALL' },
              { label: 'In Stock (>0)', value: 'IN_STOCK' },
              { label: '0 in Stock', value: 'OUT_OF_STOCK' },
              { label: 'Low Stock', value: 'LOW_STOCK' },
            ]}
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as any)}
            wrapperClassName="w-40"
          />
        </div>
        <span className="text-xs text-muted sm:ml-auto font-mono">{filteredProducts.length} items</span>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : error ? (
        <ErrorState description={error} action={<Button onClick={() => loadData()}>Try Again</Button>} />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          icon={Package}
          title={products.length === 0 ? 'No products yet' : 'No matching products'}
          description={
            products.length === 0
              ? 'Add your first product to start building the catalog and tracking stock.'
              : 'No products match your current search and filters.'
          }
          action={
            products.length === 0 && (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Create Product
              </Button>
            )
          }
        />
      ) : (
        <>
        <div className="hidden md:block">
        <Table>
            <TableHeader>
              <TableHead>Product</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Category</TableHead>
              <TableHead align="right">Stock</TableHead>
              <TableHead align="right">Cost</TableHead>
              <TableHead align="right">Selling</TableHead>
              <TableHead align="right">Margin</TableHead>
              <TableHead align="right">Action</TableHead>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((p) => {
                const thumb = cloudinaryThumb(p.imageUrl, 80);
                const isLow = (p.totalStock || 0) <= (p.minStockLevel ?? 0);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 shrink-0 rounded-md border border-line bg-surface-muted overflow-hidden flex items-center justify-center p-0.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src="/placeholder-product.svg"
                            alt={p.name}
                            loading="lazy"
                            className="h-full w-full object-contain"
                            onError={(e) => {
                              e.currentTarget.src = '/placeholder-product.svg';
                            }}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-ink truncate">{p.name}</div>
                          <div className="text-xs text-muted font-mono mt-0.5">{p.sku}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted">{p.brand}</TableCell>
                    <TableCell className="text-muted">{p.categoryName || '—'}</TableCell>
                    <TableCell align="right">
                      <span className={`font-mono font-semibold ${isLow ? 'text-warning' : 'text-ink'}`}>
                        {p.totalStock ?? 0}
                      </span>
                    </TableCell>
                    <TableCell align="right" className="font-mono text-muted">{formatUSD(p.purchasePrice)}</TableCell>
                    <TableCell align="right" className="font-mono">{formatUSD(p.sellingPrice)}</TableCell>
                    <TableCell align="right">
                      <MarginBadge marginPercent={Number(marginFor(p).toFixed(1))} />
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        <LinkButton href={`/products/${p.id}`} size="sm" variant="secondary">
                          View
                        </LinkButton>
                        <IconButton
                          label="Delete Product"
                          className="text-muted hover:text-danger hover:bg-danger-soft"
                          onClick={() => setDeletingProduct(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
        </div>

        <div className="md:hidden space-y-3">
          {filteredProducts.map((p) => {
            const isLow = (p.totalStock || 0) <= (p.minStockLevel ?? 0);
            return (
              <Card key={p.id} className="p-4 space-y-2.5">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 shrink-0 rounded-md border border-line bg-surface-muted overflow-hidden flex items-center justify-center p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/placeholder-product.svg"
                      alt={p.name}
                      loading="lazy"
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        e.currentTarget.src = '/placeholder-product.svg';
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink truncate">{p.name}</div>
                    <div className="text-xs text-muted font-mono mt-0.5">{p.sku}</div>
                    <div className="text-xs text-muted mt-0.5">{p.brand} · {p.categoryName || '—'}</div>
                  </div>
                  <MarginBadge marginPercent={Number(marginFor(p).toFixed(1))} />
                </div>
                <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line-soft">
                  <span className={`font-mono font-semibold ${isLow ? 'text-warning' : 'text-ink'}`}>
                    Stock: {p.totalStock ?? 0}
                  </span>
                  <span className="font-mono text-muted">{formatUSD(p.purchasePrice)}</span>
                  <span className="font-mono font-semibold text-ink">{formatUSD(p.sellingPrice)}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(p)}>
                    Edit
                  </Button>
                  <LinkButton href={`/products/${p.id}`} size="sm" variant="secondary" className="flex-1">
                    View
                  </LinkButton>
                  <IconButton
                    label="Delete Product"
                    className="text-muted hover:text-danger hover:bg-danger-soft"
                    onClick={() => setDeletingProduct(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </Card>
            );
          })}
        </div>
        </>
      )}

      <Drawer
        open={drawerMode !== null}
        onClose={closeDrawer}
        width="lg"
        title={drawerMode === 'edit' ? `Edit ${editingProduct?.name || 'Product'}` : 'New Product'}
        description={
          drawerMode === 'edit'
            ? 'Update product details, pricing, and stock levels.'
            : 'Add a new product to the catalog with pricing and opening stock.'
        }
        footer={
          <>
            {drawerMode === 'edit' && editingProduct && (
              <Button
                variant="destructive"
                onClick={() => setDeletingProduct(editingProduct)}
                disabled={isSubmitting}
                className="mr-auto"
              >
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={closeDrawer} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="product-form" loading={isSubmitting} iconLeft={!isSubmitting ? <CheckCircle2 className="h-4 w-4" /> : undefined}>
              {drawerMode === 'edit' ? 'Save Changes' : 'Create Product'}
            </Button>
          </>
        }
      >
        <form id="product-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
          {formError && (
            <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
              {formError}
            </div>
          )}

          <div className="flex flex-col gap-3.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Product Details</div>
            <Input
              label="Product Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Sony FX3 Full-Frame Cinema Camera"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="SKU"
                required={drawerMode === 'create'}
                disabled={drawerMode === 'edit'}
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="e.g. SONY-FX3"
                hint={drawerMode === 'edit' ? 'SKU cannot be changed' : undefined}
              />
              <Input
                label="Brand"
                required
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="e.g. Sony"
              />
              <Input
                label="Model"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="e.g. ILME-FX3"
              />
              <Input
                label="Category"
                value={form.categoryName}
                onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
                placeholder="e.g. Cinema Cameras"
              />
            </div>
            {drawerMode === 'create' && (
              <Input
                label="Barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="e.g. 027242921863"
              />
            )}
            <Textarea
              label="Description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-3.5 pt-2 border-t border-line">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Pricing</div>
              <span className="text-xs text-muted">
                Margin: <span className="font-semibold text-ink">{formMargin}%</span>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Cost"
                type="number"
                min={0}
                step="0.01"
                value={form.purchasePrice}
                onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })}
              />
              <Input
                label="Wholesale"
                type="number"
                min={0}
                step="0.01"
                value={form.wholesalePrice}
                onChange={(e) => setForm({ ...form, wholesalePrice: Number(e.target.value) })}
              />
              <Input
                label="Selling"
                type="number"
                min={0}
                step="0.01"
                value={form.sellingPrice}
                onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Tax Rate (%)"
                type="number"
                min={0}
                step="0.5"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })}
              />
              <Input
                label="Min Stock Level"
                type="number"
                min={0}
                value={form.minStockLevel}
                onChange={(e) => setForm({ ...form, minStockLevel: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3.5 pt-2 border-t border-line">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Stock &amp; Tracking</div>
            {depots.map((d) => (
              <Input
                key={d.id}
                label={`${d.name} — Quantity`}
                type="number"
                min={0}
                value={form.depotBreakdown[d.id] ?? 0}
                onChange={(e) =>
                  setForm({
                    ...form,
                    depotBreakdown: { ...form.depotBreakdown, [d.id]: Number(e.target.value) },
                  })
                }
              />
            ))}
            <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={form.trackSerial}
                onChange={(e) => setForm({ ...form, trackSerial: e.target.checked })}
                className="h-4 w-4 rounded border-line text-primary focus:ring-primary-ring"
              />
              <span>Track individual serial numbers for this product</span>
            </label>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={deletingProduct !== null}
        onClose={() => setDeletingProduct(null)}
        onConfirm={handleDelete}
        title={`Delete ${deletingProduct?.name || 'product'}?`}
        description="This permanently removes the product from the catalog. Stock records and history for this product will also be removed."
        confirmLabel="Delete Product"
        destructive
        loading={isDeleting}
      />

      {isImportOpen && (
        <BulkProductImportModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onSuccess={() => {
            loadData();
          }}
        />
      )}
    </div>
  );
}
