import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreditActionType, RfqDistributionType, RfqStatus, RoleType } from '@prisma/client';
import { RfqService } from './rfq.service';

describe('RfqService', () => {
  const prismaMock: any = {
    rfq: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    companyRole: { findUnique: jest.fn(), findMany: jest.fn() },
    product: { findMany: jest.fn() },
    deal: { create: jest.fn() },
    dealMessage: { create: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((fn: any) => fn(prismaMock));

  const notificationsMock: any = {
    createForUser: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    createForCompany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
    dispatchEmails: jest.fn().mockResolvedValue(undefined),
  };

  // Step 6 — submit() charges SEND_RFQ inside the same transaction (see
  // rfq.service.ts). Defaults to succeeding; the "insufficient credits"
  // test below overrides it to reject like CreditsService really would.
  const creditsMock: any = {
    chargeForAction: jest.fn().mockResolvedValue({ id: 'credit-txn-1' }),
  };

  const service = new RfqService(prismaMock as any, notificationsMock as any, creditsMock as any);

  beforeEach(() => jest.clearAllMocks());

  describe('create (verified-buyer check)', () => {
    it('rejects when the company has not activated the BUYER role', async () => {
      prismaMock.companyRole.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create('company-a', 'user-1', {
          categoryId: 'cat-1',
          productName: 'Test',
          quantityValue: 100,
          quantityUnit: 'kg',
          deliveryLocation: 'Bangkok',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('submit — Section 14.4 self-dealing prevention', () => {
    const draftRfq = {
      id: 'rfq-1',
      buyerCompanyId: 'company-a',
      status: RfqStatus.DRAFT,
      categoryId: 'cat-1',
      casNumber: null,
    };

    it('filters out the buyer own company from a TARGETED seller list', async () => {
      prismaMock.rfq.findUnique.mockResolvedValueOnce(draftRfq);
      // buyer tries to include itself alongside a real seller
      prismaMock.companyRole.findMany.mockResolvedValueOnce([{ companyId: 'company-b' }]);
      prismaMock.rfq.update.mockResolvedValueOnce({ ...draftRfq, status: RfqStatus.SUBMITTED });
      prismaMock.deal.create.mockResolvedValueOnce({ id: 'deal-1' });

      await service.submit('company-a', 'rfq-1', {
        distributionType: RfqDistributionType.TARGETED,
        sellerCompanyIds: ['company-a', 'company-b'],
      });

      // only the legitimate seller should have been looked up / used
      expect(prismaMock.companyRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: { in: ['company-b'] } }),
        }),
      );
      expect(prismaMock.deal.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.deal.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sellerCompanyId: 'company-b' }) }),
      );
    });

    it('throws when a company tries to send an RFQ only to itself', async () => {
      prismaMock.rfq.findUnique.mockResolvedValueOnce(draftRfq);

      await expect(
        service.submit('company-a', 'rfq-1', {
          distributionType: RfqDistributionType.TARGETED,
          sellerCompanyIds: ['company-a'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.deal.create).not.toHaveBeenCalled();
    });

    it('excludes the buyer own products when matching RFQ Market sellers', async () => {
      prismaMock.rfq.findUnique.mockResolvedValueOnce(draftRfq);
      prismaMock.product.findMany.mockResolvedValueOnce([{ sellerCompanyId: 'company-c' }]);
      prismaMock.rfq.update.mockResolvedValueOnce({ ...draftRfq, status: RfqStatus.SUBMITTED });
      prismaMock.deal.create.mockResolvedValueOnce({ id: 'deal-1' });

      await service.submit('company-a', 'rfq-1', {
        distributionType: RfqDistributionType.MARKET,
      });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sellerCompanyId: { not: 'company-a' } }),
        }),
      );
    });

    it('rejects submitting an RFQ that is not in DRAFT status', async () => {
      prismaMock.rfq.findUnique.mockResolvedValueOnce({ ...draftRfq, status: RfqStatus.SUBMITTED });
      await expect(
        service.submit('company-a', 'rfq-1', { distributionType: RfqDistributionType.MARKET }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('submit — Section 13 credit charge', () => {
    const draftRfq = {
      id: 'rfq-1',
      buyerCompanyId: 'company-a',
      status: RfqStatus.DRAFT,
      categoryId: 'cat-1',
      casNumber: null,
    };

    it('charges SEND_RFQ once, as the buyer, inside the same transaction as the Deal writes', async () => {
      prismaMock.rfq.findUnique.mockResolvedValueOnce(draftRfq);
      prismaMock.companyRole.findMany.mockResolvedValueOnce([{ companyId: 'company-b' }]);
      prismaMock.rfq.update.mockResolvedValueOnce({ ...draftRfq, status: RfqStatus.SUBMITTED });
      prismaMock.deal.create.mockResolvedValueOnce({ id: 'deal-1' });

      await service.submit('company-a', 'rfq-1', {
        distributionType: RfqDistributionType.TARGETED,
        sellerCompanyIds: ['company-b'],
      });

      expect(creditsMock.chargeForAction).toHaveBeenCalledTimes(1);
      expect(creditsMock.chargeForAction).toHaveBeenCalledWith(
        prismaMock, // the mocked $transaction hands the tx client straight through
        'company-a',
        CreditActionType.SEND_RFQ,
        RoleType.BUYER,
        { type: 'Rfq', id: 'rfq-1' },
      );
    });

    it('never creates a Deal when the buyer cannot afford to send the RFQ', async () => {
      prismaMock.rfq.findUnique.mockResolvedValueOnce(draftRfq);
      prismaMock.companyRole.findMany.mockResolvedValueOnce([{ companyId: 'company-b' }]);
      const insufficientCredits = new Error('insufficient credits');
      creditsMock.chargeForAction.mockRejectedValueOnce(insufficientCredits);

      await expect(
        service.submit('company-a', 'rfq-1', {
          distributionType: RfqDistributionType.TARGETED,
          sellerCompanyIds: ['company-b'],
        }),
      ).rejects.toThrow(insufficientCredits);

      // The charge happens before the RFQ status flips or any Deal is
      // created, so a failed charge must leave both untouched.
      expect(prismaMock.rfq.update).not.toHaveBeenCalled();
      expect(prismaMock.deal.create).not.toHaveBeenCalled();
    });
  });
});
