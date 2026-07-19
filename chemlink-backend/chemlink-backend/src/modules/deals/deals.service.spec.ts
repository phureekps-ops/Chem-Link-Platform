import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DealStatus, RfqStatus } from '@prisma/client';
import { DealsService } from './deals.service';

describe('DealsService', () => {
  const prismaMock: any = {
    deal: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
    rfq: { update: jest.fn() },
    quote: { findFirst: jest.fn(), create: jest.fn() },
    dealMessage: { create: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((fn: any) => fn(prismaMock));

  const notificationsMock: any = {
    createForUser: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    createForCompany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
    dispatchEmails: jest.fn().mockResolvedValue(undefined),
  };

  const service = new DealsService(prismaMock as any, notificationsMock as any);

  beforeEach(() => jest.clearAllMocks());

  const dealFixture = (overrides: Partial<any> = {}) => ({
    id: 'deal-1',
    sellerCompanyId: 'seller-co',
    status: DealStatus.INVITED,
    rfq: { id: 'rfq-1', buyerCompanyId: 'buyer-co', status: RfqStatus.SUBMITTED },
    ...overrides,
  });

  describe('participant authorization', () => {
    it('throws NotFoundException when the deal does not exist', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(null);
      await expect(service.acknowledge('missing', 'seller-co')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a company that is neither the buyer nor the seller on the deal', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(dealFixture());
      await expect(service.findOne('deal-1', 'some-other-co')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects the buyer trying to acknowledge (seller-only action)', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(dealFixture());
      await expect(service.acknowledge('deal-1', 'buyer-co')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects the seller trying to close the deal (buyer-only action)', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(dealFixture());
      await expect(service.close('deal-1', 'seller-co')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('close — single-winner semantics (Section 6 step 7)', () => {
    it('marks the chosen deal WON and every sibling deal LOST', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(
        dealFixture({ status: DealStatus.NEGOTIATING }),
      );
      prismaMock.deal.update.mockResolvedValueOnce({ id: 'deal-1', status: DealStatus.WON });

      await service.close('deal-1', 'buyer-co');

      expect(prismaMock.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'deal-1' },
          data: expect.objectContaining({ status: DealStatus.WON }),
        }),
      );
      expect(prismaMock.deal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ rfqId: 'rfq-1', id: { not: 'deal-1' } }),
          data: expect.objectContaining({ status: DealStatus.LOST }),
        }),
      );
      expect(prismaMock.rfq.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: RfqStatus.CLOSED_WON } }),
      );
    });

    it('rejects closing a deal that is already WON', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(dealFixture({ status: DealStatus.WON }));
      await expect(service.close('deal-1', 'buyer-co')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('addQuote — versioning and status transitions', () => {
    it('creates version 1 and sets the deal to QUOTED on first quote', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(
        dealFixture({ status: DealStatus.ACKNOWLEDGED }),
      );
      prismaMock.quote.findFirst.mockResolvedValueOnce(null);
      prismaMock.quote.create.mockResolvedValueOnce({ id: 'q1', version: 1 });

      await service.addQuote('deal-1', 'seller-co', 'user-1', {
        price: 36.8,
        priceUnit: 'บาท/กก.',
        paymentTerms: 'เครดิต 30 วัน',
        leadTimeDays: 7,
      });

      expect(prismaMock.quote.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 1 }) }),
      );
      expect(prismaMock.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: DealStatus.QUOTED } }),
      );
    });

    it('creates version 2 and sets the deal to NEGOTIATING on a revised quote', async () => {
      prismaMock.deal.findUnique.mockResolvedValueOnce(dealFixture({ status: DealStatus.QUOTED }));
      prismaMock.quote.findFirst.mockResolvedValueOnce({ version: 1 });
      prismaMock.quote.create.mockResolvedValueOnce({ id: 'q2', version: 2 });

      await service.addQuote('deal-1', 'seller-co', 'user-1', {
        price: 35.5,
        priceUnit: 'บาท/กก.',
        paymentTerms: 'เครดิต 30 วัน',
        leadTimeDays: 7,
      });

      expect(prismaMock.quote.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
      );
      expect(prismaMock.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: DealStatus.NEGOTIATING } }),
      );
    });
  });
});
