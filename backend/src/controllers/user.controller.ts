import { Response } from 'express';
import { userService } from '../services/user.service.js';
import { AuthRequest } from '../middleware/auth.js';

export const userController = {
  async getAll(req: AuthRequest, res: Response) {
    try {
      const role = req.query.role as string | undefined;
      const isApproved = req.query.isApproved === 'true' ? true : req.query.isApproved === 'false' ? false : undefined;
      const search = req.query.search as string | undefined;

      const users = await userService.getAll({ role, isApproved, search });
      res.json(users);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get users';
      res.status(400).json({ error: message });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;

      // Only ADMIN may retrieve any user; all other roles may only read their own profile.
      if (req.user!.role !== 'ADMIN' && req.user!.id !== id) {
        res.status(403).json({ error: 'Not authorized to view this user profile' });
        return;
      }

      const user = await userService.getById(id);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get user';
      res.status(400).json({ error: message });
    }
  },

  async approveUser(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const user = await userService.approveUser(id, req.user!.id);
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve user';
      res.status(400).json({ error: message });
    }
  },

  async rejectUser(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const result = await userService.rejectUser(id, req.user!.id);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject user';
      res.status(400).json({ error: message });
    }
  },

  async suspendUser(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const user = await userService.suspendUser(id, req.user!.id);
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to suspend user';
      res.status(400).json({ error: message });
    }
  },

  async activateUser(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const user = await userService.activateUser(id, req.user!.id);
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to activate user';
      res.status(400).json({ error: message });
    }
  },

  async getStats(req: AuthRequest, res: Response) {
    try {
      const stats = await userService.getStats();
      res.json(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get stats';
      res.status(400).json({ error: message });
    }
  },

  async getPendingApprovals(req: AuthRequest, res: Response) {
    try {
      const users = await userService.getPendingApprovals();
      res.json(users);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get pending approvals';
      res.status(400).json({ error: message });
    }
  },
};

