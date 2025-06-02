import { applications, type Application, type InsertApplication, applicationStatusEnum, type UpdateApplicationStatus } from "@shared/schema";
import { users, type User, type InsertUser } from "@shared/schema";
import { documentVerifications, type DocumentVerification, type InsertDocumentVerification, type UpdateDocumentVerification } from "@shared/schema";
import session from "express-session";
import { eq } from "drizzle-orm";
import { db } from "./db";
import createMemoryStore from "memorystore";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

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
  updateUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined>;

  // Application-related methods
  getAllApplications(): Promise<Application[]>;
  getApplicationById(id: number): Promise<Application | undefined>;
  getApplicationsByUserId(userId: number): Promise<Application[]>;
  createApplication(application: InsertApplication): Promise<Application>;
  updateApplicationStatus(update: UpdateApplicationStatus): Promise<Application | undefined>;

  // Document verification methods
  getDocumentVerificationByUserId(userId: number): Promise<DocumentVerification | undefined>;
  createDocumentVerification(verification: InsertDocumentVerification): Promise<DocumentVerification>;
  updateDocumentVerification(update: UpdateDocumentVerification): Promise<DocumentVerification | undefined>;
  getAllDocumentVerifications(): Promise<DocumentVerification[]>;

  // Session store for authentication
  sessionStore: session.Store;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private applications: Map<number, Application>;
  private documentVerifications: Map<number, DocumentVerification>;
  private userCurrentId: number;
  private applicationCurrentId: number;
  private documentVerificationCurrentId: number;
  sessionStore: session.Store;
  // TypeScript fixes for instagramId and twitterId

  constructor() {
    this.users = new Map();
    this.applications = new Map();
    this.documentVerifications = new Map();
    this.userCurrentId = 1;
    this.applicationCurrentId = 1;
    this.documentVerificationCurrentId = 1;
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000 // 24hrs
    });
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
    for (const user of this.users.values()) {
      if (user.googleId === googleId) return user;
    }
    return undefined;
  }

  async getUserByFacebookId(facebookId: string): Promise<User | undefined> {
    if (!facebookId) return undefined;
    for (const user of this.users.values()) {
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
      feedback: insertApplication.feedback || null, // Include feedback field
      status: "new",
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

  async updateUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (user) {
      const updatedUser: User = {
        ...user,
        isVerified,
      };
      this.users.set(userId, updatedUser);
      return updatedUser;
    }
    return undefined;
  }

  // Document verification methods
  async getDocumentVerificationByUserId(userId: number): Promise<DocumentVerification | undefined> {
    return Array.from(this.documentVerifications.values()).find(
      (verification) => verification.userId === userId
    );
  }

  async createDocumentVerification(verification: InsertDocumentVerification): Promise<DocumentVerification> {
    const id = this.documentVerificationCurrentId++;
    const now = new Date();

    const documentVerification: DocumentVerification = {
      id,
      userId: verification.userId,
      foodSafetyLicenseUrl: verification.foodSafetyLicenseUrl || null,
      foodEstablishmentCertUrl: verification.foodEstablishmentCertUrl || null,
      foodSafetyLicenseStatus: 'pending',
      foodEstablishmentCertStatus: 'pending',
      adminFeedback: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.documentVerifications.set(id, documentVerification);
    return documentVerification;
  }

  async updateDocumentVerification(update: UpdateDocumentVerification): Promise<DocumentVerification | undefined> {
    const verification = this.documentVerifications.get(update.id);

    if (!verification) {
      return undefined;
    }

    const now = new Date();
    const updatedVerification: DocumentVerification = {
      ...verification,
      foodSafetyLicenseStatus: update.foodSafetyLicenseStatus || verification.foodSafetyLicenseStatus,
      foodEstablishmentCertStatus: update.foodEstablishmentCertStatus || verification.foodEstablishmentCertStatus,
      adminFeedback: update.adminFeedback !== undefined ? update.adminFeedback : verification.adminFeedback,
      reviewedBy: update.reviewedBy,
      reviewedAt: now,
      updatedAt: now,
    };

    this.documentVerifications.set(update.id, updatedVerification);
    
    // Check if user should be marked as verified
    const isFullyVerified = updatedVerification.foodSafetyLicenseStatus === 'approved' && 
                           (updatedVerification.foodEstablishmentCertStatus === 'approved' || 
                            !updatedVerification.foodEstablishmentCertUrl);

    if (isFullyVerified) {
      await this.updateUserVerificationStatus(updatedVerification.userId, true);
    }

    return updatedVerification;
  }

  async getAllDocumentVerifications(): Promise<DocumentVerification[]> {
    return Array.from(this.documentVerifications.values());
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
    if (!instagramId) return undefined;
    const [user] = await db.select().from(users).where(eq(users.instagramId, instagramId));
    return user || undefined;
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
        isVerified: false,
      })
      .returning();

    return user;
  }

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

  async updateUserVerificationStatus(userId: number, isVerified: boolean): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ isVerified })
      .where(eq(users.id, userId))
      .returning();

    return updatedUser || undefined;
  }

  // Document verification methods
  async getDocumentVerificationByUserId(userId: number): Promise<DocumentVerification | undefined> {
    const [verification] = await db
      .select()
      .from(documentVerifications)
      .where(eq(documentVerifications.userId, userId));
    return verification || undefined;
  }

  async createDocumentVerification(verification: InsertDocumentVerification): Promise<DocumentVerification> {
    const now = new Date();

    const [createdVerification] = await db
      .insert(documentVerifications)
      .values({
        ...verification,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return createdVerification;
  }

  async updateDocumentVerification(update: UpdateDocumentVerification): Promise<DocumentVerification | undefined> {
    const { id, ...updateData } = update;
    const now = new Date();

    const [updatedVerification] = await db
      .update(documentVerifications)
      .set({
        ...updateData,
        updatedAt: now,
        reviewedAt: now,
      })
      .where(eq(documentVerifications.id, id))
      .returning();

    return updatedVerification || undefined;
  }

  async getAllDocumentVerifications(): Promise<DocumentVerification[]> {
    return await db.select().from(documentVerifications);
  }
}

// Switch between in-memory and database storage based on DATABASE_URL
const hasValidDatabaseUrl = process.env.DATABASE_URL && 
                           !process.env.DATABASE_URL.includes('dummy') && 
                           !process.env.DATABASE_URL.includes('username:password@hostname');

export const storage = hasValidDatabaseUrl 
  ? new DatabaseStorage()
  : new MemStorage();

console.log(`📦 Storage: Using ${hasValidDatabaseUrl ? 'Database' : 'In-Memory'} storage`);
if (!hasValidDatabaseUrl) {
  console.log('💡 To use database storage, set a valid DATABASE_URL in your .env file');
}
