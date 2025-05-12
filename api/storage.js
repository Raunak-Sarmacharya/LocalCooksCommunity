// Simplified storage implementation for Vercel serverless functions
import { query } from './db.js';

// Backup in-memory storage for fallback
const useDatabase = process.env.DATABASE_URL ? true : false;

const users = new Map();
const applications = new Map();
const sessions = new Map();

// Helper function to safely execute database queries
async function executeQuery(sql, params = []) {
  if (useDatabase) {
    try {
      // Use database connection
      const result = await query(sql, params);
      return result;
    } catch (error) {
      console.error('Database query error:', error);
      return null;
    }
  }
  return null; // Fallback to in-memory if database not configured
}

export const storage = {
  // Session store implementation
  sessionStore: {
    get: (sid, cb) => cb(null, sessions.get(sid)),
    set: (sid, sess, cb) => { sessions.set(sid, sess); cb(); },
    destroy: (sid, cb) => { sessions.delete(sid); cb(); },
  },
  
  // User-related methods
  getUser: async (id) => {
    if (neonClient) {
      try {
        const result = await executeQuery('SELECT * FROM users WHERE id = $1', [id]);
        return result && result.rows && result.rows.length > 0 ? result.rows[0] : undefined;
      } catch (error) {
        console.error('Error getting user by ID:', error);
      }
    }
    return users.get(id);
  },
  
  getUserByUsername: async (username) => {
    if (neonClient) {
      try {
        const result = await executeQuery('SELECT * FROM users WHERE username = $1', [username]);
        return result && result.rows && result.rows.length > 0 ? result.rows[0] : undefined;
      } catch (error) {
        console.error('Error getting user by username:', error);
      }
    }
    
    // Fallback to in-memory
    for (const user of users.values()) {
      if (user.username === username) return user;
    }
    return undefined;
  },
  
  getUserByOAuthId: async (provider, oauthId) => {
    for (const user of users.values()) {
      if ((provider === 'google' && user.googleId === oauthId) || 
          (provider === 'facebook' && user.facebookId === oauthId)) {
        return user;
      }
    }
    return undefined;
  },
  
  createUser: async (userData) => {
    const id = Date.now();
    const user = { 
      id, 
      ...userData,
      googleId: userData.googleId || null,
      facebookId: userData.facebookId || null,
      role: userData.role || 'applicant',
    };
    users.set(id, user);
    return user;
  },
  
  createOAuthUser: async (userData) => {
    const id = Date.now();
    const user = {
      id,
      username: userData.username,
      role: userData.role || 'applicant',
      password: null, // OAuth users don't have passwords
      googleId: userData.oauth_provider === 'google' ? userData.oauth_id : null,
      facebookId: userData.oauth_provider === 'facebook' ? userData.oauth_id : null,
    };
    users.set(id, user);
    return user;
  },
  
  // Application-related methods
  getAllApplications: async () => Array.from(applications.values()),
  
  getApplicationById: async (id) => applications.get(id),
  
  getApplicationsByUserId: async (userId) => {
    return Array.from(applications.values()).filter(app => app.userId === userId);
  },
  
  createApplication: async (data) => {
    const id = Date.now();
    const application = {
      ...data,
      id,
      status: 'new',
      createdAt: new Date(),
    };
    applications.set(id, application);
    return application;
  },
  
  updateApplicationStatus: async (update) => {
    const application = applications.get(update.id);
    if (!application) return undefined;
    
    const updatedApplication = {
      ...application,
      status: update.status,
    };
    applications.set(update.id, updatedApplication);
    return updatedApplication;
  },
};