/**
 * @deprecated This file is deprecated and will be removed in a future version.
 * The user-exists functionality has been moved to server/routes.ts as part of the unified entry point.
 * All API requests now route through api/index.js (bundled from server/index.ts).
 * 
 * This file is kept temporarily for backward compatibility but should not be used.
 * The route is now available at: GET /api/user-exists (handled by server/routes.ts)
 */
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { pgTable, text, serial, boolean, pgEnum } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';

// Define schema directly in this file
const userRoleEnum = pgEnum('user_role', ['admin', 'applicant']);
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").default("applicant").notNull(),
  googleId: text("google_id").unique(),
  facebookId: text("facebook_id").unique(),
  isVerified: boolean("is_verified").default(false).notNull(),
});

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  try {
    // Create fresh database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool, { schema: { users } });
    
    // Check if user exists
    const [user] = await db.select().from(users).where(eq(users.username, username));
    
    return res.status(200).json({ exists: !!user });
  } catch (err) {
    console.error('Database error in user-exists:', err);
    return res.status(500).json({ 
      error: 'Database error', 
      details: err.message 
    });
  }
} 