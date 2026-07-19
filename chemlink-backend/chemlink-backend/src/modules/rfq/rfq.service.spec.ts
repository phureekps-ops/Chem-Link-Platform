import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RfqDistributionType, RfqStatus } from '@prisma/client';
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

  const service = new RfqService(prismaMock as any, notificationsMock as any);

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
});
