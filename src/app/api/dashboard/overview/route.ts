import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, depotIdFilter } from '@/lib/api-auth';

const MONTHS_BACK = 6;

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short' });
}

/**
 * Real, server-computed business-intelligence aggregates for the Dashboard.
 * Deliberately a separate endpoint from /api/dashboard and /api/dashboard/stats
 * (both already consumed elsewhere — reports/profit/page.tsx reads /stats) so this
 * can evolve without touching their response shape.
 */
interface CachedOverview {
  data: any;
  expiresAt: number;
}
const overviewCache = new Map<string, CachedOverview>();
const OVERVIEW_CACHE_TTL_MS = 30 * 1000;

/** Resolves the "Date range" dashboard filter to a cutoff Date (inclusive from). */
function resolveRangeStart(range: string | null, now: Date): Date {
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case '7d':
      return new Date(now.getTime() - 7 * 86400000);
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return new Date(now.getFullYear(), quarterStartMonth, 1);
    }
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1);
    case '30d':
      return new Date(now.getTime() - 30 * 86400000);
    default:
      // No recognized range (or 'all') — do not restrict by date.
      return new Date(0);
  }
}

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'dashboard.view');
  if (!auth.ok) return auth.response;

  const range = req.nextUrl.searchParams.get('range');

  try {
    const depotId = depotIdFilter(auth.user);
    const cacheKey = `${depotId || 'GLOBAL'}:${range || '30d'}`;
    const currentTime = Date.now();
    const cached = overviewCache.get(cacheKey);

    if (cached && currentTime < cached.expiresAt) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=45',
        },
      });
    }

    const isDepotScoped = !!depotId;

    const invoiceWhere = depotId ? { depotId, fulfilmentStatus: { not: 'CANCELLED' as const } } : { fulfilmentStatus: { not: 'CANCELLED' as const } };

    const [invoices, products, proformaPending, shipmentsPending, depots, inventoryRows] = await withDbTimeout(() =>
      Promise.all([
        prisma.taxInvoice.findMany({
          where: invoiceWhere,
          select: {
            createdAt: true,
            grandTotal: true,
            customerId: true,
            customerName: true,
            customerCompany: true,
            depotId: true,
            items: { select: { productId: true, quantity: true, totalPrice: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.product.findMany({ select: { id: true, name: true, sku: true, brand: true, categoryName: true, purchasePrice: true } }),
        prisma.proforma.count({
          where: depotId
            ? { items: { some: { selectedDepotId: depotId } }, status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } }
            : { status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } },
        }),
        prisma.shipment.count({
          where: depotId ? { depotId, status: { not: 'DELIVERED' } } : { status: { not: 'DELIVERED' } },
        }),
        isDepotScoped ? Promise.resolve([]) : prisma.depot.findMany({ select: { id: true, name: true } }),
        prisma.depotInventory.findMany({
          where: depotId ? { depotId } : undefined,
          select: { depotId: true, quantity: true, productId: true },
        }),
      ])
    );

    const productById = new Map(products.map((p) => [p.id, p]));

    const costOfItems = (items: { productId: string; quantity: number }[]) =>
      items.reduce((sum, item) => sum + item.quantity * (productById.get(item.productId)?.purchasePrice || 0), 0);

    // ---- Monthly revenue / profit trend (trailing N months, oldest first) ----
    const now = new Date();
    const buckets: { key: string; label: string; revenue: number; cost: number; orders: number }[] = [];
    for (let i = MONTHS_BACK - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: monthKey(d), label: monthLabel(d), revenue: 0, cost: 0, orders: 0 });
    }
    const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
    for (const inv of invoices) {
      const key = monthKey(new Date(inv.createdAt));
      const bucket = bucketByKey.get(key);
      if (bucket) {
        bucket.revenue += inv.grandTotal;
        bucket.cost += costOfItems(inv.items);
        bucket.orders += 1;
      }
    }
    const trend = buckets.map((b) => ({
      month: b.label,
      revenue: Math.round(b.revenue * 100) / 100,
      profit: Math.round((b.revenue - b.cost) * 100) / 100,
      orders: b.orders,
    }));

    const currentBucket = buckets[buckets.length - 1];
    const previousBucket = buckets[buckets.length - 2];
    const pctChange = (current: number, previous: number): number | null => {
      if (!previous) return current > 0 ? 100 : null;
      return Math.round(((current - previous) / previous) * 1000) / 10;
    };
    const revenueChangePct = pctChange(currentBucket.revenue, previousBucket.revenue);
    const profitChangePct = pctChange(currentBucket.revenue - currentBucket.cost, previousBucket.revenue - previousBucket.cost);
    const ordersChangePct = pctChange(currentBucket.orders, previousBucket.orders);

    // ---- Range-scoped invoices for the "Date range" dashboard filter. The
    // trend chart above intentionally stays a fixed trailing-6-month view
    // regardless of this filter; everything below reflects the selected range.
    const rangeStart = resolveRangeStart(range, now);
    const rangeInvoices = range ? invoices.filter((inv) => new Date(inv.createdAt) >= rangeStart) : invoices;

    // ---- Totals (scoped to the selected date range) ----
    const totalRevenue = rangeInvoices.reduce((s, i) => s + i.grandTotal, 0);
    const totalCost = rangeInvoices.reduce((s, i) => s + costOfItems(i.items), 0);
    const totalGrossProfit = totalRevenue - totalCost;
    const grossMarginPercent = totalRevenue ? Math.round((totalGrossProfit / totalRevenue) * 1000) / 10 : 0;

    // ---- Sales by category ----
    const categoryTotals = new Map<string, { revenue: number; units: number }>();
    for (const inv of rangeInvoices) {
      for (const item of inv.items) {
        const categoryName = productById.get(item.productId)?.categoryName || 'Uncategorized';
        const entry = categoryTotals.get(categoryName) || { revenue: 0, units: 0 };
        entry.revenue += item.totalPrice;
        entry.units += item.quantity;
        categoryTotals.set(categoryName, entry);
      }
    }
    const salesByCategory = Array.from(categoryTotals.entries())
      .map(([name, v]) => ({ name, revenue: Math.round(v.revenue * 100) / 100, units: v.units }))
      .sort((a, b) => b.revenue - a.revenue);

    // ---- Top products ----
    const productTotals = new Map<string, { unitsSold: number; revenue: number; cost: number }>();
    for (const inv of rangeInvoices) {
      for (const item of inv.items) {
        const entry = productTotals.get(item.productId) || { unitsSold: 0, revenue: 0, cost: 0 };
        entry.unitsSold += item.quantity;
        entry.revenue += item.totalPrice;
        entry.cost += item.quantity * (productById.get(item.productId)?.purchasePrice || 0);
        productTotals.set(item.productId, entry);
      }
    }
    const topProducts = Array.from(productTotals.entries())
      .map(([productId, v]) => {
        const p = productById.get(productId);
        const profit = v.revenue - v.cost;
        return {
          productId,
          name: p?.name || 'Unknown Product',
          sku: p?.sku || '—',
          brand: p?.brand || '—',
          unitsSold: v.unitsSold,
          revenue: Math.round(v.revenue * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          marginPercent: v.revenue ? Math.round((profit / v.revenue) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ---- Top customers ----
    const customerTotals = new Map<string, { name: string; company: string; orders: number; revenue: number; cost: number }>();
    for (const inv of rangeInvoices) {
      const entry = customerTotals.get(inv.customerId) || { name: inv.customerName, company: inv.customerCompany, orders: 0, revenue: 0, cost: 0 };
      entry.orders += 1;
      entry.revenue += inv.grandTotal;
      entry.cost += costOfItems(inv.items);
      customerTotals.set(inv.customerId, entry);
    }
    const topCustomers = Array.from(customerTotals.entries())
      .map(([customerId, v]) => {
        const profit = v.revenue - v.cost;
        return {
          customerId,
          name: v.company || v.name,
          orders: v.orders,
          revenue: Math.round(v.revenue * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          marginPercent: v.revenue ? Math.round((profit / v.revenue) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ---- Depot performance (hidden entirely for depot-scoped users) ----
    let depotPerformance: Array<{
      depotId: string;
      name: string;
      revenue: number;
      profit: number;
      orders: number;
      inventoryUnits: number;
      inventoryValue: number;
    }> = [];
    if (!isDepotScoped) {
      const invoicesByDepot = new Map<string, { revenue: number; cost: number; orders: number }>();
      for (const inv of rangeInvoices) {
        const entry = invoicesByDepot.get(inv.depotId) || { revenue: 0, cost: 0, orders: 0 };
        entry.revenue += inv.grandTotal;
        entry.cost += costOfItems(inv.items);
        entry.orders += 1;
        invoicesByDepot.set(inv.depotId, entry);
      }
      const inventoryByDepot = new Map<string, { units: number; value: number }>();
      for (const row of inventoryRows) {
        const entry = inventoryByDepot.get(row.depotId) || { units: 0, value: 0 };
        entry.units += row.quantity;
        entry.value += row.quantity * (productById.get(row.productId)?.purchasePrice || 0);
        inventoryByDepot.set(row.depotId, entry);
      }
      depotPerformance = depots
        .map((d) => {
          const sales = invoicesByDepot.get(d.id) || { revenue: 0, cost: 0, orders: 0 };
          const inv = inventoryByDepot.get(d.id) || { units: 0, value: 0 };
          return {
            depotId: d.id,
            name: d.name,
            revenue: Math.round(sales.revenue * 100) / 100,
            profit: Math.round((sales.revenue - sales.cost) * 100) / 100,
            orders: sales.orders,
            inventoryUnits: inv.units,
            inventoryValue: Math.round(inv.value * 100) / 100,
          };
        })
        .sort((a, b) => b.revenue - a.revenue);
    }

    const inventoryUnits = inventoryRows.reduce((s, r) => s + r.quantity, 0);
    const inventoryValue = inventoryRows.reduce((s, r) => s + r.quantity * (productById.get(r.productId)?.purchasePrice || 0), 0);

    const result = {
      totals: {
        revenue: Math.round(totalRevenue * 100) / 100,
        grossProfit: Math.round(totalGrossProfit * 100) / 100,
        grossMarginPercent,
        orders: invoices.length,
        inventoryUnits,
        inventoryValue: Math.round(inventoryValue * 100) / 100,
        pendingProformas: proformaPending,
        pendingShipments: shipmentsPending,
      },
      currentMonth: {
        revenue: currentBucket.revenue,
        profit: currentBucket.revenue - currentBucket.cost,
        orders: currentBucket.orders,
        revenueChangePct,
        profitChangePct,
        ordersChangePct,
      },
      trend,
      salesByCategory,
      topProducts,
      topCustomers,
      depotPerformance,
    };

    overviewCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, max-age=15, stale-while-revalidate=45',
      },
    });
  } catch (error) {
    console.error('Error building dashboard overview from DB, building from dataStore:', error);
    try {
      const products = dataStore.getProducts();
      const allInvoices = dataStore.getInvoices();
      const proformas = dataStore.getProformas();
      const shipments = dataStore.getShipments();
      const depots = dataStore.getDepots();

      const fallbackRangeStart = resolveRangeStart(range, new Date());
      const invoices = range
        ? allInvoices.filter((inv) => new Date(inv.createdAt) >= fallbackRangeStart)
        : allInvoices;

      const totalRevenue = invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
      const totalUnits = products.reduce((sum, p) => sum + (p.totalStock || 0), 0);
      const totalValuation = products.reduce((sum, p) => sum + (p.totalStock || 0) * (p.purchasePrice || 0), 0);
      const productById = new Map(products.map((p) => [p.id, p]));
      const grossProfit = invoices.reduce(
        (sum, inv) =>
          sum +
          (inv.items
            ? inv.items.reduce(
                (isum, item) =>
                  isum +
                  (item.totalPrice -
                    item.quantity * (productById.get(item.productId)?.purchasePrice || 0)),
                0
              )
            : 0),
        0
      );

      const fallbackResult = {
        totals: {
          revenue: Math.round(totalRevenue * 100) / 100,
          grossProfit: Math.round(grossProfit * 100) / 100,
          grossMarginPercent: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0,
          orders: invoices.length,
          inventoryUnits: totalUnits,
          inventoryValue: Math.round(totalValuation * 100) / 100,
          pendingProformas: proformas.filter((p) => p.status !== 'CONVERTED').length,
          pendingShipments: shipments.filter((s) => s.status !== 'DELIVERED').length,
        },
        currentMonth: {
          revenue: Math.round(totalRevenue * 100) / 100,
          profit: Math.round(grossProfit * 100) / 100,
          orders: invoices.length,
          revenueChangePct: 0,
          profitChangePct: 0,
          ordersChangePct: 0,
        },
        trend: [],
        salesByCategory: [],
        topProducts: [],
        topCustomers: [],
        depotPerformance: depots.map((d) => ({
          depotId: d.id,
          name: d.name,
          revenue: 0,
          profit: 0,
          orders: 0,
          inventoryUnits: d.totalStockUnits || 0,
          inventoryValue: d.totalStockValue || 0,
        })),
      };

      return NextResponse.json(fallbackResult);
    } catch {
      return NextResponse.json({ error: 'Failed to build dashboard overview' }, { status: 500 });
    }
  }
}
