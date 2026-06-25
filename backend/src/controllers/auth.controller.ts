import { Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { AuthRequest } from '../middleware/auth.js';

export const authController = {
  async register(req: Request, res: Response) {
    try {
      const { email, password, name, phone, location, organization, role } = req.body;

      if (!email || !password || !name || !role) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      const result = await authService.register({
        email,
        password,
        name,
        phone,
        location,
        organization,
        role,
      });

      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      res.status(400).json({ error: message });
    }
  },

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
      }

      const result = await authService.login({ email, password });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      res.status(401).json({ error: message });
    }
  },

  async getProfile(req: AuthRequest, res: Response) {
    try {
      const user = await authService.getProfile(req.user!.id);
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get profile';
      res.status(400).json({ error: message });
    }
  },

  async updateProfile(req: AuthRequest, res: Response) {
    try {
      const { name, phone, location, organization } = req.body;
      const user = await authService.updateProfile(req.user!.id, {
        name,
        phone,
        location,
        organization,
      });
      res.json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update profile';
      res.status(400).json({ error: message });
    }
  },
};

