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

  async getAll(req: Request, res: Response) {
    try {
      const status = req.query.status as string | undefined;
      const foodType = req.query.foodType as string | undefined;
      const location = req.query.location as string | undefined;
      const donations = await donationService.getAll({ status, foodType, location });
      res.json(donations);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get donations';
      res.status(400).json({ error: message });
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const donation = await donationService.getById(id);
      
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

  async updateStatus(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const status = req.body.status as string;

      const donation = await donationService.updateStatus(
        id,
        status,
        req.user!.id,
        req.user!.role,
      );
      res.json(donation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update donation';
      // Return 403 when the service throws an authorization error.
      const statusCode = message === 'Not authorized to update this donation' ? 403 : 400;
      res.status(statusCode).json({ error: message });
    }
  },

  async delete(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const result = await donationService.delete(id, req.user!.id);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete donation';
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

