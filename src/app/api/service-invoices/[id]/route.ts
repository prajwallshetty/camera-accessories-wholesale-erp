import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.read');
  if (!auth.ok) return auth.response;

  try {
    let invoice: any = null;
    try {
      if ((prisma as any).serviceInvoice) {
        invoice = await (prisma as any).serviceInvoice.findFirst({
          where: { OR: [{ id }, { invoiceNumber: id }] },
          include: { items: true, customer: true },
        });
      }
    } catch {}

    if (!invoice) {
      invoice = dataStore.getServiceInvoiceById(id);
    }

    if (!invoice) {
      return NextResponse.json({ error: 'Service invoice not found' }, { status: 404 });
    }

    return NextResponse.json(invoice);
  } catch (error: any) {
    console.error('Error fetching service invoice:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch service invoice' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  try {
    let existing: any = null;
    try {
      if ((prisma as any).serviceInvoice) {
        existing = await (prisma as any).serviceInvoice.findFirst({
          where: { OR: [{ id }, { invoiceNumber: id }] },
        });
      }
    } catch {}

    if (!existing) {
      existing = dataStore.getServiceInvoiceById(id);
    }

    if (!existing) {
      return NextResponse.json({ error: 'Service invoice not found' }, { status: 404 });
    }

    const body = await req.json();
    const { status, notes, internalRemarks, paymentTerms } = body;

    const updatePayload: any = {
      ...(status ? { status } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(internalRemarks !== undefined ? { internalRemarks } : {}),
      ...(paymentTerms ? { paymentTerms } : {}),
    };

    let updated: any = null;
    try {
      if ((prisma as any).serviceInvoice) {
        updated = await (prisma as any).serviceInvoice.update({
          where: { id: existing.id },
          data: updatePayload,
          include: { items: true, customer: true },
        });
      }
    } catch {}

    const dsUpdated = dataStore.updateServiceInvoice(existing.id, updatePayload);
    if (!updated) updated = dsUpdated;

    return NextResponse.json({
      success: true,
      message: 'Service invoice updated',
      invoice: updated,
    });
  } catch (error: any) {
    console.error('Error updating service invoice:', error);
    return NextResponse.json({ error: error.message || 'Failed to update service invoice' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return PATCH(req, { params });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  try {
    let existing: any = null;
    try {
      if ((prisma as any).serviceInvoice) {
        existing = await (prisma as any).serviceInvoice.findFirst({
          where: { OR: [{ id }, { invoiceNumber: id }] },
        });
      }
    } catch {}

    if (!existing) {
      existing = dataStore.getServiceInvoiceById(id);
    }

    if (!existing) {
      return NextResponse.json({ error: 'Service invoice not found' }, { status: 404 });
    }

    if (existing.status !== 'DRAFT' && existing.status !== 'CANCELLED') {
      return NextResponse.json(
        { error: `Cannot delete an active service invoice in status "${existing.status}". Cancel it first.` },
        { status: 400 }
      );
    }

    try {
      if ((prisma as any).serviceInvoice) {
        await (prisma as any).serviceInvoice.delete({
          where: { id: existing.id },
        });
      }
    } catch (dbErr) {
      if (isPrismaConstraintError(dbErr)) {
        return NextResponse.json(
          { error: prismaConstraintMessage(dbErr, 'Service invoice') },
          { status: 409 }
        );
      }
      // Otherwise the DB is unreachable/offline — proceed to dataStore delete.
    }

    dataStore.deleteServiceInvoice(existing.id);

    return NextResponse.json({ success: true, message: 'Service invoice deleted' });
  } catch (error: any) {
    console.error('Error deleting service invoice:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete service invoice' }, { status: 500 });
  }
}
