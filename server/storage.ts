import { applications, microlearningCompletions, users, videoProgress, type Application, type InsertApplication, type InsertUser, type UpdateApplicationDocuments, type UpdateApplicationStatus, type UpdateDocumentVerification, type User } from "@shared/schema";
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
  getUserByOAuthId(provider: string, oauthId: string): Promise<User | undefined>;
  createUser(user: {
    username: string;
    password: string;
    role?: "admin" | "applicant";
    googleId?: string;
    facebookId?: string;
  }): Promise<User>;
  createOAuthUser(user: {
    username: string;
    role: "admin" | "applicant";
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

  // Session store for authentication
  sessionStore: session.Store;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private applications: Map<number, Application>;
  private videoProgress: Map<string, any>; // key: userId-videoId
  private microlearningCompletions: Map<number, any>; // key: userId
  private userCurrentId: number;
  private applicationCurrentId: number;
  sessionStore: session.Store;
  // TypeScript fixes for instagramId and twitterId

  constructor() {
    this.users = new Map();
    this.applications = new Map();
    this.videoProgress = new Map();
    this.microlearningCompletions = new Map();
    this.userCurrentId = 1;
    this.applicationCurrentId = 1;
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
      isVerified: true,
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

  async createUser(insertUser: InsertUser & { googleId?: string, facebookId?: string }): Promise<User> {
    // Ensure insertUser has the required properties
    if (!insertUser.username || insertUser.password === undefined) {
      throw new Error("Username and password are required");
    }
    
    // Create user in memory instead of database
    const user: User = {
      id: this.userCurrentId++,
      username: insertUser.username,
      password: insertUser.password,
      role: insertUser.role || "applicant",
      googleId: insertUser.googleId || null,
      facebookId: insertUser.facebookId || null,
      isVerified: false,
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
      status: "new",
      
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
      facebookId?: string
    } = {
      ...rest,
      password: '', // No password for OAuth users
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
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
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

  async createUser(insertUser: InsertUser & { googleId?: string, facebookId?: string }): Promise<User> {
    // Ensure insertUser has the required properties
    if (!insertUser.username || insertUser.password === undefined) {
      throw new Error("Username and password are required");
    }
    
    const [user] = await db
      .insert(users)
      .values({
        username: insertUser.username,
        password: insertUser.password,
        role: insertUser.role || "applicant",
        googleId: insertUser.googleId || null,
        facebookId: insertUser.facebookId || null,
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
        status: "new",
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
      facebookId?: string
    } = {
      ...rest,
      password: '', // No password for OAuth users
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

    const updateData = {
      progress: progress?.toString() || "0",
      completed: completed || false,
      completedAt: completed && completedAt ? new Date(completedAt) : null,
      updatedAt: new Date(),
      watchedPercentage: watchedPercentage?.toString() || "0",
      isRewatching: isRewatching || false,
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
}

// Switch from in-memory to database storage
// Use database storage if DATABASE_URL is set, otherwise use memory storage
export const storage = process.env.DATABASE_URL
  ? new DatabaseStorage()
  : new MemStorage();
