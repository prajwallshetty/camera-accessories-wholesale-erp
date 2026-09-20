import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, assertDepotAccess } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.adjust');
  if (!auth.ok) return auth.response;

  try {
    const { take, skip } = parsePagination(req);
    const adjustments = await prisma.stockAdjustment.findMany({ orderBy: { createdAt: 'desc' }, take, skip });
    return NextResponse.json(adjustments);
  } catch (error: any) {
    try {
      return NextResponse.json(dataStore.getAdjustments());
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.adjust');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { productId, depotId, deltaQty, reason, notes } = body;

    if (!productId || !depotId || deltaQty === undefined || !reason) {
      return NextResponse.json(
        { error: 'productId, depotId, deltaQty, and reason are required' },
        { status: 400 }
      );
    }

    const denied = assertDepotAccess(auth.user, depotId);
    if (denied) return denied;

    const delta = Number(deltaQty);
    if (!Number.isFinite(delta)) {
      return NextResponse.json({ error: 'deltaQty must be a valid number' }, { status: 400 });
    }

    let inventory: any = null;
    try {
      inventory = await prisma.depotInventory.findUnique({
        where: { productId_depotId: { productId, depotId } },
        include: { product: true, depot: true },
      });
    } catch {}

    if (inventory) {
      if (inventory.quantity + delta < 0 || inventory.availableQuantity + delta < 0) {
        return NextResponse.json({ error: 'Adjustment would make stock negative' }, { status: 400 });
      }

      try {
        const adjustment = await prisma.$transaction(async (tx) => {
          const updated = await tx.depotInventory.update({
            where: { id: inventory.id },
            data: { quantity: { increment: delta }, availableQuantity: { increment: delta } },
          });
          await tx.product.update({
            where: { id: productId },
            data: { totalStock: { increment: delta } },
          });
          return tx.stockAdjustment.create({
            data: {
              productId,
              productSku: inventory.product.sku,
              productName: inventory.product.name,
              depotId,
              depotName: inventory.depot.name,
              deltaQty: delta,
              previousQty: inventory.quantity,
              newQty: updated.quantity,
              reason,
              user: auth.user.name,
              notes,
            },
          });
        });

        dataStore.createAdjustment({
          productId,
          productSku: inventory.product.sku,
          productName: inventory.product.name,
          depotId,
          depotName: inventory.depot.name,
          deltaQty: delta,
          previousQty: inventory.quantity,
          newQty: inventory.quantity + delta,
          reason,
          user: auth.user.name,
          notes,
        });

        return NextResponse.json({ success: true, adjustment }, { status: 201 });
      } catch (dbErr) {
        // `inventory` was just read successfully via Prisma, so the DB is
        // reachable — a transaction failure here is a real error (e.g. a
        // constraint violation), not "offline." Falling through to the
        // dataStore-only path below would record the adjustment locally
        // while Postgres was never actually updated, desyncing the two
        // stores. Surface it instead.
        if (isPrismaConstraintError(dbErr)) {
          return NextResponse.json(
            { error: prismaConstraintMessage(dbErr, 'Stock adjustment') },
            { status: 409 }
          );
        }
        console.error('Stock adjustment transaction failed:', dbErr);
        return NextResponse.json({ error: 'Failed to apply stock adjustment' }, { status: 500 });
      }
    }

    // Fallback to dataStore (only reached when the initial Prisma read of
    // depotInventory itself failed, i.e. the DB is genuinely unreachable)
    const product = dataStore.getProductById(productId);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    const depot = dataStore.getDepotById(depotId);
    const depotName = depot?.name || 'Central Depot';
    const previousQty = product.depotBreakdown?.[depotId] || 0;

    if (previousQty + delta < 0) {
      return NextResponse.json({ error: 'Adjustment would make stock negative' }, { status: 400 });
    }

    const adjustment = dataStore.createAdjustment({
      productId,
      productSku: product.sku,
      productName: product.name,
      depotId,
      depotName,
      deltaQty: delta,
      previousQty,
      newQty: previousQty + delta,
      reason,
      user: auth.user.name,
      notes,
    });

    return NextResponse.json({ success: true, adjustment }, { status: 201 });
  } catch (error: any) {
    console.error('Stock adjustment error:', error);
    return NextResponse.json({ error: error.message || 'Failed to adjust stock' }, { status: 400 });
  }
}
