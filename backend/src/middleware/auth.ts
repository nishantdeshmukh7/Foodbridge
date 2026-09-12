import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import prisma from '../models/prisma.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    name: string;
    isApproved: boolean;
  };
}

// Phase 13: JWTs are stateless and carry no session id to revoke, so a
// password reset can't invalidate already-issued tokens the way a
// server-side session store could. This is the closest safe equivalent:
// compare the token's own `iat` (issued-at, added automatically by
// jsonwebtoken) against User.passwordChangedAt. A token issued before the
// most recent reset is rejected here, on every subsequent request, without
// needing any new state beyond the one timestamp already on User. A token
// issued after a reset (i.e. from logging in again with the new password)
// is unaffected. Users with passwordChangedAt still null (never reset)
// are entirely unaffected - this doesn't retroactively invalidate anyone.
function isStaleAfterPasswordReset(
  decodedIat: number | undefined,
  passwordChangedAt: Date | null
): boolean {
  if (!passwordChangedAt || decodedIat === undefined) {
    return false;
  }
  // JWT `iat` is whole seconds (per spec); passwordChangedAt has
  // millisecond precision. Flooring passwordChangedAt to seconds before
  // comparing - rather than comparing iat*1000 against the raw
  // millisecond value - avoids incorrectly flagging a token issued in the
  // very same second as the reset (e.g. an immediate re-login) as stale
  // merely due to sub-second truncation.
  const passwordChangedAtSeconds = Math.floor(passwordChangedAt.getTime() / 1000);
  return decodedIat < passwordChangedAtSeconds;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: string;
      email: string;
      role: string;
      name: string;
      iat?: number;
    };

    // Check if user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        isActive: true,
        isApproved: true,
        passwordChangedAt: true,
      },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    if (isStaleAfterPasswordReset(decoded.iat, user.passwordChangedAt)) {
      res.status(401).json({ error: 'Session expired due to a password change. Please log in again.' });
      return;
    }

    const { passwordChangedAt: _passwordChangedAt, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Not authorized for this action' });
      return;
    }

    next();
  };
};

// Must run after authenticate(). Blocks accounts that are active but not yet
// approved (currently only reachable by NGO signups - see
// authService.register) from reaching protected business routes. This is
// the server-side half of the approval gate the frontend's ProtectedRoute
// already assumes; without it, an unapproved account's valid JWT could call
// protected endpoints directly.
//
// Deliberately NOT applied to GET/PUT /auth/profile - a pending account
// still needs to see and correct its own account info so the frontend's
// "pending approval" screen can render.
export const requireApproved = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  if (!req.user.isApproved) {
    res.status(403).json({ error: 'Your account is pending approval. Please contact an administrator.' });
    return;
  }

  next();
};

// Must run after authenticate(). Allows a request through only if the
// authenticated caller IS the resource identified by the given route param
// (default "id"), or is an ADMIN. For routes like GET /users/:id, where the
// target's owner is exactly the URL param itself, this is cheaper and more
// consistent with this codebase's existing pattern (authenticate/authorize/
// requireApproved are all small composable middlewares) than adding an
// extra DB round-trip in the service just to compare an id.
export const requireSelfOrAdmin = (paramName = 'id') => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const targetId = req.params[paramName];

    if (req.user.role !== 'ADMIN' && req.user.id !== targetId) {
      res.status(403).json({ error: 'Not authorized to access this resource' });
      return;
    }

    next();
  };
};

// Optional auth - doesn't fail if no token, but attaches user if token exists
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: string;
      email: string;
      role: string;
      name: string;
      iat?: number;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        isActive: true,
        isApproved: true,
        passwordChangedAt: true,
      },
    });

    if (user && user.isActive && !isStaleAfterPasswordReset(decoded.iat, user.passwordChangedAt)) {
      const { passwordChangedAt: _passwordChangedAt, ...safeUser } = user;
      req.user = safeUser;
    }
  } catch {
    // Token invalid, continue without user
  }

  next();
};

