import { BadRequestException } from '@nestjs/common';
import { CreditActionType, CreditTxnType, Prisma, RoleType, SubscriptionTier } from '@prisma/client';
import { CreditsService } from './credits.service';
import { InsufficientCreditsException } from './exceptions/insufficient-credits.exception';

describe('CreditsService', () => {
  const txMock: any = {
    creditWallet: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    subscriptionPlan: { findUnique: jest.fn() },
    creditRateCard: { findFirst: jest.fn() },
    creditTransaction: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  };

  const prismaMock: any = {
    ...txMock,
    $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(txMock))),
  };

  const service = new CreditsService(prismaMock as any);

  beforeEach(() => jest.clearAllMocks());

  const basicPlan = {
    id: 'plan-basic',
    tier: SubscriptionTier.BASIC,
    nameTh: 'Basic',
    monthlyFreeCredits: 50,
  };

  const walletFixture = (overrides: Partial<any> = {}) => ({
    id: 'wallet-1',
    companyId: 'company-1',
    planId: 'plan-basic',
    balance: 20,
    monthlyFreeQuota: 50,
    monthlyFreeQuotaUsed: 0,
    quotaResetAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10), // 10 days out — not due
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('chargeForAction — wallet auto-creation', () => {
    it('creates a wallet on the BASIC plan the first time a company is charged', async () => {
      txMock.creditWallet.findUnique.mockResolvedValueOnce(null); // getOrCreateWallet: no existing wallet
      txMock.subscriptionPlan.findUnique.mockResolvedValueOnce(basicPlan);
      const created = walletFixture({ balance: 0, monthlyFreeQuotaUsed: 0 });
      txMock.creditWallet.create.mockResolvedValueOnce(created);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 3 });
      txMock.creditWallet.updateMany.mockResolvedValueOnce({ count: 1 }); // quota claim succeeds
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-1' });

      await service.chargeForAction(txMock, 'company-1', CreditActionType.SEND_RFQ, RoleType.BUYER, {
        type: 'Rfq',
        id: 'rfq-1',
      });

      expect(txMock.creditWallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-1', planId: 'plan-basic' }),
        }),
      );
    });

    it('throws when no BASIC plan is configured (seed not run)', async () => {
      txMock.creditWallet.findUnique.mockResolvedValueOnce(null);
      txMock.subscriptionPlan.findUnique.mockResolvedValueOnce(null);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 3 });

      await expect(
        service.chargeForAction(txMock, 'company-1', CreditActionType.SEND_RFQ, RoleType.BUYER),
      ).rejects.toThrow('No BASIC subscription plan is configured');
    });

    it('reads back the winning row when two concurrent first-charges race on wallet creation', async () => {
      txMock.creditWallet.findUnique.mockResolvedValueOnce(null);
      txMock.subscriptionPlan.findUnique.mockResolvedValueOnce(basicPlan);
      const raceError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      });
      txMock.creditWallet.create.mockRejectedValueOnce(raceError);
      const existing = walletFixture();
      txMock.creditWallet.findUniqueOrThrow.mockResolvedValueOnce(existing);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 3 });
      txMock.creditWallet.updateMany.mockResolvedValueOnce({ count: 1 });
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-1' });

      await service.chargeForAction(txMock, 'company-1', CreditActionType.SEND_RFQ, RoleType.BUYER);

      expect(txMock.creditWallet.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
      });
    });
  });

  describe('chargeForAction — quota vs wallet split (Section 13.1/13.4)', () => {
    it('draws from the free monthly quota when enough remains, and never touches balance', async () => {
      const wallet = walletFixture({ balance: 20, monthlyFreeQuota: 50, monthlyFreeQuotaUsed: 10 });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 3 });
      txMock.creditWallet.updateMany.mockResolvedValueOnce({ count: 1 });
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-1' });

      await service.chargeForAction(txMock, 'company-1', CreditActionType.SEND_RFQ, RoleType.BUYER);

      expect(txMock.creditWallet.updateMany).toHaveBeenCalledWith({
        where: { id: 'wallet-1', monthlyFreeQuotaUsed: { lte: 50 - 3 } },
        data: { monthlyFreeQuotaUsed: { increment: 3 } },
      });
      expect(txMock.creditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ fromQuota: true, amount: 3, balanceAfter: 20 }),
      });
    });

    it('falls through to a wallet-balance debit once the free quota is exhausted', async () => {
      const wallet = walletFixture({ balance: 20, monthlyFreeQuota: 50, monthlyFreeQuotaUsed: 49 });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 3 }); // only 1 credit of quota left
      txMock.creditWallet.updateMany.mockResolvedValueOnce({ count: 1 }); // balance debit succeeds
      txMock.creditWallet.findUniqueOrThrow.mockResolvedValueOnce(walletFixture({ balance: 17 }));
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-1' });

      await service.chargeForAction(txMock, 'company-1', CreditActionType.SEND_RFQ, RoleType.BUYER);

      expect(txMock.creditWallet.updateMany).toHaveBeenCalledWith({
        where: { id: 'wallet-1', balance: { gte: 3 } },
        data: { balance: { decrement: 3 } },
      });
      expect(txMock.creditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ fromQuota: false, amount: 3, balanceAfter: 17 }),
      });
    });

    it('always debits the wallet for a tier-3 (no-quota) action even with quota available', async () => {
      const wallet = walletFixture({ balance: 20, monthlyFreeQuota: 50, monthlyFreeQuotaUsed: 0 });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 15 });
      txMock.creditWallet.updateMany.mockResolvedValueOnce({ count: 1 });
      txMock.creditWallet.findUniqueOrThrow.mockResolvedValueOnce(walletFixture({ balance: 5 }));
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-1' });

      await service.chargeForAction(txMock, 'company-1', CreditActionType.UNLOCK_CONTACT, RoleType.BUYER);

      expect(txMock.creditWallet.updateMany).toHaveBeenCalledWith({
        where: { id: 'wallet-1', balance: { gte: 15 } },
        data: { balance: { decrement: 15 } },
      });
    });

    it('throws InsufficientCreditsException when the wallet balance cannot cover the charge', async () => {
      const wallet = walletFixture({ balance: 2, monthlyFreeQuota: 50, monthlyFreeQuotaUsed: 50 });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 15 });
      txMock.creditWallet.updateMany.mockResolvedValueOnce({ count: 0 }); // WHERE balance >= 15 matched nothing
      txMock.creditWallet.findUniqueOrThrow.mockResolvedValueOnce(walletFixture({ balance: 2 }));

      await expect(
        service.chargeForAction(txMock, 'company-1', CreditActionType.UNLOCK_CONTACT, RoleType.BUYER),
      ).rejects.toBeInstanceOf(InsufficientCreditsException);
      expect(txMock.creditTransaction.create).not.toHaveBeenCalled();
    });

    it('logs a zero-amount ledger row for a free (0-credit) rate without touching the wallet', async () => {
      const wallet = walletFixture({ balance: 20 });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 0 });
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-1' });

      await service.chargeForAction(txMock, 'company-1', CreditActionType.SEND_RFQ, RoleType.BUYER);

      expect(txMock.creditWallet.updateMany).not.toHaveBeenCalled();
      expect(txMock.creditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 0, balanceAfter: 20 }),
      });
    });

    it('resets the monthly quota counter when quotaResetAt has passed', async () => {
      const wallet = walletFixture({
        monthlyFreeQuotaUsed: 50,
        monthlyFreeQuota: 50,
        quotaResetAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // yesterday — due for reset
      });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet);
      const resetWallet = walletFixture({ monthlyFreeQuotaUsed: 0, monthlyFreeQuota: 50 });
      txMock.creditWallet.update.mockResolvedValueOnce(resetWallet);
      txMock.creditRateCard.findFirst.mockResolvedValueOnce({ creditsCost: 3 });
      txMock.creditWallet.updateMany.mockResolvedValueOnce({ count: 1 });
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-1' });

      await service.chargeForAction(txMock, 'company-1', CreditActionType.SEND_RFQ, RoleType.BUYER);

      expect(txMock.creditWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wallet-1' },
          data: expect.objectContaining({ monthlyFreeQuotaUsed: 0 }),
        }),
      );
      // Charged from the freshly-reset quota (50 available), not the wallet balance.
      expect(txMock.creditWallet.updateMany).toHaveBeenCalledWith({
        where: { id: 'wallet-1', monthlyFreeQuotaUsed: { lte: 50 - 3 } },
        data: { monthlyFreeQuotaUsed: { increment: 3 } },
      });
    });
  });

  describe('grantCredits (admin/manual top-up)', () => {
    it('rejects a non-positive grant amount', async () => {
      await expect(service.grantCredits('company-1', 0, 'note')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.grantCredits('company-1', -5, 'note')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('increments the wallet balance and records a CREDIT ledger row', async () => {
      const wallet = walletFixture({ balance: 20 });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet);
      txMock.creditWallet.update.mockResolvedValueOnce(walletFixture({ balance: 120 }));
      txMock.creditTransaction.create.mockResolvedValueOnce({ id: 'txn-grant' });

      await service.grantCredits('company-1', 100, 'seed: pilot sign-up bonus');

      expect(txMock.creditWallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: { balance: { increment: 100 } },
      });
      expect(txMock.creditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: CreditTxnType.CREDIT,
          amount: 100,
          balanceAfter: 120,
          note: 'seed: pilot sign-up bonus',
        }),
      });
    });
  });

  describe('getWalletSummary', () => {
    it('returns balance, plan, and quota fields for the caller company', async () => {
      const wallet = walletFixture({ balance: 42, monthlyFreeQuota: 50, monthlyFreeQuotaUsed: 12 });
      txMock.creditWallet.findUnique.mockResolvedValueOnce(wallet); // getOrCreateWallet
      txMock.creditWallet.findUniqueOrThrow.mockResolvedValueOnce({
        ...wallet,
        plan: { tier: SubscriptionTier.BASIC, nameTh: 'Basic' },
      });

      const summary = await service.getWalletSummary('company-1');

      expect(summary).toEqual(
        expect.objectContaining({
          balance: 42,
          plan: { tier: SubscriptionTier.BASIC, nameTh: 'Basic' },
          monthlyFreeQuota: 50,
          monthlyFreeQuotaUsed: 12,
          monthlyFreeQuotaRemaining: 38,
        }),
      );
    });
  });

  describe('listTransactions', () => {
    it('returns an empty page when the company has no wallet yet', async () => {
      prismaMock.creditWallet.findUnique.mockResolvedValueOnce(null);
      const result = await service.listTransactions('company-1', 1, 20);
      expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    });

    it('filters by roleContext when provided (Section 14.5 role breakdown)', async () => {
      prismaMock.creditWallet.findUnique.mockResolvedValueOnce(walletFixture());
      prismaMock.creditTransaction.findMany.mockResolvedValueOnce([{ id: 'txn-1' }]);
      prismaMock.creditTransaction.count.mockResolvedValueOnce(1);

      const result = await service.listTransactions('company-1', 1, 20, RoleType.SELLER);

      expect(prismaMock.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletId: 'wallet-1', roleContext: RoleType.SELLER },
        }),
      );
      expect(result.total).toBe(1);
    });
  });
});
