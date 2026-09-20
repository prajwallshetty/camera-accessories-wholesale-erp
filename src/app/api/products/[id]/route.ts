import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, sanitizeProductForRole } from '@/lib/api-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'products.read');
  if (!auth.ok) return auth.response;

  try {
    let product: any = null;
    try {
      product = await prisma.product.findUnique({
        where: { id },
        include: {
          category: true,
          inventories: {
            include: { depot: true },
          },
          serialNumbers: true,
        },
      });
    } catch (dbErr) {
      // DB offline, proceed to fallback
    }

    if (!product) {
      product = dataStore.getProductById(id);
    }

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(sanitizeProductForRole(product, auth.user.role));
  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'products.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();

    // Destructure out non-scalar / relational fields before passing to Prisma
    const {
      inventories,
      depotBreakdown,
      id: _id,
      sku: _sku,
      createdAt: _ca,
      updatedAt: _ua,
      category,
      serialNumbers: _sn,
      serialCount: _sc,
      totalStock: _ts,
      ...scalarData
    } = body;

    const inventoryUpdates: { depotId: string; quantity: number }[] =
      inventories ??
      (depotBreakdown
        ? Object.entries(depotBreakdown).map(([depotId, qty]) => ({
            depotId,
            quantity: Math.max(0, parseInt(qty as any) || 0),
          }))
        : null);

    let result: any = null;
    try {
      result = await prisma.$transaction(async (tx) => {
        scalarData.imageUrl = '/placeholder-product.svg';

        await tx.product.update({
          where: { id },
          data: scalarData,
        });

        if (inventoryUpdates) {
          for (const inv of inventoryUpdates) {
            const qty = Math.max(0, inv.quantity);
            await tx.depotInventory.upsert({
              where: { productId_depotId: { productId: id, depotId: inv.depotId } },
              update: { quantity: qty, availableQuantity: qty },
              create: {
                productId: id,
                depotId: inv.depotId,
                quantity: qty,
                allocatedQuantity: 0,
                availableQuantity: qty,
                minStockLevel: Number(scalarData.minStockLevel) || 5,
              },
            });
          }
        }

        const allInv = await tx.depotInventory.findMany({ where: { productId: id } });
        const newTotalStock = allInv.reduce((sum, inv) => sum + inv.quantity, 0);

        return tx.product.update({
          where: { id },
          data: { totalStock: newTotalStock },
          include: {
            category: true,
            inventories: { include: { depot: true } },
            serialNumbers: true,
          },
        });
      });
    } catch (dbErr) {
      // A real constraint violation (e.g. barcode already used by another
      // product) must be surfaced — falling through to the dataStore update
      // would silently accept an edit Postgres actually rejected, leaving
      // the two stores inconsistent.
      if (isPrismaConstraintError(dbErr)) {
        const message =
          dbErr.code === 'P2002'
            ? 'That barcode is already used by another product.'
            : prismaConstraintMessage(dbErr, 'Product');
        return NextResponse.json({ error: message }, { status: 409 });
      }

      // Otherwise the DB is unreachable/offline — proceed to dataStore fallback.
      const current = dataStore.getProductById(id);
      const newTotalStock = depotBreakdown
        ? Object.values(depotBreakdown).reduce((sum: number, q: any) => sum + (parseInt(q) || 0), 0)
        : current?.totalStock || 0;

      result = dataStore.updateProduct(id, {
        ...scalarData,
        depotBreakdown: depotBreakdown || current?.depotBreakdown || {},
        totalStock: newTotalStock,
      });
    }

    if (!result) {
      result = dataStore.getProductById(id);
    }

    if (!result) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(sanitizeProductForRole(result, auth.user.role));
  } catch (error) {
    console.error('Error updating product:', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'products.write');
  if (!auth.ok) return auth.response;

  try {
    try {
      await prisma.product.delete({
        where: { id },
      });
    } catch (dbErr) {
      // A real constraint violation (e.g. the product is referenced by
      // existing order/invoice line items) must be surfaced, not silently
      // swallowed — falling through to the dataStore delete would remove it
      // from the local cache while it still exists in Postgres.
      if (isPrismaConstraintError(dbErr)) {
        return NextResponse.json(
          { error: prismaConstraintMessage(dbErr, 'Product') },
          { status: 409 }
        );
      }
      // Otherwise the DB is unreachable/offline — proceed to dataStore delete.
    }

    dataStore.deleteProduct(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting product:', error);
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
  }
}

export const PATCH = PUT;
