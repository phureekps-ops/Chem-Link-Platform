import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { SearchProductsDto } from './dto/search-products.dto';
import { AddProductDocumentDto } from './dto/add-product-document.dto';

const SELLER_SUMMARY_SELECT = {
  select: {
    id: true,
    legalName: true,
    province: true,
    roles: {
      where: { roleType: 'SELLER' as const },
      select: { verificationStatus: true, compositeTrustScore: true },
    },
  },
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // Step 3 — search & filter (Section 5.2 facets). Only ever returns
  // published listings; a seller's own drafts are reached via
  // findMineByCompany() instead, never through the public search.
  async search(query: SearchProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ProductWhereInput = {
      isPublished: true,
    };

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { casNumber: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.categorySlug) where.category = { slug: query.categorySlug };
    if (query.stockStatus) where.stockStatus = query.stockStatus;
    if (query.maxLeadTimeDays !== undefined) {
      where.leadTimeDays = { lte: query.maxLeadTimeDays };
    }
    if (query.maxMoqValue !== undefined) {
      where.moqValue = { lte: query.maxMoqValue };
    }
    if (query.province) {
      where.sellerCompany = { province: { equals: query.province, mode: 'insensitive' } };
    }
    if (query.minTrustScore !== undefined) {
      where.sellerCompany = {
        ...(where.sellerCompany as object),
        roles: { some: { roleType: 'SELLER', compositeTrustScore: { gte: query.minTrustScore } } },
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          category: { select: { id: true, nameTh: true, slug: true } },
          sellerCompany: SELLER_SUMMARY_SELECT,
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findPublishedById(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, isPublished: true },
      include: {
        category: true,
        specs: { orderBy: { sortOrder: 'asc' } },
        documents: { orderBy: { uploadedAt: 'desc' } },
        sellerCompany: SELLER_SUMMARY_SELECT,
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  async findMineByCompany(companyId: string) {
    return this.prisma.product.findMany({
      where: { sellerCompanyId: companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { id: true, nameTh: true, slug: true } },
        _count: { select: { documents: true } },
      },
    });
  }

  // Only a SELLER-role company may list products (RolesGuard checks the
  // role is activated; here we additionally require it to be VERIFIED —
  // Section 14.3: role-restricted, higher-stakes actions need verified
  // status, not just an activated role).
  async create(companyId: string, dto: CreateProductDto) {
    await this.assertVerifiedSeller(companyId);

    return this.prisma.product.create({
      data: {
        sellerCompanyId: companyId,
        categoryId: dto.categoryId,
        name: dto.name,
        casNumber: dto.casNumber,
        grade: dto.grade,
        description: dto.description,
        moqValue: dto.moqValue,
        moqUnit: dto.moqUnit,
        priceMin: dto.priceMin,
        priceMax: dto.priceMax,
        priceUnit: dto.priceUnit,
        leadTimeDays: dto.leadTimeDays,
        stockStatus: dto.stockStatus,
        specs: dto.specs
          ? { create: dto.specs.map((s, i) => ({ ...s, sortOrder: s.sortOrder ?? i })) }
          : undefined,
      },
      include: { specs: true },
    });
  }

  async update(companyId: string, productId: string, dto: UpdateProductDto) {
    await this.assertOwnership(companyId, productId);

    const { specs, ...rest } = dto;

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...rest,
        // Full replace of specs on update keeps this endpoint simple —
        // the seller dashboard (Step 5.6) always resends the full spec
        // list from its form rather than diffing individual rows.
        ...(specs
          ? {
              specs: {
                deleteMany: {},
                create: specs.map((s, i) => ({ ...s, sortOrder: s.sortOrder ?? i })),
              },
            }
          : {}),
      },
      include: { specs: true },
    });
  }

  async remove(companyId: string, productId: string) {
    await this.assertOwnership(companyId, productId);
    await this.prisma.product.delete({ where: { id: productId } });
    return { success: true };
  }

  private async assertOwnership(companyId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found.');
    if (product.sellerCompanyId !== companyId) {
      throw new ForbiddenException('This product belongs to a different company.');
    }
    return product;
  }

  private async assertVerifiedSeller(companyId: string) {
    const sellerRole = await this.prisma.companyRole.findUnique({
      where: { companyId_roleType: { companyId, roleType: 'SELLER' } },
    });
    if (!sellerRole) {
      throw new ForbiddenException('Company has not activated the SELLER role.');
    }
    if (sellerRole.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException(
        'Company must complete SELLER verification before listing products.',
      );
    }
  }

  // --- Document library (Section 5.3: SDS / COA / TDS) ---

  async addDocument(companyId: string, productId: string, dto: AddProductDocumentDto) {
    await this.assertOwnership(companyId, productId);
    return this.prisma.productDocument.create({
      data: {
        productId,
        docType: dto.docType,
        fileUrl: dto.fileUrl,
        version: dto.version,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
      },
    });
  }

  async listDocuments(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found.');
    return this.prisma.productDocument.findMany({
      where: { productId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async removeDocument(companyId: string, productId: string, documentId: string) {
    await this.assertOwnership(companyId, productId);
    const doc = await this.prisma.productDocument.findUnique({ where: { id: documentId } });
    if (!doc || doc.productId !== productId) {
      throw new NotFoundException('Document not found for this product.');
    }
    await this.prisma.productDocument.delete({ where: { id: documentId } });
    return { success: true };
  }
}
