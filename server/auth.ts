import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Express, Request } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User } from "@shared/schema";

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      role: "admin" | "applicant";
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
      role: "admin" | "applicant";
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

  // Configure Google OAuth Strategy if credentials are available
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback",
          scope: ["profile", "email"]
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            // Check if user exists
            let user = await storage.getUserByOAuthId("google", profile.id);

            if (!user) {
              // Create a new user
              user = await storage.createOAuthUser({
                oauth_provider: "google",
                oauth_id: profile.id,
                username: profile.emails?.[0]?.value || `google_${profile.id}`,
                role: "applicant",
                profile_data: JSON.stringify(profile)
              });
            }

            return done(null, user);
          } catch (error) {
            return done(error as Error);
          }
        }
      )
    );
    console.log("Google OAuth strategy configured");
  } else {
    console.log("Google OAuth strategy not configured - missing environment variables");
  }

  // Configure Facebook OAuth Strategy if credentials are available
  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    passport.use(
      new FacebookStrategy(
        {
          clientID: process.env.FACEBOOK_CLIENT_ID,
          clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
          callbackURL: process.env.FACEBOOK_CALLBACK_URL || "/api/auth/facebook/callback",
          profileFields: ["id", "emails", "name"]
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            let user = await storage.getUserByOAuthId("facebook", profile.id);

            if (!user) {
              user = await storage.createOAuthUser({
                oauth_provider: "facebook",
                oauth_id: profile.id,
                username: profile.emails?.[0]?.value || `facebook_${profile.id}`,
                role: "applicant",
                profile_data: JSON.stringify(profile)
              });
            }

            return done(null, user);
          } catch (error) {
            return done(error as Error);
          }
        }
      )
    );
    console.log("Facebook OAuth strategy configured");
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
        role: req.body.role || "applicant" // Default to applicant if not specified
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
      role: user.role
    });
  });

  // OAuth routes - only configured if credentials are available
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    app.get(
      "/api/auth/google",
      passport.authenticate("google", { scope: ["profile", "email"] })
    );

    app.get(
      "/api/auth/google/callback",
      passport.authenticate("google", { failureRedirect: "/login" }),
      (req, res) => {
        res.redirect("/");
      }
    );
  }

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