import type { User } from "@shared/schema";
import { insertApplicationSchema, updateApplicationStatusSchema, updateDeliveryPartnerApplicationStatusSchema, updateDocumentVerificationSchema } from "@shared/schema";
import type { Express, Request, Response } from "express";
import fs from "fs";
import { createServer, type Server } from "http";
import passport from "passport";
import path from "path";
import { fromZodError } from "zod-validation-error";
import { isAlwaysFoodSafeConfigured, submitToAlwaysFoodSafe } from "./alwaysFoodSafeAPI";
import { setupAuth } from "./auth";
import { generateApplicationWithDocumentsEmail, generateApplicationWithoutDocumentsEmail, generateDeliveryPartnerStatusChangeEmail, generateDocumentStatusChangeEmail, generatePromoCodeEmail, generateStatusChangeEmail, sendEmail } from "./email";
import { deleteFile, getFileUrl, upload, uploadToBlob } from "./fileUpload";
import { comparePasswords, hashPassword } from "./passwordUtils";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication routes and middleware
  setupAuth(app);

  // NOTE: Google OAuth now handled entirely by Firebase Auth
  // No session-based Google OAuth needed for users

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

  // Application submission endpoint (supports both JSON and multipart form data)
  app.post("/api/applications", 
    upload.fields([
      { name: 'foodSafetyLicense', maxCount: 1 },
      { name: 'foodEstablishmentCert', maxCount: 1 }
    ]), 
    async (req: Request, res: Response) => {
      try {
        // Require authentication to submit an application
        if (!req.isAuthenticated()) {
          // Clean up uploaded files on error
          if (req.files) {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            Object.values(files).flat().forEach(file => {
              try {
                fs.unlinkSync(file.path);
              } catch (e) {
                console.error('Error cleaning up file:', e);
              }
            });
          }
          return res.status(401).json({ message: "You must be logged in to submit an application" });
        }

        // Validate the request body using Zod schema
        const parsedData = insertApplicationSchema.safeParse(req.body);

        if (!parsedData.success) {
          // Clean up uploaded files on validation error
          if (req.files) {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            Object.values(files).flat().forEach(file => {
              try {
                fs.unlinkSync(file.path);
              } catch (e) {
                console.error('Error cleaning up file:', e);
              }
            });
          }
          
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

        console.log('=== APPLICATION SUBMISSION WITH DOCUMENTS ===');
        console.log('Request details:', {
          method: req.method,
          contentType: req.headers['content-type'],
          hasFiles: !!req.files,
          fileKeys: req.files ? Object.keys(req.files) : [],
          bodyKeys: Object.keys(req.body || {}),
          bodyData: {
            foodSafetyLicense: req.body.foodSafetyLicense,
            foodEstablishmentCert: req.body.foodEstablishmentCert,
            foodSafetyLicenseUrl: req.body.foodSafetyLicenseUrl,
            foodEstablishmentCertUrl: req.body.foodEstablishmentCertUrl,
            userId: req.body.userId
          }
        });
        console.log('Form data:', {
          foodSafetyLicense: applicationData.foodSafetyLicense,
          foodEstablishmentCert: applicationData.foodEstablishmentCert,
          hasFiles: !!req.files,
          fileKeys: req.files ? Object.keys(req.files) : []
        });

        // Handle uploaded files and URL inputs
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        // Handle file uploads
        if (files) {
          const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
          
          if (files.foodSafetyLicense && files.foodSafetyLicense[0]) {
            console.log('📄 Uploading food safety license file...');
            if (isProduction) {
              applicationData.foodSafetyLicenseUrl = await uploadToBlob(files.foodSafetyLicense[0], req.user!.id);
            } else {
              applicationData.foodSafetyLicenseUrl = getFileUrl(files.foodSafetyLicense[0].filename);
            }
            console.log('✅ Food safety license uploaded:', applicationData.foodSafetyLicenseUrl);
          }
          
          if (files.foodEstablishmentCert && files.foodEstablishmentCert[0]) {
            console.log('📄 Uploading food establishment cert file...');
            if (isProduction) {
              applicationData.foodEstablishmentCertUrl = await uploadToBlob(files.foodEstablishmentCert[0], req.user!.id);
            } else {
              applicationData.foodEstablishmentCertUrl = getFileUrl(files.foodEstablishmentCert[0].filename);
            }
            console.log('✅ Food establishment cert uploaded:', applicationData.foodEstablishmentCertUrl);
          }
        }

        // Handle URL inputs from form (fallback if no files uploaded)
        if (req.body.foodSafetyLicenseUrl && !applicationData.foodSafetyLicenseUrl) {
          applicationData.foodSafetyLicenseUrl = req.body.foodSafetyLicenseUrl;
          console.log('📄 Using provided food safety license URL:', applicationData.foodSafetyLicenseUrl);
        }
        
        if (req.body.foodEstablishmentCertUrl && !applicationData.foodEstablishmentCertUrl) {
          applicationData.foodEstablishmentCertUrl = req.body.foodEstablishmentCertUrl;
          console.log('📄 Using provided food establishment cert URL:', applicationData.foodEstablishmentCertUrl);
        }

        // Set initial document status based on what was provided and user responses
        if (applicationData.foodSafetyLicenseUrl) {
          applicationData.foodSafetyLicenseStatus = "pending";
          console.log('✅ Food safety license document provided, status set to pending');
        }
        
        if (applicationData.foodEstablishmentCertUrl) {
          applicationData.foodEstablishmentCertStatus = "pending";
          console.log('✅ Food establishment cert document provided, status set to pending');
        }

        console.log('Final application data:', {
          userId: applicationData.userId,
          hasDocuments: !!(applicationData.foodSafetyLicenseUrl || applicationData.foodEstablishmentCertUrl),
          documentUrls: {
            foodSafetyLicense: applicationData.foodSafetyLicenseUrl || null,
            foodEstablishmentCert: applicationData.foodEstablishmentCertUrl || null
          }
        });

        // Create the application in storage
        const application = await storage.createApplication(applicationData);

        // Fetch the full application record to ensure all fields are present
        const fullApplication = await storage.getApplicationById(application.id);

        console.log('✅ Application created successfully:', {
          id: fullApplication?.id,
          hasDocuments: !!(fullApplication?.foodSafetyLicenseUrl || fullApplication?.foodEstablishmentCertUrl)
        });

        // Send appropriate email notification for new application
        try {
          if (fullApplication && fullApplication.email) {
            const hasDocuments = !!(fullApplication.foodSafetyLicenseUrl || fullApplication.foodEstablishmentCertUrl);
            
            if (hasDocuments) {
              // Application submitted WITH documents - send combined email
              const emailContent = generateApplicationWithDocumentsEmail({
                fullName: fullApplication.fullName || "Applicant",
                email: fullApplication.email
              });

              await sendEmail(emailContent, {
                trackingId: `app_with_docs_${fullApplication.id}_${Date.now()}`
              });
              console.log(`Application with documents email sent to ${fullApplication.email} for application ${fullApplication.id}`);
            } else {
              // Application submitted WITHOUT documents - prompt to upload
              const emailContent = generateApplicationWithoutDocumentsEmail({
                fullName: fullApplication.fullName || "Applicant",
                email: fullApplication.email
              });

              await sendEmail(emailContent, {
                trackingId: `app_no_docs_${fullApplication.id}_${Date.now()}`
              });
              console.log(`Application without documents email sent to ${fullApplication.email} for application ${fullApplication.id}`);
            }
          } else {
            console.warn(`Cannot send new application email: Application record not found or missing email.`);
          }
        } catch (emailError) {
          // Log the error but don't fail the request
          console.error("Error sending new application email:", emailError);
        }

        console.log('=== APPLICATION SUBMISSION COMPLETE ===');
        return res.status(201).json(application);
      } catch (error) {
        console.error("Error creating application:", error);
        
        // Clean up uploaded files on error (development only)
        if (req.files) {
          const files = req.files as { [fieldname: string]: Express.Multer.File[] };
          Object.values(files).flat().forEach(file => {
            try {
              // Only clean up files if they have a path (development mode)
              if (file.path) {
                fs.unlinkSync(file.path);
              }
            } catch (e) {
              console.error('Error cleaning up file:', e);
            }
          });
        }
        
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

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
    try {
      // Check if user is authenticated and is an admin
      console.log('Status update request - Auth info:', {
        isAuthenticated: req.isAuthenticated(),
        userRole: req.user?.role,
        userId: req.user?.id
      });

      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      // Check if the application exists
      const application = await storage.getApplicationById(id);
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }

      // Validate the request body using Zod schema
      const parsedData = updateApplicationStatusSchema.safeParse({
        id,
        ...req.body
      });

      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        return res.status(400).json({
          message: "Validation error",
          errors: validationError.details
        });
      }

      // Update the application in storage
      const updatedApplication = await storage.updateApplicationStatus(parsedData.data);
      if (!updatedApplication) {
        return res.status(404).json({ message: "Application not found or could not be updated" });
      }

      // Send email notification about status change
      try {
        if (updatedApplication.email) {
          const emailContent = generateStatusChangeEmail({
            fullName: updatedApplication.fullName || "Applicant",
            email: updatedApplication.email,
            status: updatedApplication.status
          });

          await sendEmail(emailContent, {
            trackingId: `status_${updatedApplication.id}_${updatedApplication.status}_${Date.now()}`
          });
          
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

  // Update delivery partner application status endpoint (admin only)
  app.patch("/api/delivery-partner-applications/:id/status", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated and is an admin
      console.log('Delivery partner status update request - Auth info:', {
        isAuthenticated: req.isAuthenticated(),
        userRole: req.user?.role,
        userId: req.user?.id
      });

      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      // Check if the application exists
      const application = await storage.getDeliveryPartnerApplicationById(id);
      if (!application) {
        return res.status(404).json({ message: "Delivery partner application not found" });
      }

      // Validate the request body using Zod schema
      const parsedData = updateDeliveryPartnerApplicationStatusSchema.safeParse({
        id,
        ...req.body
      });

      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        return res.status(400).json({
          message: "Validation error",
          errors: validationError.details
        });
      }

      // Update the application in storage
      const updatedApplication = await storage.updateDeliveryPartnerApplicationStatus(parsedData.data);
      if (!updatedApplication) {
        return res.status(404).json({ message: "Application not found or could not be updated" });
      }

      // Send email notification about status change
      try {
        if (updatedApplication.email) {
          const emailContent = generateDeliveryPartnerStatusChangeEmail({
            fullName: updatedApplication.fullName || "Delivery Partner",
            email: updatedApplication.email,
            status: updatedApplication.status
          });

          await sendEmail(emailContent, {
            trackingId: `delivery_status_${updatedApplication.id}_${updatedApplication.status}_${Date.now()}`
          });
          
          console.log(`Delivery partner status change email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
        } else {
          console.warn(`Cannot send status change email for delivery partner application ${updatedApplication.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending delivery partner status change email:", emailError);
      }

      return res.status(200).json(updatedApplication);
    } catch (error) {
      console.error("Error updating delivery partner application status:", error);
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

      // Send email notification about application cancellation
      try {
        if (updatedApplication.email) {
          const emailContent = generateStatusChangeEmail({
            fullName: updatedApplication.fullName || "Applicant",
            email: updatedApplication.email,
            status: 'cancelled'
          });

          await sendEmail(emailContent, {
            trackingId: `cancel_${updatedApplication.id}_${Date.now()}`
          });
          
          console.log(`Cancellation email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
        } else {
          console.warn(`Cannot send cancellation email for application ${updatedApplication.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending cancellation email:", emailError);
      }

      return res.status(200).json(updatedApplication);
    } catch (error) {
      console.error("Error cancelling application:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Test endpoint for sending status change emails
  app.post("/api/test-status-email", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated and is an admin
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
      }

      const { fullName, email, status } = req.body;

      // Generate and send a test email
      const emailContent = generateStatusChangeEmail({
        fullName: fullName || "Test User",
        email: email || "test@example.com",
        status: status || "approved"
      });

      const emailSent = await sendEmail(emailContent, {
        trackingId: `test_${email}_${status}_${Date.now()}`
      });

      if (emailSent) {
        console.log(`Test status email sent to: ${email}`);
        return res.status(200).json({ message: "Test email sent successfully" });
      } else {
        return res.status(500).json({ message: "Failed to send test email" });
      }
    } catch (error) {
      console.error("Error sending test email:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Test endpoint for sending full verification emails
  app.post("/api/test-verification-email", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated and is an admin
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
      }

      const { fullName, email, phone } = req.body;

      // Generate and send a test verification email
      const { generateFullVerificationEmail } = await import('./email.js');
      const emailContent = generateFullVerificationEmail({
        fullName: fullName || "Test User",
        email: email || "test@example.com",
        phone: phone || "5551234567"
      });

      const emailSent = await sendEmail(emailContent, {
        trackingId: `test_verification_${email}_${Date.now()}`
      });

      if (emailSent) {
        console.log(`Test verification email sent to: ${email}`);
        return res.status(200).json({ message: "Test verification email sent successfully" });
      } else {
        return res.status(500).json({ message: "Failed to send test verification email" });
      }
    } catch (error) {
      console.error("Error sending test verification email:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Test endpoint for sending document status change emails
  app.post("/api/test-document-status-email", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated and is an admin
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
      }

      const { fullName, email, documentType, status, adminFeedback } = req.body;

      // Generate and send a test document status change email
      const emailContent = generateDocumentStatusChangeEmail({
        fullName: fullName || "Test User",
        email: email || "test@example.com",
        documentType: documentType || "foodSafetyLicenseStatus",
        status: status || "approved",
        adminFeedback: adminFeedback || undefined
      });

      const emailSent = await sendEmail(emailContent, {
        trackingId: `test_doc_status_${email}_${documentType}_${status}_${Date.now()}`
      });

      if (emailSent) {
        console.log(`Test document status email sent to: ${email} for ${documentType}: ${status}`);
        return res.status(200).json({ message: "Test document status email sent successfully" });
      } else {
        return res.status(500).json({ message: "Failed to send test document status email" });
      }
    } catch (error) {
      console.error("Error sending test document status email:", error);
      return res.status(500).json({ message: "Internal server error" });
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
        isDeliveryPartner: false // No default roles - user must choose
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

  // Admin login endpoint (for admin dashboard compatibility)
  app.post("/api/admin-login", async (req, res) => {
    try {
      const { username, password } = req.body;

      console.log('Admin login attempt for:', username);

      // Get admin user
      const admin = await storage.getUserByUsername(username);

      if (!admin) {
        console.log('Admin user not found:', username);
        return res.status(401).json({ error: 'Incorrect username or password' });
      }

      // Verify admin role
      if (admin.role !== 'admin') {
        console.log('User is not an admin:', username);
        return res.status(403).json({ error: 'Not authorized as admin' });
      }

      // Check password - first try exact match for 'localcooks'
      let passwordMatches = false;

      if (password === 'localcooks') {
        passwordMatches = true;
        console.log('Admin password matched with hardcoded value');
      } else {
        // Try to compare with database password
        try {
          passwordMatches = await comparePasswords(password, admin.password);
          console.log('Admin password compared with stored hash:', passwordMatches);
        } catch (error) {
          console.error('Error comparing passwords:', error);
        }
      }

      if (!passwordMatches) {
        return res.status(401).json({ error: 'Incorrect username or password' });
      }

      console.log('Admin login successful for:', username);

      // Use Passport.js login to set session
      req.login(admin, (err) => {
        if (err) {
          console.error('Error setting session:', err);
          return res.status(500).json({ error: 'Session creation failed' });
        }

        // Remove sensitive info
        const { password: _, ...adminWithoutPassword } = admin;

        // Return user data
        return res.status(200).json(adminWithoutPassword);
      });
    } catch (error) {
      console.error('Admin login error:', error);
      res.status(500).json({ error: 'Admin login failed', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Check if user exists by username (for Google+password flow)
  app.get("/api/user-exists", async (req, res) => {
    const username = req.query.username as string;
    if (!username) {
      return res.status(400).json({ error: "Username required" });
    }
    const user = await storage.getUserByUsername(username);
    res.json({ exists: !!user });
  });

  // ===============================
  // FILE UPLOAD ROUTES
  // ===============================

  // Generic file upload endpoint (for use with new upload components)
  app.post("/api/upload-file", 
    upload.single('file'), 
    async (req: Request, res: Response) => {
      try {
        // Check if user is authenticated
        if (!req.isAuthenticated()) {
          // Clean up uploaded file (development only)
          if (req.file && req.file.path) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (e) {
              console.error('Error cleaning up file:', e);
            }
          }
          return res.status(401).json({ error: "Not authenticated" });
        }

        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
        let fileUrl: string;
        let fileName: string;

        if (isProduction) {
          // Upload to Vercel Blob in production
          fileUrl = await uploadToBlob(req.file, req.user!.id);
          // Extract filename from Vercel Blob URL for response
          fileName = fileUrl.split('/').pop() || req.file.originalname;
        } else {
          // Use local storage in development
          fileUrl = getFileUrl(req.file.filename);
          fileName = req.file.filename;
        }

        // Return success response with file information
        return res.status(200).json({
          success: true,
          url: fileUrl,
          fileName: fileName,
          size: req.file.size,
          type: req.file.mimetype
        });
      } catch (error) {
        console.error("File upload error:", error);
        
        // Clean up uploaded file on error (development only)
        if (req.file && req.file.path) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (e) {
            console.error('Error cleaning up file:', e);
          }
        }
        
        return res.status(500).json({ 
          error: "File upload failed",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  // FILE SERVING ROUTES
  // ===============================

  // Serve uploaded document files
  app.get("/api/files/documents/:filename", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const filename = req.params.filename;
      const filePath = path.join(process.cwd(), 'uploads', 'documents', filename);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found" });
      }

      // Extract userId from filename (format: userId_documentType_timestamp_originalname)
      const fileUserId = parseInt(filename.split('_')[0]);
      
      // Allow access if user owns the file or is admin
      if (req.user!.id !== fileUserId && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get file info
      const stat = fs.statSync(filePath);
      const ext = path.extname(filename).toLowerCase();
      
      // Set appropriate content type
      let contentType = 'application/octet-stream';
      if (ext === '.pdf') {
        contentType = 'application/pdf';
      } else if (['.jpg', '.jpeg'].includes(ext)) {
        contentType = 'image/jpeg';
      } else if (ext === '.png') {
        contentType = 'image/png';
      } else if (ext === '.webp') {
        contentType = 'image/webp';
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      
      // Stream the file
      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
    } catch (error) {
      console.error("Error serving file:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===============================
  // APPLICATION DOCUMENT ROUTES
  // ===============================

  // Update application documents endpoint (for approved applicants)
  app.patch("/api/applications/:id/documents", 
    (req, res, next) => {
      // Check content type to decide whether to use multer
      const contentType = req.get('Content-Type') || '';
      
      if (contentType.includes('multipart/form-data')) {
        // Use multer for file uploads
        const fileUploadMiddleware = upload.fields([
          { name: 'foodSafetyLicense', maxCount: 1 },
          { name: 'foodEstablishmentCert', maxCount: 1 }
        ]);
        fileUploadMiddleware(req, res, next);
      } else {
        // Skip multer for JSON requests
        next();
      }
    },
    async (req: Request, res: Response) => {
      try {
        // Check if user is authenticated
        if (!req.isAuthenticated()) {
          return res.status(401).json({ message: "Not authenticated" });
        }

        const applicationId = parseInt(req.params.id);
        if (isNaN(applicationId)) {
          return res.status(400).json({ message: "Invalid application ID" });
        }

        // Get the application to verify ownership and status
        const application = await storage.getApplicationById(applicationId);
        if (!application) {
          // Clean up uploaded files
          if (req.files) {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            Object.values(files).flat().forEach(file => {
              try {
                fs.unlinkSync(file.path);
              } catch (e) {
                console.error('Error cleaning up file:', e);
              }
            });
          }
          return res.status(404).json({ message: "Application not found" });
        }

        // Check if user owns the application or is admin
        if (application.userId !== req.user!.id && req.user!.role !== "admin") {
          // Clean up uploaded files
          if (req.files) {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            Object.values(files).flat().forEach(file => {
              try {
                fs.unlinkSync(file.path);
              } catch (e) {
                console.error('Error cleaning up file:', e);
              }
            });
          }
          return res.status(403).json({ message: "Access denied" });
        }

        // Check if application status allows document uploads
        if (application.status === 'cancelled' || application.status === 'rejected') {
          // Clean up uploaded files
          if (req.files) {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            Object.values(files).flat().forEach(file => {
              try {
                fs.unlinkSync(file.path);
              } catch (e) {
                console.error('Error cleaning up file:', e);
              }
            });
          }
          return res.status(400).json({ 
            message: "Document uploads are not permitted for cancelled or rejected applications",
            applicationStatus: application.status
          });
        }

        const updateData: any = {
          id: applicationId,
        };

        // Check if this is a file upload request or JSON request
        const contentType = req.get('Content-Type') || '';
        const isFileUpload = contentType.includes('multipart/form-data');

        if (isFileUpload) {
          // Handle multipart file uploads
          const files = req.files as { [fieldname: string]: Express.Multer.File[] };
          const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

          // Handle food safety license file
          if (files && files.foodSafetyLicense && files.foodSafetyLicense[0]) {
            // Delete old file if it exists and is a file path (not URL) - development only
            if (!isProduction && application.foodSafetyLicenseUrl && application.foodSafetyLicenseUrl.startsWith('/api/files/')) {
              const oldFilename = application.foodSafetyLicenseUrl.split('/').pop();
              if (oldFilename) {
                const oldFilePath = path.join(process.cwd(), 'uploads', 'documents', oldFilename);
                deleteFile(oldFilePath);
              }
            }
            
            if (isProduction) {
              updateData.foodSafetyLicenseUrl = await uploadToBlob(files.foodSafetyLicense[0], req.user!.id);
            } else {
              const filename = files.foodSafetyLicense[0].filename;
              updateData.foodSafetyLicenseUrl = getFileUrl(filename);
            }
          }

          // Handle food establishment cert file  
          if (files && files.foodEstablishmentCert && files.foodEstablishmentCert[0]) {
            // Delete old file if it exists and is a file path (not URL) - development only
            if (!isProduction && application.foodEstablishmentCertUrl && application.foodEstablishmentCertUrl.startsWith('/api/files/')) {
              const oldFilename = application.foodEstablishmentCertUrl.split('/').pop();
              if (oldFilename) {
                const oldFilePath = path.join(process.cwd(), 'uploads', 'documents', oldFilename);
                deleteFile(oldFilePath);
              }
            }
            
            if (isProduction) {
              updateData.foodEstablishmentCertUrl = await uploadToBlob(files.foodEstablishmentCert[0], req.user!.id);
            } else {
              const filename = files.foodEstablishmentCert[0].filename;
              updateData.foodEstablishmentCertUrl = getFileUrl(filename);
            }
          }

          // Handle URL inputs from form data if no files uploaded
          if (req.body.foodSafetyLicenseUrl && !updateData.foodSafetyLicenseUrl) {
            updateData.foodSafetyLicenseUrl = req.body.foodSafetyLicenseUrl;
          }

          if (req.body.foodEstablishmentCertUrl && !updateData.foodEstablishmentCertUrl) {
            updateData.foodEstablishmentCertUrl = req.body.foodEstablishmentCertUrl;
          }
        } else {
          // Handle JSON requests (from our new upload system)
          if (req.body.foodSafetyLicenseUrl) {
            updateData.foodSafetyLicenseUrl = req.body.foodSafetyLicenseUrl;
          }

          if (req.body.foodEstablishmentCertUrl) {
            updateData.foodEstablishmentCertUrl = req.body.foodEstablishmentCertUrl;
          }
        }

        // Update the application documents
        const updatedApplication = await storage.updateApplicationDocuments(updateData);

        if (!updatedApplication) {
          return res.status(404).json({ message: "Failed to update application documents" });
        }

        return res.status(200).json(updatedApplication);
      } catch (error) {
        console.error("Error updating application documents:", error);
        
        // Clean up uploaded files on error
        if (req.files) {
          const files = req.files as { [fieldname: string]: Express.Multer.File[] };
          Object.values(files).flat().forEach(file => {
            try {
              fs.unlinkSync(file.path);
            } catch (e) {
              console.error('Error cleaning up file:', e);
            }
          });
        }
        
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // Update application document verification status (admin only)
  app.patch("/api/applications/:id/document-verification", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated and is an admin
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.user!.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
      }

      const applicationId = parseInt(req.params.id);
      if (isNaN(applicationId)) {
        return res.status(400).json({ message: "Invalid application ID" });
      }

      // Validate the request body using Zod schema
      const parsedData = updateDocumentVerificationSchema.safeParse({
        id: applicationId,
        ...req.body,
        documentsReviewedBy: req.user!.id
      });

      if (!parsedData.success) {
        const validationError = fromZodError(parsedData.error);
        return res.status(400).json({
          message: "Validation error",
          errors: validationError.details
        });
      }

      // Update the application document verification
      const updatedApplication = await storage.updateApplicationDocumentVerification(parsedData.data);

      if (!updatedApplication) {
        return res.status(404).json({ message: "Application not found" });
      }

      console.log(`Document verification updated for application ${applicationId}:`, {
        foodSafetyLicenseStatus: updatedApplication.foodSafetyLicenseStatus,
        foodEstablishmentCertStatus: updatedApplication.foodEstablishmentCertStatus,
        reviewedBy: parsedData.data.documentsReviewedBy,
        timestamp: new Date().toISOString()
      });

      // Check if both documents are approved, then update user verification status
      if (updatedApplication.foodSafetyLicenseStatus === "approved" && 
          (!updatedApplication.foodEstablishmentCertUrl || updatedApplication.foodEstablishmentCertStatus === "approved")) {
        await storage.updateUserVerificationStatus(updatedApplication.userId!, true);
        console.log(`User ${updatedApplication.userId} has been fully verified`);
        
        // NOTE: Full verification email is handled by api/index.js in production
        // Removed duplicate email logic to prevent double emails
      }

      // Send email notification for document status changes
      try {
        if (updatedApplication.email) {
          // Send email for each document that was updated
          if (req.body.foodSafetyLicenseStatus) {
            const emailContent = generateDocumentStatusChangeEmail({
              fullName: updatedApplication.fullName || "Applicant",
              email: updatedApplication.email,
              documentType: "foodSafetyLicenseStatus",
              status: req.body.foodSafetyLicenseStatus,
              adminFeedback: req.body.documentsAdminFeedback
            });

            await sendEmail(emailContent, {
              trackingId: `doc_status_fsl_${updatedApplication.id}_${req.body.foodSafetyLicenseStatus}_${Date.now()}`
            });
            
            console.log(`Food Safety License status email sent to ${updatedApplication.email} for application ${updatedApplication.id}: ${req.body.foodSafetyLicenseStatus}`);
          }

          if (req.body.foodEstablishmentCertStatus) {
            const emailContent = generateDocumentStatusChangeEmail({
              fullName: updatedApplication.fullName || "Applicant",
              email: updatedApplication.email,
              documentType: "foodEstablishmentCertStatus",
              status: req.body.foodEstablishmentCertStatus,
              adminFeedback: req.body.documentsAdminFeedback
            });

            await sendEmail(emailContent, {
              trackingId: `doc_status_fec_${updatedApplication.id}_${req.body.foodEstablishmentCertStatus}_${Date.now()}`
            });
            
            console.log(`Food Establishment Certificate status email sent to ${updatedApplication.email} for application ${updatedApplication.id}: ${req.body.foodEstablishmentCertStatus}`);
          }
        } else {
          console.warn(`Cannot send document status change email for application ${updatedApplication.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending document status change email:", emailError);
      }

      return res.status(200).json(updatedApplication);
    } catch (error) {
      console.error("Error updating application document verification:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===============================
  // MICROLEARNING ROUTES
  // ===============================

  // Helper function to check if user has approved application
  const hasApprovedApplication = async (userId: number): Promise<boolean> => {
    try {
      const applications = await storage.getApplicationsByUserId(userId);
      return applications.some(app => app.status === 'approved');
    } catch (error) {
      console.error('Error checking application status:', error);
      return false;
    }
  };

  // Get user's microlearning access level and progress
  app.get("/api/microlearning/progress/:userId", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const userId = parseInt(req.params.userId);
      
      // Verify user can access this data (either their own or admin)
      if (req.user!.id !== userId && req.user!.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      const progress = await storage.getMicrolearningProgress(userId);
      const completionStatus = await storage.getMicrolearningCompletion(userId);
      const hasApproval = await hasApprovedApplication(userId);
      
      // Admins and completed users have unrestricted access regardless of application status
      const isAdmin = req.user!.role === 'admin';
      const isCompleted = completionStatus?.confirmed || false;
      const accessLevel = isAdmin || hasApproval || isCompleted ? 'full' : 'limited';

      res.json({
        success: true,
        progress: progress || [],
        completionConfirmed: completionStatus?.confirmed || false,
        completedAt: completionStatus?.completedAt,
        hasApprovedApplication: hasApproval,
        accessLevel: accessLevel, // admins get full access, others limited to first video only
        isAdmin: isAdmin
      });
    } catch (error) {
      console.error('Error fetching microlearning progress:', error);
      res.status(500).json({ message: 'Failed to fetch progress' });
    }
  });

  // Update video progress
  app.post("/api/microlearning/progress", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const { userId, videoId, progress, completed, completedAt, watchedPercentage } = req.body;
      
      // Verify user can update this data (either their own or admin)
      if (req.user!.id !== userId && req.user!.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Check if user has approved application for videos beyond the first one
      const hasApproval = await hasApprovedApplication(userId);
      const completionStatus = await storage.getMicrolearningCompletion(userId);
      const isCompleted = completionStatus?.confirmed || false;
      const firstVideoId = 'basics-cross-contamination'; // First video that everyone can access
      const isAdmin = req.user!.role === 'admin';
      
      // Admins and completed users have unrestricted access to all videos
      if (!hasApproval && !isAdmin && !isCompleted && videoId !== firstVideoId) {
        return res.status(403).json({ 
          message: 'Application approval required to access this video',
          accessLevel: 'limited',
          firstVideoOnly: true
        });
      }

      // Accept completion status as provided
      const actualCompleted = completed;

      const progressData = {
        userId,
        videoId,
        progress: Math.max(0, Math.min(100, progress)), // Clamp between 0-100
        watchedPercentage: Math.max(0, Math.min(100, watchedPercentage || 0)), // Clamp between 0-100
        completed: actualCompleted,
        completedAt: actualCompleted ? (completedAt ? new Date(completedAt) : new Date()) : null,
        updatedAt: new Date()
      };

      await storage.updateVideoProgress(progressData);

      res.json({
        success: true,
        message: 'Progress updated successfully'
      });
    } catch (error) {
      console.error('Error updating video progress:', error);
      res.status(500).json({ message: 'Failed to update progress' });
    }
  });

  // Complete microlearning and integrate with Always Food Safe
  app.post("/api/microlearning/complete", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const { userId, completionDate, videoProgress } = req.body;
      
      // Verify user can complete this (either their own or admin)
      if (req.user!.id !== userId && req.user!.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Check if user has approved application to complete full training
      const hasApproval = await hasApprovedApplication(userId);
      const isAdmin = req.user!.role === 'admin';
      
      // Admins can complete certification without application approval
      // Regular users need approval unless they're completing as admin
      if (!hasApproval && !isAdmin) {
        return res.status(403).json({ 
          message: 'Application approval required to complete full certification',
          accessLevel: 'limited',
          requiresApproval: true
        });
      }

      // Verify all required videos are completed (2 comprehensive modules)
      const requiredVideos = [
        // Food Safety Basics Module (14 videos)
        'basics-personal-hygiene', 'basics-temperature-danger', 'basics-cross-contamination',
        'basics-allergen-awareness', 'basics-food-storage', 'basics-cooking-temps',
        'basics-cooling-reheating', 'basics-thawing', 'basics-receiving', 'basics-fifo',
        'basics-illness-reporting', 'basics-pest-control', 'basics-chemical-safety', 'basics-food-safety-plan',
        // Safety and Hygiene How-To's Module (8 videos)
        'howto-handwashing', 'howto-sanitizing', 'howto-thermometer', 'howto-cleaning-schedule',
        'howto-equipment-cleaning', 'howto-uniform-care', 'howto-wound-care', 'howto-inspection-prep'
      ];
      const completedVideos = videoProgress.filter((v: any) => v.completed).map((v: any) => v.videoId);
      const allRequired = requiredVideos.every((videoId: string) => completedVideos.includes(videoId));

      if (!allRequired) {
        return res.status(400).json({ 
          message: 'All required videos must be completed before certification',
          missingVideos: requiredVideos.filter(id => !completedVideos.includes(id))
        });
      }

      // Get user details for certificate generation
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Create completion record
      const completionData = {
        userId,
        completedAt: new Date(completionDate),
        videoProgress,
        confirmed: true,
        certificateGenerated: false
      };

      await storage.createMicrolearningCompletion(completionData);

      // Integration with Always Food Safe API (if configured)
      let alwaysFoodSafeResult = null;
      if (isAlwaysFoodSafeConfigured()) {
        try {
          alwaysFoodSafeResult = await submitToAlwaysFoodSafe({
            userId,
            userName: user.username,
            email: `${user.username}@localcooks.ca`, // Placeholder email since User type doesn't have email
            completionDate: new Date(completionDate),
            videoProgress
          });
        } catch (afsError) {
          console.error('Always Food Safe API error:', afsError);
          // Don't fail the request, just log the error
        }
      }
      
      res.json({
        success: true,
        message: 'Microlearning completed successfully',
        completionConfirmed: true,
        alwaysFoodSafeIntegration: alwaysFoodSafeResult?.success ? 'success' : 'not_configured',
        certificateId: alwaysFoodSafeResult?.certificateId,
        certificateUrl: alwaysFoodSafeResult?.certificateUrl
      });
    } catch (error) {
      console.error('Error completing microlearning:', error);
      res.status(500).json({ message: 'Failed to complete microlearning' });
    }
  });

  // Get microlearning completion status
  app.get("/api/microlearning/completion/:userId", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const userId = parseInt(req.params.userId);
      
      // Verify user can access this completion (either their own or admin)
      if (req.user!.id !== userId && req.user!.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      const completion = await storage.getMicrolearningCompletion(userId);
      
      if (!completion) {
        return res.status(404).json({ message: 'No completion found' });
      }

      res.json(completion);
    } catch (error) {
      console.error('Error getting microlearning completion status:', error);
      res.status(500).json({ message: 'Failed to get completion status' });
    }
  });

  // Generate and download certificate
  app.get("/api/microlearning/certificate/:userId", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const userId = parseInt(req.params.userId);
      
      // Verify user can access this certificate (either their own or admin)
      if (req.user!.id !== userId && req.user!.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
      }

      const completion = await storage.getMicrolearningCompletion(userId);
      if (!completion || !completion.confirmed) {
        return res.status(404).json({ message: 'No confirmed completion found' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // For now, return a placeholder certificate URL
      const certificateUrl = `/api/certificates/microlearning-${userId}-${Date.now()}.pdf`;

      res.json({
        success: true,
        certificateUrl,
        completionDate: completion.completedAt,
        message: 'Certificate for skillpass.nl food safety training preparation - Complete your official certification at skillpass.nl'
      });
    } catch (error) {
      console.error('Error generating certificate:', error);
      res.status(500).json({ message: 'Failed to generate certificate' });
    }
  });

  // REMOVED: Duplicate test endpoint - keeping only the first one at line 542

  // Password reset request endpoint - TEMPORARILY DISABLED DUE TO INCOMPLETE IMPLEMENTATION
  /*
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Check if user exists
      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if user exists or not for security
        return res.status(200).json({ 
          message: "If an account with this email exists, you will receive a password reset link." 
        });
      }

      // Generate reset token (expires in 1 hour)
      const crypto = await import('crypto');
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now
      
      // Store reset token in database
      await storage.storePasswordResetToken(user.id, resetToken, resetTokenExpiry);

      // Generate reset URL
      const resetUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/auth/reset-password?token=${resetToken}`;

      // Send password reset email
      const { generatePasswordResetEmail } = await import('./email.js');
      const emailContent = generatePasswordResetEmail({
        fullName: user.displayName || user.username,
        email: user.email,
        resetToken,
        resetUrl
      });

      const emailSent = await sendEmail(emailContent, {
        trackingId: `password_reset_${user.id}_${Date.now()}`
      });

      if (emailSent) {
        console.log(`Password reset email sent to ${email}`);
        return res.status(200).json({ 
          message: "If an account with this email exists, you will receive a password reset link." 
        });
      } else {
        console.error(`Failed to send password reset email to ${email}`);
        return res.status(500).json({ 
          message: "Error sending password reset email. Please try again later." 
        });
      }
    } catch (error) {
      console.error("Error in forgot password:", error);
      return res.status(500).json({ 
        message: "Internal server error. Please try again later." 
      });
    }
  });
  */

  // Password reset confirmation endpoint - TEMPORARILY DISABLED DUE TO INCOMPLETE IMPLEMENTATION
  /*
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      // Validate password strength
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }

      // Verify reset token and get user
      const user = await storage.getUserByResetToken(token);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Update password
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await storage.updateUserPassword(user.id, hashedPassword);

      // Clear reset token
      await storage.clearPasswordResetToken(user.id);

      console.log(`Password successfully reset for user ${user.id}`);
      return res.status(200).json({ message: "Password reset successfully" });

    } catch (error) {
      console.error("Error in reset password:", error);
      return res.status(500).json({ 
        message: "Internal server error. Please try again later." 
      });
    }
  });
  */

  // Email verification endpoint - RE-ENABLED FOR EMAIL VERIFICATION FLOW
  app.post("/api/auth/send-verification-email", async (req: Request, res: Response) => {
    try {
      const { email, fullName } = req.body;

      if (!email || !fullName) {
        return res.status(400).json({ message: "Email and full name are required" });
      }

      // Generate verification token
      const crypto = await import('crypto');
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationTokenExpiry = new Date(Date.now() + 86400000); // 24 hours from now
      
      // Store verification token in database directly (bypassing storage interface for now)
      const { pool } = await import('./db.js');
      await pool.query(`
        INSERT INTO email_verification_tokens (email, token, expires_at, created_at) 
        VALUES ($1, $2, $3, NOW()) 
        ON CONFLICT (email) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()
      `, [email, verificationToken, verificationTokenExpiry]);

      // Generate verification URL
      const verificationUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/auth/verify-email?token=${verificationToken}`;

      // Send verification email
      const { sendEmail, generateEmailVerificationEmail } = await import('./email.js');
      const emailContent = generateEmailVerificationEmail({
        fullName,
        email,
        verificationToken,
        verificationUrl
      });

      const emailSent = await sendEmail(emailContent, {
        trackingId: `email_verification_${email}_${Date.now()}`
      });

      if (emailSent) {
        console.log(`Email verification sent to ${email}`);
        return res.status(200).json({ 
          message: "Verification email sent successfully" 
        });
      } else {
        console.error(`Failed to send verification email to ${email}`);
        return res.status(500).json({ 
          message: "Error sending verification email. Please try again later." 
        });
      }
    } catch (error) {
      console.error("Error sending verification email:", error);
      return res.status(500).json({ 
        message: "Internal server error. Please try again later." 
      });
    }
  });

  // Email verification confirmation endpoint - RE-ENABLED FOR EMAIL VERIFICATION FLOW
  app.get("/api/auth/verify-email", async (req: Request, res: Response) => {
    try {
      const { token } = req.query;

      if (!token || typeof token !== 'string') {
        return res.status(400).json({ message: "Verification token is required" });
      }

      // Verify token and get email - using direct database query
      const { pool } = await import('./db.js');
      const result = await pool.query(
        'SELECT email FROM email_verification_tokens WHERE token = $1 AND expires_at > NOW()',
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ message: "Invalid or expired verification token" });
      }

      const { email } = result.rows[0];

      // Mark email as verified - need to update Firebase user too
      await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE email = $1', [email]);

      // Also update the user in the users table (using Firebase UID)
      await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE email = $1', [email]);

      // Clear verification token
      await pool.query('DELETE FROM email_verification_tokens WHERE token = $1', [token]);

      console.log(`Email verified successfully: ${email}`);
      
      // Redirect to success page
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:5000'}/auth?verified=true`);

    } catch (error) {
      console.error("Error in email verification:", error);
      return res.status(500).json({ 
        message: "Internal server error. Please try again later." 
      });
    }
  });

    // NOTE: Firebase user sync endpoint has been moved to firebase-routes.ts with proper authentication
  // This old endpoint has been removed to prevent conflicts

  // Admin endpoint to send promo emails
  app.post('/api/admin/send-promo-email', async (req: Request, res: Response) => {
    try {
      console.log(`POST /api/admin/send-promo-email - Session ID: ${req.sessionID}, User ID: ${req.user?.id}`);
      
      // Check if user is authenticated
      if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
        console.log('Promo email request - User not authenticated');
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Check if user is admin
      if (req.user.role !== 'admin') {
        console.log(`Promo email request - User ${req.user.id} is not admin (role: ${req.user.role})`);
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { 
        email, 
        customEmails,
        emailMode,
        recipients,
        promoCode, 
        promoCodeLabel, 
        message, 
        customMessage, 
        greeting,
        buttonText, 
        orderUrl, 
        subject, 
        previewText,
        designSystem,
        isPremium,
        sections,
        header,
        footer,
        usageSteps,
        emailContainer,
        dividers,
        promoCodeStyling,
        promoStyle,
        customDesign
      } = req.body;

      // Handle both customMessage and message fields (different frontend components use different names)
      const messageContent = customMessage || message;

      console.log('Promo email request - Auth info:', {
        sessionUserId: req.user?.id,
        headerUserId: req.headers['user-id'],
        rawUserId: req.user?.id
      });

      // Determine target emails - support both old and new formats
      let targetEmails: string[] = [];
      
      if (recipients && Array.isArray(recipients) && recipients.length > 0) {
        // New unified format - extract emails from recipients array
        targetEmails = recipients.map((recipient: any) => 
          typeof recipient === 'string' ? recipient : recipient.email
        ).filter(Boolean);
      } else if (emailMode === 'custom' && customEmails && Array.isArray(customEmails)) {
        // Old custom email format
        targetEmails = customEmails;
      } else if (email) {
        // Old single email format
        targetEmails = [email];
      }

      // Validate that we have at least one email
      if (targetEmails.length === 0) {
        console.log('Promo email request - No valid email addresses provided');
        return res.status(400).json({ error: 'At least one email address is required' });
      }

      // Promo code is now optional - if empty, it will be a general company email
      if (promoCode && promoCode.length > 0 && promoCode.length < 3) {
        console.log('Promo email request - Invalid promo code length');
        return res.status(400).json({ error: 'Promo code must be at least 3 characters long if provided' });
      }

      if (!messageContent || messageContent.length < 10) {
        console.log('Promo email request - Invalid message:', { 
          customMessage: customMessage?.substring(0, 50), 
          message: message?.substring(0, 50),
          messageContent: messageContent?.substring(0, 50)
        });
        return res.status(400).json({ error: 'Message must be at least 10 characters' });
      }

      console.log('Promo email request - Validation passed, generating email');

      console.log(`Promo email request - Sending to ${targetEmails.length} recipient(s)`);

      // Send emails to all recipients
      const results = [];
      let successCount = 0;
      let failureCount = 0;

      for (const targetEmail of targetEmails) {
        try {
          // Generate promo code email for each recipient
          const emailContent = generatePromoCodeEmail({
            email: targetEmail,
            promoCode,
            promoCodeLabel: promoCodeLabel || '🎁 Special Offer Code For You',
            customMessage: messageContent,
            greeting: greeting || 'Hi there! 👋',
            subject: subject || 'Special Offer from Local Cooks',
            previewText: previewText || 'Don\'t miss out on this exclusive offer',
            designSystem,
            isPremium: isPremium || true,
            sections: sections || [],
            header: header || {
              title: 'Local Cooks Header',
              subtitle: 'Premium Quality Food Subheader',
              styling: {
                backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                titleColor: '#ffffff',
                subtitleColor: '#ffffff',
                titleFontSize: '32px',
                subtitleFontSize: '18px',
                          padding: '24px',
              borderRadius: '0px',
              textAlign: 'center'
            }
          },
          footer: footer || {
            mainText: 'Thank you for being part of the Local Cooks community!',
            contactText: 'Questions? Contact us at support@localcooks.com',
            copyrightText: '© 2024 Local Cooks. All rights reserved.',
            showContact: true,
            showCopyright: true,
            styling: {
              backgroundColor: '#f8fafc',
              textColor: '#64748b',
              linkColor: '#F51042',
              fontSize: '14px',
              padding: '24px 32px',
              textAlign: 'center',
              borderColor: '#e2e8f0'
            }
          },
          usageSteps: usageSteps || {
            title: '🚀 How to use your promo code:',
            steps: [
              `Visit our website: <a href="${orderUrl || 'https://localcooks.ca'}" style="color: #1d4ed8;">${orderUrl || 'https://localcooks.ca'}</a>`,
                'Browse our amazing local cooks and their delicious offerings',
                'Apply your promo code during checkout',
                'Enjoy your special offer!'
              ],
              enabled: true,
              styling: {
                backgroundColor: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                borderColor: '#93c5fd',
                titleColor: '#1d4ed8',
                textColor: '#1e40af',
                linkColor: '#1d4ed8',
                padding: '20px',
                borderRadius: '8px'
              }
            },
            emailContainer: emailContainer || {
              maxWidth: '600px',
              backgroundColor: '#f1f5f9',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
            },
            dividers: dividers || {
              enabled: true,
              style: 'solid',
              color: '#e2e8f0',
              thickness: '1px',
              margin: '24px 0',
              opacity: '1'
            },
            promoCodeStyling: promoCodeStyling,
            promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
            orderButton: {
              text: buttonText || '🌟 Start Shopping Now',
              url: orderUrl || 'https://localcooks.ca',
              styling: {
                backgroundColor: '#F51042',
                color: '#ffffff',
                fontSize: '16px',
                fontWeight: '600',
                padding: '12px 24px',
                borderRadius: '8px',
                textAlign: 'center'
              }
            }
          });

          // Send email
          const emailSent = await sendEmail(emailContent, {
            trackingId: `promo_email_${targetEmail}_${Date.now()}`
          });

          if (emailSent) {
            console.log(`Promo email sent successfully to ${targetEmail}`);
            results.push({ email: targetEmail, status: 'success' });
            successCount++;
          } else {
            console.error(`Failed to send promo email to ${targetEmail}`);
            results.push({ email: targetEmail, status: 'failed', error: 'Email sending failed' });
            failureCount++;
          }
        } catch (error) {
          console.error(`Error sending promo email to ${targetEmail}:`, error);
          results.push({ email: targetEmail, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' });
          failureCount++;
        }
      }

      // Return results
      if (successCount > 0) {
        res.json({ 
          success: true, 
          message: `Promo emails sent: ${successCount} successful, ${failureCount} failed`,
          results: results,
          promoCode,
          summary: {
            total: targetEmails.length,
            successful: successCount,
            failed: failureCount
          }
        });
      } else {
        res.status(500).json({ 
          error: 'All email sending failed',
          message: 'Failed to send promo emails to any recipients.',
          results: results
        });
      }
    } catch (error) {
      console.error('Error sending promo email:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Test endpoint for admin to test email sending
  app.post('/api/admin/test-email', async (req: Request, res: Response) => {
    try {
      console.log(`POST /api/admin/test-email - Session ID: ${req.sessionID}, User ID: ${req.user?.id}`);
      
      // Check if user is authenticated
      if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
        console.log('Test email request - User not authenticated');
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Check if user is admin
      if (req.user.role !== 'admin') {
        console.log(`Test email request - User ${req.user.id} is not admin (role: ${req.user.role})`);
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { 
        email, 
        subject, 
        previewText, 
        sections, 
        header, 
        footer,
        usageSteps,
        emailContainer,
        customDesign 
      } = req.body;

      // Validate required fields
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      console.log('Test email request - Validation passed, generating test email');

      // Generate a simple test email
      const emailContent = generatePromoCodeEmail({
        email,
        promoCode: 'TEST123',
        promoCodeLabel: '🎁 Test Promo Code',
        customMessage: 'This is a test email to verify the email system is working correctly.',
        greeting: 'Hello! 👋',
        subject: subject || 'Test Email from Local Cooks',
        previewText: previewText || 'Test email preview',
        designSystem: customDesign?.designSystem,
        isPremium: true,
        sections: sections || [],
        header: header || {
          title: 'Local Cooks Header',
          subtitle: 'Premium Quality Food Subheader',
          styling: {
            backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
            titleColor: '#ffffff',
            subtitleColor: '#ffffff',
            titleFontSize: '32px',
            subtitleFontSize: '18px',
            padding: '24px',
            borderRadius: '0px',
            textAlign: 'center'
          }
        },
        footer: footer || {
          mainText: 'Thank you for being part of the Local Cooks community!',
          contactText: 'Questions? Contact us at support@localcooks.com',
          copyrightText: '© 2024 Local Cooks. All rights reserved.',
          showContact: true,
          showCopyright: true,
          styling: {
            backgroundColor: '#f8fafc',
            textColor: '#64748b',
            linkColor: '#F51042',
            fontSize: '14px',
            padding: '24px 32px',
            textAlign: 'center',
            borderColor: '#e2e8f0'
          }
        },
        usageSteps: usageSteps || {
          title: '🚀 How to use your promo code:',
          steps: [
            'Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>',
            'Browse our amazing local cooks and their delicious offerings',
            'Apply your promo code during checkout',
            'Enjoy your special offer!'
          ],
          enabled: true,
          styling: {
            backgroundColor: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
            borderColor: '#93c5fd',
            titleColor: '#1d4ed8',
            textColor: '#1e40af',
            linkColor: '#1d4ed8',
            padding: '20px',
            borderRadius: '8px'
          }
        },
        emailContainer: emailContainer || {
          maxWidth: '600px',
          backgroundColor: '#f1f5f9',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
        },
        dividers: {
          enabled: true,
          style: 'solid',
          color: '#e2e8f0',
          thickness: '1px',
          margin: '24px 0',
          opacity: '1'
        },
        promoStyle: { colorTheme: 'green', borderStyle: 'dashed' },
        orderButton: {
          text: '🌟 Test Order Button',
          url: 'https://localcooks.ca',
          styling: {
            backgroundColor: '#F51042',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: '600',
            padding: '12px 24px',
            borderRadius: '8px',
            textAlign: 'center'
          }
        }
      });

      // Send test email
      const emailSent = await sendEmail(emailContent, {
        trackingId: `test_email_${email}_${Date.now()}`
      });

      if (emailSent) {
        console.log(`Test email sent successfully to ${email}`);
        res.json({ 
          success: true, 
          message: 'Test email sent successfully',
          recipient: email
        });
      } else {
        console.error(`Failed to send test email to ${email}`);
        res.status(500).json({ 
          error: 'Failed to send email',
          message: 'Email service unavailable'
        });
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Endpoint to set has_seen_welcome = true for the current user
  app.post('/api/user/seen-welcome', async (req, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const user = req.user;
      await storage.setUserHasSeenWelcome(user.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error setting has_seen_welcome:', error);
      res.status(500).json({ error: 'Failed to update welcome status' });
    }
  });

  // Unsubscribe endpoint - public endpoint for email unsubscribe requests
  app.post('/api/unsubscribe', async (req: Request, res: Response) => {
    try {
      const { email, reason, feedback, timestamp } = req.body;

      if (!email) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email address is required' 
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid email format' 
        });
      }

      // Create unsubscribe notification email content
      const unsubscribeNotificationContent = {
        to: 'localcooks@localcook.shop',
        subject: `🚫 Unsubscribe Request - ${email}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <div style="background: linear-gradient(135deg, #F51042 0%, #FF5470 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Local Cooks - Unsubscribe Request</h1>
            </div>
            
            <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #1f2937; margin-top: 0;">New Unsubscribe Request</h2>
              
              <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #dc2626; font-weight: 600;">
                  📧 Email: <span style="font-weight: normal;">${email}</span>
                </p>
              </div>
              
              <div style="margin: 20px 0;">
                <h3 style="color: #374151; margin-bottom: 10px;">Request Details:</h3>
                <ul style="color: #6b7280; line-height: 1.6;">
                  <li><strong>Timestamp:</strong> ${new Date(timestamp).toLocaleString()}</li>
                  <li><strong>Reason:</strong> ${reason || 'Not specified'}</li>
                  ${feedback ? `<li><strong>Feedback:</strong> ${feedback}</li>` : ''}
                </ul>
              </div>
              
              <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 6px; padding: 15px; margin: 20px 0;">
                <h4 style="color: #0369a1; margin: 0 0 10px 0;">Action Required:</h4>
                <p style="color: #0c4a6e; margin: 0; font-size: 14px;">
                  Please manually remove <strong>${email}</strong> from all email lists and marketing databases within 24 hours.
                </p>
              </div>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  This is an automated notification from the Local Cooks unsubscribe system.
                </p>
              </div>
            </div>
          </div>
        `,
        text: `
          Local Cooks - Unsubscribe Request
          
          New unsubscribe request received:
          
          Email: ${email}
          Timestamp: ${new Date(timestamp).toLocaleString()}
          Reason: ${reason || 'Not specified'}
          ${feedback ? `Feedback: ${feedback}` : ''}
          
          ACTION REQUIRED: Please manually remove ${email} from all email lists and marketing databases within 24 hours.
        `
      };

      // Send notification email to admin
      const emailSent = await sendEmail(unsubscribeNotificationContent, {
        trackingId: `unsubscribe_${email}_${Date.now()}`
      });

      if (!emailSent) {
        console.error('Failed to send unsubscribe notification email');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to process unsubscribe request' 
        });
      }

      // Send confirmation email to user
      const userConfirmationContent = {
        to: email,
        subject: 'Local Cooks - Unsubscribe Request Received',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <div style="background: linear-gradient(135deg, #F51042 0%, #FF5470 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Local Cooks</h1>
              <p style="color: white; margin: 5px 0 0 0; opacity: 0.9;">Unsubscribe Confirmation</p>
            </div>
            
            <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #1f2937; margin-top: 0;">We've Received Your Request</h2>
              
              <p style="color: #374151; line-height: 1.6;">
                Hi there,
              </p>
              
              <p style="color: #374151; line-height: 1.6;">
                We've received your request to unsubscribe from our email communications. We're sorry to see you go!
              </p>
              
              <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #0c4a6e;">
                  <strong>What happens next:</strong><br>
                  Your email address will be removed from our mailing lists within 24 hours. You may receive one final confirmation email once the process is complete.
                </p>
              </div>
              
              <p style="color: #374151; line-height: 1.6;">
                If you have any questions or if this was done in error, please don't hesitate to contact us at 
                <a href="mailto:localcooks@localcook.shop" style="color: #F51042; text-decoration: none;">localcooks@localcook.shop</a>.
              </p>
              
              <p style="color: #374151; line-height: 1.6;">
                Thank you for being part of the Local Cooks community!
              </p>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  Local Cooks Team<br>
                  <a href="mailto:localcooks@localcook.shop" style="color: #F51042; text-decoration: none;">localcooks@localcook.shop</a>
                </p>
              </div>
            </div>
          </div>
        `,
        text: `
          Local Cooks - Unsubscribe Confirmation
          
          Hi there,
          
          We've received your request to unsubscribe from our email communications. We're sorry to see you go!
          
          What happens next:
          Your email address will be removed from our mailing lists within 24 hours. You may receive one final confirmation email once the process is complete.
          
          If you have any questions or if this was done in error, please contact us at localcooks@localcook.shop.
          
          Thank you for being part of the Local Cooks community!
          
          Local Cooks Team
          localcooks@localcook.shop
        `
      };

      // Send confirmation to user (optional - they might not want more emails)
      await sendEmail(userConfirmationContent, {
        trackingId: `unsubscribe_confirmation_${email}_${Date.now()}`
      });

      console.log(`✅ Unsubscribe request processed for: ${email}`);
      
      res.json({ 
        success: true, 
        message: 'Unsubscribe request processed successfully' 
      });

    } catch (error) {
      console.error('Error processing unsubscribe request:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Internal server error' 
      });
    }
  });

  // Vehicle API endpoints for NHTSA data
  // Simple in-memory cache for vehicle data
  const vehicleCache = {
    makes: null,
    modelsByMake: new Map(),
    yearsByMake: new Map(),
    makesByType: new Map(),
    lastFetch: 0,
    cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours (increased from 10 minutes)
    isPreloaded: false
  };

  const isCacheValid = () => Date.now() - vehicleCache.lastFetch < vehicleCache.cacheExpiry;

  // New endpoint to preload all vehicle data at once
  app.get('/api/vehicles/preload', async (req: Request, res: Response) => {
    try {
      // Check if already preloaded and cache is valid
      if (vehicleCache.isPreloaded && isCacheValid()) {
        return res.json({
          success: true,
          message: 'Vehicle data already preloaded and cached',
          cached: true
        });
      }

      console.log('🚗 Starting vehicle data preload...');
      
      // Fetch all makes first
      const makesResponse = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json');
      if (!makesResponse.ok) {
        throw new Error(`NHTSA API error: ${makesResponse.status}`);
      }
      
      const makesData = await makesResponse.json();
      
      // Filter for 4-wheeled vehicles only (exclude motorcycles, etc.)
      const fourWheeledMakes = makesData.Results.filter((make: any) => {
        // Filter out motorcycle manufacturers and other non-4-wheeled vehicles
        const excludedMakes = [
          'HARLEY-DAVIDSON', 'YAMAHA', 'KAWASAKI', 'SUZUKI', 'HONDA MOTORCYCLE',
          'BMW MOTORRAD', 'DUCATI', 'TRIUMPH', 'INDIAN', 'VICTORY', 'APRILIA',
          'KTM', 'HUSQVARNA', 'MOTO GUZZI', 'MV AGUSTA', 'BENELLI', 'NORTON',
          'ROYAL ENFIELD', 'HUSABERG', 'GAS GAS', 'SHERCO', 'BETA', 'TM RACING'
        ];
        
        return !excludedMakes.some(excluded => 
          make.Make_Name.toUpperCase().includes(excluded) || 
          excluded.includes(make.Make_Name.toUpperCase())
        );
      });

      const formattedMakes = fourWheeledMakes.map((make: any) => ({
        id: make.Make_ID,
        name: make.Make_Name
      }));

      // Cache the makes
      vehicleCache.makes = formattedMakes;
      
      // Preload models for the first 20 most common makes to avoid overwhelming the API
      const commonMakes = formattedMakes.slice(0, 20);
      console.log(`🚗 Preloading models for ${commonMakes.length} common makes...`);
      
      for (const make of commonMakes) {
        try {
          const modelsResponse = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(make.name)}?format=json`);
          if (modelsResponse.ok) {
            const modelsData = await modelsResponse.json();
            
            // Filter for 4-wheeled vehicles only
            const fourWheeledModels = modelsData.Results.filter((model: any) => {
              const modelName = model.Model_Name.toUpperCase();
              
              // Very specific exclusions only for obvious non-4-wheeled vehicles
              const excludedPatterns = [
                /MOTORCYCLE$/i, /BIKE$/i, /SCOOTER$/i, /MOPED$/i, /ATV$/i, /QUAD$/i, /TRIKE$/i, /SIDECAR$/i,
                /^HARLEY/i, /^YAMAHA\s+(R|MT|YZ|WR|XT|TW|TTR|PW|GRIZZLY|RAPTOR|WOLVERINE|KODIAK|BIG\s+BEAR)/i,
                /^KAWASAKI\s+(NINJA|ZX|VERSYS|CONCOURS|VULCAN|CONCORDE|KLX|KX|KLR|BRUTE\s+FORCE)/i,
                /^SUZUKI\s+(GSX|HAYABUSA|V-STROM|BURGMAN|ADDRESS|GSF|SV|DL|RM|RMZ|DR|DRZ)/i,
                /^HONDA\s+(CBR|CB|VFR|VTR|CRF|CR|XR|TRX|RUBICON|FOREMAN|RECON|RANCHER)/i,
                /^BMW\s+(R|S|F|G|K|HP|C|CE)/i,
                /^DUCATI\s+(MONSTER|PANIGALE|MULTISTRADA|HYPERMOTARD|SCRAMBLER|DIAPER|STREETFIGHTER)/i,
                /^TRIUMPH\s+(SPEED|STREET|TIGER|BONNEVILLE|SCRAMBLER|THRUXTON|ROCKET|DAYTONA)/i,
                /^INDIAN\s+(CHIEF|SCOUT|ROADMASTER|CHALLENGER|FTR|SPRINGFIELD)/i,
                /^VICTORY\s+(VEGAS|HAMMER|VISION|CROSS\s+COUNTRY|CROSS\s+ROADS|GUNNER)/i,
                /^APRILIA\s+(RS|TUONO|SHIVER|MANA|CAPONORD|PEGASO|ETV|RXV|SXV)/i,
                /^KTM\s+(RC|DUKE|ADVENTURE|EXC|SX|EXC|XC|FREERIDE)/i,
                /^HUSQVARNA\s+(FE|FC|TC|TE|WR|YZ|CR|CRF|KX|RM|SX|EXC)/i,
                /^MOTO\s+GUZZI\s+(V7|V9|CALIFORNIA|GRISO|STELVIO|NORGE|BREVA|BELLAGIO)/i,
                /^MV\s+AGUSTA\s+(F3|F4|BRUTALE|DRAGSTER|RIVALE|STRADALE|TURISMO|F3|F4)/i,
                /^BENELLI\s+(TNT|BN|TRK|LEONCINO|ZENTO|IMPERIALE|502C|752S)/i,
                /^NORTON\s+(COMMANDO|DOMINATOR|ATLAS|MANX|INTER|ES2|16H)/i,
                /^ROYAL\s+ENFIELD\s+(CLASSIC|BULLET|THUNDERBIRD|CONTINENTAL|HIMALAYAN|INTERCEPTOR|GT)/i,
                /^HUSABERG\s+(FE|FC|TE|TC|WR|CR|CRF|KX|RM|SX|EXC)/i,
                /^GAS\s+GAS\s+(EC|MC|TXT|RAGA|PAMPERA|TRIALS|ENDURO|MOTOCROSS)/i,
                /^SHERCO\s+(SE|ST|SC|4T|2T|RACING|FACTORY|WORK|TRIALS)/i,
                /^BETA\s+(RR|RE|RS|EVO|FACTORY|RACING|ENDURO|TRIALS|MOTOCROSS)/i,
                /^TM\s+RACING\s+(EN|MX|SM|RACING|FACTORY|ENDURO|MOTOCROSS|SUPERMOTO)/i
              ];
              
              return !excludedPatterns.some(pattern => pattern.test(modelName));
            });
            
            const formattedModels = fourWheeledModels.map((model: any) => ({
              id: model.Model_ID || model.Model_ID,
              name: model.Model_Name
            }));
            
            vehicleCache.modelsByMake.set(make.id.toString(), formattedModels);
          }
          
          // Small delay to be respectful to the NHTSA API
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.warn(`⚠️ Failed to preload models for make ${make.name}:`, error);
          // Continue with other makes
        }
      }
      
      // Set cache as preloaded
      vehicleCache.isPreloaded = true;
      vehicleCache.lastFetch = Date.now();
      
      console.log('🚗 Vehicle data preload completed successfully');
      
      res.json({
        success: true,
        message: 'Vehicle data preloaded successfully',
        makesCount: formattedMakes.length,
        modelsCount: Array.from(vehicleCache.modelsByMake.values()).reduce((total, models) => total + models.length, 0),
        cached: false
      });
    } catch (error) {
      console.error('Error preloading vehicle data:', error);
      res.status(500).json({
        error: 'Failed to preload vehicle data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get all vehicle makes (4-wheeled vehicles only)
  app.get('/api/vehicles/makes', async (req: Request, res: Response) => {
    try {
      const { type } = req.query;
      
      // Check cache first
      if (type && vehicleCache.makesByType.has(type as string) && isCacheValid()) {
        return res.json({
          success: true,
          makes: vehicleCache.makesByType.get(type as string)
        });
      }
      
      if (!type && vehicleCache.makes && isCacheValid()) {
        return res.json({
          success: true,
          makes: vehicleCache.makes
        });
      }

      // If not cached, trigger preload first
      if (!vehicleCache.isPreloaded) {
        console.log('🚗 Makes not cached, triggering preload...');
        try {
          const preloadResponse = await fetch(`${req.protocol}://${req.get('host')}/api/vehicles/preload`);
          if (preloadResponse.ok) {
            // Now return the cached data
            if (type && vehicleCache.makesByType.has(type as string)) {
              return res.json({
                success: true,
                makes: vehicleCache.makesByType.get(type as string)
              });
            }
            
            if (!type && vehicleCache.makes) {
              return res.json({
                success: true,
                makes: vehicleCache.makes
              });
            }
          }
        } catch (preloadError) {
          console.warn('⚠️ Preload failed, falling back to direct API call:', preloadError);
        }
      }

      // Fallback to direct API call if preload failed
      const response = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json');
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Filter for 4-wheeled vehicles only (exclude motorcycles, etc.)
      const fourWheeledMakes = data.Results.filter((make: any) => {
        // Filter out motorcycle manufacturers and other non-4-wheeled vehicles
        const excludedMakes = [
          'HARLEY-DAVIDSON', 'YAMAHA', 'KAWASAKI', 'SUZUKI', 'HONDA MOTORCYCLE',
          'BMW MOTORRAD', 'DUCATI', 'TRIUMPH', 'INDIAN', 'VICTORY', 'APRILIA',
          'KTM', 'HUSQVARNA', 'MOTO GUZZI', 'MV AGUSTA', 'BENELLI', 'NORTON',
          'ROYAL ENFIELD', 'HUSABERG', 'GAS GAS', 'SHERCO', 'BETA', 'TM RACING'
        ];
        
        return !excludedMakes.some(excluded => 
          make.Make_Name.toUpperCase().includes(excluded) || 
          excluded.includes(make.Make_Name.toUpperCase())
        );
      });

      const formattedMakes = fourWheeledMakes.map((make: any) => ({
        id: make.Make_ID,
        name: make.Make_Name
      }));

      // Cache the results
      if (type) {
        vehicleCache.makesByType.set(type as string, formattedMakes);
      } else {
        vehicleCache.makes = formattedMakes;
      }
      vehicleCache.lastFetch = Date.now();

      res.json({
        success: true,
        makes: formattedMakes
      });
    } catch (error) {
      console.error('Error fetching vehicle makes:', error);
      res.status(500).json({
        error: 'Failed to fetch vehicle makes',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get makes for a specific vehicle type
  app.get('/api/vehicles/makes/type/:vehicleType', async (req: Request, res: Response) => {
    try {
      const { vehicleType } = req.params;
      
      // Check cache first
      if (vehicleCache.makesByType.has(vehicleType) && isCacheValid()) {
        return res.json({
          success: true,
          makes: vehicleCache.makesByType.get(vehicleType)
        });
      }

      // If not cached, trigger preload first
      if (!vehicleCache.isPreloaded) {
        console.log('🚗 Makes for type not cached, triggering preload...');
        try {
          const preloadResponse = await fetch(`${req.protocol}://${req.get('host')}/api/vehicles/preload`);
          if (preloadResponse.ok && vehicleCache.makesByType.has(vehicleType)) {
            return res.json({
              success: true,
              makes: vehicleCache.makesByType.get(vehicleType)
            });
          }
        } catch (preloadError) {
          console.warn('⚠️ Preload failed, falling back to direct API call:', preloadError);
        }
      }

      const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/${encodeURIComponent(vehicleType)}?format=json`);
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Filter for 4-wheeled vehicles only
      const fourWheeledMakes = data.Results.filter((make: any) => {
        const excludedMakes = [
          'HARLEY-DAVIDSON', 'YAMAHA', 'KAWASAKI', 'SUZUKI', 'HONDA MOTORCYCLE',
          'BMW MOTORRAD', 'DUCATI', 'TRIUMPH', 'INDIAN', 'VICTORY', 'APRILIA',
          'KTM', 'HUSQVARNA', 'MOTO GUZZI', 'MV AGUSTA', 'BENELLI', 'NORTON',
          'ROYAL ENFIELD', 'HUSABERG', 'GAS GAS', 'SHERCO', 'BETA', 'TM RACING'
        ];
        
        return !excludedMakes.some(excluded => 
          make.MakeName.toUpperCase().includes(excluded) || 
          excluded.includes(make.MakeName.toUpperCase())
        );
      });

      const formattedMakes = fourWheeledMakes.map((make: any) => ({
        id: make.MakeId, // Preserve original NHTSA make ID
        name: make.MakeName
      }));

      // Cache the results
      vehicleCache.makesByType.set(vehicleType, formattedMakes);
      vehicleCache.lastFetch = Date.now();

      res.json({
        success: true,
        makes: formattedMakes
      });
    } catch (error) {
      console.error('Error fetching makes for vehicle type:', error);
      res.status(500).json({
        error: 'Failed to fetch makes for vehicle type',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get models for a specific make using make name (more efficient)
  app.get('/api/vehicles/models/by-name/:makeName', async (req: Request, res: Response) => {
    try {
      const { makeName } = req.params;
      const decodedMakeName = decodeURIComponent(makeName);
      
      // Check cache first (use make name as key)
      if (vehicleCache.modelsByMake.has(decodedMakeName) && isCacheValid()) {
        return res.json({
          success: true,
          models: vehicleCache.modelsByMake.get(decodedMakeName)
        });
      }
      
      // Direct call to NHTSA API with make name (no need to lookup make ID)
      const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(decodedMakeName)}?format=json`);
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Filter for 4-wheeled vehicles only
      const fourWheeledModels = data.Results.filter((model: any) => {
        const modelName = model.Model_Name.toUpperCase();
        const excludedPatterns = [
          /MOTORCYCLE$/i, /BIKE$/i, /SCOOTER$/i, /MOPED$/i, /ATV$/i,
          /SNOWMOBILE$/i, /WATERCRAFT$/i, /BOAT$/i, /JET.?SKI$/i
        ];
        return !excludedPatterns.some(pattern => pattern.test(modelName));
      });

      const formattedModels = fourWheeledModels.map((model: any) => ({
        id: model.Model_ID,
        name: model.Model_Name
      }));

      // Cache the results
      vehicleCache.modelsByMake.set(decodedMakeName, formattedModels);

      res.json({
        success: true,
        models: formattedModels
      });
    } catch (error) {
      console.error('Error fetching vehicle models:', error);
      res.status(500).json({
        error: 'Failed to fetch vehicle models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get models for a specific make (without year dependency) - LEGACY ENDPOINT
  app.get('/api/vehicles/models/:makeId', async (req: Request, res: Response) => {
    try {
      const { makeId } = req.params;
      
      // Check cache first
      if (vehicleCache.modelsByMake.has(makeId) && isCacheValid()) {
        return res.json({
          success: true,
          models: vehicleCache.modelsByMake.get(makeId)
        });
      }
      
      // If not cached, trigger preload first
      if (!vehicleCache.isPreloaded) {
        console.log('🚗 Models not cached, triggering preload...');
        try {
          const preloadResponse = await fetch(`${req.protocol}://${req.get('host')}/api/vehicles/preload`);
          if (preloadResponse.ok && vehicleCache.modelsByMake.has(makeId)) {
            return res.json({
              success: true,
              models: vehicleCache.modelsByMake.get(makeId)
            });
          }
        } catch (preloadError) {
          console.warn('⚠️ Preload failed, falling back to direct API call:', preloadError);
        }
      }
      
      // First get the make name from our makes list
      const makesResponse = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json`);
      if (!makesResponse.ok) {
        throw new Error(`NHTSA API error: ${makesResponse.status}`);
      }
      
      const makesData = await makesResponse.json();
      const selectedMake = makesData.Results.find((make: any) => make.Make_ID === parseInt(makeId));
      
      if (!selectedMake) {
        throw new Error('Make not found');
      }
      
      // Get all models for this make (without year)
      const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(selectedMake.Make_Name)}?format=json`);
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      console.log(`🚗 NHTSA API returned ${data.Results?.length || 0} models for make: ${selectedMake.Make_Name}`);
      
      // Filter for 4-wheeled vehicles only, but be much less aggressive
      const fourWheeledModels = data.Results.filter((model: any) => {
        // Only exclude very obvious non-4-wheeled vehicle models
        const modelName = model.Model_Name.toUpperCase();
        
        // Very specific exclusions only for obvious non-4-wheeled vehicles
        const excludedPatterns = [
          // Motorcycle patterns
          /MOTORCYCLE$/i,
          /BIKE$/i,
          /SCOOTER$/i,
          /MOPED$/i,
          /ATV$/i,
          /QUAD$/i,
          /TRIKE$/i,
          /SIDECAR$/i,
          
          // Very specific motorcycle model names
          /^HARLEY/i,
          /^YAMAHA\s+(R|MT|YZ|WR|XT|TW|TTR|PW|GRIZZLY|RAPTOR|WOLVERINE|KODIAK|BIG\s+BEAR)/i,
          /^KAWASAKI\s+(NINJA|ZX|VERSYS|CONCOURS|VULCAN|CONCORDE|KLX|KX|KLR|BRUTE\s+FORCE)/i,
          /^SUZUKI\s+(GSX|HAYABUSA|V-STROM|BURGMAN|ADDRESS|GSF|SV|DL|RM|RMZ|DR|DRZ)/i,
          /^HONDA\s+(CBR|CB|VFR|VTR|CRF|CR|XR|TRX|RUBICON|FOREMAN|RECON|RANCHER)/i,
          /^BMW\s+(R|S|F|G|K|HP|C|CE)/i,
          /^DUCATI\s+(MONSTER|PANIGALE|MULTISTRADA|HYPERMOTARD|SCRAMBLER|DIAPER|STREETFIGHTER)/i,
          /^TRIUMPH\s+(SPEED|STREET|TIGER|BONNEVILLE|SCRAMBLER|THRUXTON|ROCKET|DAYTONA)/i,
          /^INDIAN\s+(CHIEF|SCOUT|ROADMASTER|CHALLENGER|FTR|SPRINGFIELD)/i,
          /^VICTORY\s+(VEGAS|HAMMER|VISION|CROSS\s+COUNTRY|CROSS\s+ROADS|GUNNER)/i,
          /^APRILIA\s+(RS|TUONO|SHIVER|MANA|CAPONORD|PEGASO|ETV|RXV|SXV)/i,
          /^KTM\s+(RC|DUKE|ADVENTURE|EXC|SX|EXC|XC|FREERIDE)/i,
          /^HUSQVARNA\s+(FE|FC|TC|TE|WR|YZ|CR|CRF|KX|RM|SX|EXC)/i,
          /^MOTO\s+GUZZI\s+(V7|V9|CALIFORNIA|GRISO|STELVIO|NORGE|BREVA|BELLAGIO)/i,
          /^MV\s+AGUSTA\s+(F3|F4|BRUTALE|DRAGSTER|RIVALE|STRADALE|TURISMO|F3|F4)/i,
          /^BENELLI\s+(TNT|BN|TRK|LEONCINO|ZENTO|IMPERIALE|502C|752S)/i,
          /^NORTON\s+(COMMANDO|DOMINATOR|ATLAS|MANX|INTER|ES2|16H)/i,
          /^ROYAL\s+ENFIELD\s+(CLASSIC|BULLET|THUNDERBIRD|CONTINENTAL|HIMALAYAN|INTERCEPTOR|GT)/i,
          /^HUSABERG\s+(FE|FC|TE|TC|WR|CR|CRF|KX|RM|SX|EXC)/i,
          /^GAS\s+GAS\s+(EC|MC|TXT|RAGA|PAMPERA|TRIALS|ENDURO|MOTOCROSS)/i,
          /^SHERCO\s+(SE|ST|SC|4T|2T|RACING|FACTORY|WORK|TRIALS)/i,
          /^BETA\s+(RR|RE|RS|EVO|FACTORY|RACING|ENDURO|TRIALS|MOTOCROSS)/i,
          /^TM\s+RACING\s+(EN|MX|SM|RACING|FACTORY|ENDURO|MOTOCROSS|SUPERMOTO)/i
        ];
        
        // Check if model matches any excluded patterns
        return !excludedPatterns.some(pattern => pattern.test(modelName));
      });

      console.log(`🚗 After filtering, ${fourWheeledModels.length} models remain for make: ${selectedMake.Make_Name}`);
      
      const formattedModels = fourWheeledModels.map((model: any) => ({
        id: model.Model_ID || model.Model_ID, // Use actual NHTSA ID if available
        name: model.Model_Name
      }));

      // Cache the results
      vehicleCache.modelsByMake.set(makeId, formattedModels);

      res.json({
        success: true,
        models: formattedModels
      });
    } catch (error) {
      console.error('Error fetching vehicle models:', error);
      res.status(500).json({
        error: 'Failed to fetch vehicle models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get available years for a specific make
  app.get('/api/vehicles/years/:makeId', async (req: Request, res: Response) => {
    try {
      const { makeId } = req.params;
      
      // Check cache first
      if (vehicleCache.yearsByMake.has(makeId) && isCacheValid()) {
        return res.json({
          success: true,
          years: vehicleCache.yearsByMake.get(makeId)
        });
      }
      
      // Get the make name from cache or fallback to a reasonable guess
      let selectedMake = null;
      
      // Try to get from our car makes cache first
      if (vehicleCache.makesByType.has('car') && isCacheValid()) {
        const carMakes = vehicleCache.makesByType.get('car');
        selectedMake = carMakes?.find((make: any) => make.id === parseInt(makeId));
      }
      
      // If not found in cache, try the NHTSA API (with error handling)
      if (!selectedMake) {
        try {
          const makesResponse = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json`, {
            signal: AbortSignal.timeout(3000) // 3 second timeout
          });
          
          if (makesResponse.ok) {
            const makesData = await makesResponse.json();
            selectedMake = makesData.Results.find((make: any) => make.Make_ID === parseInt(makeId));
          }
        } catch (error) {
          console.log(`⚠️ NHTSA GetAllMakes API failed for makeId ${makeId}, using fallback`);
        }
      }
      
      // Final fallback: create a reasonable make object
      if (!selectedMake) {
        // Common make ID to name mappings for popular manufacturers
        const commonMakes: { [key: number]: string } = {
          441: 'TESLA', 448: 'TOYOTA', 460: 'FORD', 467: 'CHEVROLET', 
          476: 'DODGE', 478: 'NISSAN', 475: 'ACURA', 515: 'LEXUS',
          582: 'AUDI', 482: 'VOLKSWAGEN', 485: 'VOLVO', 498: 'HYUNDAI',
          499: 'KIA', 449: 'MERCEDES-BENZ', 584: 'PORSCHE', 523: 'SUBARU'
        };
        
        const makeName = commonMakes[parseInt(makeId)] || `MAKE_${makeId}`;
        selectedMake = { Make_ID: parseInt(makeId), Make_Name: makeName };
        console.log(`🚗 Using fallback make name: ${makeName} for ID ${makeId}`);
      }
      
      // Use NHTSA API to find years that actually have vehicle models
      const currentYear = new Date().getFullYear();
      const makeName = selectedMake.Make_Name.toUpperCase();
      console.log(`🚗 Finding actual model years for ${selectedMake.Make_Name} (ID: ${makeId})`);
      
      const years = [];
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      // Helper function to check if a year has models
      const hasModelsInYear = async (year: number): Promise<boolean> => {
        try {
          const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeIdYear/${makeId}/${year}?format=json`, {
            signal: AbortSignal.timeout(5000)
          });
          
          if (!response.ok) return false;
          const data = await response.json();
          return data && data.Results && data.Results.length > 0;
        } catch {
          return false;
        }
      };
      
      // Smart sampling strategy: Check key years and find the range
      const currentPlusOne = currentYear + 1;
      const testYears = [
        // Recent years (most likely to have models)
        currentPlusOne, currentYear, currentYear - 1, currentYear - 2, currentYear - 3,
        // Sample years going back
        currentYear - 5, currentYear - 10, currentYear - 15, currentYear - 20, currentYear - 25,
        // Common milestone years
        2020, 2015, 2010, 2005, 2000, 1995, 1990, 1985
      ].filter((year, index, arr) => 
        // Remove duplicates and keep only reasonable years
        arr.indexOf(year) === index && year >= 1980 && year <= currentPlusOne
      ).sort((a, b) => b - a); // Start with recent years
      
      let earliestFoundYear = currentPlusOne;
      let latestFoundYear = 0;
      let foundCount = 0;
      
      console.log(`🚗 Testing ${testYears.length} sample years for ${selectedMake.Make_Name}...`);
      
      // Test sample years with rate limiting
      for (let i = 0; i < testYears.length && foundCount < 10; i++) {
        const year = testYears[i];
        const hasModels = await hasModelsInYear(year);
        
        if (hasModels) {
          foundCount++;
          earliestFoundYear = Math.min(earliestFoundYear, year);
          latestFoundYear = Math.max(latestFoundYear, year);
          console.log(`🚗 ✅ Found models for ${selectedMake.Make_Name} in ${year}`);
        }
        
        // Add delay between requests to respect rate limits
        if (i < testYears.length - 1) {
          await delay(150); // 150ms delay
        }
      }
      
      if (foundCount > 0) {
        // Generate the full range based on found years
        console.log(`🚗 Found model years range: ${latestFoundYear} to ${earliestFoundYear}`);
        
        // Fill in the range between earliest and latest found years
        for (let year = latestFoundYear; year >= earliestFoundYear; year--) {
          years.push(year);
        }
        
        console.log(`🚗 Generated ${years.length} years with actual models for ${selectedMake.Make_Name}`);
      } else {
        // Fallback: Use intelligent defaults based on manufacturer type
        console.log(`⚠️ No model years found via API for ${selectedMake.Make_Name}, using intelligent fallback`);
        
        let fallbackStartYear = 1995; // Conservative default
        
        // Smart fallbacks based on manufacturer patterns
        if (makeName.includes('TESLA') || makeName.includes('LUCID') || makeName.includes('RIVIAN')) {
          fallbackStartYear = 2010; // Recent EV manufacturers
        } else if (makeName.includes('GENESIS') || makeName.includes('SCION')) {
          fallbackStartYear = 2000; // Recent sub-brands
        } else if (makeName.includes('SATURN') || makeName.includes('HUMMER')) {
          fallbackStartYear = 1990; // Newer American brands
        }
        
        // Generate reasonable fallback range (last 30 years max)
        const fallbackEndYear = Math.min(currentYear + 1, fallbackStartYear + 35);
        for (let year = fallbackEndYear; year >= fallbackStartYear; year--) {
          years.push(year);
        }
        
        console.log(`🚗 Using fallback range: ${fallbackEndYear} to ${fallbackStartYear}`);
      }

      // Cache the results
      vehicleCache.yearsByMake.set(makeId, years);

      res.json({
        success: true,
        years: years
      });
    } catch (error) {
      console.error('Error fetching vehicle years:', error);
      res.status(500).json({
        error: 'Failed to fetch vehicle years',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
