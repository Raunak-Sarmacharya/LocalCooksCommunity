import { applications, deliveryPartnerApplications, microlearningCompletions, users, videoProgress, type Application, type DeliveryPartnerApplication, type InsertApplication, type InsertDeliveryPartnerApplication, type InsertUser, type UpdateApplicationDocuments, type UpdateApplicationStatus, type UpdateDeliveryPartnerApplicationStatus, type UpdateDeliveryPartnerDocuments, type UpdateDeliveryPartnerDocumentVerification, type UpdateDocumentVerification, type User } from "../shared/schema.js.js";
import connectPg from "connect-pg-simple";
import { and, eq } from "drizzle-orm";
import session from "express-session";
import createMemoryStore from "memorystore";
import { db, pool } from "./db";
import { cleanupApplicationDocuments } from "./fileUpload";

// Memory store implementation for in-memory sessions
const MemoryStore = createMemoryStore(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined>;
  updateUserFirebaseUid(userId: number, firebaseUid: string): Promise<User | undefined>;
  getUserByOAuthId(provider: string, oauthId: string): Promise<User | undefined>;
  createUser(user: {
    username: string;
    password: string;
    role?: "admin" | "chef" | "delivery_partner" | "manager";
    isChef?: boolean;
    isDeliveryPartner?: boolean;
    isManager?: boolean;
    googleId?: string;
    facebookId?: string;
    firebaseUid?: string;
  }): Promise<User>;
  createOAuthUser(user: {
    username: string;
    role: "admin" | "chef" | "delivery_partner" | "manager";
    isChef?: boolean;
    isDeliveryPartner?: boolean;
    isManager?: boolean;
    oauth_provider: string;
    oauth_id: string;
    profile_data?: string;
  }): Promise<User>;

  // Application-related methods (now includes document verification)
  getAllApplications(): Promise<Application[]>;
  getApplicationById(id: number): Promise<Application | undefined>;
  getApplicationsByUserId(userId: number): Promise<Application[]>;
  createApplication(application: InsertApplication): Promise<Application>;
  updateApplicationStatus(update: UpdateApplicationStatus): Promise<Application | undefined>;
  updateApplicationDocuments(update: UpdateApplicationDocuments): Promise<Application | undefined>;
  updateApplicationDocumentVerification(update: UpdateDocumentVerification): Promise<Application | undefined>;
  updateUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined>;

  // Microlearning-related methods
  getMicrolearningProgress(userId: number): Promise<any[]>;
  getMicrolearningCompletion(userId: number): Promise<any | undefined>;
  updateVideoProgress(progressData: any): Promise<void>;
  createMicrolearningCompletion(completionData: any): Promise<any>;

  // Delivery Partner Application-related methods
  getAllDeliveryPartnerApplications(): Promise<DeliveryPartnerApplication[]>;
  getDeliveryPartnerApplicationById(id: number): Promise<DeliveryPartnerApplication | undefined>;
  getDeliveryPartnerApplicationsByUserId(userId: number): Promise<DeliveryPartnerApplication[]>;
  createDeliveryPartnerApplication(application: InsertDeliveryPartnerApplication): Promise<DeliveryPartnerApplication>;
  updateDeliveryPartnerApplicationStatus(update: UpdateDeliveryPartnerApplicationStatus): Promise<DeliveryPartnerApplication | undefined>;
  updateDeliveryPartnerApplicationDocuments(update: UpdateDeliveryPartnerDocuments): Promise<DeliveryPartnerApplication | undefined>;
  updateDeliveryPartnerApplicationDocumentVerification(update: UpdateDeliveryPartnerDocumentVerification): Promise<DeliveryPartnerApplication | undefined>;
  updateDeliveryPartnerUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined>;
  updateUserApplicationType(userId: number, applicationType: 'chef' | 'delivery_partner'): Promise<User | undefined>;

  // Session store for authentication
  sessionStore: session.Store;

  setUserHasSeenWelcome(userId: number | string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private applications: Map<number, Application>;
  private deliveryPartnerApplications: Map<number, DeliveryPartnerApplication>;
  private videoProgress: Map<string, any>; // key: userId-videoId
  private microlearningCompletions: Map<number, any>; // key: userId
  private userCurrentId: number;
  private applicationCurrentId: number;
  private deliveryPartnerApplicationCurrentId: number;
  sessionStore: session.Store;
  // TypeScript fixes for instagramId and twitterId

  constructor() {
    this.users = new Map();
    this.applications = new Map();
    this.deliveryPartnerApplications = new Map();
    this.videoProgress = new Map();
    this.microlearningCompletions = new Map();
    this.userCurrentId = 1;
    this.applicationCurrentId = 1;
    this.deliveryPartnerApplicationCurrentId = 1;
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000 // 24hrs
    });

    // Initialize with a default admin user for development
    this.initializeDefaultAdmin();
  }

  private async initializeDefaultAdmin() {
    // Create default admin user: username "admin", password "localcooks"
    // Using the same password hash as in the production setup
    const adminUser: User = {
      id: this.userCurrentId++,
      username: "admin",
      password: "fcf0872ea0a0c91f3d8e64dc5005c9b6a36371eddc6c1127a3c0b45c71db5b72f85c5e93b80993ec37c6aff8b08d07b68e9c58f28e3bd20d9d2a4eb38992aad0.ef32a41b7d478668", // "localcooks"
      role: "admin",
      googleId: null,
      facebookId: null,
      firebaseUid: null,
      isVerified: true,
      has_seen_welcome: true,
      isManager: false,
      isChef: false,
      isDeliveryPartner: false,
      isPortalUser: false,
      applicationType: null,
    };
    this.users.set(adminUser.id, adminUser);
    console.log("Development: Default admin user created (username: admin, password: localcooks)");
  }

  // User-related methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    // For in-memory storage, we don't have firebase_uid field, so return undefined
    // This will fall back to username/email lookup
    return undefined;
  }

  async updateUserFirebaseUid(userId: number, firebaseUid: string): Promise<User | undefined> {
    // For in-memory storage, we don't store firebase_uid, so just return the user
    return this.getUser(userId);
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    if (!googleId) return undefined;
    for (const user of Array.from(this.users.values())) {
      if (user.googleId === googleId) return user;
    }
    return undefined;
  }

  async getUserByFacebookId(facebookId: string): Promise<User | undefined> {
    if (!facebookId) return undefined;
    for (const user of Array.from(this.users.values())) {
      if (user.facebookId === facebookId) return user;
    }
    return undefined;
  }

  // Instagram authentication was removed
  async getUserByInstagramId(instagramId: string): Promise<User | undefined> {
    return undefined;
  }

  async createUser(insertUser: InsertUser & { googleId?: string, facebookId?: string, firebaseUid?: string }): Promise<User> {
    // Ensure insertUser has the required properties
    if (!insertUser.username || insertUser.password === undefined) {
      throw new Error("Username and password are required");
    }
    
    // Create user in memory instead of database
    const user: User = {
      id: this.userCurrentId++,
      username: insertUser.username,
      password: insertUser.password,
      role: insertUser.role || "chef",
      googleId: insertUser.googleId || null,
      facebookId: insertUser.facebookId || null,
      firebaseUid: insertUser.firebaseUid || null,
      isVerified: (insertUser as any).isVerified !== undefined ? (insertUser as any).isVerified : false,
      has_seen_welcome: (insertUser as any).has_seen_welcome !== undefined ? (insertUser as any).has_seen_welcome : false,
      isChef: insertUser.isChef || false,
      isDeliveryPartner: insertUser.isDeliveryPartner || false,
      isManager: insertUser.isManager || false,
      isPortalUser: (insertUser as any).isPortalUser !== undefined ? (insertUser as any).isPortalUser : false,
      applicationType: (insertUser as any).applicationType || null,
    };

    this.users.set(user.id, user);
    return user;
  }

  // Application-related methods
  async getAllApplications(): Promise<Application[]> {
    return Array.from(this.applications.values());
  }

  async getApplicationById(id: number): Promise<Application | undefined> {
    return this.applications.get(id);
  }

  async getApplicationsByUserId(userId: number): Promise<Application[]> {
    return Array.from(this.applications.values()).filter(
      (application) => application.userId === userId
    );
  }

  async createApplication(insertApplication: InsertApplication): Promise<Application> {
    const id = this.applicationCurrentId++;
    const now = new Date();

    // Create application with properly typed userId (null if not provided)
    const application: Application = {
      id,
      userId: insertApplication.userId || null,
      fullName: insertApplication.fullName,
      email: insertApplication.email,
      phone: insertApplication.phone,
      foodSafetyLicense: insertApplication.foodSafetyLicense,
      foodEstablishmentCert: insertApplication.foodEstablishmentCert,
      kitchenPreference: insertApplication.kitchenPreference,
      feedback: insertApplication.feedback || null,
      status: "inReview",
      
      // Initialize document verification fields
      foodSafetyLicenseUrl: insertApplication.foodSafetyLicenseUrl || null,
      foodEstablishmentCertUrl: insertApplication.foodEstablishmentCertUrl || null,
      foodSafetyLicenseStatus: "pending",
      foodEstablishmentCertStatus: "pending",
      documentsAdminFeedback: null,
      documentsReviewedBy: null,
      documentsReviewedAt: null,
      
      createdAt: now,
    };

    this.applications.set(id, application);
    return application;
  }

  async updateApplicationStatus(update: UpdateApplicationStatus): Promise<Application | undefined> {
    const application = this.applications.get(update.id);

    if (!application) {
      return undefined;
    }

    // Clean up documents if application is being cancelled
    if (update.status === "cancelled") {
      cleanupApplicationDocuments(application);
    }

    const updatedApplication: Application = {
      ...application,
      status: update.status,
    };

    this.applications.set(update.id, updatedApplication);
    return updatedApplication;
  }

  async getUserByOAuthId(provider: string, oauthId: string): Promise<User | undefined> {
    if (!oauthId) return undefined;

    if (provider === 'google') {
      return this.getUserByGoogleId(oauthId);
    } else if (provider === 'facebook') {
      return this.getUserByFacebookId(oauthId);
    }

    return undefined;
  }

  async createOAuthUser(userData: Omit<InsertUser, 'password'> & {
    oauth_provider: string;
    oauth_id: string;
    profile_data?: string;
  }): Promise<User> {
    const { oauth_provider, oauth_id, ...rest } = userData;

    // Create user with OAuth provider details
    const insertData: InsertUser & {
      googleId?: string,
      facebookId?: string,
      isVerified?: boolean,
      has_seen_welcome?: boolean
    } = {
      ...rest,
      password: '', // No password for OAuth users
      isVerified: oauth_provider === 'google' ? true : false,
      has_seen_welcome: false,
    };

    // Set the appropriate OAuth ID based on provider
    if (oauth_provider === 'google') {
      insertData.googleId = oauth_id;
    } else if (oauth_provider === 'facebook') {
      insertData.facebookId = oauth_id;
    }

    return this.createUser(insertData);
  }

  // Application-related methods (now includes document verification)
  async updateApplicationDocuments(update: UpdateApplicationDocuments): Promise<Application | undefined> {
    const application = this.applications.get(update.id);

    if (!application) {
      return undefined;
    }

    const updatedApplication: Application = {
      ...application,
      ...update,
      // Reset document status to pending when new documents are uploaded
      ...(update.foodSafetyLicenseUrl && { foodSafetyLicenseStatus: "pending" }),
      ...(update.foodEstablishmentCertUrl && { foodEstablishmentCertStatus: "pending" }),
    };

    this.applications.set(update.id, updatedApplication);
    return updatedApplication;
  }

  async updateApplicationDocumentVerification(update: UpdateDocumentVerification): Promise<Application | undefined> {
    const application = this.applications.get(update.id);

    if (!application) {
      return undefined;
    }

    const updatedApplication: Application = {
      ...application,
      ...update,
      documentsReviewedAt: new Date(),
    };

    this.applications.set(update.id, updatedApplication);
    return updatedApplication;
  }

  async updateUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined> {
    const user = this.users.get(userId);
    
    if (!user) {
      return undefined;
    }

    const updatedUser: User = {
      ...user,
      isVerified,
    };

    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  // Microlearning methods
  async getMicrolearningProgress(userId: number): Promise<any[]> {
    const progress = [];
    for (const [key, value] of Array.from(this.videoProgress.entries())) {
      if (key.startsWith(`${userId}-`)) {
        progress.push(value);
      }
    }
    return progress;
  }

  async getMicrolearningCompletion(userId: number): Promise<any | undefined> {
    return this.microlearningCompletions.get(userId);
  }

  async updateVideoProgress(progressData: any): Promise<void> {
    const key = `${progressData.userId}-${progressData.videoId}`;
    const existingProgress = this.videoProgress.get(key);
    
    // If the video was already completed, preserve the completion status and date
    // unless explicitly setting it to completed again
    if (existingProgress && existingProgress.completed && !progressData.completed) {
      // User is re-watching a completed video - preserve completion status
      this.videoProgress.set(key, {
        ...progressData,
        completed: true, // Keep it marked as completed
        completedAt: existingProgress.completedAt, // Preserve original completion date
        isRewatching: true // Flag to indicate this is a rewatch
      });
    } else {
      // New video or explicitly marking as completed
      this.videoProgress.set(key, {
        ...progressData,
        isRewatching: existingProgress?.completed || false
      });
    }
  }

  async createMicrolearningCompletion(completionData: any): Promise<any> {
    this.microlearningCompletions.set(completionData.userId, completionData);
    return completionData;
  }

  // Delivery Partner Application-related methods
  async getAllDeliveryPartnerApplications(): Promise<DeliveryPartnerApplication[]> {
    return Array.from(this.deliveryPartnerApplications.values());
  }

  async getDeliveryPartnerApplicationById(id: number): Promise<DeliveryPartnerApplication | undefined> {
    return this.deliveryPartnerApplications.get(id);
  }

  async getDeliveryPartnerApplicationsByUserId(userId: number): Promise<DeliveryPartnerApplication[]> {
    return Array.from(this.deliveryPartnerApplications.values()).filter(
      (application) => application.userId === userId
    );
  }

  async createDeliveryPartnerApplication(insertApplication: InsertDeliveryPartnerApplication): Promise<DeliveryPartnerApplication> {
    const id = this.deliveryPartnerApplicationCurrentId++;
    const now = new Date();

    // Create application with all required delivery partner fields
    const application: DeliveryPartnerApplication = {
      id,
      userId: insertApplication.userId || null,
      fullName: insertApplication.fullName,
      email: insertApplication.email,
      phone: insertApplication.phone,
      address: insertApplication.address,
      city: insertApplication.city,
      province: insertApplication.province,
      postalCode: insertApplication.postalCode,
      
      // Vehicle details
      vehicleType: insertApplication.vehicleType,
      vehicleMake: insertApplication.vehicleMake,
      vehicleModel: insertApplication.vehicleModel,
      vehicleYear: insertApplication.vehicleYear,
      licensePlate: insertApplication.licensePlate,
      
      // Document URLs
      driversLicenseUrl: insertApplication.driversLicenseUrl || null,
      vehicleRegistrationUrl: insertApplication.vehicleRegistrationUrl || null,
      insuranceUrl: insertApplication.insuranceUrl || null,
      
      // Document verification status
      driversLicenseStatus: "pending",
      vehicleRegistrationStatus: "pending",
      insuranceStatus: "pending",
      
      // Admin fields
      documentsAdminFeedback: null,
      documentsReviewedBy: null,
      documentsReviewedAt: null,
      
      feedback: null,
      status: "inReview",
      createdAt: now,
    };

    this.deliveryPartnerApplications.set(id, application);
    return application;
  }

  async updateDeliveryPartnerApplicationStatus(update: UpdateApplicationStatus): Promise<DeliveryPartnerApplication | undefined> {
    const application = this.deliveryPartnerApplications.get(update.id);

    if (!application) {
      return undefined;
    }

    // Clean up documents if application is being cancelled
    if (update.status === "cancelled") {
      // No specific document cleanup for delivery partner applications yet
    }

    const updatedApplication: DeliveryPartnerApplication = {
      ...application,
      status: update.status,
    };

    this.deliveryPartnerApplications.set(update.id, updatedApplication);
    return updatedApplication;
  }

  async updateDeliveryPartnerApplicationDocuments(update: UpdateDeliveryPartnerDocuments): Promise<DeliveryPartnerApplication | undefined> {
    const application = this.deliveryPartnerApplications.get(update.id);

    if (!application) {
      return undefined;
    }

    const updatedApplication: DeliveryPartnerApplication = {
      ...application,
      ...update,
      // Reset document status to pending when new documents are uploaded
      ...(update.driversLicenseUrl && { driversLicenseStatus: "pending" }),
      ...(update.vehicleRegistrationUrl && { vehicleRegistrationStatus: "pending" }),
      ...(update.insuranceUrl && { insuranceStatus: "pending" }),
      ...(update.backgroundCheckUrl && { backgroundCheckStatus: "pending" }),
    };

    this.deliveryPartnerApplications.set(update.id, updatedApplication);
    return updatedApplication;
  }

  async updateDeliveryPartnerApplicationDocumentVerification(update: UpdateDeliveryPartnerDocumentVerification): Promise<DeliveryPartnerApplication | undefined> {
    const application = this.deliveryPartnerApplications.get(update.id);

    if (!application) {
      return undefined;
    }

    const updatedApplication: DeliveryPartnerApplication = {
      ...application,
      ...update,
      documentsReviewedAt: new Date(),
    };

    this.deliveryPartnerApplications.set(update.id, updatedApplication);
    return updatedApplication;
  }

  async updateDeliveryPartnerUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined> {
    const user = this.users.get(userId);
    
    if (!user) {
      return undefined;
    }

    const updatedUser: User = {
      ...user,
      isVerified,
    };

    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async updateUserApplicationType(userId: number, applicationType: 'chef' | 'delivery_partner'): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) {
      return undefined;
    }
    const updatedUser: User = {
      ...user,
      applicationType: applicationType,
    };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async setUserHasSeenWelcome(userId: number | string): Promise<void> {
    try {
      await pool.query(
        'UPDATE users SET has_seen_welcome = true WHERE id = $1',
        [userId]
      );
    } catch (error) {
      console.error('Error setting has_seen_welcome:', error);
      throw new Error('Failed to set has_seen_welcome');
    }
  }
}

