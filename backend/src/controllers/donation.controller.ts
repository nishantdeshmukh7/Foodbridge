import { Request, Response } from 'express';
import { donationService } from '../services/donation.service.js';
import { AuthRequest } from '../middleware/auth.js';

export const donationController = {
  async create(req: AuthRequest, res: Response) {
    try {
      const { foodType, quantity, description, expiryTime, pickupLocation, imageUrl, isUrgent } = req.body;

      if (!foodType || !quantity || !expiryTime || !pickupLocation) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      const donation = await donationService.create(req.user!.id, {
        foodType,
        quantity,
        description,
        expiryTime: new Date(expiryTime),
        pickupLocation,
        imageUrl,
        isUrgent,
      });

      res.status(201).json(donation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create donation';
      res.status(400).json({ error: message });
    }
  },

  // req: AuthRequest, not Request - optionalAuth (see donation.routes.ts)
  // populates req.user when a token is present without requiring one, and
  // donationService uses it to decide whether donor.phone belongs in the
  // response (see canSeeDonorContact in donation.service.ts).
  async getAll(req: AuthRequest, res: Response) {
    try {
      const status = req.query.status as string | undefined;
      const foodType = req.query.foodType as string | undefined;
      const location = req.query.location as string | undefined;
      const donations = await donationService.getAll({ status, foodType, location }, req.user);
      res.json(donations);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get donations';
      res.status(400).json({ error: message });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const donation = await donationService.getById(id, req.user);

      if (!donation) {
        res.status(404).json({ error: 'Donation not found' });
        return;
      }

      res.json(donation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get donation';
      res.status(400).json({ error: message });
    }
  },

  async getMyDonations(req: AuthRequest, res: Response) {
    try {
      const donations = await donationService.getByDonor(req.user!.id);
      res.json(donations);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get donations';
      res.status(400).json({ error: message });
    }
  },

  // Phase 12.5: NGO-only, self-scoped - req.user!.id is the only "which
  // NGO" input, never a client-supplied id or query param.
  async getMyClaims(req: AuthRequest, res: Response) {
    try {
      const status = req.query.status as string | undefined;
      const donations = await donationService.getByClaimant(req.user!.id, { status });
      res.json(donations);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get claims';
      res.status(400).json({ error: message });
    }
  },

  async claim(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;

      if (req.user!.role !== 'NGO') {
        res.status(403).json({ error: 'Only NGOs can claim donations' });
        return;
      }

      const donation = await donationService.claim(id, req.user!.id);
      res.json(donation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to claim donation';
      res.status(400).json({ error: message });
    }
  },

  // Explicit semantic endpoint (Phase 12) rather than a generic
  // status-mutation route - the only two things a client sends are which
  // donation and its own credentials; donationService.cancel() alone
  // decides whether that's legal from the current state.
  async cancel(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const donation = await donationService.cancel(id, {
        id: req.user!.id,
        role: req.user!.role,
        email: req.user!.email,
      });
      res.json(donation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel donation';
      res.status(400).json({ error: message });
    }
  },

  // NGO-facing counterpart to cancel() (Phase 12): releases a claim back
  // onto the market. req.user!.id is the only "which NGO" input - never a
  // client-supplied claimedById.
  async releaseClaim(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const donation = await donationService.releaseClaim(id, req.user!.id);
      res.json(donation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to release claim';
      res.status(400).json({ error: message });
    }
  },

  async getStats(req: Request, res: Response) {
    try {
      const stats = await donationService.getStats();
      res.json(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get stats';
      res.status(400).json({ error: message });
    }
  },
};

