import { User } from "@shared/schema";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { Express } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as LocalStrategy } from "passport-local";
import { promisify } from "util";
import { storage } from "./storage";


declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      role: "admin" | "chef" | "delivery_partner" | "manager" | null;
      isChef?: boolean;
      isDeliveryPartner?: boolean;
    }
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Fix TypeScript error for createOAuthUser interface
declare module "../server/storage" {
  interface IStorage {
    createOAuthUser(user: { 
      username: string;
      role: "admin" | "chef" | "delivery_partner" | "manager";
      isChef?: boolean;
      isDeliveryPartner?: boolean;
      oauth_provider: string;
      oauth_id: string;
      profile_data?: string;
    }): Promise<User>;
  }
}

export function setupAuth(app: Express) {
  // Session config
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "local-cooks-secret-key",
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === "production"
    }
  };

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport with local strategy
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        
        if (!user) {
          return done(null, false, { message: "Incorrect username" });
        }
        
        const isValidPassword = await comparePasswords(password, user.password);
        
        if (!isValidPassword) {
          return done(null, false, { message: "Incorrect password" });
        }
        
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    })
  );

  // NOTE: Google OAuth is handled by Firebase Auth on the client side
  // Session-based Google OAuth is only used for admin authentication
  // Regular users should use Firebase Auth with Google provider
  console.log("Session-based Google OAuth disabled - Firebase Auth handles user OAuth");

  // Configure Facebook OAuth Strategy if credentials are available
  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    // Determine callback URL based on environment
    const facebookCallbackURL = process.env.FACEBOOK_CALLBACK_URL || 
      (process.env.NODE_ENV === 'production' 
        ? 'https://your-domain.com/api/auth/facebook/callback'
        : 'http://localhost:5000/api/auth/facebook/callback');

    passport.use(
      new FacebookStrategy(
        {
          clientID: process.env.FACEBOOK_CLIENT_ID,
          clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
          callbackURL: facebookCallbackURL,
          profileFields: ["id", "emails", "name", "displayName"]
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            console.log('Facebook OAuth callback - Profile received:', {
              id: profile.id,
              email: profile.emails?.[0]?.value,
              name: profile.displayName
            });

            let user = await storage.getUserByOAuthId("facebook", profile.id);
            
            if (!user) {
              const userData = {
                oauth_provider: "facebook",
                oauth_id: profile.id,
                username: profile.emails?.[0]?.value || `facebook_${profile.id}`,
                role: "chef" as const,
                profile_data: JSON.stringify(profile)
              };

              console.log('Creating new Facebook OAuth user:', userData.username);
              user = await storage.createOAuthUser({
                ...userData,
                role: "chef", // Base role but don't set flags - let user choose
                isChef: false, // No default roles - user must choose
                isDeliveryPartner: false, // No default roles - user must choose
                isManager: false
              });
            }
            
            console.log('Facebook OAuth authentication successful for user:', user.id);
            return done(null, user);
          } catch (error) {
            console.error('Facebook OAuth error:', error);
            return done(error as Error);
          }
        }
      )
    );
    console.log(`Facebook OAuth strategy configured with callback: ${facebookCallbackURL}`);
  } else {
    console.log("Facebook OAuth strategy not configured - missing environment variables");
  }

  // Serialize/deserialize user
  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Authentication routes
  app.post("/api/register", async (req, res) => {
    try {
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(req.body.username);
      
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }
      
      // Hash password and create user
      const hashedPassword = await hashPassword(req.body.password);
      
      const user = await storage.createUser({
        username: req.body.username,
        password: hashedPassword,
        role: req.body.role || "chef", // Base role but don't set flags
        isChef: false, // No default roles - user must choose
        isDeliveryPartner: false, // No default roles - user must choose
        isManager: false
      });
      
      // Log the user in
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Login failed after registration" });
        }
        
        return res.status(201).json({
          id: user.id,
          username: user.username,
          role: user.role
        });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: Error | null, user: User | false, info: { message: string } | undefined) => {
      if (err) {
        return next(err);
      }
      
      if (!user) {
        return res.status(401).json({ error: info?.message || "Authentication failed" });
      }
      
      req.login(user, (err: Error | null) => {
        if (err) {
          return next(err);
        }
        
        return res.json({
          id: user.id,
          username: user.username,
          role: user.role
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = req.user as User;
    
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      isChef: user.isChef,
      isDeliveryPartner: user.isDeliveryPartner,
      is_verified: user.isVerified,
      has_seen_welcome: (user as any).has_seen_welcome,
      googleId: user.googleId,
      facebookId: user.facebookId
    });
  });

  // Endpoint to set has_seen_welcome = true for the current user
  app.post('/api/user/seen-welcome', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const user = req.user as User;
      await storage.setUserHasSeenWelcome(user.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error setting has_seen_welcome:', error);
      res.status(500).json({ error: 'Failed to update welcome status' });
    }
  });

  // Debug endpoint to test OAuth user creation
  app.get('/api/debug-oauth', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const user = req.user as User;
      console.log('Debug OAuth user:', {
        id: user.id,
        username: user.username,
        role: user.role,
        isVerified: user.isVerified,
        has_seen_welcome: (user as any).has_seen_welcome,
        googleId: user.googleId,
        facebookId: user.facebookId
      });
      
      // Also fetch directly from database to compare
      const dbUser = await storage.getUser(user.id);
      console.log('Debug OAuth user from DB:', dbUser);
      
      res.json({
        sessionUser: {
          id: user.id,
          username: user.username,
          role: user.role,
          isVerified: user.isVerified,
          has_seen_welcome: (user as any).has_seen_welcome,
          googleId: user.googleId,
          facebookId: user.facebookId
        },
        dbUser: dbUser
      });
    } catch (error) {
      console.error('Debug OAuth error:', error);
      res.status(500).json({ error: 'Debug failed' });
    }
  });

  // NOTE: Google OAuth routes removed - Firebase Auth handles all user OAuth
  // Admin authentication uses local strategy only

  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    app.get(
      "/api/auth/facebook",
      passport.authenticate("facebook", { scope: ["email"] })
    );

    app.get(
      "/api/auth/facebook/callback",
      passport.authenticate("facebook", { failureRedirect: "/login" }),
      (req, res) => {
        res.redirect("/");
      }
    );
  }
}