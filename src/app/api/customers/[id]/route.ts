import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'customers.read');
  if (!auth.ok) return auth.response;

  try {
    let customer: any = null;
    try {
      customer = await prisma.customer.findUnique({
        where: { id },
        include: {
          proformas: { orderBy: { createdAt: 'desc' }, take: 50 },
          taxInvoices: { orderBy: { createdAt: 'desc' }, take: 50 },
          shipments: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      });
    } catch (dbErr) {
      // Prisma offline, proceed to dataStore fallback
    }

    if (!customer) {
      const fallback = dataStore.getCustomerById(id);
      if (fallback) {
        const customerProformas = dataStore.getProformas({ customerId: fallback.id });
        const customerInvoices = dataStore.getInvoices({ customerId: fallback.id });
        customer = {
          ...fallback,
          proformas: customerProformas,
          taxInvoices: customerInvoices,
          shipments: [],
        };
      }
    }

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // Compute live accurate totals from customer's invoices
    const invoices = Array.isArray(customer.taxInvoices) ? customer.taxInvoices : [];
    const validInvoices = invoices.filter(
      (i: any) => i.fulfilmentStatus !== 'CANCELLED' && (i as any).status !== 'CANCELLED'
    );
    if (validInvoices.length > 0) {
      const computedOrders = validInvoices.length;
      const computedSpent = validInvoices
        .filter((i: any) => i.paymentStatus === 'PAID')
        .reduce((sum: number, i: any) => sum + (Number(i.grandTotal) || 0), 0);
      const computedBalance = validInvoices
        .filter((i: any) => i.paymentStatus !== 'PAID')
        .reduce((sum: number, i: any) => sum + (Number(i.grandTotal) || 0), 0);

      // If DB has drift or negative balance, self-heal in background
      if (
        customer.currentBalance !== computedBalance ||
        customer.totalOrders !== computedOrders ||
        customer.totalSpent !== computedSpent
      ) {
        prisma.customer.update({
          where: { id: customer.id },
          data: {
            currentBalance: computedBalance,
            totalOrders: computedOrders,
            totalSpent: computedSpent,
          },
        }).catch(() => {});
        try {
          dataStore.updateCustomer(customer.id, {
            currentBalance: computedBalance,
            totalOrders: computedOrders,
            totalSpent: computedSpent,
          });
        } catch {}
      }

      customer.currentBalance = computedBalance;
      customer.totalOrders = computedOrders;
      customer.totalSpent = computedSpent;
    } else {
      customer.currentBalance = Math.max(0, customer.currentBalance || 0);
    }

    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error fetching customer:', error);
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'customers.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const {
      companyName,
      contactPerson,
      email,
      phone,
      billingAddress,
      shippingAddress,
      country,
      taxNumber,
      paymentTerms,
      creditLimit,
      status,
      notes,
    } = body;

    const updateData: any = {};
    if (companyName) updateData.companyName = companyName.trim();
    if (contactPerson) updateData.contactPerson = contactPerson.trim();
    if (email) updateData.email = email.trim();
    if (phone !== undefined) updateData.phone = phone.trim();
    if (billingAddress !== undefined) updateData.billingAddress = billingAddress.trim();
    if (shippingAddress !== undefined) updateData.shippingAddress = shippingAddress.trim();
    if (country !== undefined) updateData.country = country.trim();
    if (taxNumber !== undefined) updateData.taxNumber = taxNumber.trim();
    if (paymentTerms !== undefined) updateData.paymentTerms = paymentTerms;
    if (creditLimit !== undefined) updateData.creditLimit = Number(creditLimit);
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    let customer: any = null;
    try {
      customer = await prisma.customer.update({
        where: { id },
        data: updateData,
      });
    } catch (dbErr) {
      // A real constraint violation (e.g. that email/customer code is
      // already used by another customer) must be surfaced — falling
      // through to the dataStore update would silently accept an edit
      // Postgres actually rejected, leaving the two stores inconsistent.
      if (isPrismaConstraintError(dbErr)) {
        const message =
          dbErr.code === 'P2002'
            ? 'That email or customer code is already used by another customer.'
            : prismaConstraintMessage(dbErr, 'Customer');
        return NextResponse.json({ error: message }, { status: 409 });
      }
      // Otherwise the DB is unreachable/offline — proceed to dataStore fallback.
      customer = dataStore.updateCustomer(id, updateData);
    }

    if (!customer) {
      // Try by ID in dataStore if not already attempted
      customer = dataStore.updateCustomer(id, updateData);
    }

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, customer });
  } catch (error: any) {
    console.error('Error updating customer:', error);
    return NextResponse.json({ error: error.message || 'Failed to update customer' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'customers.write');
  if (!auth.ok) return auth.response;

  try {
    try {
      await prisma.customer.delete({
        where: { id },
      });
    } catch (dbErr) {
      // A real constraint violation (e.g. the customer still has proformas/
      // invoices on file) must be surfaced, not silently swallowed — falling
      // through to the dataStore delete here would remove it from the local
      // cache while it still exists in Postgres, making it reappear later.
      if (isPrismaConstraintError(dbErr)) {
        return NextResponse.json(
          { error: prismaConstraintMessage(dbErr, 'Customer') },
          { status: 409 }
        );
      }
      // Otherwise the DB is unreachable/offline — proceed to dataStore delete.
    }

    dataStore.deleteCustomer(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return NextResponse.json({ error: 'Failed to delete customer' }, { status: 500 });
  }
}
