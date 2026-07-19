import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const txMock: any = {
    notification: { create: jest.fn() },
    user: { findMany: jest.fn() },
  };

  const prismaMock: any = {
    notification: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    user: { findMany: jest.fn() },
    $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(txMock))),
  };

  const emailChannelMock: any = { send: jest.fn().mockResolvedValue(undefined) };

  const service = new NotificationsService(prismaMock as any, emailChannelMock as any);

  beforeEach(() => jest.clearAllMocks());

  describe('createForUser', () => {
    it('writes a single notification row using the given transaction client', async () => {
      txMock.notification.create.mockResolvedValueOnce({ id: 'n1', userId: 'user-1' });

      await service.createForUser(
        txMock,
        'user-1',
        NotificationType.RFQ_RECEIVED,
        'title',
        'message',
        { dealId: 'deal-1', rfqId: 'rfq-1' },
      );

      expect(txMock.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: NotificationType.RFQ_RECEIVED,
          title: 'title',
          message: 'message',
          dealId: 'deal-1',
          rfqId: 'rfq-1',
        },
      });
    });
  });

  describe('createForCompany', () => {
    it('fans out one notification per active user at the company', async () => {
      txMock.user.findMany.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]);
      txMock.notification.create.mockResolvedValue({ id: 'n', userId: 'u' });

      const result = await service.createForCompany(
        txMock,
        'company-a',
        NotificationType.RFQ_RECEIVED,
        'title',
        'message',
      );

      expect(txMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-a', isActive: true } }),
      );
      expect(txMock.notification.create).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('creates nothing when the company has no active users', async () => {
      txMock.user.findMany.mockResolvedValueOnce([]);
      const result = await service.createForCompany(
        txMock,
        'company-a',
        NotificationType.RFQ_RECEIVED,
        'title',
        'message',
      );
      expect(txMock.notification.create).not.toHaveBeenCalled();
      expect(result).toHaveLength(0);
    });
  });

  describe('dispatchEmails', () => {
    it('looks up each user email and sends through the email channel, never throwing', async () => {
      prismaMock.user.findMany.mockResolvedValueOnce([
        { email: 'a@example.com' },
        { email: 'b@example.com' },
      ]);

      await service.dispatchEmails(['u1', 'u2'], 'subject', 'body');

      expect(emailChannelMock.send).toHaveBeenCalledTimes(2);
      expect(emailChannelMock.send).toHaveBeenCalledWith('a@example.com', 'subject', 'body');
    });
  });

  describe('markRead — ownership check', () => {
    it('rejects marking a notification that belongs to a different user', async () => {
      prismaMock.notification.findUnique.mockResolvedValueOnce({
        id: 'n1',
        userId: 'user-a',
      });
      await expect(service.markRead('user-b', 'n1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for a missing notification', async () => {
      prismaMock.notification.findUnique.mockResolvedValueOnce(null);
      await expect(service.markRead('user-a', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marks the notification read when the owner matches', async () => {
      prismaMock.notification.findUnique.mockResolvedValueOnce({ id: 'n1', userId: 'user-a' });
      prismaMock.notification.update.mockResolvedValueOnce({ id: 'n1', isRead: true });
      await service.markRead('user-a', 'n1');
      expect(prismaMock.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { isRead: true },
      });
    });
  });
});
