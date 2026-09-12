import { Response } from 'express';
import { notificationService } from '../services/notification.service.js';
import { AuthRequest } from '../middleware/auth.js';

export const notificationController = {
  // recipientId always comes from the authenticated caller's own JWT
  // (req.user!.id) - never from a route param or the request body - so
  // there is no client-controlled way to request another user's inbox.
  async list(req: AuthRequest, res: Response) {
    try {
      const limitParam = req.query.limit;
      const limit =
        typeof limitParam === 'string' && limitParam.trim() !== '' ? parseInt(limitParam, 10) : undefined;

      const notifications = await notificationService.list(req.user!.id, {
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json(notifications);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get notifications';
      res.status(400).json({ error: message });
    }
  },

  async unreadCount(req: AuthRequest, res: Response) {
    try {
      const count = await notificationService.unreadCount(req.user!.id);
      res.json({ count });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get unread count';
      res.status(400).json({ error: message });
    }
  },

  async markRead(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      await notificationService.markRead(id, req.user!.id);
      res.json({ message: 'Notification marked as read' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark notification as read';
      res.status(400).json({ error: message });
    }
  },

  async markAllRead(req: AuthRequest, res: Response) {
    try {
      await notificationService.markAllRead(req.user!.id);
      res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark all as read';
      res.status(400).json({ error: message });
    }
  },
};
