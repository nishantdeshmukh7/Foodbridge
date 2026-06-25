import { Request, Response } from 'express';
import { pickupService } from '../services/pickup.service.js';
import { AuthRequest } from '../middleware/auth.js';

export const pickupController = {
  async createPickupRequest(req: AuthRequest, res: Response) {
    try {
      const donationId = req.body.donationId as string;
      
      if (!donationId) {
        res.status(400).json({ error: 'Donation ID required' });
        return;
      }

      const pickup = await pickupService.createPickupRequest(donationId);
      res.status(201).json(pickup);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create pickup request';
      res.status(400).json({ error: message });
    }
  },

  async assignVolunteer(req: AuthRequest, res: Response) {
    try {
      const pickupRequestId = req.params.pickupRequestId as string;
      const volunteerId = req.body.volunteerId as string;
      
      if (!volunteerId) {
        res.status(400).json({ error: 'Volunteer ID required' });
        return;
      }

      const pickup = await pickupService.assignVolunteer(pickupRequestId, volunteerId);
      res.json(pickup);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to assign volunteer';
      res.status(400).json({ error: message });
    }
  },

  async acceptPickup(req: AuthRequest, res: Response) {
    try {
      const pickupRequestId = req.params.pickupRequestId as string;
      
      if (req.user!.role !== 'VOLUNTEER') {
        res.status(403).json({ error: 'Only volunteers can accept pickups' });
        return;
      }

      const pickup = await pickupService.acceptPickup(pickupRequestId, req.user!.id);
      res.json(pickup);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to accept pickup';
      res.status(400).json({ error: message });
    }
  },

  async markPickedUp(req: AuthRequest, res: Response) {
    try {
      const pickupRequestId = req.params.pickupRequestId as string;
      
      if (req.user!.role !== 'VOLUNTEER') {
        res.status(403).json({ error: 'Only volunteers can mark pickups' });
        return;
      }

      const pickup = await pickupService.markPickedUp(pickupRequestId, req.user!.id);
      res.json(pickup);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark as picked up';
      res.status(400).json({ error: message });
    }
  },

  async completeDelivery(req: AuthRequest, res: Response) {
    try {
      const pickupRequestId = req.params.pickupRequestId as string;
      const photoUrl = req.body.photoUrl as string | undefined;
      
      if (req.user!.role !== 'VOLUNTEER') {
        res.status(403).json({ error: 'Only volunteers can complete deliveries' });
        return;
      }

      const pickup = await pickupService.completeDelivery(pickupRequestId, req.user!.id, photoUrl);
      res.json(pickup);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to complete delivery';
      res.status(400).json({ error: message });
    }
  },

  async getAvailablePickups(req: AuthRequest, res: Response) {
    try {
      const pickups = await pickupService.getAvailablePickups();
      res.json(pickups);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get pickups';
      res.status(400).json({ error: message });
    }
  },

  async getMyPickups(req: AuthRequest, res: Response) {
    try {
      const pickups = await pickupService.getVolunteerPickups(req.user!.id);
      res.json(pickups);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get pickups';
      res.status(400).json({ error: message });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      const pickupRequestId = req.params.pickupRequestId as string;
      const pickup = await pickupService.getById(pickupRequestId);
      
      if (!pickup) {
        res.status(404).json({ error: 'Pickup request not found' });
        return;
      }
      
      res.json(pickup);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get pickup';
      res.status(400).json({ error: message });
    }
  },
};

