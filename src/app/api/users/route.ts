import { NextRequest, NextResponse } from 'next/server';
import { prisma, isPrismaConstraintError, prismaConstraintMessage } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, stripUserSecrets } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'users.read');
  if (!auth.ok) return auth.response;

  try {
    const q = req.nextUrl.searchParams.get('q')?.trim();
    const { take, skip } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });

    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q, mode: 'insensitive' as const } },
        { assignedDepotName: { contains: q, mode: 'insensitive' as const } },
      ];
    }

    try {
      const users = await prisma.user.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        include: { depot: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      return NextResponse.json(users.map((u) => stripUserSecrets(u)));
    } catch {
      let users = dataStore.getUsers();
      if (q) {
        const query = q.toLowerCase();
        users = users.filter(
          (u) =>
            u.name.toLowerCase().includes(query) ||
            u.email.toLowerCase().includes(query) ||
            (u.assignedDepotName && u.assignedDepotName.toLowerCase().includes(query)) ||
            u.role.toLowerCase().includes(query)
        );
      }
      return NextResponse.json(users.map((u) => stripUserSecrets(u)));
    }
  } catch (error) {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { password, ...userData } = body;

    const cleanEmail = (userData.email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    userData.email = cleanEmail;

    // Duplicate email check (fall back to the dataStore mirror when Prisma
    // is unreachable, so this is still caught offline).
    try {
      const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (existing) {
        return NextResponse.json({ error: `A user with email "${cleanEmail}" already exists` }, { status: 409 });
      }
    } catch {
      const existing = dataStore.getUsers().find((u) => u.email.toLowerCase() === cleanEmail);
      if (existing) {
        return NextResponse.json({ error: `A user with email "${cleanEmail}" already exists` }, { status: 409 });
      }
    }

    let passwordHash = '';
    if (password) {
      const { hashPassword } = await import('@/lib/auth');
      passwordHash = hashPassword(password);
    }

    try {
      const user = await prisma.user.create({
        data: {
          ...userData,
          passwordHash: passwordHash || undefined,
        },
        include: { depot: true },
      });
      dataStore.createUser({ ...user, passwordHash });
      return NextResponse.json(stripUserSecrets(user), { status: 201 });
    } catch (dbErr) {
      if (isPrismaConstraintError(dbErr)) {
        const message =
          dbErr.code === 'P2002'
            ? `A user with email "${cleanEmail}" already exists`
            : prismaConstraintMessage(dbErr, 'User');
        return NextResponse.json({ error: message }, { status: 409 });
      }
      const user = dataStore.createUser({
        ...userData,
        passwordHash,
      });
      return NextResponse.json(stripUserSecrets(user), { status: 201 });
    }
  } catch (error: any) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: error.message || 'Failed to create user' }, { status: 500 });
  }
}
