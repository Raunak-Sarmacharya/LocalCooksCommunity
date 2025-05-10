import { applications, type Application, type InsertApplication, applicationStatusEnum, type UpdateApplicationStatus } from "@shared/schema";
import { users, type User, type InsertUser } from "@shared/schema";
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
  createUser(user: InsertUser): Promise<User>;
  createOAuthUser(user: Omit<InsertUser, 'password'> & { 
    oauth_provider: string;
    oauth_id: string;
    profile_data?: string;
  }): Promise<User>;
  
  // Application-related methods
  getAllApplications(): Promise<Application[]>;
  getApplicationById(id: number): Promise<Application | undefined>;
  getApplicationsByUserId(userId: number): Promise<Application[]>;
  createApplication(application: InsertApplication): Promise<Application>;
  updateApplicationStatus(update: UpdateApplicationStatus): Promise<Application | undefined>;
  
  // Session store for authentication
  sessionStore: session.Store;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private applications: Map<number, Application>;
  private userCurrentId: number;
  private applicationCurrentId: number;
  sessionStore: session.Store;

  constructor() {
    this.users = new Map();
    this.applications = new Map();
    this.userCurrentId = 1;
    this.applicationCurrentId = 1;
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

  async getUserByInstagramId(instagramId: string): Promise<User | undefined> {
    if (!instagramId) return undefined;
    for (const user of this.users.values()) {
      if (user.instagramId === instagramId) return user;
    }
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
      twitterId: null,
      googleId: insertUser.googleId || null,
      facebookId: insertUser.facebookId || null,
      instagramId: null,
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
    const user: User = {
      id: this.userCurrentId++,
      username: insertUser.username,
      password: insertUser.password,
      role: insertUser.role || "applicant",
      twitterId: null,
      googleId: insertUser.googleId || null,
      facebookId: insertUser.facebookId || null,
      instagramId: null,
    };
    this.users.set(user.id, user);
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
}

// Switch from in-memory to database storage
export const storage = new MemStorage();
/* Temporarily disabled DatabaseStorage to avoid database errors
export const storage = process.env.NODE_ENV === "development" 
  ? new MemStorage()
  : new DatabaseStorage();
*/
