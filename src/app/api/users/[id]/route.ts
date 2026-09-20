import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, stripUserSecrets } from '@/lib/api-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'users.read');
  if (!auth.ok) return auth.response;

  try {
    let user: any = null;
    try {
      user = await prisma.user.findUnique({
        where: { id },
        include: {
          depot: true,
          auditLogs: { orderBy: { timestamp: 'desc' }, take: 50 },
        },
      });
    } catch {
      user = dataStore.getUserById(id);
    }

    if (!user) {
      user = dataStore.getUserById(id);
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(stripUserSecrets(user));
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { password, ...otherData } = body;

    const updateData: any = { ...otherData };
    if (password) {
      const { hashPassword } = await import('@/lib/auth');
      updateData.passwordHash = hashPassword(password);
    }

    // Protection 1: Prevent self-deactivation
    if ((updateData.status === 'INACTIVE' || updateData.status === 'SUSPENDED') && auth.user.id === id) {
      return NextResponse.json({ error: 'You cannot deactivate your own user account.' }, { status: 400 });
    }

    // Protection 2: Prevent deactivating or demoting the last active Super Admin
    if (updateData.status === 'INACTIVE' || updateData.status === 'SUSPENDED' || (updateData.role && updateData.role !== 'SUPER_ADMIN')) {
      try {
        const target = await prisma.user.findUnique({ where: { id } });
        if (target?.role === 'SUPER_ADMIN') {
          const superAdminCount = await prisma.user.count({
            where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
          });
          if (superAdminCount <= 1) {
            return NextResponse.json(
              { error: 'Cannot deactivate or demote the last active Super Admin in the system.' },
              { status: 400 }
            );
          }
        }
      } catch {}
    }

    try {
      const user = await prisma.user.update({
        where: { id },
        data: updateData,
      });
      dataStore.updateUser(id, updateData);
      return NextResponse.json(stripUserSecrets(user));
    } catch (dbErr) {
      // A real constraint violation (e.g. that email is already used by
      // another account) must be surfaced — falling through to the
      // dataStore update would silently accept an edit Postgres actually
      // rejected, leaving the two stores inconsistent.
      if (isPrismaConstraintError(dbErr)) {
        const message =
          dbErr.code === 'P2002'
            ? 'That email address is already used by another account.'
            : prismaConstraintMessage(dbErr, 'User');
        return NextResponse.json({ error: message }, { status: 409 });
      }

      const user = dataStore.updateUser(id, updateData);
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      return NextResponse.json(stripUserSecrets(user));
    }
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;

  if (auth.user.id === id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }

  try {
    try {
      const target = await prisma.user.findUnique({ where: { id } });
      if (target?.role === 'SUPER_ADMIN') {
        const superAdminCount = await prisma.user.count({
          where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
        });
        if (superAdminCount <= 1) {
          return NextResponse.json(
            { error: 'Cannot delete the last active Super Admin in the system.' },
            { status: 400 }
          );
        }
      }

      await prisma.user.delete({
        where: { id },
      });
    } catch (dbErr) {
      // A real constraint violation (e.g. the user is still referenced as
      // the manager/creator on existing invoices or proformas) must be
      // surfaced, not silently swallowed — falling through to the
      // dataStore delete would remove it from the local cache while it
      // still exists in Postgres.
      if (isPrismaConstraintError(dbErr)) {
        return NextResponse.json(
          { error: prismaConstraintMessage(dbErr, 'User') },
          { status: 409 }
        );
      }
      // Otherwise the DB is unreachable/offline — proceed to dataStore delete.
    }
    dataStore.deleteUser(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
