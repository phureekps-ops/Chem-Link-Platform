import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DealMessageType, DealStatus, NotificationType, Prisma, RfqStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { PostMessageDto } from './dto/post-message.dto';
import { NotificationsService } from '../notifications/notifications.service';

const DEAL_DETAIL_INCLUDE = {
  rfq: true,
  sellerCompany: { select: { id: true, legalName: true, province: true } },
  quotes: { orderBy: { version: 'desc' as const } },
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      senderUser: { select: { id: true, fullName: true, companyId: true } },
      relatedQuote: true,
    },
  },
};

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // A seller's inbox of RFQs sent to them (targeted or matched via Market).
  async findIncomingForSeller(sellerCompanyId: string) {
    return this.prisma.deal.findMany({
      where: { sellerCompanyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        rfq: {
          select: {
            id: true,
            productName: true,
            quantityValue: true,
            quantityUnit: true,
            deliveryLocation: true,
            deliveryDeadline: true,
          },
        },
      },
    });
  }

  async findOne(dealId: string, requestingCompanyId: string) {
    const { deal } = await this.loadAndAuthorize(dealId, requestingCompanyId);
    return this.prisma.deal.findUnique({
      where: { id: deal.id },
      include: DEAL_DETAIL_INCLUDE,
    });
  }

  // Section 6 step 3 — ผู้ขายรับทราบ
  async acknowledge(dealId: string, sellerCompanyId: string) {
    const { deal, rfq } = await this.loadAndAuthorize(dealId, sellerCompanyId, 'SELLER');

    if (deal.status !== DealStatus.INVITED) {
      throw new BadRequestException('Only a newly-invited deal can be acknowledged.');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedDeal = await tx.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
      });
      if (rfq.status === RfqStatus.SUBMITTED) {
        await tx.rfq.update({ where: { id: rfq.id }, data: { status: RfqStatus.ACKNOWLEDGED } });
      }
      await this.notifications.createForUser(
        tx,
        rfq.createdByUserId,
        NotificationType.DEAL_ACKNOWLEDGED,
        'ผู้ขายรับทราบคำขอ RFQ แล้ว',
        `RFQ ${rfq.productName} ได้รับการรับทราบจากผู้ขายแล้ว`,
        { dealId: deal.id, rfqId: rfq.id },
      );
      return updatedDeal;
    }).then(async (updatedDeal) => {
      await this.notifications.dispatchEmails(
        [rfq.createdByUserId],
        'ผู้ขายรับทราบ RFQ ของคุณแล้ว — ChemLink Platform',
        `RFQ ${rfq.productName} ได้รับการรับทราบจากผู้ขายแล้ว`,
      );
      return updatedDeal;
    });
  }

  // Section 6 step 4 (first quote) and step 5 (revised quote during
  // negotiation) — a new Quote row is always created, never edited in
  // place, so the full price history stays intact (Section 5.5).
  async addQuote(dealId: string, sellerCompanyId: string, userId: string, dto: CreateQuoteDto) {
    const { deal, rfq } = await this.loadAndAuthorize(dealId, sellerCompanyId, 'SELLER');

    if (deal.status === DealStatus.WON || deal.status === DealStatus.LOST || deal.status === DealStatus.DECLINED) {
      throw new BadRequestException('This deal is already closed.');
    }

    const lastQuote = await this.prisma.quote.findFirst({
      where: { dealId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (lastQuote?.version ?? 0) + 1;
    const isRevision = nextVersion > 1;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const quote = await tx.quote.create({
        data: {
          dealId,
          version: nextVersion,
          price: dto.price,
          priceUnit: dto.priceUnit,
          paymentTerms: dto.paymentTerms,
          leadTimeDays: dto.leadTimeDays,
          moqValue: dto.moqValue,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          createdByUserId: userId,
        },
      });

      await tx.dealMessage.create({
        data: {
          dealId,
          type: DealMessageType.QUOTE,
          senderUserId: userId,
          relatedQuoteId: quote.id,
        },
      });

      const nextDealStatus = isRevision ? DealStatus.NEGOTIATING : DealStatus.QUOTED;
      await tx.deal.update({ where: { id: dealId }, data: { status: nextDealStatus } });

      if (rfq.status === RfqStatus.SUBMITTED || rfq.status === RfqStatus.ACKNOWLEDGED) {
        await tx.rfq.update({ where: { id: rfq.id }, data: { status: RfqStatus.QUOTED } });
      } else if (rfq.status === RfqStatus.QUOTED && isRevision) {
        await tx.rfq.update({ where: { id: rfq.id }, data: { status: RfqStatus.NEGOTIATING } });
      }

      await this.notifications.createForUser(
        tx,
        rfq.createdByUserId,
        NotificationType.QUOTE_RECEIVED,
        isRevision ? 'ได้รับใบเสนอราคาฉบับปรับปรุง' : 'ได้รับใบเสนอราคาใหม่',
        `${rfq.productName} · ${dto.price} ${dto.priceUnit} · ${dto.paymentTerms}`,
        { dealId, rfqId: rfq.id },
      );

      return quote;
    }).then(async (quote) => {
      await this.notifications.dispatchEmails(
        [rfq.createdByUserId],
        'ได้รับใบเสนอราคาใหม่ — ChemLink Platform',
        `${rfq.productName} · ${dto.price} ${dto.priceUnit} · ${dto.paymentTerms}`,
      );
      return quote;
    });
  }

  // Section 5.5 thread — either party can post a text message. A message
  // after a quote has gone out signals the deal has entered negotiation.
  async addMessage(
    dealId: string,
    requestingCompanyId: string,
    userId: string,
    dto: PostMessageDto,
  ) {
    const { deal, rfq } = await this.loadAndAuthorize(dealId, requestingCompanyId);

    if (deal.status === DealStatus.WON || deal.status === DealStatus.LOST || deal.status === DealStatus.DECLINED) {
      throw new BadRequestException('This deal is already closed.');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const message = await tx.dealMessage.create({
        data: {
          dealId,
          type: DealMessageType.TEXT,
          senderUserId: userId,
          content: dto.content,
          attachmentUrl: dto.attachmentUrl,
        },
      });

      if (deal.status === DealStatus.QUOTED || deal.status === DealStatus.ACKNOWLEDGED) {
        await tx.deal.update({ where: { id: dealId }, data: { status: DealStatus.NEGOTIATING } });
      }
      if (rfq.status === RfqStatus.QUOTED || rfq.status === RfqStatus.ACKNOWLEDGED) {
        await tx.rfq.update({ where: { id: rfq.id }, data: { status: RfqStatus.NEGOTIATING } });
      }

      // Notify whichever side did NOT send this message.
      const senderIsSeller = requestingCompanyId === deal.sellerCompanyId;
      const preview = dto.content.length > 140 ? `${dto.content.slice(0, 140)}...` : dto.content;
      let notifiedUserIds: string[] = [];

      if (senderIsSeller) {
        await this.notifications.createForUser(
          tx,
          rfq.createdByUserId,
          NotificationType.MESSAGE_RECEIVED,
          'มีข้อความใหม่ใน Deal Room',
          preview,
          { dealId, rfqId: rfq.id },
        );
        notifiedUserIds = [rfq.createdByUserId];
      } else {
        const created = await this.notifications.createForCompany(
          tx,
          deal.sellerCompanyId,
          NotificationType.MESSAGE_RECEIVED,
          'มีข้อความใหม่ใน Deal Room',
          preview,
          { dealId, rfqId: rfq.id },
        );
        notifiedUserIds = created.map((n: { userId: string }) => n.userId);
      }

      return { message, notifiedUserIds, preview };
    }).then(async ({ message, notifiedUserIds, preview }) => {
      await this.notifications.dispatchEmails(
        notifiedUserIds,
        'มีข้อความใหม่ใน Deal Room — ChemLink Platform',
        preview,
      );
      return message;
    });
  }

  // Section 6 step 7 — ปิดดีล. Only the buyer decides; the chosen Deal is
  // marked WON and every sibling Deal under the same RFQ is marked LOST,
  // since one RFQ closes with a single winning seller in this model.
  async close(dealId: string, buyerCompanyId: string) {
    const { deal, rfq } = await this.loadAndAuthorize(dealId, buyerCompanyId, 'BUYER');

    if (deal.status === DealStatus.WON || deal.status === DealStatus.LOST) {
      throw new BadRequestException('This deal is already closed.');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const siblingDeals = await tx.deal.findMany({
        where: { rfqId: rfq.id, id: { not: dealId }, status: { notIn: [DealStatus.DECLINED] } },
        select: { id: true, sellerCompanyId: true },
      });

      const won = await tx.deal.update({
        where: { id: dealId },
        data: { status: DealStatus.WON, closedAt: new Date() },
      });

      await tx.deal.updateMany({
        where: { rfqId: rfq.id, id: { not: dealId }, status: { notIn: [DealStatus.DECLINED] } },
        data: { status: DealStatus.LOST, closedAt: new Date() },
      });

      await tx.dealMessage.create({
        data: { dealId, type: DealMessageType.SYSTEM, content: 'ปิดดีลสำเร็จ' },
      });

      await tx.rfq.update({ where: { id: rfq.id }, data: { status: RfqStatus.CLOSED_WON } });

      const wonNotified = await this.notifications.createForCompany(
        tx,
        deal.sellerCompanyId,
        NotificationType.DEAL_CLOSED_WON,
        'ยินดีด้วย คุณได้รับดีลนี้',
        `RFQ ${rfq.productName} ปิดดีลกับคุณเรียบร้อยแล้ว`,
        { dealId, rfqId: rfq.id },
      );

      let lostNotified: string[] = [];
      for (const sibling of siblingDeals) {
        const created = await this.notifications.createForCompany(
          tx,
          sibling.sellerCompanyId,
          NotificationType.DEAL_CLOSED_LOST,
          'RFQ นี้ปิดดีลกับผู้ขายรายอื่นแล้ว',
          `RFQ ${rfq.productName} ได้เลือกผู้ขายรายอื่นแล้ว ขอบคุณที่เข้าร่วมเสนอราคา`,
          { dealId: sibling.id, rfqId: rfq.id },
        );
        lostNotified.push(...created.map((n: { userId: string }) => n.userId));
      }

      return {
        won,
        wonUserIds: wonNotified.map((n: { userId: string }) => n.userId),
        lostUserIds: lostNotified,
      };
    }).then(async ({ won, wonUserIds, lostUserIds }) => {
      await Promise.all([
        this.notifications.dispatchEmails(
          wonUserIds,
          'ยินดีด้วย คุณได้รับดีลนี้ — ChemLink Platform',
          `RFQ ${rfq.productName} ปิดดีลกับคุณเรียบร้อยแล้ว`,
        ),
        this.notifications.dispatchEmails(
          lostUserIds,
          'สถานะ RFQ อัปเดต — ChemLink Platform',
          `RFQ ${rfq.productName} ได้เลือกผู้ขายรายอื่นแล้ว`,
        ),
      ]);
      return won;
    });
  }

  // A seller may opt out of an RFQ instead of quoting.
  async decline(dealId: string, sellerCompanyId: string) {
    const { deal } = await this.loadAndAuthorize(dealId, sellerCompanyId, 'SELLER');
    if (deal.status === DealStatus.WON || deal.status === DealStatus.LOST) {
      throw new BadRequestException('This deal is already closed.');
    }
    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.DECLINED },
    });
  }

  // --- helpers ---

  private async loadAndAuthorize(
    dealId: string,
    requestingCompanyId: string,
    requiredSide?: 'BUYER' | 'SELLER',
  ) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { rfq: true },
    });
    if (!deal) throw new NotFoundException('Deal not found.');

    const isSeller = deal.sellerCompanyId === requestingCompanyId;
    const isBuyer = deal.rfq.buyerCompanyId === requestingCompanyId;

    if (!isSeller && !isBuyer) {
      throw new ForbiddenException('You are not a participant in this deal.');
    }
    if (requiredSide === 'SELLER' && !isSeller) {
      throw new ForbiddenException('Only the seller on this deal can do that.');
    }
    if (requiredSide === 'BUYER' && !isBuyer) {
      throw new ForbiddenException('Only the buyer on this deal can do that.');
    }

    return { deal, rfq: deal.rfq };
  }
}
