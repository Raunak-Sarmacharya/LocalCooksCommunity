import { Pool, neonConfig } from '@neondatabase/serverless';
import * as schema from "@shared/schema";
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";

neonConfig.webSocketConstructor = ws;

// Only throw error if database URL is missing when trying to use database
if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL not set - falling back to in-memory storage");
}

// Create pool and database connection if DATABASE_URL exists
export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : {} as Pool;

export const db = process.env.DATABASE_URL
  ? drizzle(pool, { schema })
  : {} as ReturnType<typeof drizzle>;