// PostgreSQL-based database storage implementation
export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    const PostgresSessionStore = connectPg(session);
    this.sessionStore = new PostgresSessionStore({
      pool,
      createTableIfMissing: true
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    try {
      if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL not configured');
        throw new Error('Database not configured');
      }
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user || undefined;
    } catch (error) {
      console.error('Error in getUser:', error);
      throw error;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL not configured');
        throw new Error('Database not configured');
      }
      const [user] = await db.select().from(users).where(eq(users.username, username));
      return user || undefined;
    } catch (error) {
      console.error('Error in getUserByUsername:', error);
      throw error;
    }
  }

  async getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    // Note: The schema doesn't include firebase_uid, but the actual database has it
    // We'll use a raw query to access it
    if (!pool) return undefined;
    
    try {
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [firebaseUid]);
      return result.rows[0] || undefined;
    } catch (error) {
      console.error('Error getting user by firebase_uid:', error);
      return undefined;
    }
  }

  async updateUserFirebaseUid(userId: number, firebaseUid: string): Promise<User | undefined> {
    if (!pool) return undefined;
    
    try {
      const result = await pool.query(
        'UPDATE users SET firebase_uid = $1 WHERE id = $2 RETURNING *',
        [firebaseUid, userId]
      );
      return result.rows[0] || undefined;
    } catch (error) {
      console.error('Error updating user firebase_uid:', error);
      return undefined;
    }
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    if (!googleId) return undefined;
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user || undefined;
  }

  async getUserByFacebookId(facebookId: string): Promise<User | undefined> {
    if (!facebookId) return undefined;
    const [user] = await db.select().from(users).where(eq(users.facebookId, facebookId));
    return user || undefined;
  }

  async getUserByInstagramId(instagramId: string): Promise<User | undefined> {
    // Instagram authentication was removed - always return undefined
    return undefined;
  }

  async createUser(insertUser: InsertUser & { googleId?: string, facebookId?: string, firebaseUid?: string, isVerified?: boolean, has_seen_welcome?: boolean }): Promise<User> {
    // Ensure insertUser has the required properties
    if (!insertUser.username || insertUser.password === undefined) {
      throw new Error("Username and password are required");
    }
    
    // Use raw query to include firebase_uid since it's not in the schema
    if (pool && insertUser.firebaseUid) {
      try {
        const result = await pool.query(
          'INSERT INTO users (username, password, role, google_id, facebook_id, firebase_uid, is_verified, has_seen_welcome, is_chef, is_delivery_partner, is_manager) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
          [
            insertUser.username,
            insertUser.password,
            insertUser.role || (() => {
              console.error(`❌ CRITICAL ERROR: No role provided to createUser in storage.js!`);
              console.error(`   - This should not happen - role should always be provided`);
              throw new Error('Role is required when creating a user. This is a programming error.');
            })(),
            insertUser.googleId || null,
            insertUser.facebookId || null,
            insertUser.firebaseUid,
            insertUser.isVerified !== undefined ? insertUser.isVerified : false,
            insertUser.has_seen_welcome !== undefined ? insertUser.has_seen_welcome : false,
            insertUser.isChef || false,
            insertUser.isDeliveryPartner || false,
            insertUser.isManager || false
          ]
        );
        return result.rows[0];
      } catch (error) {
        console.error('Error creating user with firebase_uid:', error);
        throw error;
      }
    }
    
    // Fallback to schema-based insert without firebase_uid
    const [user] = await db
      .insert(users)
      .values({
        username: insertUser.username,
        password: insertUser.password,
        role: insertUser.role || "chef",
        googleId: insertUser.googleId || null,
        facebookId: insertUser.facebookId || null,
        isVerified: insertUser.isVerified !== undefined ? insertUser.isVerified : false,
        has_seen_welcome: insertUser.has_seen_welcome !== undefined ? insertUser.has_seen_welcome : false,
        isChef: insertUser.isChef || false,
        isDeliveryPartner: insertUser.isDeliveryPartner || false,
        isManager: insertUser.isManager || false,
      })
      .returning();

    return user;
  }

  // Application-related methods
  async getAllApplications(): Promise<Application[]> {
    return await db.select().from(applications);
  }

  async getApplicationById(id: number): Promise<Application | undefined> {
    const [application] = await db.select().from(applications).where(eq(applications.id, id));
    return application || undefined;
  }

  async getApplicationsByUserId(userId: number): Promise<Application[]> {
    return await db.select().from(applications).where(eq(applications.userId, userId));
  }

  async createApplication(insertApplication: InsertApplication): Promise<Application> {
    const now = new Date();

    const [application] = await db
      .insert(applications)
      .values({
        ...insertApplication,
        status: "inReview",
        createdAt: now,
      })
      .returning();

    return application;
  }

  async updateApplicationStatus(update: UpdateApplicationStatus): Promise<Application | undefined> {
    const { id, status } = update;

    // Fetch the application before updating
    const [application] = await db.select().from(applications).where(eq(applications.id, id));

    // Clean up documents if application is being cancelled
    if (application && status === "cancelled") {
      cleanupApplicationDocuments(application);
    }

    const [updatedApplication] = await db
      .update(applications)
      .set({ status })
      .where(eq(applications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async getUserByOAuthId(provider: string, oauthId: string): Promise<User | undefined> {
    if (!oauthId) return undefined;

    if (provider === 'google') {
      return this.getUserByGoogleId(oauthId);
    } else if (provider === 'facebook') {
      return this.getUserByFacebookId(oauthId);
    }

    return undefined;
  }

  async createOAuthUser(userData: Omit<InsertUser, 'password'> & {
    oauth_provider: string;
    oauth_id: string;
    profile_data?: string;
  }): Promise<User> {
    const { oauth_provider, oauth_id, ...rest } = userData;

    // Create user with OAuth provider details
    const insertData: InsertUser & {
      googleId?: string,
      facebookId?: string,
      isVerified?: boolean,
      has_seen_welcome?: boolean
    } = {
      ...rest,
      password: '', // No password for OAuth users
      isVerified: oauth_provider === 'google' ? true : false,
      has_seen_welcome: false,
    };

    // Set the appropriate OAuth ID based on provider
    if (oauth_provider === 'google') {
      insertData.googleId = oauth_id;
    } else if (oauth_provider === 'facebook') {
      insertData.facebookId = oauth_id;
    }

    return this.createUser(insertData);
  }

  // Application-related methods (now includes document verification)
  async updateApplicationDocuments(update: UpdateApplicationDocuments): Promise<Application | undefined> {
    const { id, ...updateData } = update;

    const [updatedApplication] = await db
      .update(applications)
      .set({
        ...updateData,
        // Reset document status to pending when new documents are uploaded
        ...(updateData.foodSafetyLicenseUrl && { foodSafetyLicenseStatus: "pending" }),
        ...(updateData.foodEstablishmentCertUrl && { foodEstablishmentCertStatus: "pending" }),
      })
      .where(eq(applications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async updateApplicationDocumentVerification(update: UpdateDocumentVerification): Promise<Application | undefined> {
    const { id, ...updateData } = update;

    const [updatedApplication] = await db
      .update(applications)
      .set({
        ...updateData,
        documentsReviewedAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async updateUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ isVerified })
      .where(eq(users.id, userId))
      .returning();

    return updatedUser || undefined;
  }

  // Microlearning methods
  async getMicrolearningProgress(userId: number): Promise<any[]> {
    const progressRecords = await db.select().from(videoProgress).where(eq(videoProgress.userId, userId));
    return progressRecords.map(record => ({
      videoId: record.videoId,
      progress: parseFloat(record.progress.toString()),
      completed: record.completed,
      completedAt: record.completedAt,
      watchedPercentage: parseFloat(record.watchedPercentage.toString()),
      isRewatching: record.isRewatching,
    }));
  }

  async getMicrolearningCompletion(userId: number): Promise<any | undefined> {
    const [completion] = await db.select().from(microlearningCompletions).where(eq(microlearningCompletions.userId, userId));
    return completion || undefined;
  }

  async updateVideoProgress(progressData: any): Promise<void> {
    const { userId, videoId, progress, completed, completedAt, watchedPercentage, isRewatching } = progressData;
    
    // Check if record exists
    const existingProgress = await db.select()
      .from(videoProgress)
      .where(and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId)))
      .limit(1);

    const existing = existingProgress[0];
    
    // Preserve completion status - if video was already completed, keep it completed
    // unless explicitly setting it to completed again
    const finalCompleted = completed || (existing?.completed || false);
    const finalCompletedAt = finalCompleted ? (existing?.completedAt || (completed ? new Date(completedAt) : new Date())) : null;

    const updateData = {
      progress: progress?.toString() || "0",
      completed: finalCompleted,
      completedAt: finalCompletedAt,
      updatedAt: new Date(),
      watchedPercentage: watchedPercentage?.toString() || "0",
      isRewatching: isRewatching || (existing?.completed || false), // Mark as rewatching if previously completed
    };

    if (existingProgress.length > 0) {
      // Update existing record
      await db.update(videoProgress)
        .set(updateData)
        .where(and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId)));
    } else {
      // Insert new record
      await db.insert(videoProgress)
        .values({
          userId,
          videoId,
          ...updateData,
        });
    }
  }

  async createMicrolearningCompletion(completionData: any): Promise<any> {
    const { userId, confirmed, certificateGenerated, videoProgress: videoProgressData } = completionData;
    
    // Check if completion already exists
    const existingCompletion = await db.select()
      .from(microlearningCompletions)
      .where(eq(microlearningCompletions.userId, userId))
      .limit(1);

    const completionRecord = {
      userId,
      confirmed: confirmed || false,
      certificateGenerated: certificateGenerated || false,
      videoProgress: videoProgressData || [],
      updatedAt: new Date(),
    };

    if (existingCompletion.length > 0) {
      // Update existing completion
      const [updated] = await db.update(microlearningCompletions)
        .set(completionRecord)
        .where(eq(microlearningCompletions.userId, userId))
        .returning();
      return updated;
    } else {
      // Insert new completion
      const [inserted] = await db.insert(microlearningCompletions)
        .values({
          ...completionRecord,
          completedAt: new Date(),
          createdAt: new Date(),
        })
        .returning();
      return inserted;
    }
  }

  // Delivery Partner Application-related methods
  async getAllDeliveryPartnerApplications(): Promise<DeliveryPartnerApplication[]> {
    return await db.select().from(deliveryPartnerApplications);
  }

  async getDeliveryPartnerApplicationById(id: number): Promise<DeliveryPartnerApplication | undefined> {
    const [application] = await db.select().from(deliveryPartnerApplications).where(eq(deliveryPartnerApplications.id, id));
    return application || undefined;
  }

  async getDeliveryPartnerApplicationsByUserId(userId: number): Promise<DeliveryPartnerApplication[]> {
    return await db.select().from(deliveryPartnerApplications).where(and(eq(deliveryPartnerApplications.userId, userId)));
  }

  async createDeliveryPartnerApplication(insertApplication: InsertDeliveryPartnerApplication): Promise<DeliveryPartnerApplication> {
    const now = new Date();

    const [application] = await db
      .insert(deliveryPartnerApplications)
      .values({
        ...insertApplication,
        status: "inReview",
        createdAt: now,
      })
      .returning();

    return application;
  }

  async updateDeliveryPartnerApplicationStatus(update: UpdateApplicationStatus): Promise<DeliveryPartnerApplication | undefined> {
    const { id, status } = update;

    // Fetch the application before updating
    const [application] = await db.select().from(deliveryPartnerApplications).where(eq(deliveryPartnerApplications.id, id));

    // Clean up documents if application is being cancelled
    if (application && status === "cancelled") {
      // No specific document cleanup for delivery partner applications yet
    }

    const [updatedApplication] = await db
      .update(deliveryPartnerApplications)
      .set({ status })
      .where(eq(deliveryPartnerApplications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async updateDeliveryPartnerApplicationDocuments(update: UpdateDeliveryPartnerDocuments): Promise<DeliveryPartnerApplication | undefined> {
    const { id, ...updateData } = update;

    const [updatedApplication] = await db
      .update(deliveryPartnerApplications)
      .set({
        ...updateData,
        // Reset document status to pending when new documents are uploaded
        ...(updateData.driversLicenseUrl && { driversLicenseStatus: "pending" }),
        ...(updateData.vehicleRegistrationUrl && { vehicleRegistrationStatus: "pending" }),
        ...(updateData.insuranceUrl && { insuranceStatus: "pending" }),
        ...(updateData.backgroundCheckUrl && { backgroundCheckStatus: "pending" }),
      })
      .where(eq(deliveryPartnerApplications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async updateDeliveryPartnerApplicationDocumentVerification(update: UpdateDocumentVerification): Promise<DeliveryPartnerApplication | undefined> {
    const { id, ...updateData } = update;

    const [updatedApplication] = await db
      .update(deliveryPartnerApplications)
      .set({
        ...updateData,
        documentsReviewedAt: new Date(),
      })
      .where(eq(deliveryPartnerApplications.id, id))
      .returning();

    return updatedApplication || undefined;
  }

  async updateDeliveryPartnerUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ isVerified })
      .where(eq(users.id, userId))
      .returning();

    return updatedUser || undefined;
  }

  async updateUserApplicationType(userId: number, applicationType: 'chef' | 'delivery_partner'): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ applicationType })
      .where(eq(users.id, userId))
      .returning();

    return updatedUser || undefined;
  }

  async setUserHasSeenWelcome(userId: number | string): Promise<void> {
    try {
      await pool.query(
        'UPDATE users SET has_seen_welcome = true WHERE id = $1',
        [userId]
      );
    } catch (error) {
      console.error('Error setting has_seen_welcome:', error);
      throw new Error('Failed to set has_seen_welcome');
    }
  }
}

// Switch from in-memory to database storage
// Use database storage if DATABASE_URL is set, otherwise use memory storage
export const storage = process.env.DATABASE_URL
  ? new DatabaseStorage()
  : new MemStorage();

// TEMPORARILY DISABLED - Missing DatabaseUser type
/*
export const getUserByEmail = async (email: string): Promise<DatabaseUser | null> => {
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by email:', error);
    return null;
  }
};
*/

// TEMPORARILY DISABLED - Password reset functionality incomplete
/*
export const storePasswordResetToken = async (userId: string, token: string, expiry: Date): Promise<void> => {
  try {
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()',
      [userId, token, expiry]
    );
  } catch (error) {
    console.error('Error storing password reset token:', error);
    throw new Error('Failed to store reset token');
  }
};
*/

// TEMPORARILY DISABLED - Missing DatabaseUser type
/*
export const getUserByResetToken = async (token: string): Promise<DatabaseUser | null> => {
  try {
    const result = await pool.query(
      `SELECT u.* FROM users u 
       JOIN password_reset_tokens prt ON u.id = prt.user_id 
       WHERE prt.token = $1 AND prt.expires_at > NOW()`,
      [token]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by reset token:', error);
    return null;
  }
};
*/

// TEMPORARILY DISABLED - Password reset and email verification functionality incomplete
/*
export const updateUserPassword = async (userId: string, hashedPassword: string): Promise<void> => {
  try {
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );
  } catch (error) {
    console.error('Error updating user password:', error);
    throw new Error('Failed to update password');
  }
};

export const clearPasswordResetToken = async (userId: string): Promise<void> => {
  try {
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [userId]
    );
  } catch (error) {
    console.error('Error clearing password reset token:', error);
    throw new Error('Failed to clear reset token');
  }
};

export const storeEmailVerificationToken = async (email: string, token: string, expiry: Date): Promise<void> => {
  try {
    await pool.query(
      'INSERT INTO email_verification_tokens (email, token, expires_at, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (email) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()',
      [email, token, expiry]
    );
  } catch (error) {
    console.error('Error storing email verification token:', error);
    throw new Error('Failed to store verification token');
  }
};

export const getEmailVerificationToken = async (token: string): Promise<{email: string} | null> => {
  try {
    const result = await pool.query(
      'SELECT email FROM email_verification_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting email verification token:', error);
    return null;
  }
};

export const markEmailAsVerified = async (email: string): Promise<void> => {
  try {
    await pool.query(
      'UPDATE users SET email_verified = true, updated_at = NOW() WHERE email = $1',
      [email]
    );
  } catch (error) {
    console.error('Error marking email as verified:', error);
    throw new Error('Failed to mark email as verified');
  }
};

export const clearEmailVerificationToken = async (token: string): Promise<void> => {
  try {
    await pool.query(
      'DELETE FROM email_verification_tokens WHERE token = $1',
      [token]
    );
  } catch (error) {
    console.error('Error clearing email verification token:', error);
    throw new Error('Failed to clear verification token');
  }
};
*/
