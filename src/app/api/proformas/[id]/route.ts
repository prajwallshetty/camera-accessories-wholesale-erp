import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { guardApi } from '@/lib/api-auth';
import { canTransition, isProformaStatus, ProformaStatus } from '@/lib/proforma-workflow';
import {
  allocateFreight,
  computeChargeableWeightKg,
  computeFreightCharge,
  computeTotalFreight,
  FreightAllocationMethod,
} from '@/lib/freight';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.read');
  if (!auth.ok) return auth.response;

  try {
    let proforma: any = null;
    try {
      proforma = await prisma.proforma.findUnique({
        where: { id },
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
        },
      });

      if (!proforma) {
        proforma = await prisma.proforma.findUnique({
          where: { proformaNumber: id },
          include: {
            customer: true,
            items: {
              include: { product: true },
            },
          },
        });
      }
    } catch (dbErr) {
      // DB offline, proceed to fallback
    }

    if (!proforma) {
      proforma = dataStore.getProformaById(id);
    }

    if (!proforma) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
    }

    return NextResponse.json(proforma);
  } catch (error) {
    console.error('Error fetching proforma:', error);
    return NextResponse.json({ error: 'Failed to fetch proforma' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { status, notes, freight, freightAllocation } = body;

    let existing: any = null;
    try {
      existing = await prisma.proforma.findFirst({
        where: {
          OR: [{ id }, { proformaNumber: id }],
        },
        include: { items: true },
      });
    } catch {}

    if (!existing) {
      existing = dataStore.getProformaById(id);
    }

    if (!existing) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
    }

    const targetId = existing.id;

    if (status !== undefined) {
      if (!isProformaStatus(status)) {
        return NextResponse.json({ error: `Unknown proforma status "${status}".` }, { status: 400 });
      }
      const check = canTransition(existing.status as ProformaStatus, status);
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    let discPercent = Number(existing.discountPercent) || 0;
    let recomputeTotals = false;

    if (existing.status === 'DRAFT') {
      if (body.paymentTerms !== undefined) updateData.paymentTerms = body.paymentTerms;
      if (body.deliveryTerms !== undefined) updateData.deliveryTerms = body.deliveryTerms;
      if (body.discountPercent !== undefined) {
        discPercent = Number(body.discountPercent) || 0;
        updateData.discountPercent = discPercent;
        recomputeTotals = true;
      }

      // Freight edit: rate, additional charges, manual override, or a direct
      // actual/volumetric weight correction. Recomputed authoritatively here
      // — never trust a client-supplied Total Freight when a breakdown exists.
      if (freight !== undefined) {
        const actualWeightKg = Number(freight.actualWeightKg ?? existing.actualWeightKg) || 0;
        const volumetricWeightKg = Number(freight.volumetricWeightKg ?? existing.volumetricWeightKg) || 0;
        const chargeableWeightKg = computeChargeableWeightKg(actualWeightKg, volumetricWeightKg);
        const freightRatePerKg = Number(freight.freightRatePerKg ?? existing.freightRatePerKg) || 0;
        const freightCharge = computeFreightCharge(chargeableWeightKg, freightRatePerKg);
        const additionalFreightCharges = Number(freight.additionalFreightCharges ?? existing.additionalFreightCharges) || 0;
        const isManualOverride = Boolean(freight.isManualOverride);
        const totalFreight = isManualOverride
          ? Math.max(0, Number(freight.manualTotalFreight) || 0)
          : computeTotalFreight(freightCharge, additionalFreightCharges);

        updateData.actualWeightKg = actualWeightKg;
        updateData.volumetricWeightKg = volumetricWeightKg;
        updateData.chargeableWeightKg = chargeableWeightKg;
        updateData.freightRatePerKg = freightRatePerKg;
        updateData.freightCharge = freightCharge;
        updateData.additionalFreightCharges = additionalFreightCharges;
        updateData.freightIsManualOverride = isManualOverride;
        if (freight.volumetricDivisor !== undefined) {
          updateData.freightVolumetricDivisor = Number(freight.volumetricDivisor) || 0;
        }
        updateData.shippingCost = totalFreight;
        recomputeTotals = true;
      } else if (body.shippingCost !== undefined) {
        // Legacy path: a bare shippingCost with no breakdown is a manual figure.
        updateData.shippingCost = Number(body.shippingCost) || 0;
        updateData.freightIsManualOverride = true;
        recomputeTotals = true;
      }
    }

    // Optional freight allocation to products — reporting only, never changes
    // subtotal/tax/shippingCost/grandTotal.
    let itemAllocationUpdates: { id: string; allocatedFreight: number }[] | null = null;
    if (freightAllocation && Array.isArray(existing.items)) {
      const method = freightAllocation.method as FreightAllocationMethod;
      const totalFreight = Number(existing.shippingCost) || 0;
      if (method === 'MANUAL') {
        const provided: { itemId: string; allocatedFreight: number }[] = freightAllocation.allocations || [];
        itemAllocationUpdates = provided.map((a) => ({ id: a.itemId, allocatedFreight: Number(a.allocatedFreight) || 0 }));
      } else {
        const shares = allocateFreight(
          existing.items.map((it: any) => ({
            quantity: it.quantity,
            unitWeightKg: it.unitWeightKg || 0,
            totalPrice: it.totalPrice,
          })),
          totalFreight,
          method
        );
        itemAllocationUpdates = existing.items.map((it: any, idx: number) => ({
          id: it.id,
          allocatedFreight: shares[idx] || 0,
        }));
      }
      updateData.freightAllocationMethod = method;
    }

    if (recomputeTotals) {
      const subtotal = Number(existing.subtotal) || 0;
      const taxAmount = Number(existing.taxAmount) || 0;
      const discountAmount = (subtotal * discPercent) / 100;
      const shippingCost = updateData.shippingCost !== undefined ? updateData.shippingCost : Number(existing.shippingCost) || 0;
      const otherCharges = Number(existing.otherCharges) || 0;
      updateData.discountAmount = Number(discountAmount.toFixed(2));
      updateData.grandTotal = Number((subtotal - discountAmount + taxAmount + shippingCost + otherCharges).toFixed(2));
    }

    if (Object.keys(updateData).length === 0 && !itemAllocationUpdates) {
      return NextResponse.json({ error: 'No supported fields to update.' }, { status: 400 });
    }

    let proforma: any = null;
    try {
      if (itemAllocationUpdates) {
        await prisma.$transaction(
          itemAllocationUpdates.map((u) =>
            prisma.proformaItem.update({ where: { id: u.id }, data: { allocatedFreight: u.allocatedFreight } })
          )
        );
      }
      proforma = await prisma.proforma.update({
        where: { id: targetId },
        data: updateData,
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
        },
      });
    } catch (dbErr) {
      // Fallback to dataStore
      if (itemAllocationUpdates) {
        const itemMap = new Map(itemAllocationUpdates.map((u) => [u.id, u.allocatedFreight]));
        existing.items = (existing.items || []).map((it: any) =>
          itemMap.has(it.id) ? { ...it, allocatedFreight: itemMap.get(it.id) } : it
        );
      }
      proforma = dataStore.updateProforma(targetId, { ...updateData, items: existing.items });
    }

    if (!proforma) {
      proforma = dataStore.updateProforma(targetId, updateData);
    }

    // Broadcast real-time event to open client portals and admin dashboards
    try {
      broadcastSystemEvent({
        type: proforma.status === 'CONFIRMED' ? 'PROFORMA_CONFIRMED' : 'PROFORMA_UPDATED',
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        status: proforma.status,
        data: proforma,
      });
    } catch (evtErr) {}

    return NextResponse.json(proforma);
  } catch (error) {
    console.error('Error updating proforma:', error);
    return NextResponse.json({ error: 'Failed to update proforma' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    let existing: any = null;
    try {
      existing = await prisma.proforma.findFirst({
        where: { OR: [{ id }, { proformaNumber: id }] },
      });
    } catch {}

    if (!existing) {
      existing = dataStore.getProformaById(id);
    }

    if (!existing) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
    }

    if (existing.status === 'CONVERTED') {
      return NextResponse.json(
        { error: 'Cannot delete a proforma that has already been converted to a tax invoice.' },
        { status: 400 }
      );
    }

    try {
      await prisma.proforma.delete({
        where: { id: existing.id },
      });
    } catch (dbErr) {
      if (isPrismaConstraintError(dbErr)) {
        return NextResponse.json(
          { error: prismaConstraintMessage(dbErr, 'Proforma') },
          { status: 409 }
        );
      }
      // Otherwise the DB is unreachable/offline — proceed to dataStore delete.
    }

    dataStore.deleteProforma(existing.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting proforma:', error);
    return NextResponse.json({ error: 'Failed to delete proforma' }, { status: 500 });
  }
}
