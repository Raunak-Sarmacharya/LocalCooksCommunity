// Simplified database connectivity for serverless functions
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configure Neon database for serverless environment
neonConfig.webSocketConstructor = ws;

let pool;

export function getDbPool() {
  // Lazy initialization of database pool
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set');
      throw new Error('Database configuration missing');
    }
    
    pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      // Configuration optimized for serverless
      max: 1,
      connectionTimeoutMillis: 5000
    });
  }
  
  return pool;
}

export async function query(text, params) {
  const pool = getDbPool();
  
  try {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Handle cleanup when the serverless function terminates
process.on('beforeExit', async () => {
  if (pool) {
    await pool.end();
  }
});