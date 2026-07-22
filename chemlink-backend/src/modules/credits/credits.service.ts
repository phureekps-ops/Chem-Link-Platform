import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  CreditActionType,
  CreditTxnType,
  CreditWallet,
  Prisma,
  PrismaClient,
  RoleType,
  SubscriptionTier,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InsufficientCreditsException } from './exceptions/insufficient-credits.exception';

// Section 13.1's tier-2 row ("มีโควตาฟรีต่อเดือน แล้วเสียเครดิตส่วนเกิน") —
// these actions draw from CreditWallet.monthlyFreeQuota before ever
// touching the paid balance. Everything else in CreditActionType is
// tier-3 ("เสียเครดิตเสมอ") and always charges the wallet directly.
const QUOTA_ELIGIBLE_ACTIONS = new Set<CreditActionType>([
  CreditActionType.SEND_RFQ,
  CreditActionType.DOWNLOAD_TECH_DOCUMENT,
  CreditActionType.AI_SOURCING_QUERY,
  CreditActionType.DEAL_ROOM_ACCESS,
]);

function startOfNextCalendarMonth(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 1);
}

// Either a live Prisma transaction client or the top-level PrismaService —
// chargeForAction is always called with the caller's own transaction
// client (Section 13.2: the debit must commit atomically with whatever
// business action it's paying for), while the read-only methods below use
// the service's own client directly. Same shape, so one set of private
// helpers serves both.
type Db = Prisma.TransactionClient | PrismaClient;

