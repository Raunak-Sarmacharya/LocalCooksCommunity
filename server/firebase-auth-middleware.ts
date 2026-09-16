import { logger } from "./logger";
import { NextFunction, Request, Response } from 'express';
import { verifyFirebaseToken } from './firebase-setup';
import { userService } from './domains/users/user.service';
import { UserWithFlags } from "@shared/schema";
import * as Sentry from '@sentry/node';

export async function resolveNeonUser(decodedToken: { uid: string }) {
  // A Firebase UID is the account boundary. Email, phone, and Google may all
  // authenticate the same UID, but contact fields must never select a user.
  return userService.getUserByFirebaseUid(decodedToken.uid);
}

/**
 * Has this account proven ownership of an email address?
 *
 * Accepts either the token claim or the application mirror. The claim is a *cache*: it is
 * baked into the ID token and stays stale for up to an hour after the address changes, and
 * refreshing it is not something we can force safely (a forced refresh against an
 * invalidated token signs the user out everywhere). The mirror is written only when
 * Firebase has confirmed the address — by registration, by the confirmation endpoint, or
 * by the repair below — so `isVerified === true` implies Firebase agrees.
 *
 * Gating on the mirror therefore removes any dependency on token freshness without
 * loosening the check.
 */
export function hasVerifiedEmail(req: Request): boolean {
  return req.firebaseUser?.email_verified === true || req.neonUser?.isVerified === true;
}

/**
 * Previously a gate requiring email AND phone. Removed: phone never blocks an action, and a
 * predicate named "requires both" is a footgun — the natural thing to do with it is to gate
 * something, which would silently reintroduce the phone block. Nothing referenced it any more.
 */

function isContactVerificationRecoveryRoute(req: Request): boolean {
  const path = req.originalUrl.split('?')[0];
  return [
    '/api/user/',
    '/api/manager/profile',
    '/api/chef/my-profile',
    '/api/sync-verification-status',
    '/api/firebase/user/me',
    '/api/firebase-sync-user',
  ].some((allowed) => path === allowed.replace(/\/$/, '') || path.startsWith(allowed));
}

// Extend Express Request to include Firebase user data
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: {
        uid: string;
        email?: string;
        email_verified?: boolean;
        /** Seconds since epoch of the last sign-in, from the decoded ID token. */
        auth_time?: number;
        name?: string;
        picture?: string;
        phone_number?: string;
      };
      neonUser?: UserWithFlags;
    }
  }
}

/**
 * Middleware to verify Firebase Auth token and set req.firebaseUser
 * NO SESSIONS - Pure JWT token verification
 */
export async function verifyFirebaseAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Check if response was already sent (to prevent double response errors)
    if (res.headersSent) {
      return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No auth token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const decodedToken = await verifyFirebaseToken(token);

    if (!decodedToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid auth token'
      });
    }

    // Set Firebase user info on request
    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      name: decodedToken.name,
      picture: decodedToken.picture,
      phone_number: decodedToken.phone_number,
    };

    next();
  } catch (error) {
    // Check if response was already sent before trying to send error
    if (res.headersSent) {
      logger.error('Firebase auth verification error (response already sent):', error);
      return;
    }
    logger.error('Firebase auth verification error:', error);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token verification failed'
    });
  }
}

/**
 * Middleware to verify Firebase Auth and load corresponding Neon user
 * This is the key translation layer: Firebase UID → Neon User ID
 * NO SESSIONS REQUIRED - Pure stateless architecture
 * IMPORTANT: This middleware does NOT auto-create users - sign-in only
 */
