import { logger } from "./logger";
// REMOVED: All session and passport imports - Firebase Auth only
import { Express } from "express";

// REMOVED: All session-based authentication
// All authentication now uses Firebase Auth exclusively
// Session middleware, passport, local strategy, and OAuth strategies have been removed

export function setupAuth(app: Express) {
  // REMOVED: All session-based authentication
  // All authentication now uses Firebase Auth exclusively
  // Session middleware, passport, and local strategy have been removed
  logger.info("✅ Session-based auth removed - Using Firebase Auth only");

  // REMOVED: All OAuth strategies (Facebook, Google) - Firebase Auth handles all OAuth
  logger.info("✅ All OAuth strategies removed - Firebase Auth handles all authentication");

  // REMOVED: Passport serialize/deserialize - No longer needed with Firebase Auth

  // REMOVED: All session-based authentication routes
  // Use Firebase Auth endpoints instead:
  // - /api/firebase-register-user (registration)
  // - /api/firebase-sync-user (sign-in)
  // - /api/user/profile (get user data with Firebase token)

  // REMOVED: Session-based endpoints - Use Firebase Auth endpoints instead

  // REMOVED: All OAuth routes - Firebase Auth handles all OAuth authentication
}
