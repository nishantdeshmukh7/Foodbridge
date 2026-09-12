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

  // Always the same response and status, regardless of whether the
  // account exists or what state it's in - see authService.
  // requestPasswordReset, which returns void specifically so nothing here
  // can accidentally branch on its outcome. A genuinely unexpected error
  // is logged server-side (message only, never the raw token - it never
  // reaches this far up the call stack in the first place) but still
  // resolves to the same public response.
  async forgotPassword(req: Request, res: Response) {
    const GENERIC_RESPONSE = {
      message: 'If an account exists for that email, a password reset link has been sent.',
    };

    try {
      const { email } = req.body;
      await authService.requestPasswordReset(email);
    } catch (error) {
      console.error(
        '[auth] forgot-password request failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
    }

    res.json(GENERIC_RESPONSE);
  },

  async resetPassword(req: Request, res: Response) {
    try {
      const { token, password } = req.body;
      await authService.resetPassword(token, password);
      res.json({ message: 'Your password has been reset. You can now sign in with your new password.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset password';
      res.status(400).json({ error: message });
    }
  },
};