export async function requireFirebaseAuthWithUser(req: Request, res: Response, next: NextFunction) {
  try {
    // Check if response was already sent (to prevent double response errors)
    if (res.headersSent) {
      return;
    }

    // First verify Firebase token directly (don't call as middleware to avoid double responses)
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No auth token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const decodedToken = await verifyFirebaseToken(token);

    if (!decodedToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid auth token'
      });
    }

    // Set Firebase user info on request
    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
      name: decodedToken.name,
      picture: decodedToken.picture,
      phone_number: decodedToken.phone_number,
    };

    // Now translate Firebase UID to Neon user (NO SESSIONS)
    let neonUser = await resolveNeonUser(decodedToken);

    if (!neonUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'This account is not registered with Local Cooks. Please create an account first.'
      });
    }

    // Firebase is authoritative for email ownership. Repair a stale database
    // mirror during any authenticated request so verified users are never
    // blocked while waiting for a separate profile-sync call.
    if (req.firebaseUser.email_verified === true && neonUser.isVerified !== true) {
      const syncedUser = await userService.updateUser(neonUser.id, {
        isVerified: true,
        // Record the first time we learn the address is confirmed, so the profile
        // card can show a date however the user verified — our token loop or
        // Firebase's own action code. Never moves an existing date.
        emailVerifiedAt: neonUser.emailVerifiedAt ?? new Date(),
      });
      if (syncedUser) neonUser = syncedUser;
    }

    // Set both Firebase and Neon user info on request
    // Include all user properties including isChef, isManager
    req.neonUser = {
      ...neonUser,
      uid: neonUser.firebaseUid || undefined, // Support legacy code that uses .uid
    } as UserWithFlags;

    const isChefOrManager =
      neonUser.role === 'chef' || neonUser.role === 'manager' ||
      neonUser.isChef === true || neonUser.isManager === true;
    if (
      isChefOrManager &&
      !hasVerifiedEmail(req) &&
      !isContactVerificationRecoveryRoute(req)
    ) {
      return res.status(403).json({
        error: 'Email verification required',
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Verify your email address before using operational features.',
      });
    }

    // Enrich Sentry with authenticated user context for error attribution
    Sentry.setUser({
      id: String(neonUser.id),
      email: req.firebaseUser.email,
      username: neonUser.username || undefined,
      data: {
        role: neonUser.role,
        firebaseUid: req.firebaseUser.uid,
      },
    });

    next();
  } catch (error) {
    // Check if response was already sent before trying to send error
    if (res.headersSent) {
      logger.error('Firebase auth with user verification error (response already sent):', error);
      return;
    }
    logger.error('Firebase auth with user verification error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication verification failed'
    });
  }
}

/**
 * Optional Firebase auth middleware - doesn't fail if no token provided
 * Useful for endpoints that work for both authenticated and non-authenticated users
 * NO SESSIONS - Pure JWT token verification when available
 */
export async function optionalFirebaseAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without user
      return next();
    }

    const token = authHeader.substring(7);
    const decodedToken = await verifyFirebaseToken(token);

    if (decodedToken) {
      req.firebaseUser = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        email_verified: decodedToken.email_verified,
        // When the user last signed in. Required to gate identity-changing operations
        // (changing a verified email) behind a recent authentication.
        auth_time: decodedToken.auth_time,
        name: decodedToken.name,
        picture: decodedToken.picture,
        phone_number: decodedToken.phone_number,
      };

      // Try to load Neon user (NO SESSIONS)
      const neonUser = await resolveNeonUser(decodedToken);
      if (neonUser) {
        req.neonUser = {
          ...neonUser,
          uid: neonUser.firebaseUid || undefined,
        } as UserWithFlags;
      }
    }

    next();
  } catch (error) {
    logger.error('Optional Firebase auth error:', error);
    // Don't fail the request, just continue without user
    next();
  }
}

/**
 * Admin role verification middleware
 * Must be used after requireFirebaseAuthWithUser
 * NO SESSIONS - Role check based on Neon user data
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Check if response was already sent
  if (res.headersSent) {
    return;
  }

  if (!req.neonUser) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (req.neonUser.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required'
    });
  }

  next();
}

/**
 * Manager role verification middleware
 * Must be used after requireFirebaseAuthWithUser
 * NO SESSIONS - Role check based on Neon user data
 */
export function requireManager(req: Request, res: Response, next: NextFunction) {
  // Check if response was already sent
  if (res.headersSent) {
    return;
  }

  if (!req.neonUser) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (req.neonUser.role !== 'manager') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Manager access required'
    });
  }

  // Email gates operational access; a missing phone never does. Admins never
  // reach here (role check above), so a broken mailbox cannot lock the platform.
  if (!hasVerifiedEmail(req) && !req.originalUrl.startsWith('/api/manager/profile')) {
    return res.status(403).json({
      error: 'Email verification required',
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: 'Verify your email address before using manager operations.',
    });
  }

  next();
}
