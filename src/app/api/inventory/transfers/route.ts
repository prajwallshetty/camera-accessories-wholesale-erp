import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, depotIdFilter, guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.read');
  if (!auth.ok) return auth.response;
  try {
    const scopedDepotId = depotIdFilter(auth.user);
    const { take, skip } = parsePagination(req);
    const transfers = await prisma.stockTransfer.findMany({
      where: scopedDepotId ? { OR: [{ sourceDepotId: scopedDepotId }, { destinationDepotId: scopedDepotId }] } : undefined,
      include: {
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return NextResponse.json(transfers);
  } catch (error) {
    try {
      const scopedDepotId = depotIdFilter(auth.user);
      let transfers = dataStore.getTransfers();
      if (scopedDepotId) {
        transfers = transfers.filter((t) => t.sourceDepotId === scopedDepotId || t.destinationDepotId === scopedDepotId);
      }
      return NextResponse.json(transfers);
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.transfer');
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const { sourceDepotId, destinationDepotId, items, notes } = body;

    if (sourceDepotId === destinationDepotId) {
      return NextResponse.json({ error: 'Source and destination depots must be different' }, { status: 400 });
    }
    const denied = assertDepotAccess(auth.user, sourceDepotId);
    if (denied) return denied;

    let sourceDepot: any = null;
    let destDepot: any = null;
    try {
      sourceDepot = await prisma.depot.findUnique({ where: { id: sourceDepotId } });
      destDepot = await prisma.depot.findUnique({ where: { id: destinationDepotId } });
    } catch {}

    if (!sourceDepot) sourceDepot = dataStore.getDepotById(sourceDepotId);
    if (!destDepot) destDepot = dataStore.getDepotById(destinationDepotId);

    if (!sourceDepot || !destDepot) {
      return NextResponse.json({ error: 'Depot not found' }, { status: 404 });
    }

    let prismaAttempted = false;
    try {
      // Everything below runs in a single transaction: if any item fails
      // (bad product, insufficient stock, a constraint violation), the
      // whole transfer — including the header row and any inventory
      // already moved for earlier items — rolls back atomically. Without
      // this, a mid-loop failure used to leave a half-written transfer in
      // Postgres and then create a second, different record in dataStore.
      prismaAttempted = true;
      const transfer = await prisma.$transaction(async (tx) => {
        // Generate transfer number
        const lastTransfer = await tx.stockTransfer.findFirst({
          orderBy: { createdAt: 'desc' },
        });
        const lastNumber = lastTransfer ? parseInt(lastTransfer.transferNumber.split('-')[2]) : 0;
        const transferNumber = `TR-2026-${String(lastNumber + 1).padStart(5, '0')}`;

        const created = await tx.stockTransfer.create({
          data: {
            transferNumber,
            sourceDepotId,
            sourceDepotName: sourceDepot.name,
            destinationDepotId,
            destinationDepotName: destDepot.name,
            status: 'PENDING',
            notes,
            createdBy: auth.user.name || 'System',
          },
        });

        for (const item of items) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });

          if (!product) throw new Error(`Product ${item.productId} not found`);

          const quantity = Number(item.quantity) || 0;
          if (quantity <= 0) throw new Error(`Invalid quantity for ${product.name}`);

          const sourceInventory = await tx.depotInventory.findUnique({
            where: { productId_depotId: { productId: item.productId, depotId: sourceDepotId } },
          });
          if (!sourceInventory || sourceInventory.availableQuantity < quantity) {
            throw new Error(
              `Insufficient stock of ${product.name} at ${sourceDepot.name} (available: ${sourceInventory?.availableQuantity ?? 0})`
            );
          }

          await tx.stockTransferItem.create({
            data: {
              transferId: created.id,
              productId: item.productId,
              productSku: product.sku,
              productName: product.name,
              quantity,
              serialNumbers: item.serialNumbers || [],
            },
          });

          if (item.serialNumbers && Array.isArray(item.serialNumbers) && item.serialNumbers.length > 0) {
            await tx.serialNumber.updateMany({
              where: {
                productId: item.productId,
                serialNumber: { in: item.serialNumbers },
              },
              data: {
                depotId: destinationDepotId,
                depotName: destDepot.name,
              },
            });
          }

          await tx.depotInventory.update({
            where: { id: sourceInventory.id },
            data: {
              quantity: { decrement: quantity },
              availableQuantity: { decrement: quantity },
            },
          });

          await tx.depotInventory.upsert({
            where: {
              productId_depotId: {
                productId: item.productId,
                depotId: destinationDepotId,
              },
            },
            update: {
              quantity: { increment: quantity },
              availableQuantity: { increment: quantity },
            },
            create: {
              productId: item.productId,
              depotId: destinationDepotId,
              quantity,
              allocatedQuantity: 0,
              availableQuantity: quantity,
              minStockLevel: 10,
            },
          });
        }

        return tx.stockTransfer.findUnique({
          where: { id: created.id },
          include: { items: true },
        });
      });

      dataStore.createTransfer({
        id: transfer!.id,
        transferNumber: transfer!.transferNumber,
        sourceDepotId,
        sourceDepotName: sourceDepot.name,
        destinationDepotId,
        destinationDepotName: destDepot.name,
        items,
        notes,
        createdBy: auth.user.name || 'System',
      });

      return NextResponse.json(transfer, { status: 201 });
    } catch (dbErr) {
      // A real business-rule or constraint failure (bad product, insufficient
      // stock, a unique-field conflict) must be surfaced — the transaction
      // above already rolled back cleanly, so falling through to a
      // dataStore-only record here would silently create a transfer that
      // never happened in Postgres.
      if (prismaAttempted && (isPrismaConstraintError(dbErr) || dbErr instanceof Error)) {
        const message = isPrismaConstraintError(dbErr)
          ? prismaConstraintMessage(dbErr, 'Stock transfer')
          : (dbErr as Error).message;
        // Genuine DB-offline errors from the circuit breaker are plain
        // Errors with no distinguishing code — but so are the explicit
        // business-rule throws above. Treat known business-rule phrasing
        // as a real rejection; anything else falls back to dataStore.
        if (/not found|Insufficient stock|Invalid quantity/i.test(message)) {
          return NextResponse.json({ error: message }, { status: 400 });
        }
      }

      // Direct DataStore fallback (DB genuinely unreachable)
      const formattedItems = (items || []).map((item: any) => {
        const product = dataStore.getProductById(item.productId);
        return {
          productId: item.productId,
          productSku: product?.sku || '',
          productName: product?.name || '',
          quantity: Number(item.quantity) || 1,
          serialNumbers: item.serialNumbers || [],
        };
      });

      const transfer = dataStore.createTransfer({
        sourceDepotId,
        sourceDepotName: sourceDepot.name,
        destinationDepotId,
        destinationDepotName: destDepot.name,
        items: formattedItems,
        notes,
        createdBy: auth.user.name || 'System',
      });

      return NextResponse.json(transfer, { status: 201 });
    }
  } catch (error: any) {
    console.error('Error creating transfer:', error);
    return NextResponse.json({ error: error.message || 'Failed to create transfer' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.transfer');
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'Transfer ID and target status are required' }, { status: 400 });
    }

    const updateData: { status: any; receivedAt?: Date } = { status };
    if (status === 'COMPLETED') {
      updateData.receivedAt = new Date();
    }

    try {
      const updated = await prisma.stockTransfer.update({
        where: { id },
        data: updateData,
        include: { items: true },
      });
      dataStore.updateTransfer(id, { status, receivedAt: updateData.receivedAt ? updateData.receivedAt.toISOString() : undefined });
      return NextResponse.json(updated);
    } catch {
      const updated = dataStore.updateTransfer(id, {
        status,
        receivedAt: updateData.receivedAt ? updateData.receivedAt.toISOString() : undefined,
      });
      if (!updated) {
        return NextResponse.json({ error: 'Stock transfer not found' }, { status: 404 });
      }
      return NextResponse.json(updated);
    }
  } catch (error: any) {
    console.error('Error updating transfer status:', error);
    return NextResponse.json({ error: error.message || 'Failed to update transfer status' }, { status: 500 });
  }
}
