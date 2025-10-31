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
import { generateApplicationWithDocumentsEmail, generateApplicationWithoutDocumentsEmail, generateChefAllDocumentsApprovedEmail, generateDeliveryPartnerStatusChangeEmail, generateDocumentStatusChangeEmail, generatePromoCodeEmail, generateStatusChangeEmail, sendEmail, generateManagerMagicLinkEmail, generateBookingNotificationEmail, generateBookingRequestEmail, generateBookingConfirmationEmail, generateBookingCancellationEmail } from "./email";
import { deleteFile, getFileUrl, upload, uploadToBlob } from "./fileUpload";
import { comparePasswords, hashPassword } from "./passwordUtils";
import { storage } from "./storage";
import { firebaseStorage } from "./storage-firebase";
import { verifyFirebaseToken } from "./firebase-admin";

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

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      console.log('Admin login attempt for:', username);
      console.log('Storage type:', storage.constructor.name);
      console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

      // Get admin user
      let admin;
      try {
        console.log('Calling storage.getUserByUsername...');
        admin = await storage.getUserByUsername(username);
        console.log('Storage call completed, user:', admin ? 'found' : 'not found');
      } catch (dbError: any) {
        console.error('Database error fetching user:', dbError);
        console.error('Error stack:', dbError?.stack);
        console.error('Error code:', dbError?.code);
        console.error('Error detail:', dbError?.detail);
        return res.status(500).json({ 
          error: 'Database connection failed',
          message: dbError instanceof Error ? dbError.message : 'Unknown database error',
          code: dbError?.code
        });
      }

      if (!admin) {
        console.log('Admin user not found:', username);
        return res.status(401).json({ error: 'Incorrect username or password' });
      }
      
      console.log('User found:', { id: admin.id, username: admin.username, role: admin.role });

      // Verify user is admin or manager (both use session-based auth)
      if (admin.role !== 'admin' && admin.role !== 'manager') {
        console.log('User is not an admin or manager:', username, 'role:', admin.role);
        return res.status(403).json({ error: 'Not authorized - admin or manager access required' });
      }

      // Check password - first try exact match for 'localcooks' (legacy admin password)
      let passwordMatches = false;

      if (password === 'localcooks' && admin.role === 'admin') {
        passwordMatches = true;
        console.log('Admin password matched with hardcoded value');
      } else {
        // Compare with database password hash
        try {
          passwordMatches = await comparePasswords(password, admin.password);
          console.log('Password compared with stored hash:', passwordMatches);
        } catch (error) {
          console.error('Error comparing passwords:', error);
        }
      }

      if (!passwordMatches) {
        return res.status(401).json({ error: 'Incorrect username or password' });
      }

      console.log(`${admin.role} login successful for:`, username);

      // Store session data for admin (both Passport and direct session)
      (req.session as any).userId = admin.id;
      (req.session as any).user = { ...admin, password: undefined };

      // Use Passport.js login to set session
      req.login(admin, (err) => {
        if (err) {
          console.error('Error setting session:', err);
          return res.status(500).json({ error: 'Session creation failed' });
        }

        // Ensure session data is persisted
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('Error saving session:', saveErr);
            return res.status(500).json({ error: 'Session save failed' });
          }

          // Remove sensitive info
          const { password: _, ...adminWithoutPassword } = admin;

          // Return user data
          return res.status(200).json(adminWithoutPassword);
        });
      });
    } catch (error) {
      console.error('Admin login error:', error);
      console.error('Error details:', error instanceof Error ? error.stack : error);
      res.status(500).json({ 
        error: 'Admin login failed', 
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
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

  // Helper function to get authenticated user from session (supports both Passport and direct session)
  async function getAuthenticatedUser(req: Request): Promise<{ id: number; username: string; role: string | null } | null> {
    // Check Passport session first
    if (req.isAuthenticated?.() && req.user) {
      return req.user as any;
    }

    // Check direct session data (for admin login via req.session.userId)
    if ((req.session as any)?.userId) {
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      if (user) {
        return user;
      }
    }

    // Check session user object
    if ((req.session as any)?.user) {
      return (req.session as any).user;
    }

    return null;
  }

  // Admin session check endpoint (for admin dashboard)
  app.get("/api/user-session", async (req: Request, res: Response) => {
    try {
      const user = await getAuthenticatedUser(req);
      
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Fetch full user data including has_seen_welcome from database
      const fullUser = await storage.getUser(user.id);
      const { password: _, ...userWithoutPassword } = (fullUser || user) as any;
      
      return res.json({
        ...userWithoutPassword,
        authMethod: req.isAuthenticated?.() ? 'passport-session' : 'session'
      });
    } catch (error) {
      console.error("Error checking user session:", error);
      return res.status(500).json({ error: "Failed to check session" });
    }
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

      // Check if all documents are approved and send consolidated email
      try {
        if (updatedApplication.email) {
          // Check if all documents are approved
          const hasFoodSafetyLicense = updatedApplication.foodSafetyLicenseUrl;
          const hasFoodEstablishmentCert = updatedApplication.foodEstablishmentCertUrl;
          
          const foodSafetyApproved = updatedApplication.foodSafetyLicenseStatus === "approved";
          const foodEstablishmentApproved = !hasFoodEstablishmentCert || updatedApplication.foodEstablishmentCertStatus === "approved";
          
          // If all documents are approved, send consolidated email
          if (foodSafetyApproved && foodEstablishmentApproved) {
            const approvedDocuments = [];
            if (hasFoodSafetyLicense) approvedDocuments.push("Food Safety License");
            if (hasFoodEstablishmentCert) approvedDocuments.push("Food Establishment Certificate");
            
            const emailContent = generateChefAllDocumentsApprovedEmail({
              fullName: updatedApplication.fullName || "Applicant",
              email: updatedApplication.email,
              approvedDocuments: approvedDocuments,
              adminFeedback: req.body.documentsAdminFeedback
            });

            await sendEmail(emailContent, {
              trackingId: `all_docs_approved_chef_${updatedApplication.id}_${Date.now()}`
            });
            
            console.log(`All documents approved email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
          }
        } else {
          console.warn(`Cannot send all documents approved email for application ${updatedApplication.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending all documents approved email:", emailError);
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

  // ===================================
  // KITCHEN BOOKING SYSTEM - MANAGER ROUTES
  // ===================================

  // IMPORTANT: Put route must be defined BEFORE get route with same base path
  // to avoid Express routing conflicts. Specific routes must come before generic ones.
  
  // Update location cancellation policy (manager only)
  app.put("/api/manager/locations/:locationId/cancellation-policy", async (req: Request, res: Response) => {
    console.log('[PUT] /api/manager/locations/:locationId/cancellation-policy hit', {
      locationId: req.params.locationId,
      body: req.body
    });
    try {
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const { locationId } = req.params;
      const locationIdNum = parseInt(locationId);
      
      if (isNaN(locationIdNum) || locationIdNum <= 0) {
        console.error('[PUT] Invalid locationId:', locationId);
        return res.status(400).json({ error: "Invalid location ID" });
      }
      
      const { cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, notificationEmail } = req.body;
      
      console.log('[PUT] Request body:', {
        cancellationPolicyHours,
        cancellationPolicyMessage,
        defaultDailyBookingLimit,
        notificationEmail,
        locationId: locationIdNum
      });

      if (cancellationPolicyHours !== undefined && (typeof cancellationPolicyHours !== 'number' || cancellationPolicyHours < 0)) {
        return res.status(400).json({ error: "Cancellation policy hours must be a non-negative number" });
      }

      if (defaultDailyBookingLimit !== undefined && (typeof defaultDailyBookingLimit !== 'number' || defaultDailyBookingLimit < 1 || defaultDailyBookingLimit > 24)) {
        return res.status(400).json({ error: "Daily booking limit must be between 1 and 24 hours" });
      }

      // Import db dynamically
      const { db } = await import('./db');
      const { locations } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');

      // Verify manager owns this location
      const locationResults = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationIdNum), eq(locations.managerId, user.id)));
      
      const location = locationResults[0];

      if (!location) {
        console.error('[PUT] Location not found or access denied:', {
          locationId: locationIdNum,
          managerId: user.id,
          userRole: user.role
        });
        return res.status(404).json({ error: "Location not found or access denied" });
      }
      
      console.log('[PUT] Location verified:', {
        locationId: location.id,
        locationName: location.name,
        managerId: location.managerId
      });

      // Update location settings
      const updates: any = { updatedAt: new Date() };
      if (cancellationPolicyHours !== undefined) {
        updates.cancellationPolicyHours = cancellationPolicyHours;
      }
      if (cancellationPolicyMessage !== undefined) {
        updates.cancellationPolicyMessage = cancellationPolicyMessage;
      }
      if (defaultDailyBookingLimit !== undefined) {
        updates.defaultDailyBookingLimit = defaultDailyBookingLimit;
      }
      if (notificationEmail !== undefined) {
        // Validate email format if provided and not empty
        if (notificationEmail && notificationEmail.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
          return res.status(400).json({ error: "Invalid email format" });
        }
        // Set to null if empty string, otherwise use the value
        updates.notificationEmail = notificationEmail && notificationEmail.trim() !== '' ? notificationEmail.trim() : null;
        console.log('[PUT] Setting notificationEmail:', { 
          raw: notificationEmail, 
          processed: updates.notificationEmail 
        });
      }

      const updatedResults = await db
        .update(locations)
        .set(updates)
        .where(eq(locations.id, locationIdNum))
        .returning();

      if (!updatedResults || updatedResults.length === 0) {
        console.error('[PUT] Cancellation policy update failed: No location returned from DB', {
          locationId: locationIdNum,
          updates
        });
        return res.status(500).json({ error: "Failed to update location settings - no rows updated" });
      }

      const updated = updatedResults[0];
      console.log('[PUT] Location settings updated successfully:', {
        locationId: updated.id,
        cancellationPolicyHours: updated.cancellationPolicyHours,
        defaultDailyBookingLimit: updated.defaultDailyBookingLimit,
        notificationEmail: (updated as any).notificationEmail || (updated as any).notification_email || 'not set'
      });
      
      // Map snake_case fields to camelCase for the frontend
      const response = {
        ...updated,
        notificationEmail: (updated as any).notificationEmail || (updated as any).notification_email || null,
        cancellationPolicyHours: (updated as any).cancellationPolicyHours || (updated as any).cancellation_policy_hours,
        cancellationPolicyMessage: (updated as any).cancellationPolicyMessage || (updated as any).cancellation_policy_message,
        defaultDailyBookingLimit: (updated as any).defaultDailyBookingLimit || (updated as any).default_daily_booking_limit,
      };
      
      console.log('[PUT] Sending response with notificationEmail:', response.notificationEmail);
      res.status(200).json(response);
    } catch (error: any) {
      console.error("Error updating cancellation policy:", error);
      res.status(500).json({ error: error.message || "Failed to update cancellation policy" });
    }
  });

  app.get("/api/manager/locations", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const locations = await firebaseStorage.getLocationsByManager(user.id);
      
      // Map snake_case fields to camelCase for the frontend
      const mappedLocations = locations.map(loc => ({
        ...loc,
        notificationEmail: (loc as any).notificationEmail || (loc as any).notification_email || null,
        cancellationPolicyHours: (loc as any).cancellationPolicyHours || (loc as any).cancellation_policy_hours,
        cancellationPolicyMessage: (loc as any).cancellationPolicyMessage || (loc as any).cancellation_policy_message,
        defaultDailyBookingLimit: (loc as any).defaultDailyBookingLimit || (loc as any).default_daily_booking_limit,
      }));
      
      // Log to verify notificationEmail is included in response
      console.log('[GET] /api/manager/locations - Returning locations:', 
        mappedLocations.map(loc => ({
          id: loc.id,
          name: loc.name,
          notificationEmail: loc.notificationEmail || 'not set'
        }))
      );
      
      res.json(mappedLocations);
    } catch (error: any) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch locations" });
    }
  });

  // Get kitchens for a location (manager)
  app.get("/api/manager/kitchens/:locationId", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId) || locationId <= 0) {
        return res.status(400).json({ error: "Invalid location ID" });
      }

      // Verify the manager has access to this location
      const locations = await firebaseStorage.getLocationsByManager(user.id);
      const hasAccess = locations.some(loc => loc.id === locationId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this location" });
      }

      const kitchens = await firebaseStorage.getKitchensByLocation(locationId);
      res.json(kitchens);
    } catch (error: any) {
      console.error("Error fetching kitchens:", error);
      res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
    }
  });

  // Set kitchen availability
  app.post("/api/manager/availability", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }
      
      const { kitchenId, dayOfWeek, startTime, endTime, isAvailable } = req.body;
      await firebaseStorage.setKitchenAvailability(kitchenId, { dayOfWeek, startTime, endTime, isAvailable });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting availability:", error);
      res.status(500).json({ error: error.message || "Failed to set availability" });
    }
  });

  // Get kitchen availability
  app.get("/api/manager/availability/:kitchenId", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }
      
      const kitchenId = parseInt(req.params.kitchenId);
      const availability = await firebaseStorage.getKitchenAvailability(kitchenId);
      res.json(availability);
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ error: "Failed to fetch availability" });
    }
  });

  // Get all bookings for manager
  app.get("/api/manager/bookings", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const bookings = await firebaseStorage.getBookingsByManager(user.id);
      res.json(bookings);
    } catch (error: any) {
      console.error("Error fetching bookings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch bookings" });
    }
  });

  // Get bookings for a specific kitchen (for availability management)
  app.get("/api/manager/kitchens/:kitchenId/bookings", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const kitchenId = parseInt(req.params.kitchenId);
      console.log(`📋 Fetching bookings for kitchen ${kitchenId}`);
      
      const bookings = await firebaseStorage.getBookingsByKitchen(kitchenId);
      console.log(`✅ Found ${bookings.length} bookings for kitchen ${kitchenId}`);
      
      // Return ALL bookings (not just confirmed) so manager can see pending ones too
      res.json(bookings);
    } catch (error: any) {
      console.error("Error fetching kitchen bookings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch kitchen bookings" });
    }
  });

  // Update booking status
  app.put("/api/manager/bookings/:id/status", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }
      
      const id = parseInt(req.params.id);
      const { status } = req.body;
      
      // Get booking details before updating
      const booking = await firebaseStorage.getBookingById(id);
      
      await firebaseStorage.updateKitchenBookingStatus(id, status);
      
      // Send email notification to chef based on status change
      if (booking) {
        try {
          const kitchen = await firebaseStorage.getKitchenById(booking.kitchenId);
          const chef = await storage.getUser(booking.chefId);
          
          if (chef && kitchen) {
            if (status === 'confirmed') {
              // Send confirmation email
              const confirmationEmail = generateBookingConfirmationEmail({
                chefEmail: chef.username,
                chefName: (chef as any).displayName || chef.username,
                kitchenName: kitchen.name,
                bookingDate: booking.bookingDate,
                startTime: booking.startTime,
                endTime: booking.endTime,
                specialNotes: booking.specialNotes
              });
              await sendEmail(confirmationEmail);
              console.log(`✅ Booking confirmation email sent to chef: ${chef.username}`);
            } else if (status === 'cancelled') {
              // Send cancellation email
              const cancellationEmail = generateBookingCancellationEmail({
                chefEmail: chef.username,
                chefName: (chef as any).displayName || chef.username,
                kitchenName: kitchen.name,
                bookingDate: booking.bookingDate,
                startTime: booking.startTime,
                endTime: booking.endTime,
                cancellationReason: 'The manager has cancelled this booking'
              });
              await sendEmail(cancellationEmail);
              console.log(`✅ Booking cancellation email sent to chef: ${chef.username}`);
            }
          }
        } catch (emailError) {
          console.error("Error sending booking status email:", emailError);
          // Don't fail the status update if email fails
        }
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating booking status:", error);
      res.status(500).json({ error: error.message || "Failed to update booking status" });
    }
  });

  // Get date overrides for a kitchen
  app.get("/api/manager/kitchens/:kitchenId/date-overrides", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const kitchenId = parseInt(req.params.kitchenId);
      const { startDate, endDate } = req.query;
      
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;
      
      const overrides = await firebaseStorage.getKitchenDateOverrides(kitchenId, start, end);
      res.json(overrides);
    } catch (error: any) {
      console.error("Error fetching date overrides:", error);
      res.status(500).json({ error: error.message || "Failed to fetch date overrides" });
    }
  });

  // Create a date override
  app.post("/api/manager/kitchens/:kitchenId/date-overrides", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const kitchenId = parseInt(req.params.kitchenId);
      const { specificDate, startTime, endTime, isAvailable, reason } = req.body;
      
      // Validate input
      if (!specificDate) {
        return res.status(400).json({ error: "Date is required" });
      }
      
      // Validate time range if kitchen is available
      if (isAvailable) {
        if (!startTime || !endTime) {
          return res.status(400).json({ 
            error: "Start time and end time are required when kitchen is available" 
          });
        }
        if (startTime >= endTime) {
          return res.status(400).json({ 
            error: "End time must be after start time" 
          });
        }
      }
      
      // If closing the kitchen (isAvailable = false), check for existing bookings
      if (!isAvailable) {
        const bookings = await firebaseStorage.getBookingsByKitchen(kitchenId);
        const dateStr = new Date(specificDate).toISOString().split('T')[0];
        const bookingsOnDate = bookings.filter(b => {
          const bookingDateStr = new Date(b.bookingDate).toISOString().split('T')[0];
          return bookingDateStr === dateStr && b.status === 'confirmed';
        });
        
        if (bookingsOnDate.length > 0) {
          return res.status(400).json({ 
            error: "Cannot close kitchen on this date",
            message: `There are ${bookingsOnDate.length} confirmed booking(s) on this date. Please cancel or reschedule them first.`,
            bookings: bookingsOnDate 
          });
        }
      }
      
      const override = await firebaseStorage.createKitchenDateOverride({
        kitchenId,
        specificDate: new Date(specificDate),
        startTime,
        endTime,
        isAvailable,
        reason,
      });
      
      res.json(override);
    } catch (error: any) {
      console.error("Error creating date override:", error);
      res.status(500).json({ error: error.message || "Failed to create date override" });
    }
  });

  // Update a date override
  app.put("/api/manager/date-overrides/:id", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const id = parseInt(req.params.id);
      const { startTime, endTime, isAvailable, reason } = req.body;
      
      // Validate time range if kitchen is available
      if (isAvailable === true) {
        if (!startTime || !endTime) {
          return res.status(400).json({ 
            error: "Start time and end time are required when kitchen is available" 
          });
        }
        if (startTime >= endTime) {
          return res.status(400).json({ 
            error: "End time must be after start time" 
          });
        }
      }
      
      // If changing to closed (isAvailable = false), check for existing bookings
      if (isAvailable === false) {
        // Load the specific override to find its kitchen and date
        const override = await firebaseStorage.getKitchenDateOverrideById(id);
        if (override) {
          const bookings = await firebaseStorage.getBookingsByKitchen(override.kitchenId);
          const dateStr = new Date(override.specificDate).toISOString().split('T')[0];
          const bookingsOnDate = bookings.filter(b => {
            const bookingDateStr = new Date(b.bookingDate).toISOString().split('T')[0];
            return bookingDateStr === dateStr && b.status === 'confirmed';
          });
          if (bookingsOnDate.length > 0) {
            return res.status(400).json({ 
              error: "Cannot close kitchen on this date",
              message: `There are ${bookingsOnDate.length} confirmed booking(s) on this date. Please cancel or reschedule them first.`,
              bookings: bookingsOnDate 
            });
          }
        }
      }
      
      const updated = await firebaseStorage.updateKitchenDateOverride(id, {
        startTime,
        endTime,
        isAvailable,
        reason,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating date override:", error);
      res.status(500).json({ error: error.message || "Failed to update date override" });
    }
  });

  // Delete a date override
  app.delete("/api/manager/date-overrides/:id", async (req: Request, res: Response) => {
    try {
      // Check authentication - managers use session-based auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const id = parseInt(req.params.id);
      await firebaseStorage.deleteKitchenDateOverride(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting date override:", error);
      res.status(500).json({ error: error.message || "Failed to delete date override" });
    }
  });

  // REMOVED manual bookings endpoints - database doesn't support booking_type column yet

  // ===================================
  // KITCHEN BOOKING SYSTEM - CHEF ROUTES
  // ===================================

  // Middleware to require chef authentication
  // Supports BOTH Firebase auth (for approved chefs) AND session auth (for admin/managers)
  async function requireChef(req: Request, res: Response, next: () => void) {
    try {
      // First, try Firebase authentication
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decodedToken = await verifyFirebaseToken(token);
        
        if (decodedToken) {
          // Load user from Firebase UID
          const neonUser = await firebaseStorage.getUserByFirebaseUid(decodedToken.uid);
          
          if (neonUser && neonUser.isChef) {
            // Set both Firebase and user info on request
            req.firebaseUser = {
              uid: decodedToken.uid,
              email: decodedToken.email,
              email_verified: decodedToken.email_verified,
            };
            req.user = neonUser as any;
            console.log(`✅ Chef authenticated via Firebase: ${neonUser.username} (ID: ${neonUser.id})`);
            return next();
          } else if (neonUser && !neonUser.isChef) {
            return res.status(403).json({ error: "Chef access required" });
          }
        }
      }
      
      // Fall back to session authentication
      if (req.isAuthenticated?.() && req.user?.isChef) {
        console.log(`✅ Chef authenticated via session: ${req.user.username} (ID: ${req.user.id})`);
        return next();
      }
      
      // Neither authentication method worked
      return res.status(401).json({ error: "Authentication required. Please sign in as a chef." });
    } catch (error) {
      console.error('Error in requireChef middleware:', error);
      return res.status(401).json({ error: "Authentication failed" });
    }
  }

  // Get all kitchens with location and manager info
  app.get("/api/chef/kitchens", requireChef, async (req: Request, res: Response) => {
    try {
      const allKitchens = await firebaseStorage.getAllKitchensWithLocationAndManager();
      
      // Filter to only return active kitchens - handle both camelCase and snake_case
      const activeKitchens = allKitchens.filter(k => {
        const isActive = k.isActive !== undefined ? k.isActive : (k as any).is_active;
        return isActive !== false && isActive !== null;
      });
      
      res.json(activeKitchens);
    } catch (error: any) {
      console.error("Error fetching kitchens:", error);
      res.status(500).json({ error: "Failed to fetch kitchens", details: error.message });
    }
  });

  // Get all locations (for chefs to see kitchen locations)
  app.get("/api/chef/locations", requireChef, async (req: Request, res: Response) => {
    try {
      const locations = await firebaseStorage.getAllLocations();
      res.json(locations);
    } catch (error: any) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // Get ALL time slots with booking info (capacity aware)
  app.get("/api/chef/kitchens/:kitchenId/slots", requireChef, async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({ error: "Date parameter is required" });
      }
      
      const bookingDate = new Date(date as string);
      
      // Validate date
      if (isNaN(bookingDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      
      const slotsInfo = await firebaseStorage.getAllTimeSlotsWithBookingInfo(kitchenId, bookingDate);
      
      res.json(slotsInfo);
    } catch (error: any) {
      console.error("Error fetching time slots:", error);
      res.status(500).json({ 
        error: "Failed to fetch time slots",
        message: error.message 
      });
    }
  });

  // Get available time slots for a kitchen on a specific date (legacy endpoint, returns only available slots)
  app.get("/api/chef/kitchens/:kitchenId/availability", requireChef, async (req: Request, res: Response) => {
    try {
      const kitchenId = parseInt(req.params.kitchenId);
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({ error: "Date parameter is required" });
      }
      
      const bookingDate = new Date(date as string);
      
      // Validate date
      if (isNaN(bookingDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      
      console.log(`🔍 Fetching available slots for kitchen ${kitchenId} on ${date}`);
      
      const slots = await firebaseStorage.getAvailableTimeSlots(kitchenId, bookingDate);
      
      console.log(`✅ Returning ${slots.length} available slots`);
      
      res.json(slots);
    } catch (error: any) {
      console.error("Error fetching available slots:", error);
      res.status(500).json({ 
        error: "Failed to fetch available slots",
        message: error.message 
      });
    }
  });

  // Create a booking
  app.post("/api/chef/bookings", requireChef, async (req: Request, res: Response) => {
    try {
      const { kitchenId, bookingDate, startTime, endTime, specialNotes } = req.body;
      
      // First validate that the booking is within manager-set availability
      const bookingDateObj = new Date(bookingDate);
      const availabilityCheck = await firebaseStorage.validateBookingAvailability(
        kitchenId, 
        bookingDateObj, 
        startTime, 
        endTime
      );
      
      if (!availabilityCheck.valid) {
        return res.status(400).json({ error: availabilityCheck.error || "Booking is not within manager-set available hours" });
      }
      
      // Check for conflicts with existing bookings
      const hasConflict = await firebaseStorage.checkBookingConflict(kitchenId, bookingDateObj, startTime, endTime);
      if (hasConflict) {
        return res.status(409).json({ error: "Time slot is already booked" });
      }

      const booking = await firebaseStorage.createKitchenBooking({
        chefId: req.user!.id,
        kitchenId,
        bookingDate: new Date(bookingDate),
        startTime,
        endTime,
        specialNotes
      });

      // Send email notifications (background - don't block booking creation)
      try {
        // Get kitchen and location details
        const kitchen = await firebaseStorage.getKitchenById(kitchenId);
        if (!kitchen) {
          console.warn(`⚠️ Kitchen ${kitchenId} not found, skipping email notifications`);
        } else {
          // Handle both camelCase and snake_case for kitchen locationId
          const kitchenLocationId = (kitchen as any).locationId || (kitchen as any).location_id;
          if (!kitchenLocationId) {
            console.warn(`⚠️ Kitchen ${kitchenId} has no locationId, skipping email notifications`);
          } else {
            const location = await firebaseStorage.getLocationById(kitchenLocationId);
            if (!location) {
              console.warn(`⚠️ Location ${kitchenLocationId} not found, skipping email notifications`);
            } else {
              console.log(`📧 Preparing booking emails - Location: ${location.name}, Notification Email: ${location.notificationEmail || 'not set'}`);
              
              // Get chef and manager details
              const chef = await storage.getUser(req.user!.id);
              if (!chef) {
                console.warn(`⚠️ Chef ${req.user!.id} not found, skipping email notifications`);
              } else {
                // Get manager - location.managerId is now in camelCase after getLocationById mapping
                const managerId = location.managerId || (location as any).manager_id;
                const manager = managerId ? await storage.getUser(managerId) : null;
                
                if (!manager) {
                  console.warn(`⚠️ Manager ${managerId} not found for location ${kitchenLocationId}, skipping manager email`);
                }

                // Always send chef email if chef exists
                if (chef && kitchen) {
                  const chefEmailAddress = chef.username; // chef.username is the email
                  const chefEmail = generateBookingRequestEmail({
                    chefEmail: chefEmailAddress,
                    chefName: (chef as any).displayName || chef.username || 'Chef',
                    kitchenName: kitchen.name || 'Kitchen',
                    bookingDate: bookingDate,
                    startTime,
                    endTime,
                    specialNotes: specialNotes || ''
                  });
                  await sendEmail(chefEmail);
                  console.log(`✅ Booking request email sent to chef: ${chefEmailAddress}`);
                }

                // Send notification to manager if manager exists and notification email is configured
                if (manager && location) {
                  // Use notification email if set, otherwise fallback to manager's username (email)
                  const notificationEmailAddress = location.notificationEmail || manager.username;
                  
                  if (!notificationEmailAddress) {
                    console.warn(`⚠️ No notification email found for location ${kitchenLocationId} and manager ${managerId} has no username/email`);
                  } else {
                    const managerEmail = generateBookingNotificationEmail({
                      managerEmail: notificationEmailAddress,
                      chefName: (chef as any).displayName || chef.username || 'Chef',
                      kitchenName: kitchen.name || 'Kitchen',
                      bookingDate: bookingDate,
                      startTime,
                      endTime,
                      specialNotes: specialNotes || ''
                    });
                    await sendEmail(managerEmail);
                    console.log(`✅ Booking notification email sent to: ${notificationEmailAddress}`);
                  }
                } else if (!manager) {
                  console.warn(`⚠️ No manager found for location ${kitchenLocationId}, cannot send manager notification email`);
                }
              }
            }
          }
        }
      } catch (emailError) {
        console.error("❌ Error sending booking emails:", emailError);
        console.error("Email error details:", emailError instanceof Error ? emailError.message : emailError);
        // Don't fail the booking if emails fail
      }
      
      res.status(201).json(booking);
    } catch (error) {
      console.error("Error creating booking:", error);
      res.status(500).json({ error: "Failed to create booking" });
    }
  });

  // Get chef's bookings
  app.get("/api/chef/bookings", requireChef, async (req: Request, res: Response) => {
    try {
      const bookings = await firebaseStorage.getBookingsByChef(req.user!.id);
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  // Cancel a booking
  app.put("/api/chef/bookings/:id/cancel", requireChef, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await firebaseStorage.cancelKitchenBooking(id, req.user!.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error cancelling booking:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to cancel booking" });
    }
  });

  // ===================================
  // KITCHEN BOOKING SYSTEM - ADMIN ROUTES
  // ===================================

  // Create manager account
  app.post("/api/admin/managers", async (req: Request, res: Response) => {
    try {
      // Check authentication - support both session and Firebase auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { username, password, email, name } = req.body;
      
      // Validate required fields
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }
      
      // Check if user already exists
      const existingUser = await firebaseStorage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Create manager user with hashed password
      // Set has_seen_welcome to false to force password change on first login
      const hashedPassword = await hashPassword(password);
      const manager = await firebaseStorage.createUser({
        username,
        password: hashedPassword,
        role: "manager",
        isChef: false,
        isDeliveryPartner: false,
        isManager: true,
        has_seen_welcome: false  // Manager must change password on first login
      });

      // Send welcome email to manager with credentials
      try {
        const welcomeEmail = {
          to: username, // username is the email
          subject: "Your Manager Account - Local Cooks Community",
          text: `Hello ${name || 'Manager'},\n\nYour manager account has been created!\n\nUsername: ${username}\nPassword: ${password}\n\nPlease login at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}/login\n\nBest regards,\nLocal Cooks Team`,
          html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Your Manager Account</title></head><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="color: white; margin: 0;">Local Cooks Community</h1></div><div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #333;">Hello ${name || 'Manager'},</h2><p>Your manager account has been created for the Local Cooks kitchen booking system!</p><div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid hsl(347, 91%, 51%); margin: 20px 0;"><h3 style="margin-top: 0; color: hsl(347, 91%, 51%);">Your Login Credentials</h3><p><strong>Username:</strong> ${username}</p><p><strong>Temporary Password:</strong> <code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${password}</code></p></div><p><strong>⚠️ Important:</strong> Please change your password after your first login for security.</p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="display: inline-block; background: hsl(347, 91%, 51%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Login Now</a><p style="margin-top: 30px; color: #666; font-size: 14px;">If you have any questions, please contact support.</p></div><div style="text-align: center; padding: 20px; color: #999; font-size: 12px;"><p>&copy; ${new Date().getFullYear()} Local Cooks Community. All rights reserved.</p></div></body></html>`
        };
        
        await sendEmail(welcomeEmail);
        console.log(`✅ Welcome email sent to manager: ${username}`);
      } catch (emailError) {
        console.error("Error sending manager welcome email:", emailError);
        // Don't fail manager creation if email fails
      }

      res.status(201).json({ success: true, managerId: manager.id });
    } catch (error: any) {
      console.error("Error creating manager:", error);
      console.error("Error details:", error.message, error.stack);
      res.status(500).json({ error: error.message || "Failed to create manager" });
    }
  });

  // Get all managers (admin only)
  app.get("/api/admin/managers", async (req: Request, res: Response) => {
    try {
      // Check authentication - support both session and Firebase auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      // Fetch all users with manager role and their managed locations with notification emails
      const { pool, db } = await import('./db');
      
      console.log('🔍 GET /api/admin/managers - Pool available?', !!pool);
      console.log('🔍 GET /api/admin/managers - DB available?', !!db);
      
      // CRITICAL: Always use pool if available (faster SQL aggregation)
      // Only fallback to Drizzle if pool is not available
      if (pool) {
        console.log('✅ Using pool query for GET /api/admin/managers');
        
        // Get managers with their locations and notification emails
        // CRITICAL: Use COALESCE with json_agg to ensure we always get an array (even if empty)
        const result = await pool.query(
          `SELECT 
            u.id, 
            u.username, 
            u.role,
            COALESCE(
              json_agg(
                json_build_object(
                  'locationId', l.id,
                  'locationName', l.name,
                  'notificationEmail', l.notification_email
                )
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) as locations
          FROM users u
          LEFT JOIN locations l ON l.manager_id = u.id
          WHERE u.role = $1
          GROUP BY u.id, u.username, u.role
          ORDER BY u.username ASC`,
          ['manager']
        );
        
        console.log('📊 Database query executed, rows returned:', result.rows.length);
        if (result.rows.length > 0) {
          console.log('📊 First row from database:', {
            id: result.rows[0].id,
            username: result.rows[0].username,
            role: result.rows[0].role,
            locations: result.rows[0].locations,
            locationsType: typeof result.rows[0].locations,
            locationsIsArray: Array.isArray(result.rows[0].locations)
          });
        }
        
        // Transform the result to include notification emails in a flat structure
        console.log(`📊 Raw database result - ${result.rows.length} manager(s) found`);
        if (result.rows.length > 0) {
          console.log(`📊 First row keys:`, Object.keys(result.rows[0]));
          console.log(`📊 First row locations property:`, result.rows[0].locations);
          console.log(`📊 First row locations type:`, typeof result.rows[0].locations);
        }
        
        const managersWithEmails = result.rows.map((row: any) => {
          // Parse JSON if it's a string, otherwise use as-is
          // PostgreSQL json_agg returns JSON as a string or object depending on driver
          let locations = row.locations;
          
          console.log(`🔍 Manager ${row.id} (${row.username}): raw locations =`, typeof locations, locations);
          console.log(`🔍 Manager ${row.id}: row object keys:`, Object.keys(row));
          
          // Handle different return types from PostgreSQL
          // COALESCE in SQL should ensure we get []::json, but handle all cases
          if (locations === null || locations === undefined) {
            console.log(`⚠️ Manager ${row.id}: locations is null/undefined, using empty array`);
            locations = [];
          } else if (typeof locations === 'string') {
            try {
              // Handle empty JSON array string
              const trimmed = locations.trim();
              if (trimmed === '[]' || trimmed === '' || trimmed === 'null') {
                locations = [];
                console.log(`✅ Manager ${row.id}: Empty locations string converted to array`);
              } else {
                locations = JSON.parse(locations);
                console.log(`✅ Manager ${row.id}: Parsed JSON string, got ${Array.isArray(locations) ? locations.length : 'non-array'} items`);
              }
            } catch (e) {
              console.error(`❌ Error parsing locations JSON for manager ${row.id}:`, e, 'Raw value:', locations);
              locations = [];
            }
          } else if (typeof locations === 'object') {
            // Already parsed JSON object/array
            console.log(`✅ Manager ${row.id}: locations is already object, isArray=${Array.isArray(locations)}`);
          }
          
          // Ensure locations is an array (handle case where it's already parsed)
          if (!Array.isArray(locations)) {
            console.warn(`⚠️ Manager ${row.id} locations is not an array after processing:`, typeof locations, locations);
            // Try to extract array if it's wrapped in an object
            if (locations && typeof locations === 'object' && '0' in locations) {
              locations = Object.values(locations);
            } else {
              locations = [];
            }
          }
          
          console.log(`✅ Manager ${row.id} (${row.username}) FINAL: ${locations.length} location(s):`, JSON.stringify(locations, null, 2));
          
          // Get all notification emails from locations managed by this manager
          // Handle both camelCase (from mapping) and raw snake_case
          const notificationEmails = locations
            .map((loc: any) => loc.notificationEmail || loc.notification_email)
            .filter((email: string) => email && email.trim() !== '');
          
          // STEP 4: Map to consistent structure (camelCase)
          const mappedLocations = locations.map((loc: any) => {
            // Handle both camelCase and snake_case from database
            const locationId = loc.locationId || loc.location_id || loc.id;
            const locationName = loc.locationName || loc.location_name || loc.name;
            const notificationEmail = loc.notificationEmail || loc.notification_email || null;
            
            return {
              locationId: locationId,
              locationName: locationName,
              notificationEmail: notificationEmail
            };
          });
          
          // CRITICAL: Build managerData with explicit locations property
          const managerData: any = {
            id: row.id,
            username: row.username,
            role: row.role,
          };
          
          // EXPLICITLY set locations property - do not rely on object spread
          managerData.locations = mappedLocations;
          
          console.log(`📦 Manager ${row.id} FINAL structure (BEFORE return):`, {
            id: managerData.id,
            username: managerData.username,
            role: managerData.role,
            hasLocationsProperty: 'locations' in managerData,
            locationsCount: managerData.locations?.length || 0,
            locationsIsArray: Array.isArray(managerData.locations),
            locationsValue: managerData.locations,
            fullObject: JSON.stringify(managerData, null, 2)
          });
          
          // Verify the object has locations before returning
          if (!('locations' in managerData)) {
            console.error(`❌ CRITICAL ERROR: Manager ${row.id} object missing locations property!`);
            managerData.locations = [];
          }
          
          return managerData;
        });
        
        console.log('📤 GET /api/admin/managers - managersWithEmails.length:', managersWithEmails.length);
        if (managersWithEmails.length > 0) {
          const firstManager = managersWithEmails[0];
          console.log('📤 managersWithEmails[0] keys:', Object.keys(firstManager));
          console.log('📤 managersWithEmails[0] has locations?', 'locations' in firstManager);
          console.log('📤 managersWithEmails[0].locations:', firstManager.locations);
          console.log('📤 managersWithEmails[0].locations type:', typeof firstManager.locations);
          console.log('📤 managersWithEmails[0].locations is array?', Array.isArray(firstManager.locations));
          console.log('📤 managersWithEmails[0] FULL OBJECT:', JSON.stringify(firstManager, null, 2));
        }
        
        // FINAL VERIFICATION: Ensure every manager has a locations array before sending
        const verifiedManagers = managersWithEmails.map((manager: any) => {
          // CRITICAL: Explicitly check and ensure locations property exists
          if (!manager.hasOwnProperty('locations')) {
            console.error(`❌ Manager ${manager.id} is missing locations property! Adding it.`);
            manager.locations = [];
          } else if (!Array.isArray(manager.locations)) {
            console.warn(`⚠️ Manager ${manager.id} has locations but it's not an array (${typeof manager.locations}), converting`);
            manager.locations = Array.isArray(manager.locations) ? manager.locations : [];
          }
          
          // Return a new object with explicit structure to ensure properties are preserved
          return {
            id: manager.id,
            username: manager.username,
            role: manager.role,
            locations: Array.isArray(manager.locations) ? manager.locations : []
          };
        });
        
        console.log('📤 FINAL VERIFIED - First manager structure:', {
          id: verifiedManagers[0]?.id,
          username: verifiedManagers[0]?.username,
          role: verifiedManagers[0]?.role,
          hasLocations: 'locations' in verifiedManagers[0],
          locationsCount: verifiedManagers[0]?.locations?.length || 0,
          locationsIsArray: Array.isArray(verifiedManagers[0]?.locations),
          locations: verifiedManagers[0]?.locations,
          fullJSON: JSON.stringify(verifiedManagers[0], null, 2)
        });
        
        // CRITICAL: Log what we're actually sending
        console.log('📤 SENDING RESPONSE - Full response array:', JSON.stringify(verifiedManagers, null, 2));
        
        return res.json(verifiedManagers);
      } else {
        // Fallback to Drizzle if pool is not available
        try {
        console.log('⚠️ Using Drizzle fallback for GET /api/admin/managers');
        const { users, locations } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const managerRows = await db
          .select({ id: users.id, username: users.username, role: users.role })
          .from(users)
          .where(eq(users.role as any, 'manager'));
        
        console.log(`Found ${managerRows.length} managers with Drizzle`);
        
        // Get locations for each manager
        const managersWithLocations = await Promise.all(
          managerRows.map(async (manager) => {
            const managerLocations = await db
              .select()
              .from(locations)
              .where(eq(locations.managerId, manager.id));
            
            console.log(`Manager ${manager.id} has ${managerLocations.length} locations`);
            
            const notificationEmails = managerLocations
              .map(loc => (loc as any).notificationEmail || (loc as any).notification_email)
              .filter(email => email && email.trim() !== '');
            
            // CRITICAL: Build managerData with explicit locations property
            const managerData: any = {
              id: manager.id,
              username: manager.username,
              role: manager.role,
            };
            
            // EXPLICITLY set locations property
            managerData.locations = managerLocations.map(loc => ({
              locationId: loc.id,
              locationName: (loc as any).name,
              notificationEmail: (loc as any).notificationEmail || (loc as any).notification_email || null
            }));
            
            console.log(`📤 Drizzle Manager ${manager.id} final structure:`, {
              id: managerData.id,
              username: managerData.username,
              role: managerData.role,
              hasLocations: 'locations' in managerData,
              locationCount: managerData.locations.length,
              locations: managerData.locations,
              fullJSON: JSON.stringify(managerData, null, 2)
            });
            
            return managerData;
          })
        );
        
        console.log('📤 Drizzle fallback returning', managersWithLocations.length, 'managers');
        if (managersWithLocations.length > 0) {
          console.log('📤 Drizzle managersWithLocations[0] FULL:', JSON.stringify(managersWithLocations[0], null, 2));
        }
        // CRITICAL: Return managersWithLocations directly - it already has locations properly mapped
        return res.json(managersWithLocations);
      } catch (e) {
        console.error('❌ Error fetching managers with Drizzle:', e);
        return res.json([]);
      }
    } catch (error: any) {
      console.error("Error fetching managers:", error);
      res.status(500).json({ error: error.message || "Failed to fetch managers" });
    }
  });

  // Manager change password endpoint
  app.post("/api/manager/change-password", async (req: Request, res: Response) => {
    try {
      // Check authentication - support both session and Firebase auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "manager") {
        return res.status(403).json({ error: "Manager access required" });
      }

      const { currentPassword, newPassword } = req.body;

      // Validate required fields
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current password and new password are required" });
      }

      // Validate new password strength
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters long" });
      }

      // Get full user data to verify current password
      const fullUser = await storage.getUser(user.id);
      if (!fullUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Verify current password
      const passwordMatches = await comparePasswords(currentPassword, fullUser.password);
      if (!passwordMatches) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      // Update password using direct database query
      const hashedNewPassword = await hashPassword(newPassword);
      const { pool } = await import('./db');
      if (pool) {
        await pool.query(
          'UPDATE users SET password = $1 WHERE id = $2',
          [hashedNewPassword, user.id]
        );
      } else {
        // Fallback for in-memory storage
        const memUser = await storage.getUser(user.id);
        if (memUser) {
          (memUser as any).password = hashedNewPassword;
        }
      }

      // Mark that manager has changed password (set has_seen_welcome to true)
      await storage.setUserHasSeenWelcome(user.id);

      res.json({ success: true, message: "Password changed successfully" });
    } catch (error: any) {
      console.error("Error changing password:", error);
      res.status(500).json({ error: error.message || "Failed to change password" });
    }
  });

  // Get all locations (admin)
  app.get("/api/admin/locations", async (req: Request, res: Response) => {
    try {
      // Check authentication - support both session and Firebase auth
      const isSessionAuth = req.isAuthenticated?.();
      const isFirebaseAuth = req.neonUser;
      
      if (!isSessionAuth && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : req.user!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const locations = await firebaseStorage.getAllLocations();
      
      // Map snake_case fields to camelCase for the frontend (consistent with manager endpoint)
      // Drizzle ORM may return snake_case depending on configuration, so we ensure camelCase
      const mappedLocations = locations.map((loc: any) => ({
        ...loc,
        managerId: loc.managerId || loc.manager_id || null,
        notificationEmail: loc.notificationEmail || loc.notification_email || null,
        cancellationPolicyHours: loc.cancellationPolicyHours || loc.cancellation_policy_hours || 24,
        cancellationPolicyMessage: loc.cancellationPolicyMessage || loc.cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
        defaultDailyBookingLimit: loc.defaultDailyBookingLimit || loc.default_daily_booking_limit || 2,
        createdAt: loc.createdAt || loc.created_at,
        updatedAt: loc.updatedAt || loc.updated_at,
      }));
      
      res.json(mappedLocations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // Create location (admin)
  app.post("/api/admin/locations", async (req: Request, res: Response) => {
    try {
      // Check authentication - support both session and Firebase auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { name, address, managerId } = req.body;
      
      // Convert managerId to number or undefined
      // Handle empty strings, null, undefined, and convert to number
      let managerIdNum: number | undefined = undefined;
      if (managerId !== undefined && managerId !== null && managerId !== '') {
        managerIdNum = parseInt(managerId.toString());
        if (isNaN(managerIdNum) || managerIdNum <= 0) {
          return res.status(400).json({ error: "Invalid manager ID format" });
        }
        
        // Validate that the manager exists and has manager role
        // Use firebaseStorage to be consistent with location creation
        const manager = await firebaseStorage.getUser(managerIdNum);
        if (!manager) {
          return res.status(400).json({ error: `Manager with ID ${managerIdNum} does not exist` });
        }
        if (manager.role !== 'manager') {
          return res.status(400).json({ error: `User with ID ${managerIdNum} is not a manager` });
        }
      }
      
      console.log('Creating location with:', { name, address, managerId: managerIdNum });
      
      const location = await firebaseStorage.createLocation({ 
        name, 
        address, 
        managerId: managerIdNum,
        notificationEmail: req.body.notificationEmail || undefined
      });
      
      // Map snake_case to camelCase for consistent API response
      const mappedLocation = {
        ...location,
        managerId: (location as any).managerId || (location as any).manager_id || null,
        notificationEmail: (location as any).notificationEmail || (location as any).notification_email || null,
        cancellationPolicyHours: (location as any).cancellationPolicyHours || (location as any).cancellation_policy_hours || 24,
        cancellationPolicyMessage: (location as any).cancellationPolicyMessage || (location as any).cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
        defaultDailyBookingLimit: (location as any).defaultDailyBookingLimit || (location as any).default_daily_booking_limit || 2,
        createdAt: (location as any).createdAt || (location as any).created_at,
        updatedAt: (location as any).updatedAt || (location as any).updated_at,
      };
      
      res.status(201).json(mappedLocation);
    } catch (error: any) {
      console.error("Error creating location:", error);
      console.error("Error details:", error.message, error.stack);
      res.status(500).json({ error: error.message || "Failed to create location" });
    }
  });

  // Get kitchens for a location (admin)
  app.get("/api/admin/kitchens/:locationId", async (req: Request, res: Response) => {
    try {
      // Check authentication - support both session and Firebase auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId) || locationId <= 0) {
        return res.status(400).json({ error: "Invalid location ID" });
      }

      const kitchens = await firebaseStorage.getKitchensByLocation(locationId);
      res.json(kitchens);
    } catch (error: any) {
      console.error("Error fetching kitchens:", error);
      res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
    }
  });

  // Create kitchen (admin)
  app.post("/api/admin/kitchens", async (req: Request, res: Response) => {
    try {
      // Check authentication - support both session and Firebase auth
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { locationId, name, description } = req.body;
      
      // Validate required fields
      if (!locationId || !name) {
        return res.status(400).json({ error: "Location ID and name are required" });
      }
      
      // Validate locationId is a valid number
      const locationIdNum = parseInt(locationId.toString());
      if (isNaN(locationIdNum) || locationIdNum <= 0) {
        return res.status(400).json({ error: "Invalid location ID format" });
      }
      
      // Validate that the location exists
      const location = await firebaseStorage.getLocationById(locationIdNum);
      if (!location) {
        return res.status(400).json({ error: `Location with ID ${locationIdNum} does not exist` });
      }
      
      const kitchen = await firebaseStorage.createKitchen({ locationId: locationIdNum, name, description, isActive: true });
      res.status(201).json(kitchen);
    } catch (error: any) {
      console.error("Error creating kitchen:", error);
      console.error("Error details:", error.message, error.stack);
      // Provide better error messages
      if (error.code === '23503') { // Foreign key constraint violation
        return res.status(400).json({ error: 'The selected location does not exist or is invalid.' });
      }
      res.status(500).json({ error: error.message || "Failed to create kitchen" });
    }
  });

  // Update location (admin)
  // IMPORTANT: Route registration order matters - specific routes before catch-all
  app.put("/api/admin/locations/:id", async (req: Request, res: Response) => {
    try {
      console.log(`📍 PUT /api/admin/locations/:id - Request received for location ID: ${req.params.id}`);
      console.log(`📍 Request body:`, JSON.stringify(req.body, null, 2));
      
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        console.error('❌ PUT /api/admin/locations/:id - Not authenticated');
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        console.error(`❌ PUT /api/admin/locations/:id - User ${user.id} is not admin (role: ${user.role})`);
        return res.status(403).json({ error: "Admin access required" });
      }

      const locationId = parseInt(req.params.id);
      if (isNaN(locationId) || locationId <= 0) {
        console.error(`❌ Invalid location ID: ${req.params.id}`);
        return res.status(400).json({ error: "Invalid location ID" });
      }
      
      console.log(`✅ Validated - updating location ${locationId} for admin user ${user.id}`);

      const { name, address, managerId, notificationEmail } = req.body;
      
      // Validate managerId if provided
      let managerIdNum: number | undefined | null = undefined;
      if (managerId !== undefined && managerId !== null && managerId !== '') {
        managerIdNum = parseInt(managerId.toString());
        if (isNaN(managerIdNum) || managerIdNum <= 0) {
          return res.status(400).json({ error: "Invalid manager ID format" });
        }
        
        // Validate that the manager exists and has manager role
        const manager = await firebaseStorage.getUser(managerIdNum);
        if (!manager) {
          return res.status(400).json({ error: `Manager with ID ${managerIdNum} does not exist` });
        }
        if (manager.role !== 'manager') {
          return res.status(400).json({ error: `User with ID ${managerIdNum} is not a manager` });
        }
      } else if (managerId === null || managerId === '') {
        // Explicitly allow setting to null
        managerIdNum = null;
      }

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (address !== undefined) updates.address = address;
      if (managerIdNum !== undefined) updates.managerId = managerIdNum;

      console.log(`💾 Updating location ${locationId} with:`, updates);
      
      const updated = await firebaseStorage.updateLocation(locationId, updates);
      if (!updated) {
        console.error(`❌ Location ${locationId} not found in database`);
        return res.status(404).json({ error: "Location not found" });
      }
      
      console.log(`✅ Location ${locationId} updated successfully`);
      
      // Map snake_case to camelCase for consistent API response (matching getAllLocations pattern)
      const mappedLocation = {
        ...updated,
        managerId: (updated as any).managerId || (updated as any).manager_id || null,
        notificationEmail: (updated as any).notificationEmail || (updated as any).notification_email || null,
        cancellationPolicyHours: (updated as any).cancellationPolicyHours || (updated as any).cancellation_policy_hours || 24,
        cancellationPolicyMessage: (updated as any).cancellationPolicyMessage || (updated as any).cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
        defaultDailyBookingLimit: (updated as any).defaultDailyBookingLimit || (updated as any).default_daily_booking_limit || 2,
        createdAt: (updated as any).createdAt || (updated as any).created_at,
        updatedAt: (updated as any).updatedAt || (updated as any).updated_at,
      };
      
      return res.json(mappedLocation);
    } catch (error: any) {
      console.error("❌ Error updating location:", error);
      console.error("Error stack:", error.stack);
      res.status(500).json({ error: error.message || "Failed to update location" });
    }
  });

  // Delete location (admin)
  app.delete("/api/admin/locations/:id", async (req: Request, res: Response) => {
    try {
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const locationId = parseInt(req.params.id);
      if (isNaN(locationId) || locationId <= 0) {
        return res.status(400).json({ error: "Invalid location ID" });
      }

      await firebaseStorage.deleteLocation(locationId);
      res.json({ success: true, message: "Location deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting location:", error);
      res.status(500).json({ error: error.message || "Failed to delete location" });
    }
  });

  // Update kitchen (admin)
  app.put("/api/admin/kitchens/:id", async (req: Request, res: Response) => {
    try {
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const kitchenId = parseInt(req.params.id);
      if (isNaN(kitchenId) || kitchenId <= 0) {
        return res.status(400).json({ error: "Invalid kitchen ID" });
      }

      const { name, description, isActive, locationId } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;
      if (locationId !== undefined) {
        const locationIdNum = parseInt(locationId.toString());
        if (isNaN(locationIdNum) || locationIdNum <= 0) {
          return res.status(400).json({ error: "Invalid location ID format" });
        }
        
        // Validate that the location exists
        const location = await firebaseStorage.getLocationById(locationIdNum);
        if (!location) {
          return res.status(400).json({ error: `Location with ID ${locationIdNum} does not exist` });
        }
        updates.locationId = locationIdNum;
      }

      const updated = await firebaseStorage.updateKitchen(kitchenId, updates);
      if (!updated) {
        return res.status(404).json({ error: "Kitchen not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating kitchen:", error);
      res.status(500).json({ error: error.message || "Failed to update kitchen" });
    }
  });

  // Delete kitchen (admin)
  app.delete("/api/admin/kitchens/:id", async (req: Request, res: Response) => {
    try {
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const kitchenId = parseInt(req.params.id);
      if (isNaN(kitchenId) || kitchenId <= 0) {
        return res.status(400).json({ error: "Invalid kitchen ID" });
      }

      await firebaseStorage.deleteKitchen(kitchenId);
      res.json({ success: true, message: "Kitchen deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting kitchen:", error);
      res.status(500).json({ error: error.message || "Failed to delete kitchen" });
    }
  });

  // Update manager (admin)
  // IMPORTANT: Route registration order matters - specific routes before catch-all
  app.put("/api/admin/managers/:id", async (req: Request, res: Response) => {
    try {
      console.log(`📍 PUT /api/admin/managers/:id - Request received for manager ID: ${req.params.id}`);
      console.log(`📍 Request body:`, JSON.stringify(req.body, null, 2));
      
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        console.error('❌ PUT /api/admin/managers/:id - Not authenticated');
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        console.error(`❌ PUT /api/admin/managers/:id - User ${user.id} is not admin (role: ${user.role})`);
        return res.status(403).json({ error: "Admin access required" });
      }

      const managerId = parseInt(req.params.id);
      if (isNaN(managerId) || managerId <= 0) {
        console.error(`❌ Invalid manager ID: ${req.params.id}`);
        return res.status(400).json({ error: "Invalid manager ID" });
      }
      
      console.log(`✅ Validated - updating manager ${managerId} for admin user ${user.id}`);

      const { username, role, isManager, locationNotificationEmails } = req.body;
      
      // Verify the user exists and is a manager
      const manager = await firebaseStorage.getUser(managerId);
      if (!manager) {
        return res.status(404).json({ error: "Manager not found" });
      }
      if (manager.role !== 'manager') {
        return res.status(400).json({ error: "User is not a manager" });
      }

      const updates: any = {};
      if (username !== undefined) {
        // Check if username is already taken by another user
        const existingUser = await firebaseStorage.getUserByUsername(username);
        if (existingUser && existingUser.id !== managerId) {
          return res.status(400).json({ error: "Username already exists" });
        }
        updates.username = username;
      }
      if (role !== undefined) updates.role = role;
      if (isManager !== undefined) updates.isManager = isManager;

      const updated = await firebaseStorage.updateUser(managerId, updates);
      if (!updated) {
        return res.status(404).json({ error: "Failed to update manager" });
      }
      
      // Update notification emails for locations managed by this manager
      if (locationNotificationEmails && Array.isArray(locationNotificationEmails)) {
        const { db } = await import('./db');
        const { locations } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        
        // Get all locations managed by this manager
        const managedLocations = await db
          .select()
          .from(locations)
          .where(eq(locations.managerId, managerId));
        
        // Update each location's notification email
        for (const emailUpdate of locationNotificationEmails) {
          if (emailUpdate.locationId && emailUpdate.notificationEmail !== undefined) {
            const locationId = parseInt(emailUpdate.locationId.toString());
            if (!isNaN(locationId)) {
              // Validate email format if provided and not empty
              const email = emailUpdate.notificationEmail?.trim() || '';
              if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                console.warn(`Invalid email format for location ${locationId}: ${email}`);
                continue; // Skip invalid emails
              }
              
              await db
                .update(locations)
                .set({ 
                  notificationEmail: email || null,
                  updatedAt: new Date()
                })
                .where(eq(locations.id, locationId));
              
              console.log(`✅ Updated notification email for location ${locationId}: ${email || 'null'}`);
            }
          }
        }
      }
      
      // Return updated manager with location info
      const { locations } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const managedLocations = await db
        .select()
        .from(locations)
        .where(eq(locations.managerId, managerId));
      
      const notificationEmails = managedLocations
        .map(loc => (loc as any).notificationEmail || (loc as any).notification_email)
        .filter(email => email && email.trim() !== '');
      
      const response = {
        ...updated,
        locations: managedLocations.map(loc => ({
          locationId: loc.id,
          locationName: (loc as any).name,
          notificationEmail: (loc as any).notificationEmail || (loc as any).notification_email || null
        })),
        notificationEmails: notificationEmails,
        primaryNotificationEmail: notificationEmails.length > 0 ? notificationEmails[0] : null
      };
      
      res.json(response);
    } catch (error: any) {
      console.error("Error updating manager:", error);
      res.status(500).json({ error: error.message || "Failed to update manager" });
    }
  });

  // Delete manager (admin)
  app.delete("/api/admin/managers/:id", async (req: Request, res: Response) => {
    try {
      const sessionUser = await getAuthenticatedUser(req);
      const isFirebaseAuth = req.neonUser;
      
      if (!sessionUser && !isFirebaseAuth) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const managerId = parseInt(req.params.id);
      if (isNaN(managerId) || managerId <= 0) {
        return res.status(400).json({ error: "Invalid manager ID" });
      }

      // Prevent deleting yourself
      if (managerId === user.id) {
        return res.status(400).json({ error: "You cannot delete your own account" });
      }

      // Verify the user exists and is a manager
      const manager = await firebaseStorage.getUser(managerId);
      if (!manager) {
        return res.status(404).json({ error: "Manager not found" });
      }
      if (manager.role !== 'manager') {
        return res.status(400).json({ error: "User is not a manager" });
      }

      await firebaseStorage.deleteUser(managerId);
      res.json({ success: true, message: "Manager deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting manager:", error);
      res.status(500).json({ error: error.message || "Failed to delete manager" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
