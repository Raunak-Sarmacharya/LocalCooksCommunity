import { NextFunction, Request, Response } from 'express';
import { verifyFirebaseToken } from './firebase-admin';
import { firebaseStorage } from './storage-firebase';

// Extend Express Request to include Firebase user data
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: {
        uid: string;
        email?: string;
        email_verified?: boolean;
      };
      neonUser?: {
        id: number;
        username: string;
        role: "admin" | "chef" | "delivery_partner";
        firebaseUid?: string;
      };
    }
  }
}

/**
 * Middleware to verify Firebase Auth token and set req.firebaseUser
 * NO SESSIONS - Pure JWT token verification
 */
export async function verifyFirebaseAuth(req: Request, res: Response, next: NextFunction) {
  try {
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
    };

    next();
  } catch (error) {
    console.error('Firebase auth verification error:', error);
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
    // First verify Firebase token
    await verifyFirebaseAuth(req, res, () => {});
    
    if (!req.firebaseUser) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Firebase authentication required' 
      });
    }

    // Now translate Firebase UID to Neon user (NO SESSIONS)
    const neonUser = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);
    
    if (!neonUser) {
      return res.status(404).json({ 
        error: 'User not found', 
        message: 'This account is not registered with Local Cooks. Please create an account first.' 
      });
    }

    // Set both Firebase and Neon user info on request
    req.neonUser = {
      id: neonUser.id,
      username: neonUser.username,
      role: neonUser.role,
      firebaseUid: neonUser.firebaseUid || undefined,
    };

    console.log(`🔄 Auth translation: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${neonUser.id}`);

    next();
  } catch (error) {
    console.error('Firebase auth with user verification error:', error);
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
      };

      // Try to load Neon user (NO SESSIONS)
      const neonUser = await firebaseStorage.getUserByFirebaseUid(decodedToken.uid);
      if (neonUser) {
        req.neonUser = {
          id: neonUser.id,
          username: neonUser.username,
          role: neonUser.role,
          firebaseUid: neonUser.firebaseUid || undefined,
        };
      }
    }

    next();
  } catch (error) {
    console.error('Optional Firebase auth error:', error);
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