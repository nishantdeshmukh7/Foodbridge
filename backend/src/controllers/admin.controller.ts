import { Request, Response } from 'express';
import { adminService } from '../services/admin.service.js';

export const adminController = {
  async getAnalytics(req: Request, res: Response) {
    try {
      const analytics = await adminService.getAnalytics();
      res.json(analytics);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get analytics';
      res.status(400).json({ error: message });
    }
  },

  async getActivity(req: Request, res: Response) {
    try {
      const activity = await adminService.getRecentActivity();
      res.json(activity);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get activity';
      res.status(400).json({ error: message });
    }
  },
};
