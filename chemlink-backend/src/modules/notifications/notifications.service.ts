import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailChannel } from './channels/email.channel';

interface NotificationContext {
  dealId?: string;
  rfqId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailChannel: EmailChannel,
  ) {}

  // Writes one Notification row per user and returns them, so the caller
  // can fire emails afterward. ALWAYS called with a transaction client so
  // the notification is committed atomically with the RFQ/Deal state
  // change it describes -- an RFQ_RECEIVED notification should never exist
  // for a Deal that failed to actually get created.
  async createForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    ctx: NotificationContext = {},
  ) {
    return tx.notification.create({
      data: { userId, type, title, message, dealId: ctx.dealId, rfqId: ctx.rfqId },
    });
  }

  // Fans out to every active user at a company. Used for seller-side
  // events (Section 5.6) where any team member with SELLER access should
  // see a new RFQ, since Step 4 has no "assigned sales rep" concept yet.
  async createForCompany(
    tx: Prisma.TransactionClient,
    companyId: string,
    type: NotificationType,
    title: string,
    message: string,
    ctx: NotificationContext = {},
  ) {
    const users = await tx.user.findMany({
      where: { companyId, isActive: true },
      select: { id: true },
    });
    return Promise.all(
      users.map((u: { id: string }) => this.createForUser(tx, u.id, type, title, message, ctx)),
    );
  }

  // Fire-and-forget email dispatch, meant to be called AFTER the
  // transaction that created the Notification rows has committed. Errors
  // are swallowed inside EmailChannel -- this never throws.
  async dispatchEmails(userIds: string[], subject: string, body: string) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { email: true },
    });
    await Promise.all(
      users.map((u: { email: string }) => this.emailChannel.send(u.email, subject, body)),
    );
  }

  // --- inbox reads (Section 5.6/5.7 notification center) ---

  async findMine(userId: string, unreadOnly: boolean, page: number, limit: number) {
    const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundException('Notification not found.');
    if (notification.userId !== userId) {
      throw new ForbiddenException('This notification belongs to a different user.');
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }
}
