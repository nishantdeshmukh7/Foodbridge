import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// authenticate only - no requireApproved. Same reasoning as GET/PUT
// /auth/profile: a not-yet-approved account should still be able to read
// its own basic state. In practice the frontend never mounts the bell
// outside the authenticated dashboard shell (which is itself gated on
// isApproved via ProtectedRoute), so this is a belt-and-suspenders
// consistency choice, not a functional requirement.
router.get('/', authenticate, notificationController.list);
router.get('/unread-count', authenticate, notificationController.unreadCount);
router.post('/:id/read', authenticate, notificationController.markRead);
router.post('/read-all', authenticate, notificationController.markAllRead);

export default router;