interface RelatedEntity {
  type: string;
  id: string;
}

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- the one write path: metering (Section 13.2 "Metering / Usage Gateway") ---

  // MUST be called with the same `tx` the caller's own state change runs
  // in (see RfqService.submit for the reference integration) — a charge
  // must never succeed for an action that then fails to actually happen,
  // and vice versa. Throws InsufficientCreditsException if the wallet
  // can't cover it; the caller's transaction then rolls back as a whole.
  async chargeForAction(
    tx: Prisma.TransactionClient,
    companyId: string,
    actionType: CreditActionType,
    roleContext: RoleType | null,
    related?: RelatedEntity,
  ) {
    const rate = await this.getActiveRate(tx, actionType);
    let wallet = await this.getOrCreateWallet(tx, companyId);
    wallet = await this.resetQuotaIfDue(tx, wallet);

    if (rate === 0) {
      // Free under the current rate card — still logged for Usage
      // Analytics (Section 13.2), just with nothing to debit.
      return tx.creditTransaction.create({
        data: this.ledgerRow(wallet.id, CreditTxnType.DEBIT, 0, {
          actionType,
          fromQuota: false,
          roleContext,
          related,
          balanceAfter: wallet.balance,
        }),
      });
    }

    if (QUOTA_ELIGIBLE_ACTIONS.has(actionType)) {
      const quotaRemaining = wallet.monthlyFreeQuota - wallet.monthlyFreeQuotaUsed;
      if (quotaRemaining >= rate) {
        // Conditional UPDATE, not read-then-write: two concurrent charges
        // racing for the last of the month's free quota can't both win.
        // The `lte` threshold is a JS-computed literal from the wallet row
        // read a moment ago; a same-millisecond plan change could make it
        // very slightly stale, which is an acceptable trade for the free
        // tier (unlike the paid balance debit below, which is fully
        // guarded against that same class of race).
        const claimed = await tx.creditWallet.updateMany({
          where: { id: wallet.id, monthlyFreeQuotaUsed: { lte: wallet.monthlyFreeQuota - rate } },
          data: { monthlyFreeQuotaUsed: { increment: rate } },
        });
        if (claimed.count > 0) {
          return tx.creditTransaction.create({
            data: this.ledgerRow(wallet.id, CreditTxnType.DEBIT, rate, {
              actionType,
              fromQuota: true,
              roleContext,
              related,
              balanceAfter: wallet.balance,
            }),
          });
        }
        // Lost the race for the last of the quota — fall through to a
        // wallet-balance charge instead of failing the caller's action.
      }
    }

    // Wallet-balance charge. The WHERE clause is the atomicity guarantee
    // (Section 13.2 "หักเครดิตแบบ Atomic Transaction เพื่อป้องกัน... Race
    // Condition"): under concurrent charges against a balance that can
    // only cover one of them, exactly one UPDATE matches.
    const debited = await tx.creditWallet.updateMany({
      where: { id: wallet.id, balance: { gte: rate } },
      data: { balance: { decrement: rate } },
    });
    if (debited.count === 0) {
      const current = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      throw new InsufficientCreditsException(rate - current.balance, current.balance);
    }

    const afterDebit = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    return tx.creditTransaction.create({
      data: this.ledgerRow(wallet.id, CreditTxnType.DEBIT, rate, {
        actionType,
        fromQuota: false,
        roleContext,
        related,
        balanceAfter: afterDebit.balance,
      }),
    });
  }

  // Admin/manual top-up (Section 13.2 "Admin Credit Console" — e.g.
  // granting free credits to Anchor Sellers per Section 13.5's mitigation
  // for the chicken-and-egg risk). Not yet wired to an HTTP endpoint: that
  // needs a platform-admin auth concept that doesn't exist yet (Section 8
  // Admin Panel is separately unbuilt — see README). Used by the seed
  // script today and ready for a controller once admin auth lands.
  async grantCredits(companyId: string, amount: number, note: string) {
    if (amount <= 0) {
      throw new BadRequestException('Grant amount must be a positive number of credits.');
    }
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const wallet = await this.getOrCreateWallet(tx, companyId);
      const updated = await tx.creditWallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      });
      return tx.creditTransaction.create({
        data: this.ledgerRow(wallet.id, CreditTxnType.CREDIT, amount, {
          balanceAfter: updated.balance,
          note,
        }),
      });
    });
  }

  // --- reads ---

  async getWalletSummary(companyId: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let wallet = await this.getOrCreateWallet(tx, companyId);
      wallet = await this.resetQuotaIfDue(tx, wallet);
      const withPlan = await tx.creditWallet.findUniqueOrThrow({
        where: { id: wallet.id },
        include: { plan: true },
      });
      return {
        balance: withPlan.balance,
        plan: withPlan.plan ? { tier: withPlan.plan.tier, nameTh: withPlan.plan.nameTh } : null,
        monthlyFreeQuota: withPlan.monthlyFreeQuota,
        monthlyFreeQuotaUsed: withPlan.monthlyFreeQuotaUsed,
        monthlyFreeQuotaRemaining: withPlan.monthlyFreeQuota - withPlan.monthlyFreeQuotaUsed,
        quotaResetAt: withPlan.quotaResetAt,
      };
    });
  }

  // Section 13.2 Usage Analytics Dashboard (basic slice) / Section 14.5
  // ("ควรแจกแจงการใช้เครดิตแยกตามบทบาท") — optional roleContext filter so
  // a dual-role company can see buyer-side vs seller-side usage separately.
  async listTransactions(companyId: string, page: number, limit: number, roleContext?: RoleType) {
    const wallet = await this.prisma.creditWallet.findUnique({ where: { companyId } });
    if (!wallet) {
      return { items: [], page, limit, total: 0, totalPages: 0 };
    }
    const where: Prisma.CreditTransactionWhereInput = {
      walletId: wallet.id,
      ...(roleContext ? { roleContext } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.creditTransaction.count({ where }),
    ]);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  // Section 13.1 "Price Transparency": the frontend confirm dialog ("การ
  // ดาวน์โหลดเอกสารนี้ใช้ 5 เครดิต...") reads its cost figures from here
  // rather than hard-coding them, so an admin rate change takes effect
  // without a frontend deploy.
  async listRateCard() {
    const actionTypes = Object.values(CreditActionType);
    return Promise.all(
      actionTypes.map(async (actionType) => ({
        actionType,
        creditsCost: await this.getActiveRate(this.prisma, actionType).catch(() => null),
      })),
    );
  }

  // --- internals ---

  private ledgerRow(
    walletId: string,
    type: CreditTxnType,
    amount: number,
    opts: {
      actionType?: CreditActionType;
      fromQuota?: boolean;
      roleContext?: RoleType | null;
      related?: RelatedEntity;
      balanceAfter: number;
      note?: string;
    },
  ): Prisma.CreditTransactionUncheckedCreateInput {
    return {
      walletId,
      type,
      amount,
      actionType: opts.actionType,
      fromQuota: opts.fromQuota ?? false,
      roleContext: opts.roleContext ?? undefined,
      relatedEntityType: opts.related?.type,
      relatedEntityId: opts.related?.id,
      balanceAfter: opts.balanceAfter,
      note: opts.note,
    };
  }

  private async getOrCreateWallet(db: Db, companyId: string): Promise<CreditWallet> {
    const existing = await db.creditWallet.findUnique({ where: { companyId } });
    if (existing) return existing;

    const basicPlan = await db.subscriptionPlan.findUnique({
      where: { tier: SubscriptionTier.BASIC },
    });
    if (!basicPlan) {
      throw new InternalServerErrorException(
        'No BASIC subscription plan is configured — run the seed script before metering credits.',
      );
    }

    try {
      return await db.creditWallet.create({
        data: {
          companyId,
          planId: basicPlan.id,
          monthlyFreeQuota: basicPlan.monthlyFreeCredits,
          quotaResetAt: startOfNextCalendarMonth(new Date()),
        },
      });
    } catch (err) {
      // Two concurrent first-ever charges for the same company can both
      // reach here; the loser's unique(companyId) create fails, and it
      // just reads back the winner's row instead of erroring the caller.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return db.creditWallet.findUniqueOrThrow({ where: { companyId } });
      }
      throw err;
    }
  }

  private async resetQuotaIfDue(db: Db, wallet: CreditWallet): Promise<CreditWallet> {
    if (wallet.quotaResetAt > new Date()) return wallet;
    return db.creditWallet.update({
      where: { id: wallet.id },
      data: { monthlyFreeQuotaUsed: 0, quotaResetAt: startOfNextCalendarMonth(new Date()) },
    });
  }

  private async getActiveRate(db: Db, actionType: CreditActionType): Promise<number> {
    const rate = await db.creditRateCard.findFirst({
      where: { actionType, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!rate) {
      throw new InternalServerErrorException(
        `No credit rate card entry configured for action "${actionType}" — run the seed script or add one via CreditRateCard.`,
      );
    }
    return rate.creditsCost;
  }
}
