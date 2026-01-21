import { Router, Request, Response } from 'express';
import { verifyFirebaseAuth } from '../../firebase-auth-middleware';
import { firebaseStorage } from '../../storage-firebase';
import { syncFirebaseUserToNeon } from '../../firebase-user-sync';
import { initializeFirebaseAdmin } from '../../firebase-admin';
import { db } from '../../db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getSubdomainFromHeaders, isRoleAllowedForSubdomain } from '@shared/subdomain-utils';

const router = Router();

// 🔥 Firebase User Registration Endpoint
// This is called during registration to create new users
router.post('/firebase-register-user', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
        if (!req.firebaseUser) {
            return res.status(401).json({ error: 'Firebase authentication required' });
        }

        const { displayName, role, emailVerified } = req.body;

        // Check if user already exists
        const existingUser = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);
        if (existingUser) {
            return res.status(409).json({
                error: 'User already exists',
                message: 'This account is already registered. Please sign in instead.',
                user: {
                    id: existingUser.id,
                    username: existingUser.username,
                    role: existingUser.role,
                    firebaseUid: existingUser.firebaseUid
                }
            });
        }

        // Validate subdomain-role matching for registration
        const subdomain = getSubdomainFromHeaders(req.headers);
        // For registration, we only have the role, not the flags yet
        if (role && !isRoleAllowedForSubdomain(role, subdomain, false, false, false)) {
            const requiredSubdomain = role === 'chef' ? 'chef' :
                role === 'manager' ? 'kitchen' :
                    role === 'admin' ? 'admin' : null;

            return res.status(403).json({
                error: `Access denied. ${role} users must register from the ${requiredSubdomain} subdomain.`,
                requiredSubdomain: requiredSubdomain
            });
        }

        // Create new user during registration
        const user = await syncFirebaseUserToNeon({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email || null,
            displayName,
            emailVerified: emailVerified !== undefined ? emailVerified : req.firebaseUser.email_verified,
            role: role // Don't set default role - let user choose
        });

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                firebaseUid: user.firebaseUid
            },
            message: 'Account created successfully'
        });
    } catch (error) {
        console.error('Error registering Firebase user:', error);
        res.status(500).json({
            error: 'Failed to create account',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// 🔥 Firebase Password Reset Request - Uses Firebase's built-in password reset
router.post('/firebase/forgot-password', async (req: Request, res: Response) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        console.log(`🔥 Firebase password reset requested for: ${email}`);

        // Get Firebase Admin instance
        const firebaseApp = initializeFirebaseAdmin();

        if (!firebaseApp) {
            console.error('Firebase Admin not initialized');
            return res.status(500).json({
                message: "Password reset service unavailable. Please try again later."
            });
        }

        try {
            // Get auth instance using modular SDK
            const { getAuth } = await import('firebase-admin/auth');
            const auth = getAuth(firebaseApp);

            // Check if user exists in Firebase
            const userRecord = await auth.getUserByEmail(email);
            console.log(`✅ Firebase user found: ${userRecord.uid}`);

            // Check if this user exists in our Neon database and is email/password user
            const neonUser = await firebaseStorage.getUserByFirebaseUid(userRecord.uid);

            if (!neonUser) {
                console.log(`❌ User not found in Neon DB for Firebase UID: ${userRecord.uid}`);
                // Don't reveal if user exists or not for security
                return res.status(200).json({
                    message: "If an account with this email exists, you will receive a password reset link."
                });
            }

            // Only allow password reset for email/password users (those with hashed passwords in Neon)
            // Firebase OAuth users (Google, etc.) should use their OAuth provider's password reset
            if (!neonUser.password || neonUser.password === '') {
                console.log(`❌ User ${userRecord.uid} is OAuth user, no password reset needed`);
                return res.status(400).json({
                    message: "This account uses Google/OAuth sign-in. Please use 'Sign in with Google' or contact your OAuth provider to reset your password."
                });
            }

            // Generate password reset link using Firebase
            const resetUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/auth/reset-password`;
            const resetLink = await auth.generatePasswordResetLink(email, {
                url: resetUrl,
                handleCodeInApp: true,
            });

            console.log(`✅ Firebase password reset link generated for: ${email}`);

            // Optionally send custom email here or let Firebase handle it
            // For now, let Firebase send the default email

            return res.status(200).json({
                message: "If an account with this email exists, you will receive a password reset link.",
                resetLink: process.env.NODE_ENV === 'development' ? resetLink : undefined // Only show in dev
            });

        } catch (firebaseError: any) {
            if (firebaseError.code === 'auth/user-not-found') {
                console.log(`❌ Firebase user not found: ${email}`);
                // Don't reveal if user exists or not for security
                return res.status(200).json({
                    message: "If an account with this email exists, you will receive a password reset link."
                });
            } else {
                console.error(`❌ Firebase error:`, firebaseError);
                return res.status(500).json({
                    message: "Error processing password reset request. Please try again later."
                });
            }
        }

    } catch (error) {
        console.error("Error in Firebase forgot password:", error);
        return res.status(500).json({
            message: "Internal server error. Please try again later."
        });
    }
});

// 🔥 Firebase Password Reset Confirmation - Uses Firebase's built-in password reset
router.post('/firebase/reset-password', async (req: Request, res: Response) => {
    try {
        const { oobCode, newPassword } = req.body;

        if (!oobCode || !newPassword) {
            return res.status(400).json({ message: "Reset code and new password are required" });
        }

        // Validate password strength
        if (newPassword.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters long" });
        }

        console.log(`🔥 Firebase password reset confirmation with code: ${oobCode.substring(0, 8)}...`);

        // Get Firebase Admin instance
        const firebaseApp = initializeFirebaseAdmin();

        if (!firebaseApp) {
            console.error('Firebase Admin not initialized');
            return res.status(500).json({
                message: "Password reset service unavailable. Please try again later."
            });
        }

        try {
            // Get auth instance using modular SDK
            const { getAuth } = await import('firebase-admin/auth');
            const auth = getAuth(firebaseApp);

            // Verify the reset code and get the email
            const email = await (auth as any).verifyPasswordResetCode(oobCode);
            console.log(`✅ Password reset code verified for: ${email}`);

            // Confirm the password reset
            await (auth as any).confirmPasswordReset(oobCode, newPassword);
            console.log(`✅ Password reset confirmed for: ${email}`);

            // Update the password hash in our Neon database for consistency
            const userRecord = await auth.getUserByEmail(email);
            const neonUser = await firebaseStorage.getUserByFirebaseUid(userRecord.uid);

            if (neonUser) {
                // Hash the new password and update in Neon DB
                const bcrypt = require('bcryptjs');
                const hashedPassword = await bcrypt.hash(newPassword, 12);

                await db.update(users)
                    .set({ password: hashedPassword })
                    .where(eq(users.firebaseUid, userRecord.uid));

                console.log(`✅ Password hash updated in Neon DB for user: ${neonUser.id}`);
            }

            return res.status(200).json({
                message: "Password reset successfully. You can now log in with your new password."
            });

        } catch (firebaseError: any) {
            console.error(`❌ Firebase password reset error:`, firebaseError);

            if (firebaseError.code === 'auth/invalid-action-code') {
                return res.status(400).json({ message: "Invalid or expired reset code" });
            } else if (firebaseError.code === 'auth/weak-password') {
                return res.status(400).json({ message: "Password is too weak. Please choose a stronger password." });
            } else {
                return res.status(500).json({
                    message: "Error resetting password. Please try again later."
                });
            }
        }

    } catch (error) {
        console.error("Error in Firebase reset password:", error);
        return res.status(500).json({
            message: "Internal server error. Please try again later."
        });
    }
});

// 🔥 Firebase User Sync Endpoint (Legacy - for existing flows)
// This is called by the frontend when a user logs in/registers
router.post('/firebase-sync-user', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
        if (!req.firebaseUser) {
            return res.status(401).json({ error: 'Firebase authentication required' });
        }

        const { displayName, role, emailVerified, isRegistration } = req.body;

        // If this is explicitly marked as registration, allow user creation
        if (isRegistration) {
            // Check if user already exists
            const existingUser = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);
            if (existingUser) {
                return res.json({
                    success: true,
                    user: {
                        id: existingUser.id,
                        username: existingUser.username,
                        role: existingUser.role,
                        firebaseUid: existingUser.firebaseUid
                    },
                    message: 'User already exists'
                });
            }

            // Create new user during registration
            const user = await syncFirebaseUserToNeon({
                uid: req.firebaseUser.uid,
                email: req.firebaseUser.email || null,
                displayName,
                emailVerified: emailVerified !== undefined ? emailVerified : req.firebaseUser.email_verified,
                role: role || 'chef'
            });

            return res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    firebaseUid: user.firebaseUid
                }
            });
        }

        // For sign-in (not registration), only sync if user already exists
        const existingUser = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);
        if (!existingUser) {
            return res.status(404).json({
                error: 'User not found',
                message: 'This account is not registered with Local Cooks. Please create an account first.'
            });
        }

        // Validate subdomain-role matching for login
        const subdomain = getSubdomainFromHeaders(req.headers);
        const isPortalUser = (existingUser as any).isPortalUser || (existingUser as any).is_portal_user || false;
        const isChef = (existingUser as any).isChef || (existingUser as any).is_chef || false;
        const isManager = (existingUser as any).isManager || (existingUser as any).is_manager || false;
        if (!isRoleAllowedForSubdomain(existingUser.role, subdomain, isPortalUser, isChef, isManager)) {
            // Determine effective role for error message
            const effectiveRole = existingUser.role || (isManager ? 'manager' : isChef ? 'chef' : null);
            const requiredSubdomain = effectiveRole === 'chef' ? 'chef' :
                effectiveRole === 'manager' ? 'kitchen' :
                    effectiveRole === 'admin' ? 'admin' : null;

            return res.status(403).json({
                error: `Access denied. ${effectiveRole || 'user'} users must login from the ${requiredSubdomain} subdomain.`,
                requiredSubdomain: requiredSubdomain
            });
        }

        res.json({
            success: true,
            user: {
                id: existingUser.id,
                username: existingUser.username,
                role: existingUser.role,
                firebaseUid: existingUser.firebaseUid
            }
        });
    } catch (error) {
        console.error('Error syncing Firebase user:', error);
        res.status(500).json({
            error: 'Failed to sync user',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export const authRouter = router;
