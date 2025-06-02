import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Check if we have a valid database URL (not dummy/placeholder)
const hasValidDatabaseUrl = process.env.DATABASE_URL && 
                           !process.env.DATABASE_URL.includes('dummy') && 
                           !process.env.DATABASE_URL.includes('username:password@hostname');

const isInMemoryMode = !hasValidDatabaseUrl;

// Only throw error if not in in-memory mode and database URL is missing
if (!isInMemoryMode && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Create a mock pool object for in-memory mode
export const pool = isInMemoryMode ?
  {} as Pool :
  new Pool({ connectionString: process.env.DATABASE_URL });

// We'll only use this in database mode anyway
export const db = isInMemoryMode ?
  {} as ReturnType<typeof drizzle> :
  drizzle(pool, { schema });