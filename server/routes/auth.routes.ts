import { Router } from 'express';
import passport from 'passport';
import { setupAuth } from '../auth';

const router = Router();

// Set up authentication routes and middleware
setupAuth(router as any);

// NOTE: Google OAuth now handled entirely by Firebase Auth
// No session-based Google OAuth needed for users

// Facebook authentication
router.get("/facebook", (req, res, next) => {
  console.log("Starting Facebook auth flow");
  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    passport.authenticate("facebook", {
      scope: ["email"],
      failureRedirect: "/login?error=facebook_auth_failed",
      state: Date.now().toString() // Add state parameter for security
    })(req, res, next);
  } else {
    console.error("Facebook OAuth credentials not configured");
    res.redirect("/login?error=facebook_not_configured");
  }
});

router.get(
  "/facebook/callback",
  (req: { query: { error: any; }; }, res: { redirect: (arg0: string) => any; }, next: () => void) => {
    console.log("Facebook OAuth callback received:", req.query);
    // Check for error in the callback
    if (req.query.error) {
      console.error("Facebook OAuth error:", req.query.error);
      return res.redirect(`/login?error=${req.query.error}`);
    }
    next();
  },
  passport.authenticate("facebook", {
    failureRedirect: "/login?error=facebook_callback_failed",
    failWithError: true
  }),
  (req: any, res: { redirect: (arg0: string) => void; }) => {
    // Successful authentication
    console.log("Facebook authentication successful");
    res.redirect("/");
  },
  // Error handler
  (err: any, req: any, res: any, next: any) => {
    console.error("Facebook authentication error:", err);
    res.redirect("/login?error=internal_error");
  }
);

// Instagram authentication
router.get("/instagram", (req, res, next) => {
  console.log("Starting Instagram auth flow");
  if (process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET) {
    passport.authenticate("instagram", {
      failureRedirect: "/login?error=instagram_auth_failed",
      state: Date.now().toString() // Add state parameter for security
    })(req, res, next);
  } else {
    console.error("Instagram OAuth credentials not configured");
    res.redirect("/login?error=instagram_not_configured");
  }
});

router.get(
  "/instagram/callback",
  (req: { query: { error: any; }; }, res: { redirect: (arg0: string) => any; }, next: () => void) => {
    console.log("Instagram OAuth callback received:", req.query);
    // Check for error in the callback
    if (req.query.error) {
      console.error("Instagram OAuth error:", req.query.error);
      return res.redirect(`/login?error=${req.query.error}`);
    }
    next();
  },
  passport.authenticate("instagram", {
    failureRedirect: "/login?error=instagram_callback_failed",
    failWithError: true
  }),
  (req: any, res: { redirect: (arg0: string) => void; }) => {
    // Successful authentication
    console.log("Instagram authentication successful");
    res.redirect("/");
  },
  // Error handler
  (err: any, req: any, res: any, next: any) => {
    console.error("Instagram authentication error:", err);
    res.redirect("/login?error=internal_error");
  }
);

export default router;
