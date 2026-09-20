import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, sanitizeProductForRole, depotIdFilter } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'products.read');
  if (!auth.ok) return auth.response;

  try {
    const depotFilter = depotIdFilter(auth.user);
    const { take, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const q = req.nextUrl.searchParams.get('q')?.trim();

    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [products, depots] = await withDbTimeout(() =>
      Promise.all([
        prisma.product.findMany({
          where: Object.keys(where).length > 0 ? where : undefined,
          select: {
            id: true,
            sku: true,
            name: true,
            brand: true,
            model: true,
            categoryId: true,
            categoryName: true,
            subcategory: true,
            description: true,
            imageUrl: true,
            barcode: true,
            trackSerial: true,
            purchasePrice: true,
            sellingPrice: true,
            wholesalePrice: true,
            taxRate: true,
            minStockLevel: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            category: { select: { name: true } },
            inventories: {
              where: depotFilter ? { depotId: depotFilter } : undefined,
              select: { depotId: true, quantity: true },
            },
            // Only the count is used (serialCount) — no need to load every serial row.
            _count: {
              select: {
                serialNumbers: depotFilter ? { where: { depotId: depotFilter } } : true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take,
          skip,
        }),
        prisma.depot.findMany({
          where: depotFilter ? { id: depotFilter } : undefined,
          select: { id: true, code: true, name: true }
        }),
      ])
    );

    const formatted = products.map((product) => {
      const depotBreakdown: Record<string, number> = {};
      // Initialize all depots with 0 so the frontend always has consistent depot stock keys
      depots.forEach((d) => {
        depotBreakdown[d.id] = 0;
      });

      let totalStock = 0;
      for (const inv of product.inventories) {
        depotBreakdown[inv.depotId] = inv.quantity;
        totalStock += inv.quantity;
      }

      const productData = {
        id: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        model: product.model || '',
        categoryId: product.categoryId,
        categoryName: product.category?.name || product.categoryName || 'General Optics',
        subcategory: product.subcategory || '',
        description: product.description || '',
        imageUrl: '/placeholder-product.svg',
        barcode: product.barcode,
        trackSerial: product.trackSerial,
        purchasePrice: product.purchasePrice,
        sellingPrice: product.sellingPrice,
        wholesalePrice: product.wholesalePrice,
        taxRate: product.taxRate,
        minStockLevel: product.minStockLevel,
        status: product.status as 'ACTIVE' | 'ARCHIVED',
        totalStock,
        depotBreakdown,
        serialCount: product._count?.serialNumbers || 0,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      };

      return sanitizeProductForRole(productData, auth.user.role);
    });

    return NextResponse.json(formatted, {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
      },
    });
  } catch (error: any) {
    console.error('Error fetching products from DB, using fallback:', error);
    try {
      const q = req.nextUrl.searchParams.get('q')?.trim()?.toLowerCase();
      let list = dataStore.getProducts();
      if (q) {
        list = list.filter((p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          (p.model && p.model.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
        );
      }
      const fallbackProducts = list.map((p) =>
        sanitizeProductForRole(p as any, auth.user.role)
      );
      return NextResponse.json(fallbackProducts);
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'products.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const {
      name,
      sku,
      brand,
      model,
      categoryName,
      description,
      barcode,
      imageUrl,
      purchasePrice,
      wholesalePrice,
      sellingPrice,
      taxRate = 5,
      trackSerial = true,
      minStockLevel = 10,
      depotBreakdown = {},
      status = 'ACTIVE',
    } = body;

    // Validation
    if (!name?.trim()) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    if (!sku?.trim()) return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
    if (!brand?.trim()) return NextResponse.json({ error: 'Brand is required' }, { status: 400 });

    const cleanSku = sku.trim().toUpperCase();

    // Check if SKU already exists (fall back to the dataStore mirror when
    // Prisma is unreachable, so duplicate SKUs are still caught offline).
    let existingSku: any = null;
    try {
      existingSku = await prisma.product.findUnique({ where: { sku: cleanSku } });
    } catch {
      existingSku = dataStore.getProducts().find((p) => p.sku?.toUpperCase() === cleanSku) || null;
    }
    if (existingSku) {
      return NextResponse.json({ error: `Product with SKU "${cleanSku}" already exists` }, { status: 409 });
    }

    // Resolve or create category
    const catName = categoryName?.trim() || 'Camera Bodies';
    const catSlug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let category: any = null;
    try {
      category = await prisma.category.findFirst({
        where: {
          OR: [{ name: { equals: catName, mode: 'insensitive' } }, { slug: catSlug }],
        },
      });

      if (!category) {
        category = await prisma.category.create({
          data: {
            name: catName,
            slug: `${catSlug}-${Date.now()}`,
            description: `${catName} equipment and optics`,
          },
        });
      }
    } catch {}

    // Resolve barcode
    const cleanBarcode = barcode?.trim() || `8809${Math.floor(10000000 + Math.random() * 90000000)}`;

    // Calculate total stock from depot breakdown
    const totalStock = Object.values(depotBreakdown).reduce(
      (sum: number, qty: any) => sum + (parseInt(qty) || 0),
      0
    );

    // Get all depots to map depot names and codes
    let allDepots: any[] = [];
    try {
      allDepots = await prisma.depot.findMany();
    } catch {}
    const depotMap = new Map(allDepots.map((d) => [d.id, d]));

    // Generate clean product ID
    const productId = `prod-${cleanSku.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    // Create Product in Database
    let product: any = null;
    try {
      product = await prisma.product.create({
        data: {
          id: productId,
          sku: cleanSku,
          name: name.trim(),
          brand: brand.trim(),
          model: model?.trim() || '',
          categoryId: category?.id || 'cat-1',
          categoryName: category?.name || catName,
          description: description?.trim() || '',
          imageUrl: '/placeholder-product.svg',
          barcode: cleanBarcode,
          trackSerial: Boolean(trackSerial),
          purchasePrice: Number(purchasePrice) || 0,
          wholesalePrice: Number(wholesalePrice) || 0,
          sellingPrice: Number(sellingPrice) || 0,
          taxRate: Number(taxRate) || 0,
          minStockLevel: Number(minStockLevel) || 10,
          status: status || 'ACTIVE',
          totalStock,
        },
      });
    } catch (err) {
      console.error('Database write failed during product creation, using in-memory fallback:', err);
    }

    // Create Depot Inventory & Serial Numbers in DB
    if (product) {
      try {
        const serialsToCreate: any[] = [];
        for (const [depotId, qtyRaw] of Object.entries(depotBreakdown)) {
          const qty = parseInt(qtyRaw as any) || 0;
          const depot = depotMap.get(depotId);
          if (depot) {
            await prisma.depotInventory.upsert({
              where: {
                productId_depotId: {
                  productId: product.id,
                  depotId: depot.id,
                },
              },
              create: {
                productId: product.id,
                depotId: depot.id,
                quantity: qty,
                allocatedQuantity: 0,
                availableQuantity: qty,
                minStockLevel: Number(minStockLevel) || 5,
              },
              update: {
                quantity: qty,
                availableQuantity: qty,
              },
            });

            if (trackSerial && qty > 0) {
              const depotCode = depot.code.replace('DEP-', '');
              for (let i = 1; i <= Math.min(qty, 100); i++) {
                const randomCode = Math.floor(1000 + Math.random() * 9000);
                serialsToCreate.push({
                  productId: product.id,
                  productSku: product.sku,
                  productName: product.name,
                  serialNumber: `SN-${cleanSku}-${depotCode}-${String(i).padStart(3, '0')}-${randomCode}`,
                  depotId: depot.id,
                  depotName: depot.name,
                  status: 'IN_STOCK',
                  historyJson: JSON.stringify([
                    {
                      action: 'INITIAL_STOCK_ENTRY',
                      depot: depot.name,
                      timestamp: new Date().toISOString(),
                      notes: 'Initial inventory entry',
                    },
                  ]),
                });
              }
            }
          }
        }

        if (serialsToCreate.length > 0) {
          await prisma.serialNumber.createMany({
            data: serialsToCreate,
            skipDuplicates: true,
          });
        }
      } catch (err) {
        console.error('Error creating depot inventory rows:', err);
      }
    }

    // Sync with in-memory dataStore
    const memoryProduct = dataStore.createProduct({
      id: productId,
      sku: cleanSku,
      name: name.trim(),
      brand: brand.trim(),
      model: model?.trim() || '',
      categoryId: category?.id || 'cat-1',
      categoryName: category?.name || catName,
      description: description?.trim() || '',
      imageUrl: '/placeholder-product.svg',
      barcode: cleanBarcode,
      trackSerial: Boolean(trackSerial),
      purchasePrice: Number(purchasePrice) || 0,
      wholesalePrice: Number(wholesalePrice) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      taxRate: Number(taxRate) || 0,
      minStockLevel: Number(minStockLevel) || 10,
      status: status || 'ACTIVE',
      depotBreakdown,
      totalStock,
    });

    const finalProduct = product || memoryProduct;

    return NextResponse.json(
      {
        success: true,
        product: {
          ...finalProduct,
          depotBreakdown,
          totalStock,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating product:', error);
    return NextResponse.json({ error: error.message || 'Failed to create product' }, { status: 500 });
  }
}
