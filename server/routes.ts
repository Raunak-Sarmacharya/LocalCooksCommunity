import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertApplicationSchema, updateApplicationStatusSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { setupAuth } from "./auth";
import passport from "passport";
import { sendEmail, generateStatusChangeEmail } from "./email";

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication routes and middleware
  setupAuth(app);

  // Google authentication
  app.get("/api/auth/google", (req, res, next) => {
    console.log("Starting Google auth flow");
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      passport.authenticate("google", {
        scope: ["profile", "email"],
        failureRedirect: "/login?error=google_auth_failed",
        state: Date.now().toString() // Add state parameter for security
      })(req, res, next);
    } else {
      console.error("Google OAuth credentials not configured");
      res.redirect("/login?error=google_not_configured");
    }
  });

  app.get(
    "/api/auth/google/callback",
    (req: { query: { error: any; }; }, res: { redirect: (arg0: string) => any; }, next: () => void) => {
      console.log("Google OAuth callback received:", req.query);
      // Check for error in the callback
      if (req.query.error) {
        console.error("Google OAuth error:", req.query.error);
        return res.redirect(`/login?error=${req.query.error}`);
      }
      next();
    },
    passport.authenticate("google", {
      failureRedirect: "/login?error=google_callback_failed",
      failWithError: true // This will pass the error to the next middleware
    }),
    (req: any, res: { redirect: (arg0: string) => void; }) => {
      // Successful authentication
      console.log("Google authentication successful");
      res.redirect("/");
    },
    // Error handler
    (err: any, req: any, res: any, next: any) => {
      console.error("Google authentication error:", err);
      res.redirect("/login?error=internal_error");
    }
  );

  // Facebook authentication
  app.get("/api/auth/facebook", (req, res, next) => {
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

  app.get(
    "/api/auth/facebook/callback",
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
  app.get("/api/auth/instagram", (req, res, next) => {
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

  app.get(
    "/api/auth/instagram/callback",
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

  // Application submission endpoint
  app.post("/api/applications", async (req: Request, res: Response) => {
    try {
      // Require authentication to submit an application
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "You must be logged in to submit an application" });
      }

      // Validate the request body using Zod schema
      const parsedData = insertApplicationSchema.safeParse(req.body);

      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        return res.status(400).json({
          message: "Validation error",
          errors: validationError.details
        });
      }

      // Ensure the application is associated with the current user
      // Override any userId in the request to prevent spoofing
      const applicationData = {
        ...parsedData.data,
        userId: req.user!.id
      };

      // Create the application in storage
      const application = await storage.createApplication(applicationData);

      // Fetch the full application record to ensure all fields are present
      const fullApplication = await storage.getApplicationById(application.id);

      // Send email notification about new application
      try {
        if (fullApplication && fullApplication.email) {
          const emailContent = generateStatusChangeEmail({
            fullName: fullApplication.fullName || "Applicant",
            email: fullApplication.email,
            status: "new"
          });

          await sendEmail(emailContent);
          console.log(`New application email sent to ${fullApplication.email} for application ${fullApplication.id}`);
        } else {
          console.warn(`Cannot send new application email: Application record not found or missing email.`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending new application email:", emailError);
      }

      return res.status(201).json(application);
    } catch (error) {
      console.error("Error creating application:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get all applications endpoint (for admin view)
  app.get("/api/applications", async (req: Request, res: Response) => {
    // Check if user is authenticated and is an admin
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (req.user!.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    try {
      const applications = await storage.getAllApplications();
      return res.status(200).json(applications);
    } catch (error) {
      console.error("Error fetching applications:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get applications for the logged-in user (this specific route needs to come before the /:id route)
  app.get("/api/applications/my-applications", async (req: Request, res: Response) => {
    // Check if user is authenticated
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const userId = req.user!.id;
      const applications = await storage.getApplicationsByUserId(userId);
      return res.status(200).json(applications);
    } catch (error) {
      console.error("Error fetching user applications:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get application by ID endpoint
  app.get("/api/applications/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      const application = await storage.getApplicationById(id);

      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }

      return res.status(200).json(application);
    } catch (error) {
      console.error("Error fetching application:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update application status endpoint (admin only)
  app.patch("/api/applications/:id/status", async (req: Request, res: Response) => {
    // Check if user is authenticated via session or X-User-ID header
    const userId = req.isAuthenticated() ? req.user!.id : (req.headers['x-user-id'] ? parseInt(req.headers['x-user-id'] as string) : null);

    console.log('Status update request - Auth info:', {
      isAuthenticated: req.isAuthenticated(),
      sessionUserId: req.isAuthenticated() ? req.user!.id : null,
      headerUserId: req.headers['x-user-id'],
      resolvedUserId: userId
    });

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Get user from storage to check role
    const user = await storage.getUser(userId);

    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      // Validate the request body using Zod schema
      const parsedData = updateApplicationStatusSchema.safeParse({
        id,
        status: req.body.status
      });

      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        return res.status(400).json({
          message: "Validation error",
          errors: validationError.details
        });
      }

      const updatedApplication = await storage.updateApplicationStatus(parsedData.data);

      if (!updatedApplication) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Send email notification about status change
      try {
        if (updatedApplication.email) {
          const emailContent = generateStatusChangeEmail({
            fullName: updatedApplication.fullName || "Applicant",
            email: updatedApplication.email,
            status: updatedApplication.status
          });

          await sendEmail(emailContent);
          console.log(`Status change email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
        } else {
          console.warn(`Cannot send status change email for application ${updatedApplication.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending status change email:", emailError);
      }

      return res.status(200).json(updatedApplication);
    } catch (error) {
      console.error("Error updating application status:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Cancel application endpoint (for applicants)
  app.patch("/api/applications/:id/cancel", async (req: Request, res: Response) => {
    // Check if user is authenticated via session or X-User-ID header
    const userId = req.isAuthenticated() ? req.user!.id : (req.headers['x-user-id'] ? parseInt(req.headers['x-user-id'] as string) : null);

    console.log('Cancel application request - Auth info:', {
      isAuthenticated: req.isAuthenticated(),
      sessionUserId: req.isAuthenticated() ? req.user!.id : null,
      headerUserId: req.headers['x-user-id'],
      resolvedUserId: userId
    });

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      // First get the application to verify ownership
      const application = await storage.getApplicationById(id);

      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Check if the application belongs to the authenticated user
      if (application.userId !== userId) {
        return res.status(403).json({ message: "Access denied. You can only cancel your own applications." });
      }

      const updateData = {
        id,
        status: "cancelled" as const
      };

      const updatedApplication = await storage.updateApplicationStatus(updateData);

      if (!updatedApplication) {
        return res.status(404).json({ message: "Application not found" });
      }

      return res.status(200).json(updatedApplication);
    } catch (error) {
      console.error("Error cancelling application:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Test endpoint for sending status change emails
  app.post("/api/test/status-email", async (req: Request, res: Response) => {
    // Check if user is authenticated and is an admin
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (req.user!.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    try {
      const { status, email, fullName } = req.body;

      if (!status || !email || !fullName) {
        return res.status(400).json({
          message: "Missing required fields",
          required: ["status", "email", "fullName"]
        });
      }

      // Generate email content
      const emailContent = generateStatusChangeEmail({
        fullName,
        email,
        status
      });

      // Send the email
      const emailSent = await sendEmail(emailContent);

      if (!emailSent) {
        return res.status(500).json({
          message: "Failed to send email",
          details: "Check server logs for more information"
        });
      }

      return res.status(200).json({
        message: "Test email sent successfully",
        emailDetails: {
          to: email,
          subject: emailContent.subject,
          status
        }
      });
    } catch (error) {
      console.error("Error sending test email:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
