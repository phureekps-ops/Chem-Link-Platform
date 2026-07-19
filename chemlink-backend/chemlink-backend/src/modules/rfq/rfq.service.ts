import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DealMessageType, NotificationType, Prisma, RfqDistributionType, RfqStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto } from './dto/update-rfq.dto';
import { SubmitRfqDto } from './dto/submit-rfq.dto';
import { NotificationsService } from '../notifications/notifications.service';

const DEAL_ROOM_INCLUDE = {
  quotes: { orderBy: { version: 'desc' as const } },
  messages: { orderBy: { createdAt: 'asc' as const } },
  sellerCompany: { select: { id: true, legalName: true, province: true } },
};

@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Draft lifecycle (Section 5.4 step 1) ---

  async create(buyerCompanyId: string, userId: string, dto: CreateRfqDto) {
    await this.assertVerifiedBuyer(buyerCompanyId);

    return this.prisma.rfq.create({
      data: {
        buyerCompanyId,
        createdByUserId: userId,
        productId: dto.productId,
        categoryId: dto.categoryId,
        productName: dto.productName,
        casNumber: dto.casNumber,
        gradeRequirement: dto.gradeRequirement,
        purityRequirement: dto.purityRequirement,
        quantityValue: dto.quantityValue,
        quantityUnit: dto.quantityUnit,
        deliveryLocation: dto.deliveryLocation,
        deliveryDeadline: dto.deliveryDeadline ? new Date(dto.deliveryDeadline) : undefined,
        paymentTermsNote: dto.paymentTermsNote,
        notes: dto.notes,
        status: RfqStatus.DRAFT,
      },
    });
  }

  async update(buyerCompanyId: string, rfqId: string, dto: UpdateRfqDto) {
    const rfq = await this.assertOwnedDraft(buyerCompanyId, rfqId);

    return this.prisma.rfq.update({
      where: { id: rfq.id },
      data: {
        ...dto,
        deliveryDeadline: dto.deliveryDeadline ? new Date(dto.deliveryDeadline) : undefined,
      },
    });
  }

  async findMine(buyerCompanyId: string) {
    return this.prisma.rfq.findMany({
      where: { buyerCompanyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { nameTh: true, slug: true } },
        _count: { select: { deals: true } },
      },
    });
  }

  async findOneOwned(buyerCompanyId: string, rfqId: string) {
    const rfq = await this.prisma.rfq.findUnique({
      where: { id: rfqId },
      include: {
        category: true,
        deals: { include: DEAL_ROOM_INCLUDE },
      },
    });
    if (!rfq) throw new NotFoundException('RFQ not found.');
    if (rfq.buyerCompanyId !== buyerCompanyId) {
      throw new ForbiddenException('This RFQ belongs to a different company.');
    }
    return rfq;
  }

  // --- Submission (Section 5.4 step 2, Section 6 steps 1→2) ---

  async submit(buyerCompanyId: string, rfqId: string, dto: SubmitRfqDto) {
    const rfq = await this.assertOwnedDraft(buyerCompanyId, rfqId);

    const sellerCompanyIds =
      dto.distributionType === RfqDistributionType.TARGETED
        ? await this.validateTargetedSellers(buyerCompanyId, dto.sellerCompanyIds ?? [])
        : await this.matchMarketSellers(buyerCompanyId, rfq.categoryId, rfq.casNumber);

    if (sellerCompanyIds.length === 0) {
      throw new BadRequestException(
        dto.distributionType === RfqDistributionType.TARGETED
          ? 'No valid sellers were selected.'
          : 'No verified sellers currently match this RFQ in RFQ Market.',
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.rfq.update({
        where: { id: rfq.id },
        data: {
          distributionType: dto.distributionType,
          status: RfqStatus.SUBMITTED,
          submittedAt: new Date(),
        },
      });

      const notifiedUserIds: string[] = [];

      for (const sellerCompanyId of sellerCompanyIds) {
        const deal = await tx.deal.create({
          data: {
            rfqId: rfq.id,
            sellerCompanyId,
            matchedViaMarket: dto.distributionType === RfqDistributionType.MARKET,
          },
        });
        const summary = this.buildRfqSummaryMessage(rfq);
        await tx.dealMessage.create({
          data: { dealId: deal.id, type: DealMessageType.SYSTEM, content: summary },
        });

        // Section 5.6 -- every active user at the seller company sees the
        // new RFQ in their notification center immediately.
        const created = await this.notifications.createForCompany(
          tx,
          sellerCompanyId,
          NotificationType.RFQ_RECEIVED,
          'มี RFQ ใหม่เข้ามา',
          summary,
          { dealId: deal.id, rfqId: rfq.id },
        );
        notifiedUserIds.push(...created.map((n: { userId: string }) => n.userId));
      }

      return { updated, notifiedUserIds };
    }).then(async ({ updated, notifiedUserIds }) => {
      // Email dispatch happens after the transaction commits -- an SMTP
      // hiccup must never roll back the RFQ submission itself.
      await this.notifications.dispatchEmails(
        notifiedUserIds,
        'มี RFQ ใหม่รอการเสนอราคา — ChemLink Platform',
        this.buildRfqSummaryMessage(rfq),
      );
      return updated;
    });
  }

  async cancel(buyerCompanyId: string, rfqId: string) {
    const rfq = await this.prisma.rfq.findUnique({ where: { id: rfqId } });
    if (!rfq) throw new NotFoundException('RFQ not found.');
    if (rfq.buyerCompanyId !== buyerCompanyId) {
      throw new ForbiddenException('This RFQ belongs to a different company.');
    }
    if (rfq.status === RfqStatus.CLOSED_WON || rfq.status === RfqStatus.CLOSED_LOST) {
      throw new BadRequestException('A closed RFQ cannot be cancelled.');
    }
    return this.prisma.rfq.update({
      where: { id: rfqId },
      data: { status: RfqStatus.CANCELLED },
    });
  }

  // --- helpers ---

  private async assertOwnedDraft(buyerCompanyId: string, rfqId: string) {
    const rfq = await this.prisma.rfq.findUnique({ where: { id: rfqId } });
    if (!rfq) throw new NotFoundException('RFQ not found.');
    if (rfq.buyerCompanyId !== buyerCompanyId) {
      throw new ForbiddenException('This RFQ belongs to a different company.');
    }
    if (rfq.status !== RfqStatus.DRAFT) {
      throw new BadRequestException('Only a draft RFQ can be edited or submitted.');
    }
    return rfq;
  }

  private async assertVerifiedBuyer(companyId: string) {
    const buyerRole = await this.prisma.companyRole.findUnique({
      where: { companyId_roleType: { companyId, roleType: 'BUYER' } },
    });
    if (!buyerRole) {
      throw new ForbiddenException('Company has not activated the BUYER role.');
    }
    if (buyerRole.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException('Company must complete BUYER verification before sending RFQs.');
    }
  }

  // Section 14.4 — a company must never end up sending an RFQ to itself,
  // even though Section 14 allows one company to hold both roles.
  private async validateTargetedSellers(
    buyerCompanyId: string,
    sellerCompanyIds: string[],
  ): Promise<string[]> {
    const uniqueIds = [...new Set(sellerCompanyIds)].filter((id) => id !== buyerCompanyId);
    if (uniqueIds.length === 0) return [];

    const verifiedSellers = await this.prisma.companyRole.findMany({
      where: {
        companyId: { in: uniqueIds },
        roleType: 'SELLER',
        verificationStatus: 'VERIFIED',
      },
      select: { companyId: true },
    });
    return verifiedSellers.map((s: { companyId: string }) => s.companyId);
  }

  // Rule-based matching for RFQ Market (Section 10 MVP scope — AI Matching
  // is deferred to Step 11). Matches verified sellers who have at least
  // one published product in the same category (and same CAS number, if
  // the buyer specified one).
  private async matchMarketSellers(
    buyerCompanyId: string,
    categoryId: string,
    casNumber: string | null,
  ): Promise<string[]> {
    const matches = await this.prisma.product.findMany({
      where: {
        isPublished: true,
        categoryId,
        ...(casNumber ? { casNumber } : {}),
        sellerCompanyId: { not: buyerCompanyId }, // Section 14.4 self-dealing guard
        sellerCompany: {
          roles: { some: { roleType: 'SELLER', verificationStatus: 'VERIFIED' } },
        },
      },
      select: { sellerCompanyId: true },
      distinct: ['sellerCompanyId'],
    });
    return matches.map((m: { sellerCompanyId: string }) => m.sellerCompanyId);
  }

  private buildRfqSummaryMessage(rfq: {
    productName: string;
    quantityValue: number;
    quantityUnit: string;
    deliveryLocation: string;
    deliveryDeadline: Date | null;
  }): string {
    const deadline = rfq.deliveryDeadline
      ? rfq.deliveryDeadline.toLocaleDateString('th-TH')
      : 'ไม่ระบุ';
    return `สร้างคำขอ RFQ · ${rfq.productName} · ต้องการ ${rfq.quantityValue} ${rfq.quantityUnit} ส่ง ${rfq.deliveryLocation} ภายใน ${deadline}`;
  }
}
