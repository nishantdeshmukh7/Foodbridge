import { NotificationType, Prisma } from '@prisma/client';
import prisma from '../models/prisma.js';

// Same injectable-transaction-client pattern as pickupService.createPickupRequest:
// accepts either the top-level client or an interactive-transaction client, so a
// caller mid-transaction can create a notification that commits or rolls back
// with everything else in that transaction, while a caller with no transaction
// of its own (e.g. this service's own read endpoints) just uses the default.
type Db = Prisma.TransactionClient | typeof prisma;

export interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  donationId?: string;
  pickupRequestId?: string;
}

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

export const notificationService = {
  // The one place that ever calls prisma.notification.create() - every
  // workflow integration in donation/pickup/user services goes through
  // this, passing their own `tx` so the notification can never exist
  // without (or survive the rollback of) the state change it describes.
  async create(input: CreateNotificationInput, db: Db = prisma) {
    return db.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        message: input.message,
        donationId: input.donationId,
        pickupRequestId: input.pickupRequestId,
      },
    });
  },

  async list(recipientId: string, options: { limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

    return prisma.notification.findMany({
      where: { recipientId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async unreadCount(recipientId: string) {
    return prisma.notification.count({ where: { recipientId, isRead: false } });
  },

  // Conditional update scoped to {id, recipientId} - the same idiom used
  // throughout this codebase (donationService.claim/cancel,
  // pickupService's transitions) to make ownership authoritative at the
  // database level rather than a separate findFirst-then-check. A
  // notification that exists but belongs to someone else updates zero
  // rows here, identically to one that doesn't exist at all - callers
  // can't distinguish "not yours" from "not found".
  async markRead(notificationId: string, recipientId: string) {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, recipientId },
      data: { isRead: true },
    });

    if (result.count === 0) {
      throw new Error('Notification not found');
    }
  },

  async markAllRead(recipientId: string) {
    await prisma.notification.updateMany({
      where: { recipientId, isRead: false },
      data: { isRead: true },
    });
  },
};
