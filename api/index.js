// Minimal Express server for Vercel
import { Pool } from '@neondatabase/serverless';
import connectPgSimple from 'connect-pg-simple';
import { randomBytes, scrypt } from 'crypto';
import express from 'express';
import session from 'express-session';
import fs from 'fs';
import createMemoryStore from 'memorystore';
import multer from 'multer';
import path from 'path';
import { promisify } from 'util';
// Default timezone constant (available immediately)
const DEFAULT_TIMEZONE = 'America/St_Johns';

// Lazy-load timezone utilities using dynamic import to avoid breaking module load
// This ensures login works while still providing proper timezone handling
let timezoneUtilsCache = null;

async function getTimezoneUtils() {
  if (!timezoneUtilsCache) {
    try {
      timezoneUtilsCache = await import('./shared/timezone-utils.js');
    } catch (error) {
      console.error('Failed to load timezone utilities, using fallback:', error);
      // Fallback to simple implementation if import fails
      timezoneUtilsCache = {
        DEFAULT_TIMEZONE,
        isBookingTimePast: (date, time, tz) => {
          const [year, month, day] = date.split('-').map(Number);
          const [hours, minutes] = time.split(':').map(Number);
          const bookingDate = new Date(year, month - 1, day, hours, minutes);
          return bookingDate < new Date();
        },
        getHoursUntilBooking: (date, time, tz) => {
          const [year, month, day] = date.split('-').map(Number);
          const [hours, minutes] = time.split(':').map(Number);
          const bookingDate = new Date(year, month - 1, day, hours, minutes);
          const diffMs = bookingDate.getTime() - new Date().getTime();
          return diffMs / (1000 * 60 * 60);
        }
      };
    }
  }
  return timezoneUtilsCache;
}

// Wrapper functions that use lazy-loaded utilities
async function isBookingTimePast(bookingDate, bookingTime, timezone = DEFAULT_TIMEZONE) {
  const utils = await getTimezoneUtils();
  return utils.isBookingTimePast(bookingDate, bookingTime, timezone);
}

async function getHoursUntilBooking(bookingDate, bookingTime, timezone = DEFAULT_TIMEZONE) {
  const utils = await getTimezoneUtils();
  return utils.getHoursUntilBooking(bookingDate, bookingTime, timezone);
}

// Setup
const app = express();
const scryptAsync = promisify(scrypt);
const MemoryStore = createMemoryStore(session);
const PgStore = connectPgSimple(session);

// Configure multer for file uploads
let upload;

try {
  // Check if we're in production
  const uploadIsProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  
  // File filter to only allow certain file types
  const fileFilter = (req, file, cb) => {
    // Allow PDF, JPG, JPEG, PNG files
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/webp'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, JPEG, PNG, and WebP files are allowed.'));
    }
  };

  if (uploadIsProduction) {
    // Production: Use memory storage for Vercel Blob
    const memoryStorage = multer.memoryStorage();
    upload = multer({
      storage: memoryStorage,
      fileFilter: fileFilter,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    });
  } else {
    // Development: Use disk storage
    const uploadsDir = path.join(process.cwd(), 'uploads', 'documents');
    
    // Only create directory in development
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const diskStorage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadsDir);
      },
      filename: (req, file, cb) => {
        // Generate unique filename: userId_documentType_timestamp_originalname
        const userId = req.session.userId || req.headers['x-user-id'] || 'unknown';
        const timestamp = Date.now();
        const documentType = file.fieldname; // 'foodSafetyLicense' or 'foodEstablishmentCert'
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        
        const filename = `${userId}_${documentType}_${timestamp}_${baseName}${ext}`;
        cb(null, filename);
      }
    });

    upload = multer({
      storage: diskStorage,
      fileFilter: fileFilter,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    });
  }

  console.log('File upload configuration initialized successfully');
} catch (error) {
  console.error('Failed to initialize file upload configuration:', error);
  // Create a proper dummy upload middleware with all required methods
  const dummyMiddleware = (req, res, next) => {
    res.status(500).json({ message: "File upload not available in this environment" });
  };
  
  upload = {
    single: () => dummyMiddleware,
    fields: () => dummyMiddleware,
    array: () => dummyMiddleware,
    any: () => dummyMiddleware,
    none: () => dummyMiddleware
  };
}

// Database connection with small pool size for serverless
let pool;
let sessionStore;

try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1 // Small pool for serverless
    });

    // Create PG session store
    sessionStore = new PgStore({
      pool: pool,
      createTableIfMissing: true,
      // Add automatic cleanup configuration
      pruneSessionInterval: 60 * 15, // Prune every 15 minutes (in seconds)
      errorLog: console.error,
      debugLog: console.log
    });

    console.log('Connected to database and initialized session store');

    // Create session table
    (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS "session" (
            "sid" varchar NOT NULL COLLATE "default",
            "sess" json NOT NULL,
            "expire" timestamp(6) NOT NULL,
            CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
          );
          CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);
        console.log('Session table created or verified');
      } catch (err) {
        console.error('Error setting up session table:', err);
      }
    })();

    // Run initial session cleanup on startup
    (async () => {
      try {
        console.log('Running startup session cleanup...');
        const cleanupResult = await cleanupExpiredSessions();
        console.log(`Startup cleanup: Removed ${cleanupResult.cleaned} expired sessions`);
        
        const stats = await getSessionStats();
        console.log('Session stats after startup cleanup:', {
          total: stats.total_sessions,
          active: stats.active_sessions,
          expired: stats.expired_sessions
        });
      } catch (err) {
        console.error('Error during startup session cleanup:', err);
      }
    })();

  } else {
    console.log('DATABASE_URL not provided, using in-memory storage');
    sessionStore = new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    });
  }
} catch (error) {
  console.error('Database connection error:', error);
  // Fallback to memory store
  sessionStore = new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  });
}

// In-memory fallback for users
const users = new Map();
const locations = []; // In-memory storage for locations

// Middleware  
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

// Session setup
const sessionSecret = process.env.SESSION_SECRET || 'local-cooks-dev-secret';
const isProduction = process.env.NODE_ENV === 'production';

console.log('Setting up session with', {
  production: isProduction,
  storeType: pool ? 'PostgreSQL' : 'Memory',
  sessionSecret: sessionSecret ? 'Provided' : 'Missing'
});

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: isProduction, // true in production (HTTPS), false in development
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
    sameSite: isProduction ? 'lax' : 'lax', // Use 'lax' to allow cross-subdomain access
    domain: isProduction ? '.localcooks.ca' : undefined // Use dot-prefixed domain for cross-subdomain cookies in production
  },
  name: 'connect.sid', // Explicit session name
  proxy: isProduction // Trust proxy in production (for Vercel)
}));

// Import subdomain utilities
import { getSubdomainFromHeaders } from './shared/subdomain-utils.js';

// Add subdomain detection middleware
app.use((req, res, next) => {
  // Detect subdomain from headers
  const subdomain = getSubdomainFromHeaders(req.headers);
  req.subdomain = subdomain;
  
  // Log subdomain info for debugging
  if (req.path.startsWith('/api/')) {
    console.log(`${req.method} ${req.path} - Subdomain: ${subdomain || 'main'} - Session ID: ${req.session.id}, User ID: ${req.session.userId || 'none'}`);
  }
  
  next();
});

// Add middleware to log session info on each request
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`${req.method} ${req.path} - Session ID: ${req.session.id}, User ID: ${req.session.userId || 'none'}`);
  }
  next();
});

// Helper functions
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(password, salt, 64);
  return `${buf.toString('hex')}.${salt}`;
}

async function comparePasswords(supplied, stored) {
  try {
    // Log input for debugging
    console.log('Comparing passwords:');
    console.log('- Supplied password (truncated):', supplied.substring(0, 10) + '...');
    console.log('- Stored password format:', stored.substring(0, 10) + '...');

    const [hashed, salt] = stored.split('.');
    if (!hashed || !salt) {
      console.error('Invalid stored password format');
      return false;
    }

    // Hash the supplied password with the same salt
    const suppliedBuf = await scryptAsync(supplied, salt, 64);

    // Convert both to hex strings and compare them directly
    const suppliedHex = Buffer.from(suppliedBuf).toString('hex');

    console.log('- Original hash (truncated):', hashed.substring(0, 10) + '...');
    console.log('- Generated hash (truncated):', suppliedHex.substring(0, 10) + '...');

    // Simple string comparison as a fallback in case timing-safe equal fails
    const match = hashed === suppliedHex;
    console.log('- Password match:', match);

    return match;
  } catch (error) {
    console.error('Password comparison error:', error);
    return false;
  }
}

async function getUserByUsername(username) {
  // Try database first
  if (pool) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length > 0) return result.rows[0];
    } catch (error) {
      console.error('❌ Database query error in getUserByUsername:', error);
      console.error('Error stack:', error.stack);
      // Re-throw database errors so they can be caught by callers
      throw error;
    }
  }

  // Fall back to in-memory
  for (const user of users.values()) {
    if (user.username === username) return user;
  }
  
  return null;
}

// Helper functions to interact with locations table in Neon DB

// Get all locations from database
async function getAllLocations() {
  try {
    if (!pool) {
      return [];
    }
    const result = await pool.query(`
      SELECT id, name, address, manager_id as "managerId", 
             notification_email as "notificationEmail",
             cancellation_policy_hours as "cancellationPolicyHours",
             cancellation_policy_message as "cancellationPolicyMessage",
             default_daily_booking_limit as "defaultDailyBookingLimit",
             minimum_booking_window_hours as "minimumBookingWindowHours",
             logo_url as "logoUrl",
             timezone,
             created_at, updated_at 
      FROM locations 
      ORDER BY created_at DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching locations from database:', error);
    return [];
  }
}

// Get kitchens by location ID
async function getKitchensByLocation(locationId) {
  try {
    if (!pool) {
      return [];
    }
    const result = await pool.query(`
      SELECT id, name, description, location_id as "locationId", is_active as "isActive"
      FROM kitchens
      WHERE location_id = $1
      ORDER BY name
    `, [locationId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching kitchens by location:', error);
    return [];
  }
}

// Create a location in the database
async function createLocation({ name, address, managerId }) {
  try {
    if (!pool) {
      console.error('createLocation: Database pool not available');
      throw new Error('Database not available');
    }
    
    console.log('createLocation called with:', { name, address, managerId });
    
    // Handle optional managerId - only include if it's provided and valid
    let managerIdParam = null;
    if (managerId !== undefined && managerId !== null && managerId !== '') {
      managerIdParam = parseInt(managerId);
      if (isNaN(managerIdParam)) {
        managerIdParam = null;
      }
    }
    
    console.log('Executing SQL query with params:', { name, address, managerId: managerIdParam });
    
    const result = await pool.query(`
      INSERT INTO locations (name, address, manager_id, timezone)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, address, manager_id as "managerId", timezone, created_at, updated_at
    `, [name, address, managerIdParam, DEFAULT_TIMEZONE]);
    
    console.log('Location created successfully:', result.rows[0]);
    return result.rows[0];
  } catch (error) {
    console.error('Error in createLocation function:', error);
    console.error('Error details:', error.message, error.stack);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    throw error;
  }
}

// Get all kitchens from database
async function getAllKitchens() {
  try {
    if (!pool) {
      return [];
    }
    const result = await pool.query(`
      SELECT id, location_id as "locationId", name, description, is_active as "isActive", created_at, updated_at 
      FROM kitchens 
      ORDER BY created_at DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching kitchens from database:', error);
    return [];
  }
}

// Create a kitchen in the database
async function createKitchen({ locationId, name, description, isActive }) {
  try {
    if (!pool) {
      throw new Error('Database not available');
    }
    
    const result = await pool.query(`
      INSERT INTO kitchens (location_id, name, description, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, location_id as "locationId", name, description, is_active as "isActive", created_at, updated_at
    `, [locationId, name, description, isActive !== false]);
    
    return result.rows[0];
  } catch (error) {
    console.error('Error creating kitchen in database:', error);
    throw error;
  }
}

async function getUser(id) {
  // Try database first
  if (pool) {
    try {
      if (isNaN(Number(id))) {
        // Lookup by firebase_uid
        const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [id]);
        if (result.rows.length > 0) return result.rows[0];
      } else {
        // Lookup by integer id
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        if (result.rows.length > 0) return result.rows[0];
      }
    } catch (error) {
      console.error('❌ Database query error in getUser:', error);
      console.error('Error stack:', error.stack);
      // Re-throw database errors so they can be caught by callers
      throw error;
    }
  }

  // Fall back to in-memory
  if (isNaN(Number(id))) {
    for (const user of users.values()) {
      if (user.firebase_uid === id) return user;
    }
    return null;
  }
  return users.get(parseInt(id));
}

// Helper function to clean up Vercel blob files
async function cleanupBlobFiles(urls) {
  if (!urls || !Array.isArray(urls)) return;
  
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  
  if (!isProduction) {
    console.log('Development mode: Skipping blob cleanup for URLs:', urls);
    return;
  }

  try {
    // Import Vercel Blob delete function
    const { del } = await import('@vercel/blob');
    
    for (const url of urls) {
      if (url && typeof url === 'string' && url.includes('blob.vercel-storage.com')) {
        try {
          await del(url);
          console.log(`Successfully deleted blob file: ${url}`);
        } catch (error) {
          console.error(`Failed to delete blob file ${url}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error during blob cleanup:', error);
  }
}

async function createUser(userData) {
  // Try database first
  if (pool) {
    try {
      const hashedPassword = userData.password; // Already hashed before this point
      // Patch: support firebase_uid, is_verified, has_seen_welcome
      const result = await pool.query(
        `INSERT INTO users (username, password, role, firebase_uid, is_verified, has_seen_welcome) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          userData.username,
          hashedPassword,
          userData.role || 'applicant',
          userData.firebase_uid || null,
          userData.is_verified !== undefined ? userData.is_verified : false,
          userData.has_seen_welcome !== undefined ? userData.has_seen_welcome : false
        ]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating user in database:', error);
    }
  }

  // Fall back to in-memory
  const id = Date.now();
  const user = { id, ...userData };
  users.set(id, user);
  return user;
}
// Initialize database tables if they don't exist
async function initializeDatabase() {
  if (!pool) return;

  try {
    // Check if users table exists
    const tableCheck = await pool.query(`
      SELECT to_regclass('public.users') as table_exists;
    `);

    if (!tableCheck.rows[0].table_exists) {
      console.log('Creating database tables...');

      // Create all enums first
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
            CREATE TYPE user_role AS ENUM ('admin', 'applicant');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kitchen_preference') THEN
            CREATE TYPE kitchen_preference AS ENUM ('commercial', 'home', 'notSure');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'certification_status') THEN
            CREATE TYPE certification_status AS ENUM ('yes', 'no', 'notSure');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
            CREATE TYPE application_status AS ENUM ('inReview', 'approved', 'rejected', 'cancelled');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_verification_status') THEN
            CREATE TYPE document_verification_status AS ENUM ('pending', 'approved', 'rejected');
          END IF;
        END$$;
      `);

      // Create users table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          role user_role NOT NULL DEFAULT 'applicant',
          google_id TEXT,
          facebook_id TEXT,
          is_verified BOOLEAN DEFAULT false NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create applications table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS applications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          food_safety_license certification_status NOT NULL,
          food_establishment_cert certification_status NOT NULL,
          kitchen_preference kitchen_preference NOT NULL,
          feedback TEXT,
          status application_status NOT NULL DEFAULT 'inReview',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Document verification data is stored directly in applications table
      console.log('Document verification fields are already in applications table');

      // Create an admin user
      const hashedPassword = 'fcf0872ea0a0c91f3d8e64dc5005c9b6a36371eddc6c1127a3c0b45c71db5b72f85c5e93b80993ec37c6aff8b08d07b68e9c58f28e3bd20d9d2a4eb38992aad0.ef32a41b7d478668'; // localcooks
      await pool.query(`
        INSERT INTO users (username, password, role)
        VALUES ('admin', $1, 'admin')
        ON CONFLICT (username) DO NOTHING;
      `, [hashedPassword]);

      // Create password reset and email verification tables
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          token VARCHAR(255) NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
      // Add unique constraint for password reset tokens if it doesn't exist
      await pool.query(`
        DO $$ BEGIN
          BEGIN
            ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_unique UNIQUE (user_id);
          EXCEPTION
            WHEN duplicate_table THEN null;
            WHEN duplicate_object THEN null;
          END;
        END $$;
      `);
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          token VARCHAR(255) NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
      // Add unique constraint for email verification tokens if it doesn't exist
      await pool.query(`
        DO $$ BEGIN
          BEGIN
            ALTER TABLE email_verification_tokens ADD CONSTRAINT email_verification_tokens_email_unique UNIQUE (email);
          EXCEPTION
            WHEN duplicate_table THEN null;
            WHEN duplicate_object THEN null;
          END;
        END $$;
      `);

      console.log('Database initialized successfully');
    } else {
      // Users table exists, but check if applications table exists and create it if needed
      const appTableCheck = await pool.query(`
        SELECT to_regclass('public.applications') as table_exists;
      `);

      if (!appTableCheck.rows[0].table_exists) {
        console.log('Applications table does not exist, creating...');
        
        // Ensure enums exist
        await pool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kitchen_preference') THEN
              CREATE TYPE kitchen_preference AS ENUM ('commercial', 'home', 'notSure');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'certification_status') THEN
              CREATE TYPE certification_status AS ENUM ('yes', 'no', 'notSure');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
              CREATE TYPE application_status AS ENUM ('inReview', 'approved', 'rejected', 'cancelled');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_verification_status') THEN
              CREATE TYPE document_verification_status AS ENUM ('pending', 'approved', 'rejected');
            END IF;
          END$$;
        `);

        // Create applications table
        await pool.query(`
          CREATE TABLE IF NOT EXISTS applications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            full_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            food_safety_license certification_status NOT NULL,
            food_establishment_cert certification_status NOT NULL,
            kitchen_preference kitchen_preference NOT NULL,
            feedback TEXT,
            status application_status NOT NULL DEFAULT 'inReview',
            
            -- Document verification fields
            food_safety_license_url TEXT,
            food_establishment_cert_url TEXT,
            food_safety_license_status document_verification_status DEFAULT 'pending',
            food_establishment_cert_status document_verification_status DEFAULT 'pending',
            documents_admin_feedback TEXT,
            documents_reviewed_by INTEGER REFERENCES users(id),
            documents_reviewed_at TIMESTAMP,
            
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Document verification data is stored directly in applications table
        console.log('Document verification fields are already in applications table');

        console.log('Applications table created successfully');
      }

      // Check and create password reset and email verification tables
      const passwordResetTableCheck = await pool.query(`
        SELECT to_regclass('public.password_reset_tokens') as table_exists;
      `);

      if (!passwordResetTableCheck.rows[0].table_exists) {
        console.log('Creating password_reset_tokens table...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            token VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          );
        `);
        
        // Add unique constraint
        await pool.query(`
          DO $$ BEGIN
            BEGIN
              ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_unique UNIQUE (user_id);
            EXCEPTION
              WHEN duplicate_table THEN null;
              WHEN duplicate_object THEN null;
            END;
          END $$;
        `);
        console.log('Password reset tokens table created successfully');
      }

      const emailVerificationTableCheck = await pool.query(`
        SELECT to_regclass('public.email_verification_tokens') as table_exists;
      `);

      if (!emailVerificationTableCheck.rows[0].table_exists) {
        console.log('Creating email_verification_tokens table...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          );
        `);
        
        // Add unique constraint
        await pool.query(`
          DO $$ BEGIN
            BEGIN
              ALTER TABLE email_verification_tokens ADD CONSTRAINT email_verification_tokens_email_unique UNIQUE (email);
            EXCEPTION
              WHEN duplicate_table THEN null;
              WHEN duplicate_object THEN null;
            END;
          END $$;
        `);
        console.log('Email verification tokens table created successfully');
      }

      // Check if applications table has document fields and add them if missing
      try {
        const appColumnCheck = await pool.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = 'applications' AND column_name IN (
            'food_safety_license_url', 
            'food_establishment_cert_url', 
            'food_safety_license_status',
            'food_establishment_cert_status',
            'documents_admin_feedback',
            'documents_reviewed_by',
            'documents_reviewed_at'
          )
        `);
        
        const existingAppColumns = appColumnCheck.rows.map(row => row.column_name);
        
        // Document verification is now handled directly in the applications table
        console.log('Document verification data is stored in applications table - no separate table needed');
      } catch (appColumnError) {
        console.error('Error checking/adding application table columns:', appColumnError);
      }

      // Check if users table has required fields and add them if missing
      try {
        const columnCheck = await pool.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name IN ('is_verified', 'created_at')
        `);
        
        const existingColumns = columnCheck.rows.map(row => row.column_name);
        
        if (!existingColumns.includes('is_verified')) {
          console.log('Adding is_verified column to users table...');
          await pool.query(`
            ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT false NOT NULL;
          `);
        }
        
        if (!existingColumns.includes('created_at')) {
          console.log('Adding created_at column to users table...');
          await pool.query(`
            ALTER TABLE users ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
          `);
        }
      } catch (columnError) {
        console.error('Error checking/adding user table columns:', columnError);
      }
    }
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Initialize DB tables if needed
if (pool) {
  initializeDatabase().catch((error) => {
    console.error('Database initialization failed, but continuing with API startup:', error);
  });
} else {
  console.log('No database connection available, API will use in-memory storage');
}
// Utility to ensure admin user exists
async function ensureAdminUser() {
  try {
    console.log('Checking if admin user exists...');
    const admin = await getUserByUsername('admin');

    if (admin) {
      console.log('Admin user exists:', { id: admin.id, role: admin.role });
      return admin;
    }

    console.log('Admin user does not exist, creating...');

    // Create admin user
    const hashedPassword = await hashPassword('localcooks');
    const adminUser = await createUser({
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
    });

    console.log('Admin user created:', { id: adminUser.id, role: adminUser.role });
    return adminUser;
  } catch (error) {
    console.error('Error ensuring admin user exists:', error);
    return null;
  }
}

// Ensure admin user on startup
ensureAdminUser().catch((error) => {
  console.error('Failed to ensure admin user exists, but continuing with API startup:', error);
});

// Admin login endpoint
app.post('/api/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log('Admin login attempt for:', username);

    // Get admin user
    const admin = await getUserByUsername(username);

    if (!admin) {
      console.log('Admin user not found:', username);
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    // Verify user is admin (only admins can use this endpoint)
    if (admin.role !== 'admin') {
      console.log('User is not an admin:', username, 'role:', admin.role);
      return res.status(403).json({ error: 'Not authorized - admin access required. Managers should use /api/manager-login' });
    }

    // Check password - first try exact match for 'localcooks' (legacy admin password)
    let passwordMatches = false;
    
    console.log('User found:', {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      passwordLength: admin.password ? admin.password.length : 0
    });
    console.log('Provided password:', password);

    if (password === 'localcooks' && admin.role === 'admin') {
      passwordMatches = true;
      console.log('Admin password matched with hardcoded value');
    } else {
      // Compare with database password hash
      try {
        passwordMatches = await comparePasswords(password, admin.password);
        console.log('Password compared with database:', passwordMatches);
      } catch (error) {
        console.error('Error comparing passwords:', error);
      }
    }

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    console.log('Admin login successful for:', username);

    // Remove sensitive info
    const { password: _, ...adminWithoutPassword } = admin;

    // Set session with full user data
    req.session.userId = admin.id;
    req.session.user = adminWithoutPassword; // Store full user object (without password)

    console.log('Setting session data:', {
      sessionId: req.session.id,
      userId: admin.id,
      userData: { id: adminWithoutPassword.id, username: adminWithoutPassword.username, role: adminWithoutPassword.role }
    });

    // Force session regeneration to ensure fresh session
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.status(500).json({ error: 'Session creation failed' });
      }
      
      // Set session data again after regeneration
      req.session.userId = admin.id;
      req.session.user = adminWithoutPassword;
      
      // Save session explicitly
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Error saving session:', saveErr);
          return res.status(500).json({ error: 'Session save failed' });
        } else {
          console.log('Session saved successfully with userId:', admin.id);
          console.log('Final session ID:', req.session.id);
          console.log('Session user data cached:', { id: adminWithoutPassword.id, username: adminWithoutPassword.username, role: adminWithoutPassword.role });
        }
        
        // Return user data with session info
        return res.status(200).json({
          ...adminWithoutPassword,
          sessionId: req.session.id // Include session ID for debugging
        });
      });
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Admin login failed', message: error.message });
  }
});

// Manager login endpoint (for commercial kitchen managers)
app.post('/api/manager-login', async (req, res) => {
  try {
    // Ensure JSON response
    res.setHeader('Content-Type', 'application/json');
    
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    console.log('Manager login attempt for:', username);

    // Check database connection
    if (!pool) {
      console.error('❌ Database connection not available');
      return res.status(500).json({ 
        error: 'Database error', 
        message: 'Database connection not available'
      });
    }

    // Get manager user
    let manager;
    try {
      manager = await getUserByUsername(username);
    } catch (dbError) {
      console.error('❌ Database error fetching manager:', dbError);
      console.error('Error stack:', dbError?.stack);
      return res.status(500).json({ 
        error: 'Database error', 
        message: dbError?.message || 'Failed to fetch user from database',
        ...(process.env.NODE_ENV === 'development' && { stack: dbError?.stack })
      });
    }

    if (!manager) {
      console.log('Manager user not found:', username);
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    // Verify user is manager (only managers can use this endpoint)
    if (manager.role !== 'manager') {
      console.log('User is not a manager:', username, 'role:', manager.role);
      return res.status(403).json({ error: 'Not authorized - manager access required. Admins should use /api/admin-login' });
    }

    // Check password - compare with database password hash
    let passwordMatches = false;
    
    console.log('User found:', {
      id: manager.id,
      username: manager.username,
      role: manager.role,
      hasPassword: !!manager.password
    });

    try {
      if (!manager.password) {
        console.error('Manager has no password set');
        return res.status(401).json({ error: 'Incorrect username or password' });
      }
      passwordMatches = await comparePasswords(password, manager.password);
      console.log('Password compared with database:', passwordMatches);
    } catch (error) {
      console.error('Error comparing passwords:', error);
      return res.status(500).json({ 
        error: 'Authentication error', 
        message: 'Failed to verify password'
      });
    }

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    console.log('Manager login successful for:', username);

    // Remove sensitive info
    const { password: _, ...managerWithoutPassword } = manager;

    // Set session with full user data
    if (!req.session) {
      console.error('Session not available');
      return res.status(500).json({ error: 'Session creation failed' });
    }

    req.session.userId = manager.id;
    req.session.user = managerWithoutPassword; // Store full user object (without password)

    console.log('Setting session data:', {
      sessionId: req.session.id,
      userId: manager.id,
      userData: { id: managerWithoutPassword.id, username: managerWithoutPassword.username, role: managerWithoutPassword.role }
    });

    // Save session explicitly
    try {
      await new Promise((resolve, reject) => {
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('Error saving session:', saveErr);
            reject(saveErr);
          } else {
            console.log('Session saved successfully with userId:', manager.id);
            console.log('Final session ID:', req.session.id);
            resolve();
          }
        });
      });
    } catch (saveError) {
      console.error('Error saving session:', saveError);
      return res.status(500).json({ error: 'Session save failed' });
    }
    
    // Return user data
    return res.status(200).json(managerWithoutPassword);
  } catch (error) {
    console.error('❌ Manager login error:', error);
    console.error('Error stack:', error?.stack);
    console.error('Error details:', {
      message: error?.message,
      name: error?.name,
      code: error?.code
    });
    
    // Make sure we haven't already sent a response
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ 
        error: 'Manager login failed', 
        message: error?.message || 'Unknown error',
        ...(process.env.NODE_ENV === 'development' && { 
          stack: error?.stack
        })
      });
    } else {
      console.error('⚠️ Response already sent, cannot send error response');
    }
  }
});

// Removed redundant manual sync endpoint - sync is handled automatically by auth system

// Debug endpoint to check user sync status
app.get('/api/debug/user-sync/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
    console.log('Debug: Checking sync status for Firebase UID:', uid);
    
    // Check if user exists in database
    const user = await getUser(uid);
    
    if (user) {
      console.log('Debug: User found in database:', { id: user.id, username: user.username, role: user.role, firebase_uid: user.firebase_uid });
      return res.json({
        synced: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          firebase_uid: user.firebase_uid
        }
      });
    } else {
      console.log('Debug: User NOT found in database for UID:', uid);
      return res.json({
        synced: false,
        uid: uid,
        suggestion: 'Try logging out and logging back in to trigger sync'
      });
    }
  } catch (error) {
    console.error('Debug sync check error:', error);
    res.status(500).json({ error: 'Debug check failed', message: error.message });
  }
});
// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check if user exists
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Create user with hashed password
    const hashedPassword = await hashPassword(password);
    const user = await createUser({
      username,
      password: hashedPassword,
      role: req.body.role || 'applicant',
    });

    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = user;

    // Log in the user
    req.session.userId = user.id;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed', message: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log('Login attempt for user:', username);

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // First try to find user by username
    let user = await getUserByUsername(username);
    
    // If not found by username, try to find by email in applications table
    if (!user && username.includes('@')) {
      console.log('Username looks like email, searching applications table...');
      try {
        const emailResult = await pool.query(`
          SELECT u.* FROM users u 
          JOIN applications a ON u.id = a.user_id 
          WHERE LOWER(a.email) = LOWER($1) 
          ORDER BY a.created_at DESC 
          LIMIT 1
        `, [username]);
        
        if (emailResult.rows.length > 0) {
          user = emailResult.rows[0];
          console.log('Found user by email in applications table:', user.username);
        }
      } catch (emailError) {
        console.error('Error searching by email:', emailError);
      }
    }
    
    if (!user) {
      console.log('Login failed: User not found by username or email');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await comparePasswords(password, user.password);
    if (!passwordMatch) {
      console.log('Login failed: Password mismatch');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = user;

    // Log in the user
    req.session.userId = user.id;
    req.session.user = userWithoutPassword; // Store full user object (without password)

    console.log('Login successful, session ID:', req.session.id);
    console.log('User ID in session:', req.session.userId);

    // Save session explicitly
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
      } else {
        console.log('Session saved successfully');
      }
      res.status(200).json(userWithoutPassword);
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  // Clear passport session if it exists
  if (req.logout) {
    req.logout((err) => {
      if (err) {
        console.error('Passport logout error:', err);
      }
    });
  }
  
  // Clear session data
  req.session.userId = undefined;
  req.session.user = undefined;
  
  // Destroy the session
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

// Get users endpoint for email studio and user selection
app.get('/api/get-users', async (req, res) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not available' });
    }

    const { search } = req.query;

    let query;
    let params = [];

    if (search && search.trim()) {
      // Search by username (which is usually email) or application data
      query = `
        SELECT 
          u.id,
          u.username,
          COALESCE(a.email, u.username) as email,
          COALESCE(a.full_name, 
            CASE 
              WHEN u.username LIKE '%@%' THEN SPLIT_PART(u.username, '@', 1)
              ELSE u.username 
            END
          ) as full_name,
          u.role
        FROM users u
        LEFT JOIN applications a ON u.id = a.user_id
        WHERE 
          LOWER(u.username) LIKE LOWER($1) OR 
          LOWER(COALESCE(a.email, '')) LIKE LOWER($1) OR
          LOWER(COALESCE(a.full_name, '')) LIKE LOWER($1)
        ORDER BY 
          u.role = 'admin' DESC,
          u.username
        LIMIT 20
      `;
      params = [`%${search.trim()}%`];
    } else {
      // Return all users with their info
      query = `
        SELECT 
          u.id,
          u.username,
          COALESCE(a.email, u.username) as email,
          COALESCE(a.full_name, 
            CASE 
              WHEN u.username LIKE '%@%' THEN SPLIT_PART(u.username, '@', 1)
              ELSE u.username 
            END
          ) as full_name,
          u.role
        FROM users u
        LEFT JOIN applications a ON u.id = a.user_id
        ORDER BY 
          u.role = 'admin' DESC,
          u.username
        LIMIT 50
      `;
    }

    const result = await pool.query(query, params);

    // Format the response for the frontend
    const users = result.rows.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      displayText: `${user.full_name} (${user.email})` // For dropdown display
    }));

    res.status(200).json({ users });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ===================================
// 🔥 FIREBASE ROUTES (PRIORITY - MUST COME FIRST)
// ===================================

// 🔥 Firebase Password Reset Request - Uses Firebase's built-in password reset (NO AUTH REQUIRED)
app.post('/api/firebase/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    console.log(`🔥 Firebase password reset requested for: ${email}`);

    if (!firebaseAdmin) {
      console.error('Firebase Admin not initialized');
      return res.status(500).json({ 
        message: "Password reset service unavailable. Please try again later." 
      });
    }

    try {
      const { getAuth } = await import('firebase-admin/auth');
      const auth = getAuth(firebaseAdmin);
      
      // Check if user exists in Firebase
      const userRecord = await auth.getUserByEmail(email);
      console.log(`✅ Firebase user found: ${userRecord.uid}`);

      // Check if this user exists in our Neon database and is email/password user
      let neonUser = null;
      if (pool) {
        const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [userRecord.uid]);
        neonUser = result.rows[0] || null;
      } else {
        // In-memory fallback
        for (const u of users.values()) {
          if (u.firebase_uid === userRecord.uid) {
            neonUser = u;
            break;
          }
        }
      }
      
      if (!neonUser) {
        console.log(`❌ User not found in Neon DB for Firebase UID: ${userRecord.uid}`);
        // Don't reveal if user exists or not for security
        return res.status(200).json({ 
          message: "If an account with this email exists, you will receive a password reset link." 
        });
      }

      // Only allow password reset for email/password users (those with hashed passwords in Neon)
      // Firebase OAuth users (Google, etc.) should use their OAuth provider's password reset
      if (!neonUser.password || neonUser.password === '') {
        console.log(`❌ User ${userRecord.uid} is OAuth user, no password reset needed`);
        return res.status(400).json({ 
          message: "This account uses Google/OAuth sign-in. Please use 'Sign in with Google' or contact your OAuth provider to reset your password." 
        });
      }

              // Generate password reset link using Firebase Admin SDK with email parameter
        // Determine subdomain based on user type
        let subdomain = 'chef'; // default
        if (neonUser) {
          if (neonUser.is_delivery_partner) {
            subdomain = 'driver';
          } else if (neonUser.is_portal_user) {
            subdomain = 'kitchen';
          } else if (neonUser.is_chef) {
            subdomain = 'chef';
          } else if (neonUser.role === 'admin') {
            subdomain = 'admin';
          }
        }
        
        const baseDomain = process.env.BASE_DOMAIN || 'localcooks.ca';
        const baseUrl = process.env.NODE_ENV === 'production' 
          ? `https://${subdomain}.${baseDomain}`
          : (process.env.BASE_URL || 'http://localhost:5000');
        const resetUrl = `${baseUrl}/email-action?email=${encodeURIComponent(email)}`;
        const resetLink = await auth.generatePasswordResetLink(email, {
          url: resetUrl,
          handleCodeInApp: true,
        });

        console.log(`✅ Firebase password reset link generated for: ${email}`);

        // Send the reset link via custom email service
        console.log(`📧 Sending password reset email via custom email service to: ${email}`);
        
        try {
          // Import email functions
          const { sendEmail, generatePasswordResetEmail } = await import('../server/email.js');
          
          // Generate email content with the reset link
          const emailContent = generatePasswordResetEmail({
            fullName: neonUser.username || email.split('@')[0],
            email: email,
            resetToken: '', // Not needed for Firebase link
            resetUrl: resetLink
          });

          // Send the email
          const emailSent = await sendEmail(emailContent, {
            trackingId: `password_reset_${email}_${Date.now()}`
          });

          if (emailSent) {
            console.log(`✅ Password reset email sent successfully to: ${email}`);
          } else {
            console.error(`❌ Failed to send password reset email to: ${email}`);
            return res.status(500).json({ 
              message: "Error sending password reset email. Please try again later." 
            });
          }
        } catch (emailError) {
          console.error(`❌ Error sending password reset email:`, emailError);
          return res.status(500).json({ 
            message: "Error sending password reset email. Please try again later." 
          });
        }
      
              return res.status(200).json({ 
          message: "If an account with this email exists, you will receive a password reset link."
        });

    } catch (firebaseError) {
      if (firebaseError.code === 'auth/user-not-found') {
        console.log(`❌ Firebase user not found: ${email}`);
        // Don't reveal if user exists or not for security
        return res.status(200).json({ 
          message: "If an account with this email exists, you will receive a password reset link." 
        });
      } else {
        console.error(`❌ Firebase error:`, firebaseError);
        return res.status(500).json({ 
          message: "Error processing password reset request. Please try again later." 
        });
      }
    }

  } catch (error) {
    console.error("Error in Firebase forgot password:", error);
    return res.status(500).json({ 
      message: "Internal server error. Please try again later." 
    });
  }
});

// 🔥 Firebase Password Reset Confirmation - Uses Firebase's built-in password reset (NO AUTH REQUIRED)
app.post('/api/firebase/reset-password', async (req, res) => {
  try {
    const { oobCode, newPassword } = req.body;

    if (!oobCode || !newPassword) {
      return res.status(400).json({ message: "Reset code and new password are required" });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long" });
    }

    console.log(`🔥 Firebase password reset confirmation with code: ${oobCode.substring(0, 8)}...`);

    if (!firebaseAdmin) {
      console.error('Firebase Admin not initialized');
      return res.status(500).json({ 
        message: "Password reset service unavailable. Please try again later." 
      });
    }

    try {
      // SOLUTION: Use Firebase client SDK to decode the oobCode and extract email
      // Since Admin SDK doesn't have these methods, we'll implement a workaround
      
      console.log(`🔍 Attempting to decode Firebase reset code: ${oobCode.substring(0, 8)}...`);
      
      // Basic validation: Check if oobCode follows Firebase's format
      if (!oobCode || oobCode.length < 10) {
        throw new Error('Invalid reset code format');
      }
      
      // Extract email from request body (should be provided by the frontend after verifying oobCode)
      let email = req.body.email;
      
      if (!email) {
        console.log('❌ No email provided in request body.');
        throw new Error('Invalid reset link. Please request a new password reset.');
      }
      
      console.log(`📧 Email extracted for password reset: ${email}`);
      
             console.log(`🔍 Processing password reset for email: ${email}`);
      
      // Get Firebase Admin SDK
      const { getAuth } = await import('firebase-admin/auth');
      const auth = getAuth(firebaseAdmin);
      
      // Get the user by email to verify they exist
      const userRecord = await auth.getUserByEmail(email);
      console.log(`✅ Found Firebase user for email: ${email}`);
      
      // Get the user from our system and verify they exist
      let neonUser = null;
      if (pool) {
        const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [userRecord.uid]);
        neonUser = result.rows[0] || null;
      } else {
        // In-memory fallback
        for (const u of users.values()) {
          if (u.firebase_uid === userRecord.uid) {
            neonUser = u;
            break;
          }
        }
      }
      
      if (!neonUser) {
        throw new Error('User not found in system');
      }
      
      // Update the password using Firebase Admin SDK
      await auth.updateUser(userRecord.uid, {
        password: newPassword
      });
      console.log(`✅ Password updated for Firebase user: ${userRecord.uid}`);
      
      if (neonUser) {
        // Hash the new password and update in Neon DB
        const bcrypt = await import('bcryptjs');
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        if (pool) {
          await pool.query(
            'UPDATE users SET password = $1 WHERE firebase_uid = $2',
            [hashedPassword, userRecord.uid]
          );
          console.log(`✅ Password hash updated in Neon DB for user: ${neonUser.id}`);
        } else {
          // In-memory update
          neonUser.password = hashedPassword;
          console.log(`✅ Password hash updated in memory for user: ${neonUser.id}`);
        }
      }

      return res.status(200).json({ 
        message: "Password reset successfully. You can now log in with your new password." 
      });

    } catch (firebaseError) {
      console.error(`❌ Firebase password reset error:`, firebaseError);
      
      if (firebaseError.code === 'auth/invalid-action-code') {
        return res.status(400).json({ message: "Invalid or expired reset code" });
      } else if (firebaseError.code === 'auth/weak-password') {
        return res.status(400).json({ message: "Password is too weak. Please choose a stronger password." });
      } else if (firebaseError.code === 'auth/user-not-found') {
        return res.status(400).json({ message: "User not found. Please check your email address." });
      } else if (firebaseError.message?.includes('User not found in system')) {
        return res.status(400).json({ message: "User account not found in our system." });
      } else if (firebaseError.message?.includes('Email is required')) {
        return res.status(400).json({ message: "Invalid reset link. Please request a new password reset." });
      } else {
        return res.status(500).json({ 
          message: "Error resetting password. Please try again later." 
        });
      }
    }

  } catch (error) {
    console.error("Error in Firebase reset password:", error);
    return res.status(500).json({ 
      message: "Internal server error. Please try again later." 
    });
  }
});

// Manager forgot password endpoint (for managers who don't have Firebase accounts)
app.post('/api/manager/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }

    console.log(`🔐 Manager password reset requested for username: ${username}`);

    if (!pool) {
      return res.status(500).json({ 
        message: "Password reset service unavailable. Please try again later." 
      });
    }

    // Find manager by username
    const manager = await getUserByUsername(username);

    if (!manager) {
      // Don't reveal if user exists or not for security
      console.log(`❌ Manager not found: ${username}`);
      return res.status(200).json({ 
        message: "If an account with this username exists, you will receive a password reset link." 
      });
    }

    // Verify user is a manager
    if (manager.role !== 'manager') {
      console.log(`❌ User is not a manager: ${username}, role: ${manager.role}`);
      // Don't reveal if user exists or not for security
      return res.status(200).json({ 
        message: "If an account with this username exists, you will receive a password reset link." 
      });
    }

    // Generate reset token
    const resetToken = randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setHours(resetTokenExpiry.getHours() + 1); // Token expires in 1 hour

    // Store reset token in database
    try {
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) 
         VALUES ($1, $2, $3, NOW()) 
         ON CONFLICT (user_id) 
         DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
        [manager.id, resetToken, resetTokenExpiry]
      );
      console.log(`✅ Password reset token stored for manager: ${manager.id}`);
    } catch (dbError) {
      console.error('Error storing password reset token:', dbError);
      return res.status(500).json({ 
        message: "Error processing password reset request. Please try again later." 
      });
    }

    // Generate reset URL
    const baseDomain = process.env.BASE_DOMAIN || 'localcooks.ca';
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? `https://kitchen.${baseDomain}`
      : (process.env.BASE_URL || 'http://localhost:5000');
    const resetUrl = `${baseUrl}/password-reset?token=${resetToken}&role=manager`;

    // Send password reset email
    try {
      const { sendEmail, generatePasswordResetEmail } = await import('../server/email.js');
      
      // Generate email content
      const emailContent = generatePasswordResetEmail({
        fullName: manager.username || username,
        email: username, // Username is the email for managers
        resetToken: resetToken,
        resetUrl: resetUrl
      });

      // Send the email
      const emailSent = await sendEmail(emailContent, {
        trackingId: `manager_password_reset_${manager.id}_${Date.now()}`
      });

      if (emailSent) {
        console.log(`✅ Password reset email sent successfully to manager: ${username}`);
      } else {
        console.error(`❌ Failed to send password reset email to manager: ${username}`);
        return res.status(500).json({ 
          message: "Error sending password reset email. Please try again later." 
        });
      }
    } catch (emailError) {
      console.error(`❌ Error sending password reset email:`, emailError);
      return res.status(500).json({ 
        message: "Error sending password reset email. Please try again later." 
      });
    }

    return res.status(200).json({ 
      message: "If an account with this username exists, you will receive a password reset link." 
    });

  } catch (error) {
    console.error("Error in manager forgot password:", error);
    return res.status(500).json({ 
      message: "Internal server error. Please try again later." 
    });
  }
});

// Manager reset password endpoint (for managers who don't have Firebase accounts)
app.post('/api/manager/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token and new password are required" });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long" });
    }

    console.log(`🔐 Manager password reset attempt with token: ${token.substring(0, 8)}...`);

    if (!pool) {
      return res.status(500).json({ 
        message: "Password reset service unavailable. Please try again later." 
      });
    }

    // Verify reset token and get manager
    const result = await pool.query(`
      SELECT u.* FROM users u 
      JOIN password_reset_tokens prt ON u.id = prt.user_id 
      WHERE prt.token = $1 AND prt.expires_at > NOW() AND u.role = 'manager'
    `, [token]);

    if (result.rows.length === 0) {
      console.log(`❌ Invalid or expired reset token`);
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    const manager = result.rows[0];

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password in database
    try {
      await pool.query(
        'UPDATE users SET password = $1 WHERE id = $2',
        [hashedPassword, manager.id]
      );
      console.log(`✅ Password updated for manager: ${manager.id}`);

      // Clear reset token
      await pool.query(
        'DELETE FROM password_reset_tokens WHERE user_id = $1',
        [manager.id]
      );
      console.log(`✅ Reset token cleared for manager: ${manager.id}`);
    } catch (dbError) {
      console.error('Error updating password:', dbError);
      return res.status(500).json({ 
        message: "Error updating password. Please try again later." 
      });
    }

    console.log(`✅ Password successfully reset for manager: ${manager.id}`);
    return res.status(200).json({ 
      message: "Password reset successfully. You can now log in with your new password." 
    });

  } catch (error) {
    console.error("Error in manager reset password:", error);
    return res.status(500).json({ 
      message: "Internal server error. Please try again later." 
    });
  }
});

// 🔥 Firebase-Compatible Get Current User (for auth page)
// Supports both Firebase Auth (Bearer token) and Session Auth (fallback)
app.get('/api/user', async (req, res) => {
  // Ensure JSON response from the start
  res.setHeader('Content-Type', 'application/json');
  
  try {
    // Check for Bearer token (Firebase Auth)
    const authHeader = req.headers.authorization;
    const hasBearerToken = authHeader && authHeader.startsWith('Bearer ');
    
    if (hasBearerToken) {
      const token = authHeader.substring(7)?.trim();
      
      if (!token) {
        console.warn('⚠️ Empty Bearer token provided');
        // Fall through to session auth
      } else if (!firebaseAdmin) {
        // Firebase Admin not initialized - return clear error
        console.error('❌ Firebase Admin SDK not initialized - cannot verify Firebase tokens');
        return res.status(503).json({ 
          error: 'Service unavailable',
          message: 'Firebase authentication service is not configured. Please contact support.',
          code: 'FIREBASE_NOT_CONFIGURED'
        });
      } else {
        // Try Firebase token verification
        try {
          const decodedToken = await verifyFirebaseToken(token);
          
          if (decodedToken && decodedToken.uid) {
            const firebaseUid = decodedToken.uid;
            console.log('🔥 FIREBASE /api/user - Verified token for UID:', firebaseUid);

            // Get user from database by Firebase UID
            if (!pool) {
              return res.status(500).json({ 
                error: 'Database error', 
                message: 'Database connection not available'
              });
            }

            let user;
            try {
              const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [firebaseUid]);
              user = result.rows[0] || null;
              console.log('📊 Database query result:', user ? `Found user ${user.id}` : 'No user found');
            } catch (dbError) {
              console.error('❌ Database query error:', dbError);
              return res.status(500).json({ 
                error: 'Database error', 
                message: dbError?.message || 'Failed to fetch user from database'
              });
            }
            
            if (!user) {
              console.log('❌ Firebase user not found in database for UID:', firebaseUid);
              return res.status(404).json({ error: 'User not found' });
            }

            console.log('✅ Firebase user found:', {
              id: user.id,
              username: user.username,
              is_verified: user.is_verified,
              has_seen_welcome: user.has_seen_welcome
            });

            const response = {
              id: user.id,
              username: user.username,
              role: user.role,
              is_verified: user.is_verified,
              has_seen_welcome: user.has_seen_welcome,
              firebaseUid: user.firebase_uid
            };

            return res.json(response);
          } else {
            // Token verification failed - invalid token
            console.warn('⚠️ Firebase token verification failed - invalid token');
            return res.status(401).json({ 
              error: 'Unauthorized',
              message: 'Invalid authentication token'
            });
          }
        } catch (verifyError) {
          // Token verification threw an error
          console.error('❌ Firebase token verification error:', verifyError?.message);
          return res.status(401).json({ 
            error: 'Unauthorized',
            message: 'Token verification failed',
            ...(process.env.NODE_ENV === 'development' && { details: verifyError?.message })
          });
        }
      }
    }

    // Fallback to session authentication (for managers/admins)
    const rawUserId = req.session?.userId || req.headers['x-user-id'];
    if (rawUserId) {
      console.log('📋 /api/user - Using session auth for user ID:', rawUserId);
      
      if (!pool) {
        return res.status(500).json({ 
          error: 'Database error', 
          message: 'Database connection not available'
        });
      }

      let user;
      try {
        user = await getUser(rawUserId);
      } catch (dbError) {
        console.error('❌ Database error fetching user:', dbError);
        return res.status(500).json({ 
          error: 'Database error', 
          message: dbError?.message || 'Failed to fetch user from database'
        });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { password: _, ...userWithoutPassword } = user;
      return res.json(userWithoutPassword);
    }

    // No authentication provided
    return res.status(401).json({ error: 'Not authenticated' });
    
  } catch (error) {
    // Catch-all for any unexpected errors
    console.error('❌ Unexpected error in /api/user:', error);
    console.error('Error stack:', error?.stack);
    
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: 'Internal server error',
        message: error?.message || 'An unexpected error occurred',
        ...(process.env.NODE_ENV === 'development' && { stack: error?.stack })
      });
    }
  }
});
// 🔥 Set has_seen_welcome = true for current Firebase user
app.post('/api/user/seen-welcome', verifyFirebaseAuth, async (req, res) => {
  try {
    if (!req.firebaseUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('🎉 WELCOME SCREEN - Setting has_seen_welcome = true for UID:', req.firebaseUser.uid);

    // Get user from database by Firebase UID
    let user = null;
    let updated = false;
    
    if (pool) {
      // First get the user
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [req.firebaseUser.uid]);
      user = result.rows[0] || null;
      
      if (user) {
        console.log(`📋 Found user ${user.id} (${user.username}), current has_seen_welcome: ${user.has_seen_welcome}`);
        
        // Only update if not already true
        if (!user.has_seen_welcome) {
          await pool.query(
            'UPDATE users SET has_seen_welcome = $1 WHERE firebase_uid = $2',
            [true, req.firebaseUser.uid]
          );
          updated = true;
          console.log(`✅ Updated has_seen_welcome to true for user ${user.id}`);
        } else {
          console.log(`ℹ️ User ${user.id} has_seen_welcome was already true`);
        }
        
        res.json({ 
          success: true, 
          user: { 
            id: user.id, 
            username: user.username, 
            has_seen_welcome: true 
          }, 
          updated 
        });
      } else {
        console.log(`❌ User not found for UID: ${req.firebaseUser.uid}`);
        res.status(404).json({ error: 'User not found in database' });
      }
    } else {
      // In-memory fallback
      for (const u of users.values()) {
        if (u.firebase_uid === req.firebaseUser.uid) {
          u.has_seen_welcome = true;
          user = u;
          updated = true;
          break;
        }
      }
      
      if (user) {
        console.log(`✅ In-memory: Set has_seen_welcome to true for user ${user.id}`);
        res.json({ 
          success: true, 
          user: { 
            id: user.id, 
            username: user.username, 
            has_seen_welcome: true 
          }, 
          updated 
        });
      } else {
        console.log(`❌ In-memory: User not found for UID: ${req.firebaseUser.uid}`);
        res.status(404).json({ error: 'User not found in database' });
      }
    }
  } catch (error) {
    console.error('❌ Error updating has_seen_welcome:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🧪 DEBUG: Reset welcome screen for testing
app.post('/api/debug/reset-welcome', verifyFirebaseAuth, async (req, res) => {
  try {
    if (!req.firebaseUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('🧪 DEBUG - Resetting has_seen_welcome to FALSE for UID:', req.firebaseUser.uid);

    // Get user from database by Firebase UID
    let user = null;
    
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [req.firebaseUser.uid]);
      user = result.rows[0] || null;
      
      if (user) {
        await pool.query('UPDATE users SET has_seen_welcome = false WHERE id = $1', [user.id]);
        console.log(`🧪 Reset has_seen_welcome = false for user ${user.id}`);
      }
    } else {
      // In-memory fallback
      for (const u of users.values()) {
        if (u.firebase_uid === req.firebaseUser.uid) {
          u.has_seen_welcome = false;
          user = u;
          console.log(`🧪 Reset has_seen_welcome = false for in-memory user ${u.id}`);
          break;
        }
      }
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      message: 'Welcome screen reset - user should see welcome screen on next login',
      user: {
        id: user.id,
        username: user.username,
        has_seen_welcome: user.has_seen_welcome
      }
    });
  } catch (error) {
    console.error('❌ Error resetting welcome screen:', error);
    res.status(500).json({ error: 'Failed to reset welcome screen' });
  }
});

// 🧪 DEBUG: Reset user's has_seen_welcome to false for testing
app.post('/api/user/reset-welcome', verifyFirebaseAuth, async (req, res) => {
  try {
    if (!req.firebaseUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('🧪 DEBUG - Resetting has_seen_welcome to false for UID:', req.firebaseUser.uid);

    // Get user from database by Firebase UID
    let user = null;
    
    if (pool) {
      // First get the user
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [req.firebaseUser.uid]);
      user = result.rows[0] || null;
      
      if (user) {
        // Update has_seen_welcome to false
        await pool.query(
          'UPDATE users SET has_seen_welcome = $1 WHERE firebase_uid = $2',
          [false, req.firebaseUser.uid]
        );
        
        console.log(`🧪 DEBUG - Successfully reset has_seen_welcome to false for user ${user.id}`);
        res.json({ success: true, message: 'has_seen_welcome reset to false' });
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } else {
      // In-memory fallback
      for (const u of users.values()) {
        if (u.firebase_uid === req.firebaseUser.uid) {
          u.has_seen_welcome = false;
          user = u;
          break;
        }
      }
      
      if (user) {
        console.log(`🧪 DEBUG - In-memory: reset has_seen_welcome to false for user ${user.id}`);
        res.json({ success: true, message: 'has_seen_welcome reset to false (in-memory)' });
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    }
  } catch (error) {
    console.error('🧪 DEBUG - Error resetting has_seen_welcome:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// 🧪 COMPREHENSIVE DEBUG: Welcome screen status endpoint
app.get('/api/debug/welcome-status', verifyFirebaseAuth, async (req, res) => {
  try {
    if (!req.firebaseUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('🧪 DEBUG - Checking welcome status for UID:', req.firebaseUser.uid);

    let user = null;
    
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [req.firebaseUser.uid]);
      user = result.rows[0] || null;
    } else {
      // In-memory fallback
      for (const u of users.values()) {
        if (u.firebase_uid === req.firebaseUser.uid) {
          user = u;
          break;
        }
      }
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const debugInfo = {
      user_found: true,
      user_id: user.id,
      username: user.username,
      firebase_uid: user.firebase_uid,
      is_verified: user.is_verified,
      has_seen_welcome: user.has_seen_welcome,
      is_verified_type: typeof user.is_verified,
      has_seen_welcome_type: typeof user.has_seen_welcome,
      should_show_welcome_screen: user.is_verified && !user.has_seen_welcome,
      role: user.role,
      created_at: user.created_at || 'N/A',
      firebase_user: {
        uid: req.firebaseUser.uid,
        email: req.firebaseUser.email,
        email_verified: req.firebaseUser.email_verified
      }
    };

    console.log('🧪 DEBUG - Welcome status:', debugInfo);
    res.json(debugInfo);
  } catch (error) {
    console.error('🧪 DEBUG - Error checking welcome status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===================================
// 📱 SESSION ROUTES (FALLBACK)
// ===================================

app.get('/api/user-session', async (req, res) => {
  try {
    // Ensure JSON response
    res.setHeader('Content-Type', 'application/json');
    
    // Debug session info
    const sessionId = req.session?.id || null;
    const sessionUserId = req.session?.userId || null;
    const sessionUser = req.session?.user ? { 
      id: req.session.user.id, 
      username: req.session.user.username, 
      role: req.session.user.role 
    } : null;
    
    console.log('GET /api/user-session - Request details:', {
      sessionId: sessionId,
      userId: sessionUserId,
      sessionUser: sessionUser,
      hasCookies: !!req.headers.cookie,
      hasSession: !!req.session
    });

    // Get user ID from session or header
    const rawUserId = (req.session?.userId) || req.headers['x-user-id'];

    if (!rawUserId) {
      console.log('No userId in session or header, returning 401');
      return res.status(401).json({ 
        error: 'Not authenticated',
        message: 'No active session found'
      });
    }

    // Store user ID in session if it's not there and session exists
    if (req.session && !req.session.userId && rawUserId) {
      console.log('Storing userId in session from header:', rawUserId);
      req.session.userId = rawUserId;
      try {
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error('Error saving session:', err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      } catch (saveErr) {
        console.error('Error saving session during user-session fetch:', saveErr);
        // Continue - we can still fetch the user
      }
    }
    
    console.log('Fetching user with ID:', rawUserId);

    // Always fetch fresh data from database to ensure has_seen_welcome is up to date
    let user;
    try {
      if (!pool) {
        throw new Error('Database connection not available');
      }
      user = await getUser(rawUserId);
    } catch (dbError) {
      console.error('❌ Database error fetching user:', dbError);
      console.error('Error stack:', dbError?.stack);
      return res.status(500).json({ 
        error: 'Database error', 
        message: dbError?.message || 'Failed to fetch user from database',
        ...(process.env.NODE_ENV === 'development' && { stack: dbError?.stack })
      });
    }

    if (!user) {
      console.log('User not found in database, destroying session');
      if (req.session) {
        try {
          req.session.destroy(() => { });
        } catch (destroyErr) {
          console.error('Error destroying session:', destroyErr);
        }
      }
      return res.status(401).json({ error: 'User not found' });
    }

    console.log('User found in database:', { id: user.id, username: user.username, role: user.role, has_seen_welcome: user.has_seen_welcome });

    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = user;

    // Cache user in session for future requests (if session exists)
    if (req.session) {
      req.session.user = userWithoutPassword;

      // Save session to ensure user data is cached
      try {
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error('Error saving session:', err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      } catch (saveError) {
        console.error('❌ Error saving session in /api/user-session:', saveError);
        // Continue even if session save fails - user data is still valid
      }
    }

    return res.status(200).json(userWithoutPassword);
  } catch (error) {
    console.error('❌ Get user-session error:', error);
    console.error('Error stack:', error?.stack);
    // Ensure we always send a JSON response
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ 
        error: 'Failed to get user data', 
        message: error?.message || 'Unknown error',
        ...(process.env.NODE_ENV === 'development' && { stack: error?.stack })
      });
    } else {
      console.error('⚠️ Response already sent, cannot send error response');
    }
  }
});

// Diagnostic endpoint
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  let tables = [];

  if (pool) {
    try {
      await pool.query('SELECT 1');
      dbStatus = 'connected';

      // Check what tables exist
      const tableResult = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `);
      tables = tableResult.rows.map(r => r.table_name);
    } catch (error) {
      dbStatus = `error: ${error.message}`;
    }
  }

  res.status(200).json({
    status: 'ok',
    dbStatus,
    tables,
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'not set',
      SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'not set',
    },
    session: {
      id: req.session.id,
      active: !!req.session.userId,
      userId: req.session.userId || null
    }
  });
});
// Test endpoint to debug session persistence
app.get('/api/session-test', (req, res) => {
  const sessionCounter = req.session.counter || 0;
  req.session.counter = sessionCounter + 1;

  res.status(200).json({
    sessionId: req.session.id,
    counter: req.session.counter,
    userId: req.session.userId || null,
    isAuthenticated: !!req.session.userId,
    cookiePresent: !!req.headers.cookie
  });
});

// Debug endpoint to test certificate authentication
app.get('/api/debug-auth/:userId', async (req, res) => {
  try {
    console.log('=== DEBUG AUTH ENDPOINT ===');
    console.log('Session:', JSON.stringify(req.session, null, 2));
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    
    console.log('Session User ID:', sessionUserId);
    console.log('Requested User ID:', req.params.userId);
    
    if (!sessionUserId) {
      return res.json({
        authenticated: false,
        error: 'No session userId or header x-user-id',
        sessionData: req.session,
        headers: req.headers
      });
    }
    
    // Convert Firebase UIDs to integer user IDs
    const sessionUser = await getUser(sessionUserId);
    if (!sessionUser) {
      return res.json({
        authenticated: false,
        error: 'Session user not found',
        sessionUserId: sessionUserId
      });
    }
    const sessionUserIntId = sessionUser.id;
    
    let requestedUser = await getUser(req.params.userId);
    if (!requestedUser) {
      return res.json({
        authenticated: true,
        error: 'Requested user not found',
        sessionUserId: sessionUserId,
        requestedUserId: req.params.userId
      });
    }
    const requestedUserIntId = requestedUser.id;
    
    const completion = await getMicrolearningCompletion(requestedUserIntId);
    
    res.json({
      authenticated: true,
      sessionUserId: sessionUserId,
      sessionUserIntId: sessionUserIntId,
      requestedUserId: req.params.userId,
      requestedUserIntId: requestedUserIntId,
      sessionUser: sessionUser ? { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role } : null,
      completion: completion ? { confirmed: completion.confirmed, completedAt: completion.completedAt } : null,
      canAccess: sessionUserIntId === requestedUserIntId || sessionUser?.role === 'admin'
    });
  } catch (error) {
    console.error('Debug auth error:', error);
    res.status(500).json({ error: error.message });
  }
});
// Applications API endpoints
app.post('/api/applications', upload.fields([
  { name: 'foodSafetyLicense', maxCount: 1 },
  { name: 'foodEstablishmentCert', maxCount: 1 }
]), async (req, res) => {
  console.log('Application submission attempt');
  console.log('Session ID:', req.session.id);
  console.log('Cookie:', req.headers.cookie);
  console.log('Headers:', req.headers);
  console.log('Session data:', {
    userId: req.session.userId,
    user: req.session.user ? { id: req.session.user.id, username: req.session.user.username } : null
  });
  console.log('Request body (first field):', req.body ? req.body.fullName : 'No data');
  console.log('Files received:', req.files ? Object.keys(req.files) : 'No files');

  // Get userId from session OR from header if session is not working
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    console.log('No userId in session or header, returning 401');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Convert Firebase UID to integer user ID
  const user = await getUser(rawUserId);
  if (!user) {
    console.log('User not found for ID:', rawUserId);
    return res.status(401).json({ error: 'User not found' });
  }
  const userId = user.id;

  // Store user ID in session as a backup
  if (!req.session.userId && rawUserId) {
    console.log('Storing userId in session from header:', rawUserId);
    req.session.userId = rawUserId;
    await new Promise((resolve) => req.session.save(resolve));
  }

  try {
    console.log('User authenticated, processing application for user ID:', req.session.userId);

    // DEBUG: Log the entire request body to see what we're receiving
    console.log('=== APPLICATION SUBMISSION DEBUG (api/index.js) ===');
    console.log('Request method:', req.method);
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('Full request body:', JSON.stringify(req.body, null, 2));
    console.log('Files info:', req.files ? {
      fileCount: Object.keys(req.files).length,
      fields: Object.keys(req.files),
      details: Object.entries(req.files).map(([field, files]) => ({
        field,
        count: files.length,
        names: files.map(f => f.originalname)
      }))
    } : 'No files');
    console.log('Required fields check:');

    // Validate required fields
    const { fullName, email, phone, foodSafetyLicense, foodEstablishmentCert, kitchenPreference } = req.body;

    console.log('Extracted fields:', {
      fullName: fullName || 'MISSING',
      email: email || 'MISSING', 
      phone: phone || 'MISSING',
      foodSafetyLicense: foodSafetyLicense || 'MISSING',
      foodEstablishmentCert: foodEstablishmentCert || 'MISSING',
      kitchenPreference: kitchenPreference || 'MISSING'
    });

    if (!fullName || !email || !phone || !foodSafetyLicense || !foodEstablishmentCert || !kitchenPreference) {
      console.log('❌ Missing required fields in request - VALIDATION FAILED');
      console.log('Missing fields analysis:', {
        fullName: !fullName ? 'MISSING' : 'OK',
        email: !email ? 'MISSING' : 'OK',
        phone: !phone ? 'MISSING' : 'OK', 
        foodSafetyLicense: !foodSafetyLicense ? 'MISSING' : 'OK',
        foodEstablishmentCert: !foodEstablishmentCert ? 'MISSING' : 'OK',
        kitchenPreference: !kitchenPreference ? 'MISSING' : 'OK'
      });
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide all required application information'
      });
    }

    console.log('✅ All required fields present - proceeding with application creation');

    // Handle file uploads if present
    let uploadedFileUrls = {
      foodSafetyLicenseUrl: req.body.foodSafetyLicenseUrl || null,
      foodEstablishmentCertUrl: req.body.foodEstablishmentCertUrl || null
    };

    // Process uploaded files if any
    if (req.files) {
      console.log('📁 Processing uploaded files...');
      
      // Import put function for Vercel Blob
      try {
        const { put } = await import('@vercel/blob');
        
        // Upload food safety license file
        if (req.files.foodSafetyLicense && req.files.foodSafetyLicense[0]) {
          const file = req.files.foodSafetyLicense[0];
          console.log('⬆️ Uploading food safety license:', file.originalname);
          
          const blob = await put(`food-safety-license-${userId}-${Date.now()}-${file.originalname}`, file.buffer, {
            access: 'public',
            contentType: file.mimetype
          });
          
          uploadedFileUrls.foodSafetyLicenseUrl = blob.url;
          console.log('✅ Food safety license uploaded:', blob.url);
        }

        // Upload food establishment cert file
        if (req.files.foodEstablishmentCert && req.files.foodEstablishmentCert[0]) {
          const file = req.files.foodEstablishmentCert[0];
          console.log('⬆️ Uploading food establishment cert:', file.originalname);
          
          const blob = await put(`food-establishment-cert-${userId}-${Date.now()}-${file.originalname}`, file.buffer, {
            access: 'public',
            contentType: file.mimetype
          });
          
          uploadedFileUrls.foodEstablishmentCertUrl = blob.url;
          console.log('✅ Food establishment cert uploaded:', blob.url);
        }
        
        console.log('📄 Final document URLs:', uploadedFileUrls);
        
      } catch (uploadError) {
        console.error('❌ File upload error:', uploadError);
        return res.status(500).json({
          error: 'File upload failed',
          message: uploadError.message
        });
      }
    } else {
      console.log('📄 No files to upload, using URL inputs if provided');
    }

    // Handle document URLs from request body or uploads
    const documentData = uploadedFileUrls;

    // Store in database if available
    if (pool) {
      try {
        // Make sure the user exists
        const userCheckQuery = await pool.query(`
          SELECT id FROM users WHERE id = $1
        `, [userId]);

        if (userCheckQuery.rows.length === 0) {
          console.log(`User with ID ${userId} not found in database`);
          return res.status(400).json({ error: 'User not found. Please register or log in again.' });
        }

        console.log(`User with ID ${userId} verified in database, proceeding with application insertion`);

        // Insert application with document URLs
        const result = await pool.query(`
          INSERT INTO applications
          (user_id, full_name, email, phone, food_safety_license, food_establishment_cert, kitchen_preference, feedback, status,
           food_safety_license_url, food_establishment_cert_url, food_safety_license_status, food_establishment_cert_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING *;
        `, [
          userId, // Use the userId from session or header
          fullName,
          email,
          phone,
          foodSafetyLicense,
          foodEstablishmentCert,
          kitchenPreference,
          req.body.feedback || null, // Include feedback field, default to null if not provided
          'inReview', // Explicitly set status to inReview
          documentData.foodSafetyLicenseUrl, // Document URL
          documentData.foodEstablishmentCertUrl, // Document URL  
          documentData.foodSafetyLicenseUrl ? 'pending' : null, // Status based on URL presence
          documentData.foodEstablishmentCertUrl ? 'pending' : null // Status based on URL presence
        ]);

        const createdApplication = result.rows[0];

        console.log('✅ Application created with document URLs:', {
          id: createdApplication.id,
          hasDocuments: !!(createdApplication.food_safety_license_url || createdApplication.food_establishment_cert_url),
          documentUrls: {
            foodSafetyLicense: createdApplication.food_safety_license_url,
            foodEstablishmentCert: createdApplication.food_establishment_cert_url
          }
        });

        // Send appropriate email based on whether documents were submitted
        console.log("🔔 STARTING EMAIL PROCESS:", {
          applicationId: createdApplication.id,
          email: createdApplication.email,
          hasDocuments: !!(createdApplication.food_safety_license_url || createdApplication.food_establishment_cert_url),
          environment: process.env.NODE_ENV
        });
        
        try {
          if (createdApplication.email) {
            const hasDocuments = !!(createdApplication.food_safety_license_url || createdApplication.food_establishment_cert_url);
            
            if (hasDocuments) {
              // Application submitted WITH documents - send combined email
              console.log("📧 Sending WITH documents email...");
              const { sendEmail, generateApplicationWithDocumentsEmail } = await import('../server/email.js');
              const emailContent = generateApplicationWithDocumentsEmail({
                fullName: createdApplication.full_name || "Applicant",
                email: createdApplication.email
              });
              console.log("📧 WITH docs email content generated:", { to: emailContent.to, subject: emailContent.subject });

              const emailResult = await sendEmail(emailContent, {
                trackingId: `app_with_docs_${createdApplication.id}_${Date.now()}`
              });
              console.log(`✅ Application with documents email result: ${emailResult ? 'SUCCESS' : 'FAILED'} to ${createdApplication.email} for application ${createdApplication.id}`);
            } else {
              // Application submitted WITHOUT documents - prompt to upload
              console.log("📧 Sending WITHOUT documents email...");
              const { sendEmail, generateApplicationWithoutDocumentsEmail } = await import('../server/email.js');
              const emailContent = generateApplicationWithoutDocumentsEmail({
                fullName: createdApplication.full_name || "Applicant",
                email: createdApplication.email
              });
              console.log("📧 WITHOUT docs email content generated:", { to: emailContent.to, subject: emailContent.subject });

              const emailResult = await sendEmail(emailContent, {
                trackingId: `app_no_docs_${createdApplication.id}_${Date.now()}`
              });
              console.log(`✅ Application without documents email result: ${emailResult ? 'SUCCESS' : 'FAILED'} to ${createdApplication.email} for application ${createdApplication.id}`);
            }
          } else {
            console.warn(`Cannot send application email: Missing email address`);
          }
        } catch (emailError) {
          // Log the error but don't fail the request
          console.error("❌ PRODUCTION EMAIL ERROR:", {
            error: emailError.message,
            stack: emailError.stack,
            applicationId: createdApplication.id,
            email: createdApplication.email,
            hasDocuments: !!(createdApplication.food_safety_license_url || createdApplication.food_establishment_cert_url),
            environment: process.env.NODE_ENV,
            emailConfig: {
              hasEmailUser: !!process.env.EMAIL_USER,
              hasEmailPass: !!process.env.EMAIL_PASS,
              emailHost: process.env.EMAIL_HOST
            }
          });
        }

        // Return the created application
        return res.status(201).json(createdApplication);
      } catch (error) {
        console.error('Error storing application:', error);
        return res.status(500).json({
          error: 'Failed to store application',
          message: error.message
        });
      }
    }

    // Fallback to memory storage (simplified)
    const application = {
      id: Date.now(),
      userId: req.session.userId,
      fullName,
      email,
      phone,
      foodSafetyLicense,
      foodEstablishmentCert,
      kitchenPreference,
      feedback: req.body.feedback || null, // Include feedback field
      status: 'inReview',
      createdAt: new Date().toISOString(),
      // Include document URLs
      foodSafetyLicenseUrl: documentData.foodSafetyLicenseUrl,
      foodEstablishmentCertUrl: documentData.foodEstablishmentCertUrl,
      foodSafetyLicenseStatus: documentData.foodSafetyLicenseUrl ? 'pending' : null,
      foodEstablishmentCertStatus: documentData.foodEstablishmentCertUrl ? 'pending' : null
    };

    console.log('✅ Application created in memory with document URLs:', {
      id: application.id,
      hasDocuments: !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl),
      documentUrls: {
        foodSafetyLicense: application.foodSafetyLicenseUrl,
        foodEstablishmentCert: application.foodEstablishmentCertUrl
      }
    });

    // Send appropriate email based on whether documents were submitted (for memory storage case)
    console.log("🔔 STARTING EMAIL PROCESS (MEMORY):", {
      applicationId: application.id,
      email: application.email,
      hasDocuments: !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl),
      environment: process.env.NODE_ENV
    });
    
    try {
      if (application.email) {
        const hasDocuments = !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl);
        
        if (hasDocuments) {
          // Application submitted WITH documents - send combined email
          console.log("📧 Sending WITH documents email (MEMORY)...");
          const { sendEmail, generateApplicationWithDocumentsEmail } = await import('../server/email.js');
          const emailContent = generateApplicationWithDocumentsEmail({
            fullName: application.fullName || "Applicant",
            email: application.email
          });
          console.log("📧 WITH docs email content generated (MEMORY):", { to: emailContent.to, subject: emailContent.subject });

          const emailResult = await sendEmail(emailContent, {
            trackingId: `app_with_docs_${application.id}_${Date.now()}`
          });
          console.log(`✅ Application with documents email result (MEMORY): ${emailResult ? 'SUCCESS' : 'FAILED'} to ${application.email} for application ${application.id}`);
        } else {
          // Application submitted WITHOUT documents - prompt to upload
          console.log("📧 Sending WITHOUT documents email (MEMORY)...");
          const { sendEmail, generateApplicationWithoutDocumentsEmail } = await import('../server/email.js');
          const emailContent = generateApplicationWithoutDocumentsEmail({
            fullName: application.fullName || "Applicant",
            email: application.email
          });
          console.log("📧 WITHOUT docs email content generated (MEMORY):", { to: emailContent.to, subject: emailContent.subject });

          const emailResult = await sendEmail(emailContent, {
            trackingId: `app_no_docs_${application.id}_${Date.now()}`
          });
          console.log(`✅ Application without documents email result (MEMORY): ${emailResult ? 'SUCCESS' : 'FAILED'} to ${application.email} for application ${application.id}`);
        }
      } else {
        console.warn(`Cannot send application email: Missing email address`);
      }
    } catch (emailError) {
      // Log the error but don't fail the request
      console.error("❌ PRODUCTION EMAIL ERROR (Memory):", {
        error: emailError.message,
        stack: emailError.stack,
        applicationId: application.id,
        email: application.email,
        hasDocuments: !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl),
        environment: process.env.NODE_ENV,
        emailConfig: {
          hasEmailUser: !!process.env.EMAIL_USER,
          hasEmailPass: !!process.env.EMAIL_PASS,
          emailHost: process.env.EMAIL_HOST
        }
      });
    }

    res.status(201).json(application);
  } catch (error) {
    console.error('Create application error:', error);
    res.status(500).json({
      error: 'Failed to create application',
      message: error.message
    });
  }
});

// Admin endpoint to get all applications
app.get('/api/applications', async (req, res) => {
  console.log('GET /api/applications - Session data:', {
    sessionId: req.session.id,
    userId: req.session.userId || null,
    headers: {
      'x-user-id': req.headers['x-user-id'] || null
    }
  });

  // Get user ID from session or header
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    console.log('No userId in session or header');
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // First check if the user is an admin - convert Firebase UID to integer ID
    let user = await getUser(rawUserId);
    
    // If user not found and rawUserId looks like a Firebase UID, try to auto-sync
    if (!user && typeof rawUserId === 'string' && rawUserId.length > 10 && !rawUserId.match(/^\d+$/)) {
      console.log('Admin user not found for Firebase UID, attempting auto-sync:', rawUserId);
      
      try {
        // Auto-sync Firebase user to database
        const syncResponse = await fetch(`${process.env.BASE_URL || 'http://localhost:5000'}/api/firebase-sync-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: rawUserId,
            email: `firebase_admin_${rawUserId}@auto-sync.local`,
            displayName: `Admin_${rawUserId.slice(-8)}`,
            role: 'admin' // Try admin role
          })
        });
        
        if (syncResponse.ok) {
          const syncData = await syncResponse.json();
          console.log('Admin auto-sync successful:', syncData);
          
          // Try to get user again after sync
          user = await getUser(rawUserId);
        }
      } catch (syncError) {
        console.error('Admin auto-sync error:', syncError);
      }
    }
    
    console.log('User from DB:', user ? { id: user.id, username: user.username, role: user.role } : null);

    if (!user || user.role !== 'admin') {
      console.log('User is not an admin:', user ? user.role : 'user not found');
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can access this endpoint'
      });
    }

    // Store user ID in session if it's not there
    if (!req.session.userId && rawUserId) {
      console.log('Storing userId in session from header:', rawUserId);
      req.session.userId = rawUserId;
      await new Promise(resolve => req.session.save(resolve));
    }

    // Get from database if available
    if (pool) {
      // Check if table exists
      const tableCheck = await pool.query(`
        SELECT to_regclass('public.applications') as table_exists;
      `);

      if (!tableCheck.rows[0].table_exists) {
        // No applications table yet
        return res.status(200).json([]);
      }

      // Get applications with document data (all stored in applications table)
      const result = await pool.query(`
        SELECT a.*, u.username as applicant_username
        FROM applications a
        JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC;
      `);

      // Log the first application to see what fields are available
      if (result.rows.length > 0) {
        console.log('Sample application data with document verification:', {
          id: result.rows[0].id,
          status: result.rows[0].status,
          user_id: result.rows[0].user_id,
          document_urls: {
            food_safety_license_url: result.rows[0].food_safety_license_url,
            food_establishment_cert_url: result.rows[0].food_establishment_cert_url
          },
          document_statuses: {
            food_safety_license_status: result.rows[0].food_safety_license_status,
            food_establishment_cert_status: result.rows[0].food_establishment_cert_status
          },
          hasDocumentData: !!(result.rows[0].food_safety_license_url || result.rows[0].food_establishment_cert_url)
        });
      }

      return res.status(200).json(result.rows);
    }

    // Fallback empty response
    res.status(200).json([]);
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({
      error: 'Failed to get applications',
      message: error.message
    });
  }
});
// User endpoint to get their own applications
app.get('/api/applications/my-applications', async (req, res) => {
  console.log('GET /api/applications/my-applications - Session data:', {
    sessionId: req.session.id,
    userId: req.session.userId || null,
    headers: {
      'x-user-id': req.headers['x-user-id'] || null,
      'user-agent': req.headers['user-agent'] || null,
      'cache-control': req.headers['cache-control'] || null
    },
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });

  // Force no-cache response
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  // Get user ID from session or header
  let rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    console.log('No userId in session or header');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Convert Firebase UID to integer user ID
  let user = await getUser(rawUserId);
  
  console.log('User lookup result:', {
    rawUserId: rawUserId,
    userFound: !!user,
    userDetails: user ? { id: user.id, username: user.username, role: user.role, firebase_uid: user.firebase_uid } : null
  });
  
  // If user not found and rawUserId looks like a Firebase UID, try to auto-sync
  if (!user && typeof rawUserId === 'string' && rawUserId.length > 10 && !rawUserId.match(/^\d+$/)) {
    console.log('User not found for Firebase UID, attempting auto-sync:', rawUserId);
    
    try {
      // Check if we can get Firebase user info first
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
      const firebaseUser = token ? await verifyFirebaseToken(token) : null;
      
      if (firebaseUser) {
        console.log('Firebase user info available for sync:', { 
          uid: firebaseUser.uid, 
          email: firebaseUser.email,
          emailVerified: firebaseUser.email_verified 
        });
        
        // Auto-sync Firebase user to database with real email
        const syncResponse = await fetch(`${process.env.BASE_URL || 'http://localhost:5000'}/api/firebase-sync-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: firebaseUser.uid,
            email: firebaseUser.email || `firebase_user_${rawUserId}@auto-sync.local`,
            displayName: firebaseUser.name || `User_${rawUserId.slice(-8)}`,
            emailVerified: firebaseUser.email_verified || false,
            role: 'applicant'
          })
        });
        
        if (syncResponse.ok) {
          const syncData = await syncResponse.json();
          console.log('Auto-sync successful:', syncData);
          
          // Try to get user again after sync
          user = await getUser(rawUserId);
          console.log('User after auto-sync:', user ? { id: user.id, username: user.username, role: user.role } : 'Still not found');
        } else {
          console.log('Auto-sync failed:', syncResponse.status);
        }
      } else {
        console.log('No Firebase token available for auto-sync, creating placeholder user');
        // Fallback to placeholder sync
        const syncResponse = await fetch(`${process.env.BASE_URL || 'http://localhost:5000'}/api/firebase-sync-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: rawUserId,
            email: `firebase_user_${rawUserId}@auto-sync.local`,
            displayName: `User_${rawUserId.slice(-8)}`,
            role: 'applicant'
          })
        });
        
        if (syncResponse.ok) {
          user = await getUser(rawUserId);
        }
      }
    } catch (syncError) {
      console.error('Auto-sync error:', syncError);
    }
  }
  
  if (!user) {
    console.log('User not found for ID even after sync attempt:', rawUserId);
    return res.status(401).json({ error: 'User not found' });
  }
  
  const userId = user.id;
  console.log('Using database user ID for applications query:', userId);

  try {
    // Get from database if available
    if (pool) {
      // Check if table exists
      const tableCheck = await pool.query(`
        SELECT to_regclass('public.applications') as table_exists;
      `);

      if (!tableCheck.rows[0].table_exists) {
        // No applications table yet
        return res.status(200).json([]);
      }

      // Get applications with document data from applications table itself
      const result = await pool.query(`
        SELECT a.*
        FROM applications a
        WHERE a.user_id = $1
        ORDER BY a.created_at DESC;
      `, [userId]);

      console.log(`Found ${result.rows.length} applications for user ${userId} (Firebase UID: ${rawUserId})`);
      return res.status(200).json(result.rows);
    }

    // Fallback empty response
    res.status(200).json([]);
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({
      error: 'Failed to get applications',
      message: error.message
    });
  }
});

// Get a single application by ID
app.get('/api/applications/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { id } = req.params;

    // Get from database if available
    if (pool) {
      // Check if applications table exists
      const tableCheck = await pool.query(`
        SELECT to_regclass('public.applications') as table_exists;
      `);

      if (!tableCheck.rows[0].table_exists) {
        return res.status(404).json({ error: 'Application not found' });
      }

      // Get user to check if admin
      const user = await getUser(req.session.userId);
      if (!user) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // If admin, they can see any application
      // If applicant, they can only see their own applications
      let query = `SELECT * FROM applications WHERE id = $1`;
      const params = [id];

      if (user.role !== 'admin') {
        query += ` AND user_id = $2`;
        params.push(req.session.userId);
      }

      const result = await pool.query(query, params);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Application not found' });
      }

      return res.status(200).json(result.rows[0]);
    }

    // Fallback error for no database
    res.status(404).json({ error: 'Application not found' });
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({ error: 'Failed to get application' });
  }
});

// Cancel application endpoint (applicants can cancel their own applications)
app.patch('/api/applications/:id/cancel', async (req, res) => {
  console.log('🚫 CANCEL APPLICATION - Request received:', {
    applicationId: req.params.id,
    sessionId: req.session.id,
    sessionUserId: req.session.userId || null,
    headerUserId: req.headers['x-user-id'] || null,
    method: req.method,
    url: req.url
  });

  // Get user ID from session or header
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    console.log('🚫 CANCEL ERROR: No userId in session or header');
    return res.status(401).json({ error: 'Authentication required' });
  }

  console.log('🚫 Looking up user for rawUserId:', rawUserId);

  // Convert Firebase UID to integer user ID
  const user = await getUser(rawUserId);
  if (!user) {
    console.log('🚫 CANCEL ERROR: User not found for ID:', rawUserId);
    return res.status(401).json({ error: 'User not found' });
  }
  const userId = user.id;

  console.log('🚫 User lookup successful:', {
    firebaseUid: rawUserId,
    integerUserId: userId,
    userRole: user.role,
    userEmail: user.email
  });

  // Store user ID in session if it's not there
  if (!req.session.userId && rawUserId) {
    console.log('Storing userId in session from header:', rawUserId);
    req.session.userId = rawUserId;
    await new Promise(resolve => req.session.save(resolve));
  }

  try {
    const { id } = req.params;

    // Get from database if available
    if (pool) {
      // Check if applications table exists
      const tableCheck = await pool.query(`
        SELECT to_regclass('public.applications') as table_exists;
      `);

      if (!tableCheck.rows[0].table_exists) {
        return res.status(404).json({ error: 'Application not found' });
      }

      // Note: user is already available from the lookup above
      // No need to look up again

      // Update the application
      let result;
      if (user.role === 'admin') {
        // Admins can cancel any application
        result = await pool.query(`
          UPDATE applications
          SET status = 'cancelled'
          WHERE id = $1
          RETURNING *;
        `, [id]);
      } else {
        // Applicants can only cancel their own applications
        // Use the integer userId from the user lookup, not the Firebase UID
        result = await pool.query(`
          UPDATE applications
          SET status = 'cancelled'
          WHERE id = $1 AND user_id = $2
          RETURNING *;
        `, [id, userId]);  // ✅ FIX: Use integer userId instead of Firebase UID
      }

      console.log('🚫 Database update result:', {
        rowCount: result.rowCount,
        applicationId: id,
        userId: userId,
        success: result.rowCount > 0
      });

      if (result.rowCount === 0) {
        console.log('🚫 CANCEL ERROR: Application not found or not owned by user');
        return res.status(404).json({ error: 'Application not found or not owned by you' });
      }

      // Get the user_id for the cancelled application
      const cancelledApp = result.rows[0];
      const cancelledUserId = cancelledApp.user_id;

      console.log('🚫 Application cancelled successfully:', {
        applicationId: cancelledApp.id,
        status: cancelledApp.status,
        userId: cancelledUserId
      });

      // Get document URLs before deletion for blob cleanup
              // Get document URLs from the application record
        const docResult = await pool.query(`
          SELECT food_safety_license_url, food_establishment_cert_url 
          FROM applications
          WHERE id = $1
        `, [result.rows[0].id]);

      // Clean up Vercel blob files if they exist
      if (docResult.rows.length > 0) {
        const docUrls = docResult.rows[0];
        await cleanupBlobFiles([
          docUrls.food_safety_license_url,
          docUrls.food_establishment_cert_url
        ]);
      }

      // Send email notification about application cancellation
      try {
        // Import the email functions
        const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

        if (cancelledApp.email) {
          const emailContent = generateStatusChangeEmail({
            fullName: cancelledApp.full_name || cancelledApp.applicant_name || "Applicant",
            email: cancelledApp.email,
            status: 'cancelled'
          });

          await sendEmail(emailContent, {
            trackingId: `cancel_${cancelledApp.id}_${Date.now()}`
          });
          console.log(`Cancellation email sent to ${cancelledApp.email} for application ${cancelledApp.id}`);
        } else {
          console.warn(`Cannot send cancellation email for application ${cancelledApp.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending cancellation email:", emailError);
      }

      // due to CASCADE DELETE foreign key constraint

      return res.status(200).json(cancelledApp);
    }

    // Fallback error - no storage
    res.status(500).json({ error: 'No storage available' });
  } catch (error) {
    console.error('Cancel application error:', error);
    res.status(500).json({ error: 'Failed to cancel application' });
  }
});

// Update application status endpoint (admin only)
app.patch('/api/applications/:id/status', async (req, res) => {
  // Check if user is authenticated via session or X-User-ID header
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  console.log('Status update request - Auth info:', {
    sessionUserId: req.session.userId,
    headerUserId: req.headers['x-user-id'],
    rawUserId: rawUserId
  });

  if (!rawUserId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // First check if the user is an admin - convert Firebase UID to integer ID
    const user = await getUser(rawUserId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can update application status'
      });
    }
    const userId = user.id;

    // Store user ID in session if it's not there
    if (!req.session.userId && rawUserId) {
      console.log('Storing userId in session from header:', rawUserId);
      req.session.userId = rawUserId;
      await new Promise(resolve => req.session.save(resolve));
    }

    const { id } = req.params;
    const { status } = req.body;

    // Validate the status
    const validStatuses = ['inReview', 'approved', 'rejected', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Update in database if available
    if (pool) {
      // Check if applications table exists
      const tableCheck = await pool.query(`
        SELECT to_regclass('public.applications') as table_exists;
      `);

      if (!tableCheck.rows[0].table_exists) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Application not found'
        });
      }

      // Update the application
      const result = await pool.query(`
        UPDATE applications
        SET status = $1
        WHERE id = $2
        RETURNING *;
      `, [status, id]);

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Application not found'
        });
      }

      const updatedApplication = result.rows[0];

      // Send email notification about status change
      try {
        // Import the email functions
        const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

        if (updatedApplication.email) {
          const emailContent = generateStatusChangeEmail({
            fullName: updatedApplication.full_name || updatedApplication.applicant_name || "Applicant",
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
    }

    // Fallback error - no storage
    res.status(500).json({
      error: 'No storage available',
      message: 'Cannot update application without database'
    });
  } catch (error) {
    console.error('Update application status error:', error);
    res.status(500).json({
      error: 'Failed to update application status',
      message: error.message
    });
  }
});

// Database initialization endpoint
app.get('/api/init-db', async (req, res) => {
  if (!pool) {
    return res.status(400).json({
      error: 'No database connection',
      message: 'DATABASE_URL environment variable is not set'
    });
  }

  try {
    await initializeDatabase();
    res.status(200).json({
      message: 'Database initialization attempted',
      success: true
    });
  } catch (error) {
    console.error('Database initialization error:', error);
    res.status(500).json({
      error: 'Database initialization failed',
      message: error.message
    });
  }
});
// ===============================
// FILE SERVING ROUTES
// ===============================

// Serve uploaded document files
app.get("/api/files/documents/:filename", async (req, res) => {
  try {
    // Check if user is authenticated
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Convert Firebase UID to integer user ID
    const user = await getUser(rawUserId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // File serving not supported in serverless environment
    return res.status(501).json({ 
      message: "File serving not available in production environment. Please use external URLs for document storage." 
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});
// ===============================
// APPLICATION DOCUMENT ROUTES
// ===============================

// Update application documents endpoint (for approved applicants)
app.patch("/api/applications/:id/documents", async (req, res) => {
  try {
    console.log("=== DOCUMENT UPLOAD DEBUG START ===");
    console.log("Document upload request received:", {
      method: req.method,
      applicationId: req.params.id,
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body || {}),
      body: req.body,
      headers: {
        'x-user-id': req.headers['x-user-id'],
        'content-length': req.headers['content-length']
      }
    });

    // Check if user is authenticated
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      console.log("❌ Authentication failed - no userId found");
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Convert Firebase UID to integer user ID
    const authenticatedUser = await getUser(rawUserId);
    if (!authenticatedUser) {
      console.log("❌ User not found for ID:", rawUserId);
      return res.status(401).json({ message: "User not found" });
    }
    const userId = authenticatedUser.id;

    console.log("✅ User authenticated with Firebase UID:", rawUserId, "-> integer ID:", userId);

    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      console.log("❌ Invalid application ID:", req.params.id);
      return res.status(400).json({ message: "Invalid application ID" });
    }

    console.log("✅ Application ID parsed:", applicationId);

    // Get the application to verify ownership and status
    let application = null;
    if (pool) {
      console.log("📊 Querying database for application...");
      const result = await pool.query(`
        SELECT * FROM applications WHERE id = $1
      `, [applicationId]);
      application = result.rows[0];
      console.log("📊 Database query result:", {
        found: !!application,
        applicationStatus: application?.status,
        userId: application?.user_id
      });
    } else {
      console.log("❌ No database pool available");
    }

    if (!application) {
      console.log("❌ Application not found in database");
      return res.status(404).json({ message: "Application not found" });
    }

    console.log("✅ Application found:", {
      id: application.id,
      status: application.status,
      userId: application.user_id,
      currentDocUrls: {
        foodSafety: application.food_safety_license_url,
        foodEstablishment: application.food_establishment_cert_url
      }
    });

    // Check if user owns the application or is admin (use already retrieved user)
    console.log("👤 User details:", {
      found: !!authenticatedUser,
      role: authenticatedUser?.role,
      isAdmin: authenticatedUser?.role === "admin"
    });
    
    // Check if user owns the application or is admin
    if (application.user_id !== userId && authenticatedUser?.role !== "admin") {
      console.log("❌ Access denied - user doesn't own application and is not admin");
      return res.status(403).json({ message: "Access denied" });
    }

    console.log("✅ Access check passed");

    // Check if application status allows document uploads
    if (application.status === 'cancelled' || application.status === 'rejected') {
      console.log("❌ Document upload blocked - application status:", application.status);
      return res.status(400).json({ 
        message: "Document uploads are not permitted for cancelled or rejected applications",
        applicationStatus: application.status
      });
    }

    // Allow document uploads for active application statuses
    console.log("✅ Document upload allowed for application status:", application.status);

    const updateData = {};

    // Handle URL inputs only (file uploads not supported in serverless environment)
    if (req.body.foodSafetyLicenseUrl) {
      updateData.food_safety_license_url = req.body.foodSafetyLicenseUrl;
      updateData.food_safety_license_status = 'pending';
      console.log("📄 Adding food safety license URL:", req.body.foodSafetyLicenseUrl);
    }

    if (req.body.foodEstablishmentCertUrl) {
      updateData.food_establishment_cert_url = req.body.foodEstablishmentCertUrl;
      updateData.food_establishment_cert_status = 'pending';
      console.log("📄 Adding food establishment cert URL:", req.body.foodEstablishmentCertUrl);
    }

    console.log("🔄 Update data prepared:", updateData);

    // Check if any document data was provided
    if (Object.keys(updateData).length === 0) {
      console.log("❌ No document URLs provided in request body");
      return res.status(400).json({ 
        message: "No document URLs provided. Please provide document URLs for upload." 
      });
    }

    console.log("🔄 Final update data:", updateData);

    // Update the application record directly with document URLs
    if (pool) {
      console.log("💾 Starting database update...");
      const setClause = Object.keys(updateData).map((key, index) => `${key} = $${index + 2}`).join(', ');
      const values = [applicationId, ...Object.values(updateData)];
      
      console.log("💾 SQL Update query:", {
        setClause,
        values,
        query: `UPDATE applications SET ${setClause} WHERE id = $1 RETURNING *;`
      });
      
      const result = await pool.query(`
        UPDATE applications 
        SET ${setClause}
        WHERE id = $1
        RETURNING *;
      `, values);

      console.log("💾 Database update result:", {
        rowCount: result.rowCount,
        success: result.rowCount > 0
      });

      if (result.rowCount === 0) {
        console.log("❌ Database update failed - no rows affected");
        return res.status(500).json({ message: "Failed to update application documents" });
      }

      const updatedApplication = result.rows[0];
      
      console.log("✅ Application document URLs updated successfully:", {
        applicationId: updatedApplication.id,
        urls: {
          foodSafetyLicense: updatedApplication.food_safety_license_url,
          foodEstablishmentCert: updatedApplication.food_establishment_cert_url
        },
        statuses: {
          foodSafetyLicense: updatedApplication.food_safety_license_status,
          foodEstablishmentCert: updatedApplication.food_establishment_cert_status
        }
      });
      
      console.log("📤 Returning response data with URLs:", {
        responseHasUrls: !!(updatedApplication.food_safety_license_url || updatedApplication.food_establishment_cert_url),
        urls: {
          foodSafetyLicense: updatedApplication.food_safety_license_url,
          foodEstablishmentCert: updatedApplication.food_establishment_cert_url
        }
      });
      
      // Verify the data was actually saved by querying again
      const verifyResult = await pool.query(`
        SELECT food_safety_license_url, food_establishment_cert_url, 
               food_safety_license_status, food_establishment_cert_status 
        FROM applications WHERE id = $1
      `, [applicationId]);
      
      console.log("🔍 Verification query result:", {
        found: verifyResult.rows.length > 0,
        data: verifyResult.rows[0] || "No data"
      });
      
      // Send document update confirmation email (only for dashboard updates, not initial submissions)
      try {
        if (updatedApplication.email) {
          const { sendEmail, generateDocumentUpdateEmail } = await import('../server/email.js');
          const emailContent = generateDocumentUpdateEmail({
            fullName: updatedApplication.full_name || "User",
            email: updatedApplication.email
          });

          await sendEmail(emailContent, {
            trackingId: `doc_update_${updatedApplication.id}_${Date.now()}`
          });
          console.log(`Document update confirmation email sent to ${updatedApplication.email}`);
        } else {
          console.warn(`Cannot send document update email: No email address found`);
        }
      } catch (emailError) {
        console.error('Error sending document update confirmation email:', emailError);
      }
      
      console.log("=== DOCUMENT UPLOAD DEBUG END (SUCCESS) ===");
      return res.status(200).json(updatedApplication);
    } else {
      console.log("❌ No database pool available for update");
      console.log("=== DOCUMENT UPLOAD DEBUG END (ERROR) ===");
      return res.status(500).json({ message: "Database not available" });
    }

  } catch (error) {
    console.error("❌ ERROR in document upload endpoint:", error);
    console.error("Error stack:", error.stack);
    console.log("=== DOCUMENT UPLOAD DEBUG END (ERROR) ===");
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});
// Update application document verification status (admin only)
app.patch("/api/applications/:id/document-verification", async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }
    const userId = user.id;

    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    // Get the application to find the user_id
    const appResult = await pool.query(`
      SELECT user_id FROM applications WHERE id = $1
    `, [applicationId]);

    if (appResult.rows.length === 0) {
      return res.status(404).json({ message: "Application not found" });
    }

    const targetUserId = appResult.rows[0].user_id;

    // Build update data for applications table (document verification fields)
    const updateData = {
      documents_reviewed_by: userId,
      documents_reviewed_at: new Date()
    };

    // Map camelCase field names to snake_case database column names
    const fieldMapping = {
      'foodSafetyLicenseStatus': 'food_safety_license_status',
      'foodEstablishmentCertStatus': 'food_establishment_cert_status',
      'documentsAdminFeedback': 'documents_admin_feedback'
    };

    // Apply field mapping and add to update data
    Object.keys(req.body).forEach(key => {
      const mappedKey = fieldMapping[key] || key;
      updateData[mappedKey] = req.body[key];
    });

    // Update the application record directly with document verification status
    const setClause = Object.keys(updateData).map((key, index) => `${key} = $${index + 2}`).join(', ');
    const values = [applicationId, ...Object.values(updateData)];
    
    const result = await pool.query(`
      UPDATE applications 
      SET ${setClause}
      WHERE id = $1
      RETURNING *;
    `, values);

    if (result.rowCount === 0) {
      return res.status(500).json({ message: "Failed to update document verification" });
    }

    const updatedApplication = result.rows[0];

    console.log(`Document verification updated for application ${applicationId}:`, {
      foodSafetyLicenseStatus: updatedApplication.food_safety_license_status,
      foodEstablishmentCertStatus: updatedApplication.food_establishment_cert_status,
      reviewedBy: userId,
      timestamp: new Date().toISOString()
    });

    // Check if all documents are approved and send consolidated email
    try {
      if (updatedApplication.email) {
        // Import the email functions
        const { sendEmail, generateChefAllDocumentsApprovedEmail } = await import('../server/email.js');

        // Check if all documents are approved
        const hasFoodSafetyLicense = updatedApplication.food_safety_license_url;
        const hasFoodEstablishmentCert = updatedApplication.food_establishment_cert_url;
        
        const foodSafetyApproved = updatedApplication.food_safety_license_status === "approved";
        const foodEstablishmentApproved = !hasFoodEstablishmentCert || updatedApplication.food_establishment_cert_status === "approved";
        
        // If all documents are approved, send consolidated email
        if (foodSafetyApproved && foodEstablishmentApproved) {
          const approvedDocuments = [];
          if (hasFoodSafetyLicense) approvedDocuments.push("Food Safety License");
          if (hasFoodEstablishmentCert) approvedDocuments.push("Food Establishment Certificate");
          
          const emailContent = generateChefAllDocumentsApprovedEmail({
            fullName: updatedApplication.full_name || updatedApplication.applicant_name || "Applicant",
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

    // Check if both documents are approved, then update user verification status
    if (updatedApplication.food_safety_license_status === "approved" && 
        (!updatedApplication.food_establishment_cert_url || updatedApplication.food_establishment_cert_status === "approved")) {
      
      await pool.query(`
        UPDATE users SET is_verified = true WHERE id = $1
      `, [targetUserId]);
      
      console.log(`User ${targetUserId} has been fully verified`);
      
      // Send full verification email with vendor credentials
      try {
        console.log(`🔍 Full verification email trigger - User ${targetUserId}`);
        console.log(`📧 Application email: ${updatedApplication.email}`);
        console.log(`📱 Application phone: ${updatedApplication.phone}`);
        console.log(`👤 Application name: ${updatedApplication.full_name}`);
        
        // Import the email functions
        const { sendEmail, generateFullVerificationEmail } = await import('../server/email.js');
        
        // Get user details for email
        const userResult = await pool.query(`
          SELECT username FROM users WHERE id = $1
        `, [targetUserId]);
        
        if (userResult.rows.length > 0 && updatedApplication.email) {
          const user = userResult.rows[0];
          
          // Ensure we have all required data
          const emailData = {
            fullName: updatedApplication.full_name || user.username || 'User',
            email: updatedApplication.email,
            phone: updatedApplication.phone || user.username || '0000000000'
          };
          
          console.log(`📤 Preparing email with data:`, {
            fullName: emailData.fullName,
            email: emailData.email,
            phone: emailData.phone ? 'Present' : 'Missing'
          });
          
          const emailContent = generateFullVerificationEmail(emailData);
          
          const emailSent = await sendEmail(emailContent, {
            trackingId: `full_verification_${targetUserId}_${Date.now()}`
          });
          
          if (emailSent) {
            console.log(`✅ Full verification email sent successfully to ${updatedApplication.email} for user ${targetUserId}`);
            console.log(`🔑 Vendor credentials generated: username=${emailData.phone.replace(/[^0-9]/g, '')}`);
          } else {
            console.error(`❌ Failed to send full verification email to ${updatedApplication.email} for user ${targetUserId}`);
          }
        } else {
          console.warn(`⚠️ Cannot send full verification email: Missing user data or email for user ${targetUserId}`);
          console.warn(`   - User found: ${userResult.rows.length > 0}`);
          console.warn(`   - Email present: ${!!updatedApplication.email}`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("💥 Error sending full verification email:", emailError);
        console.error("💥 Error stack:", emailError.stack);
      }
    }

    // Return the application data in the format expected by the frontend
    const responseData = updatedApplication;

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Error updating application document verification:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});
// Debug endpoint to check application document URLs
app.get("/api/debug/applications/:id/documents", async (req, res) => {
  try {
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    const result = await pool.query(`
      SELECT id, user_id, status, 
             food_safety_license_url, food_establishment_cert_url,
             food_safety_license_status, food_establishment_cert_status,
             created_at
      FROM applications 
      WHERE id = $1
    `, [applicationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Application not found" });
    }

    const app = result.rows[0];
    
    return res.status(200).json({
      debug: true,
      application: {
        id: app.id,
        userId: app.user_id,
        status: app.status,
        documentUrls: {
          foodSafetyLicense: app.food_safety_license_url,
          foodEstablishmentCert: app.food_establishment_cert_url
        },
        documentStatuses: {
          foodSafetyLicense: app.food_safety_license_status,
          foodEstablishmentCert: app.food_establishment_cert_status
        },
        hasDocuments: !!(app.food_safety_license_url || app.food_establishment_cert_url),
        timestamps: {
          created: app.created_at
        }
      },
      rawDatabaseRow: app
    });
  } catch (error) {
    console.error("Error in debug endpoint:", error);
    return res.status(500).json({ 
      message: "Internal server error", 
      error: error.message 
    });
  }
});

// Debug endpoint to list all applications with document info
app.get("/api/debug/applications", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    const result = await pool.query(`
      SELECT id, user_id, status, full_name, email,
             food_safety_license_url, food_establishment_cert_url,
             food_safety_license_status, food_establishment_cert_status,
             created_at
      FROM applications 
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const applications = result.rows.map(app => ({
      id: app.id,
      userId: app.user_id,
      status: app.status,
      fullName: app.full_name,
      email: app.email,
      hasDocuments: !!(app.food_safety_license_url || app.food_establishment_cert_url),
      documentUrls: {
        foodSafetyLicense: app.food_safety_license_url ? "✅ Present" : "❌ Missing",
        foodEstablishmentCert: app.food_establishment_cert_url ? "✅ Present" : "❌ Missing"
      },
      documentStatuses: {
        foodSafetyLicense: app.food_safety_license_status || "Not set",
        foodEstablishmentCert: app.food_establishment_cert_status || "Not set"
      },
      timestamps: {
        created: app.created_at
      }
    }));

    return res.status(200).json({
      debug: true,
      totalApplications: applications.length,
      applicationsWithDocuments: applications.filter(app => app.hasDocuments).length,
      applications: applications
    });
  } catch (error) {
    console.error("Error in debug applications endpoint:", error);
    return res.status(500).json({ 
      message: "Internal server error", 
      error: error.message 
    });
  }
});

// Generic file upload endpoint (for use with new upload components) - Supports Firebase Auth
app.post("/api/upload", 
  requireFirebaseAuthWithUser,
  upload.single('file'), 
  async (req, res) => {
    try {
      console.log('🔄 === FILE UPLOAD DEBUG START ===');
      console.log('📤 Upload: Firebase Auth data:', {
        firebaseUid: req.firebaseUser?.uid,
        neonUserId: req.neonUser?.id,
        hasFile: !!req.file,
        fileDetails: req.file ? {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        } : null
      });
      
      // Use Firebase-authenticated user data
      const userId = req.neonUser.id;
      console.log('✅ Upload: User authenticated via Firebase:', req.firebaseUser?.uid, '-> Neon ID:', userId);

      if (!req.file) {
        console.log('❌ Upload: No file in request');
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log('✅ Upload: File received successfully');

      const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
      console.log('🌍 Environment:', isProduction ? 'Production (Vercel)' : 'Development');
      
      let fileUrl;
      let fileName;

      if (isProduction) {
        // Upload to Vercel Blob in production
        try {
          console.log('☁️ Starting Vercel Blob upload...');
          // Import Vercel Blob
          const { put } = await import('@vercel/blob');
          
          const timestamp = Date.now();
          const documentType = req.file.fieldname || 'file';
          const ext = path.extname(req.file.originalname);
          const baseName = path.basename(req.file.originalname, ext);
          
          const filename = `${userId}_${documentType}_${timestamp}_${baseName}${ext}`;
          
          console.log('☁️ Uploading to Vercel Blob:', {
            filename,
            size: req.file.size,
            mimetype: req.file.mimetype
          });
          
          const blob = await put(filename, req.file.buffer, {
            access: 'public',
            contentType: req.file.mimetype,
          });
          
          console.log(`✅ File uploaded to Vercel Blob successfully: ${filename} -> ${blob.url}`);
          fileUrl = blob.url;
          fileName = filename;
        } catch (error) {
          console.error('❌ Error uploading to Vercel Blob:', error);
          return res.status(500).json({ 
            error: "File upload failed",
            details: "Failed to upload file to cloud storage"
          });
        }
      } else {
        // In development, return a local file path (note: file serving is limited in this environment)
        fileUrl = `/api/files/documents/${req.file.filename}`;
        fileName = req.file.filename;
        console.log('💻 Development upload - file saved locally:', {
          fileUrl,
          fileName
        });
      }

      // Return success response with file information
      const response = {
        success: true,
        url: fileUrl,
        fileName: fileName,
        size: req.file.size,
        type: req.file.mimetype
      };
      
      console.log('📤 Upload successful, returning response:', response);
      console.log('🔄 === FILE UPLOAD DEBUG END (SUCCESS) ===');
      
      return res.status(200).json(response);
    } catch (error) {
      console.error("❌ File upload error:", error);
      console.error("Error stack:", error.stack);
      
      // Clean up uploaded file on error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error('Error cleaning up file:', e);
        }
      }
      
      console.log('🔄 === FILE UPLOAD DEBUG END (ERROR) ===');
      return res.status(500).json({ 
        error: "File upload failed",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
);
// Generic file upload endpoint (for use with new upload components) - Alternative endpoint
app.post("/api/upload-file", 
  upload.single('file'), 
  async (req, res) => {
    try {
      console.log('🔄 === FILE UPLOAD DEBUG START ===');
      console.log('📤 Upload: Session data:', {
        sessionId: req.session.id,
        sessionUserId: req.session.userId,
        headerUserId: req.headers['x-user-id'],
        hasFile: !!req.file,
        fileDetails: req.file ? {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        } : null
      });
      
      // Check if user is authenticated
      const rawUserId = req.session.userId || req.headers['x-user-id'];
      if (!rawUserId) {
        console.log('❌ Upload: No userId in session or header, returning 401');
        // Clean up uploaded file
        if (req.file && req.file.path) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (e) {
            console.error('Error cleaning up file:', e);
          }
        }
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Convert Firebase UID to integer user ID
      const user = await getUser(rawUserId);
      if (!user) {
        console.log('❌ Upload: User not found for ID:', rawUserId);
        // Clean up uploaded file
        if (req.file && req.file.path) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (e) {
            console.error('Error cleaning up file:', e);
          }
        }
        return res.status(401).json({ error: "User not found" });
      }
      const userId = user.id;

      console.log('✅ Upload: User authenticated:', rawUserId, '-> integer ID:', userId);

      // Store user ID in session as a backup (for Vercel session persistence)
      if (!req.session.userId && rawUserId) {
        console.log('🔄 Upload: Storing userId in session from header:', rawUserId);
        req.session.userId = rawUserId;
        await new Promise((resolve) => req.session.save(resolve));
      }

      if (!req.file) {
        console.log('❌ Upload: No file in request');
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log('✅ Upload: File received successfully');

      const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
      console.log('🌍 Environment:', isProduction ? 'Production (Vercel)' : 'Development');
      
      let fileUrl;
      let fileName;

      if (isProduction) {
        // Upload to Vercel Blob in production
        try {
          console.log('☁️ Starting Vercel Blob upload...');
          // Import Vercel Blob
          const { put } = await import('@vercel/blob');
          
          const timestamp = Date.now();
          const documentType = req.file.fieldname || 'file';
          const ext = path.extname(req.file.originalname);
          const baseName = path.basename(req.file.originalname, ext);
          
          const filename = `${userId}_${documentType}_${timestamp}_${baseName}${ext}`;
          
          console.log('☁️ Uploading to Vercel Blob:', {
            filename,
            size: req.file.size,
            mimetype: req.file.mimetype
          });
          
          const blob = await put(filename, req.file.buffer, {
            access: 'public',
            contentType: req.file.mimetype,
          });
          
          console.log(`✅ File uploaded to Vercel Blob successfully: ${filename} -> ${blob.url}`);
          fileUrl = blob.url;
          fileName = filename;
        } catch (error) {
          console.error('❌ Error uploading to Vercel Blob:', error);
          return res.status(500).json({ 
            error: "File upload failed",
            details: "Failed to upload file to cloud storage"
          });
        }
      } else {
        // In development, return a local file path (note: file serving is limited in this environment)
        fileUrl = `/api/files/documents/${req.file.filename}`;
        fileName = req.file.filename;
        console.log('💻 Development upload - file saved locally:', {
          fileUrl,
          fileName
        });
      }

      // Return success response with file information
      const response = {
        success: true,
        url: fileUrl,
        fileName: fileName,
        size: req.file.size,
        type: req.file.mimetype
      };
      
      console.log('✅ Upload: Success response:', response);
      res.json(response);
      
    } catch (error) {
      console.error('❌ Upload: Error:', error);
      
      // Clean up uploaded file on error (development only)
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error('Error cleaning up file:', e);
        }
      }
      
      res.status(500).json({ 
        error: "File upload failed",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
);

// Force admin user creation endpoint
app.post('/api/force-create-admin', async (req, res) => {
  if (!pool) {
    return res.status(400).json({
      error: 'No database connection',
      message: 'DATABASE_URL environment variable is not set'
    });
  }

  try {
    console.log('Force creating admin user...');
    
    // First, ensure database tables exist
    await initializeDatabase();
    
    // Check if admin already exists
    const existingAdmin = await getUserByUsername('admin');
    
    if (existingAdmin) {
      console.log('Admin user already exists:', { id: existingAdmin.id, role: existingAdmin.role });
      return res.status(200).json({
        message: 'Admin user already exists',
        admin: { id: existingAdmin.id, username: existingAdmin.username, role: existingAdmin.role }
      });
    }
    
    // Create admin user with hardcoded password hash for 'localcooks'
    const hashedPassword = 'fcf0872ea0a0c91f3d8e64dc5005c9b6a36371eddc6c1127a3c0b45c71db5b72f85c5e93b80993ec37c6aff8b08d07b68e9c58f28e3bd20d9d2a4eb38992aad0.ef32a41b7d478668';
    
    const result = await pool.query(`
      INSERT INTO users (username, password, role)
      VALUES ('admin', $1, 'admin')
      RETURNING id, username, role;
    `, [hashedPassword]);
    
    const newAdmin = result.rows[0];
    console.log('Admin user created successfully:', newAdmin);
    
    res.status(201).json({
      message: 'Admin user created successfully',
      admin: newAdmin
    });
    
  } catch (error) {
    console.error('Error forcing admin user creation:', error);
    res.status(500).json({
      error: 'Failed to create admin user',
      message: error.message
    });
  }
});

// Debug admin user endpoint
app.get('/api/debug-admin', async (req, res) => {
  if (!pool) {
    return res.status(400).json({
      error: 'No database connection',
      message: 'DATABASE_URL environment variable is not set'
    });
  }

  try {
    // Get admin user from database
    const result = await pool.query(`
      SELECT id, username, role, 
             LENGTH(password) as password_length,
             SUBSTRING(password, 1, 20) as password_preview
      FROM users 
      WHERE role = 'admin' OR username = 'admin'
      ORDER BY id;
    `);

    const adminUsers = result.rows;

    // Also check via our helper function
    const adminViaHelper = await getUserByUsername('admin');

    res.status(200).json({
      message: 'Admin user debug info',
      adminUsersInDB: adminUsers,
      adminViaHelper: adminViaHelper ? {
        id: adminViaHelper.id,
        username: adminViaHelper.username,
        role: adminViaHelper.role,
        passwordLength: adminViaHelper.password?.length,
        passwordPreview: adminViaHelper.password?.substring(0, 20)
      } : null,
      expectedPasswordHash: 'fcf0872ea0a0c91f3d8e64dc5005c9b6a36371eddc6c1127a3c0b45c71db5b72f85c5e93b80993ec37c6aff8b08d07b68e9c58f28e3bd20d9d2a4eb38992aad0.ef32a41b7d478668'
    });
    
  } catch (error) {
    console.error('Error debugging admin user:', error);
    res.status(500).json({
      error: 'Failed to debug admin user',
      message: error.message
    });
  }
});
// Get document verification data for a user
app.get("/api/document-verification", async (req, res) => {
  try {
    // Check if user is authenticated
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Convert Firebase UID to integer user ID
    const user = await getUser(rawUserId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    const userId = user.id;

    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    // Get the user's most recent application with document data
    const result = await pool.query(`
      SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(200).json(null);
    }

    const application = result.rows[0];
    
    // Convert to frontend-expected format
    const responseData = {
      id: application.id,
      user_id: userId,
      application_id: application.id,
      foodSafetyLicenseUrl: application.food_safety_license_url,
      foodEstablishmentCertUrl: application.food_establishment_cert_url,
      foodSafetyLicenseStatus: application.food_safety_license_status,
      foodEstablishmentCertStatus: application.food_establishment_cert_status,
      documentsAdminFeedback: application.documents_admin_feedback,
      documentsReviewedBy: application.documents_reviewed_by,
      documentsReviewedAt: application.documents_reviewed_at,
      createdAt: application.created_at
    };

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Error getting document verification:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Session cleanup functions
async function cleanupExpiredSessions() {
  if (!pool) {
    console.log('No database available for session cleanup');
    return { cleaned: 0, error: 'No database connection' };
  }

  try {
    const result = await pool.query(`
      DELETE FROM session 
      WHERE expire < NOW()
      RETURNING sid;
    `);
    
    console.log(`Cleaned up ${result.rowCount} expired sessions`);
    return { cleaned: result.rowCount };
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
    return { cleaned: 0, error: error.message };
  }
}

async function getSessionStats() {
  if (!pool) {
    return { error: 'No database connection' };
  }

  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN expire > NOW() THEN 1 END) as active_sessions,
        COUNT(CASE WHEN expire <= NOW() THEN 1 END) as expired_sessions,
        MIN(expire) as oldest_session,
        MAX(expire) as newest_session
      FROM session;
    `);

    return stats.rows[0];
  } catch (error) {
    console.error('Error getting session stats:', error);
    return { error: error.message };
  }
}
// ===============================
// SESSION MANAGEMENT ENDPOINTS
// ===============================
// Get session statistics (admin only)
app.get("/api/admin/sessions/stats", async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const stats = await getSessionStats();
    
    // Check if stats has an error or is null
    if (stats.error || !stats) {
      return res.status(500).json({ 
        message: "Failed to get session stats", 
        error: stats?.error || "Unknown error" 
      });
    }
    
    return res.status(200).json({
      message: "Session statistics",
      stats: stats,
      recommendations: {
        shouldCleanup: (stats.expired_sessions || 0) > 100,
        cleanupRecommended: (stats.total_sessions || 0) > 1000,
        criticalLevel: (stats.total_sessions || 0) > 5000
      }
    });
  } catch (error) {
    console.error("Error getting session stats:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});
// Manual session cleanup (admin only)
app.post("/api/admin/sessions/cleanup", async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const beforeStats = await getSessionStats();
    const cleanupResult = await cleanupExpiredSessions();
    const afterStats = await getSessionStats();

    // Check for errors in cleanup result
    if (cleanupResult.error) {
      return res.status(500).json({ 
        message: "Session cleanup failed", 
        error: cleanupResult.error,
        before: beforeStats,
        after: afterStats
      });
    }

    return res.status(200).json({
      message: "Session cleanup completed",
      before: beforeStats,
      after: afterStats,
      cleaned: cleanupResult.cleaned || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error during session cleanup:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Aggressive session cleanup (admin only) - removes sessions older than X days
app.post("/api/admin/sessions/cleanup-old", async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const { days = 30 } = req.body; // Default to 30 days
    
    // Validate and sanitize days parameter to prevent SQL injection
    const daysNum = parseInt(days, 10);
    if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
      return res.status(400).json({ message: "Invalid days parameter. Must be between 1 and 365." });
    }
    
    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    const beforeStats = await getSessionStats();
    
    // Check if beforeStats has an error
    if (beforeStats?.error) {
      return res.status(500).json({ 
        message: "Failed to get session stats before cleanup", 
        error: beforeStats.error 
      });
    }
    
    // Use parameterized query to prevent SQL injection
    const result = await pool.query(`
      DELETE FROM session 
      WHERE expire < NOW() - INTERVAL '1 day' * $1
      RETURNING sid;
    `, [daysNum]);

    const afterStats = await getSessionStats();
    
    // Check if afterStats has an error
    if (afterStats?.error) {
      return res.status(500).json({ 
        message: "Failed to get session stats after cleanup", 
        error: afterStats.error,
        before: beforeStats,
        cleaned: result.rowCount
      });
    }

    return res.status(200).json({
      message: `Cleaned up sessions older than ${daysNum} days`,
      before: beforeStats,
      after: afterStats,
      cleaned: result.rowCount || 0,
      days: daysNum,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error during aggressive session cleanup:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ===============================
// MICROLEARNING ROUTES
// ===============================

// Helper function to check if user has approved application
async function hasApprovedApplication(userId) {
  try {
    if (!pool) {
      console.log('No database available for application check');
      return false;
    }

    const result = await pool.query(`
      SELECT status FROM applications WHERE user_id = $1 ORDER BY created_at DESC
    `, [userId]);

    return result.rows.some(app => app.status === 'approved');
  } catch (error) {
    console.error('Error checking application status:', error);
    return false;
  }
}

// Enhanced function to get detailed application status
async function getApplicationStatus(userId) {
  try {
    if (!pool) {
      console.log('No database available for application check');
      return {
        hasApproved: false,
        hasActive: false,
        hasPending: false,
        hasRejected: false,
        hasCancelled: false,
        latestStatus: null,
        applications: []
      };
    }

    const result = await pool.query(`
      SELECT status, created_at FROM applications WHERE user_id = $1 ORDER BY created_at DESC
    `, [userId]);

    const applications = result.rows;
    const activeApplications = applications.filter(app => 
      app.status !== 'cancelled' && app.status !== 'rejected'
    );

    return {
      hasApproved: applications.some(app => app.status === 'approved'),
      hasActive: activeApplications.length > 0,
      hasPending: applications.some(app => app.status === 'inReview'),
      hasRejected: applications.some(app => app.status === 'rejected'),
      hasCancelled: applications.some(app => app.status === 'cancelled'),
      latestStatus: applications.length > 0 ? applications[0].status : null,
      applications: applications
    };
  } catch (error) {
    console.error('Error checking application status:', error);
    return {
      hasApproved: false,
      hasActive: false,
      hasPending: false,
      hasRejected: false,
      hasCancelled: false,
      latestStatus: null,
      applications: []
    };
  }
}

// In-memory storage for microlearning data (fallback when no DB)
const microlearningProgress = new Map();
const microlearningCompletions = new Map();

// Storage functions for microlearning
async function getMicrolearningProgress(userId) {
  if (pool) {
    try {
      // Create table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS video_progress (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          video_id VARCHAR(100) NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          completed BOOLEAN NOT NULL DEFAULT FALSE,
          completed_at TIMESTAMP,
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, video_id)
        );
      `);

      const result = await pool.query(`
        SELECT video_id, progress, completed, completed_at, updated_at 
        FROM video_progress WHERE user_id = $1
      `, [userId]);

      return result.rows.map(row => ({
        videoId: row.video_id,
        progress: row.progress,
        completed: row.completed,
        completedAt: row.completed_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('Error getting microlearning progress:', error);
      return [];
    }
  } else {
    // In-memory fallback
    const progress = [];
    for (const [key, value] of microlearningProgress.entries()) {
      if (key.startsWith(`${userId}-`)) {
        progress.push(value);
      }
    }
    return progress;
  }
}

async function getMicrolearningCompletion(userId) {
  if (pool) {
    try {
      // Create table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS microlearning_completions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL UNIQUE,
          completed_at TIMESTAMP NOT NULL,
          confirmed BOOLEAN NOT NULL DEFAULT FALSE,
          certificate_generated BOOLEAN NOT NULL DEFAULT FALSE,
          video_progress JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);

      const result = await pool.query(`
        SELECT * FROM microlearning_completions WHERE user_id = $1
      `, [userId]);

      if (result.rows.length === 0) {
        return undefined;
      }

      const row = result.rows[0];
      return {
        userId: row.user_id,
        completedAt: row.completed_at,
        confirmed: row.confirmed,
        certificateGenerated: row.certificate_generated,
        videoProgress: row.video_progress,
        createdAt: row.created_at
      };
    } catch (error) {
      console.error('Error getting microlearning completion:', error);
      return undefined;
    }
  } else {
    // In-memory fallback
    return microlearningCompletions.get(`completion-${userId}`);
  }
}
async function updateVideoProgress(progressData) {
  if (pool) {
    try {
      // Create table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS video_progress (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          video_id VARCHAR(100) NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          completed BOOLEAN NOT NULL DEFAULT FALSE,
          completed_at TIMESTAMP,
          updated_at TIMESTAMP DEFAULT NOW(),
          watched_percentage INTEGER DEFAULT 0,
          is_rewatching BOOLEAN DEFAULT FALSE
        );
      `);
      
      // Add unique constraint if it doesn't exist (for existing tables)
      await pool.query(`
        DO $$ BEGIN
          BEGIN
            ALTER TABLE video_progress ADD CONSTRAINT video_progress_user_video_unique UNIQUE (user_id, video_id);
          EXCEPTION
            WHEN duplicate_table THEN null;
            WHEN duplicate_object THEN null;
          END;
        END $$;
      `);

      // First, get existing progress to preserve completion status
      const existingResult = await pool.query(`
        SELECT completed, completed_at FROM video_progress 
        WHERE user_id = $1 AND video_id = $2
      `, [progressData.userId, progressData.videoId]);

      const existingProgress = existingResult.rows[0];
      
      // Preserve completion status - if video was already completed, keep it completed
      // unless explicitly setting it to completed again
      const finalCompleted = progressData.completed || (existingProgress?.completed || false);
      const finalCompletedAt = finalCompleted ? (existingProgress?.completed_at || progressData.completedAt) : null;
      const isRewatching = existingProgress?.completed || false;

      await pool.query(`
        INSERT INTO video_progress (user_id, video_id, progress, completed, completed_at, updated_at, watched_percentage, is_rewatching)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, video_id) 
        DO UPDATE SET 
          progress = EXCLUDED.progress,
          completed = EXCLUDED.completed,
          completed_at = EXCLUDED.completed_at,
          updated_at = EXCLUDED.updated_at,
          watched_percentage = EXCLUDED.watched_percentage,
          is_rewatching = EXCLUDED.is_rewatching
      `, [
        progressData.userId,
        progressData.videoId,
        progressData.progress,
        finalCompleted,
        finalCompletedAt,
        progressData.updatedAt,
        progressData.watchedPercentage || 0,
        isRewatching
      ]);
    } catch (error) {
      console.error('Error updating video progress:', error);
    }
  } else {
    // In-memory fallback - apply same logic as storage.ts
    const key = `${progressData.userId}-${progressData.videoId}`;
    const existingProgress = microlearningProgress.get(key);
    
    // Preserve completion status - if video was already completed, keep it completed
    const finalCompleted = progressData.completed || (existingProgress?.completed || false);
    const finalCompletedAt = finalCompleted ? (existingProgress?.completedAt || progressData.completedAt) : null;
    
    microlearningProgress.set(key, {
      ...progressData,
      completed: finalCompleted,
      completedAt: finalCompletedAt,
      isRewatching: existingProgress?.completed || false
    });
  }
}
async function createMicrolearningCompletion(completionData) {
  if (pool) {
    try {
      // Create table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS microlearning_completions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          completed_at TIMESTAMP NOT NULL,
          confirmed BOOLEAN NOT NULL DEFAULT FALSE,
          certificate_generated BOOLEAN NOT NULL DEFAULT FALSE,
          video_progress JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
      // Add unique constraint if it doesn't exist (for existing tables)
      await pool.query(`
        DO $$ BEGIN
          BEGIN
            ALTER TABLE microlearning_completions ADD CONSTRAINT microlearning_completions_user_id_unique UNIQUE (user_id);
          EXCEPTION
            WHEN duplicate_table THEN null;
            WHEN duplicate_object THEN null;
          END;
        END $$;
      `);

      const result = await pool.query(`
        INSERT INTO microlearning_completions (user_id, completed_at, confirmed, certificate_generated, video_progress)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          completed_at = EXCLUDED.completed_at,
          confirmed = EXCLUDED.confirmed,
          certificate_generated = EXCLUDED.certificate_generated,
          video_progress = EXCLUDED.video_progress
        RETURNING *
      `, [
        completionData.userId,
        completionData.completedAt,
        completionData.confirmed !== undefined ? completionData.confirmed : true, // Default to true if not provided
        completionData.certificateGenerated || false,
        JSON.stringify(completionData.videoProgress)
      ]);

      return result.rows[0];
    } catch (error) {
      console.error('Error creating microlearning completion:', error);
      return completionData;
    }
  } else {
    // In-memory fallback
    const key = `completion-${completionData.userId}`;
    microlearningCompletions.set(key, completionData);
    return completionData;
  }
}

async function updateCertificateGenerated(userId, certificateGenerated = true) {
  if (pool) {
    try {
      const result = await pool.query(`
        UPDATE microlearning_completions 
        SET certificate_generated = $1, updated_at = NOW()
        WHERE user_id = $2
        RETURNING *
      `, [certificateGenerated, userId]);

      if (result.rows.length > 0) {
        console.log(`✅ Certificate generated status updated for user ${userId}: ${certificateGenerated}`);
        return result.rows[0];
      } else {
        console.log(`⚠️ No completion record found for user ${userId} to update certificate status`);
        return null;
      }
    } catch (error) {
      console.error('Error updating certificate generated status:', error);
      return null;
    }
  } else {
    // In-memory fallback
    const key = `completion-${userId}`;
    const completion = microlearningCompletions.get(key);
    if (completion) {
      completion.certificateGenerated = certificateGenerated;
      microlearningCompletions.set(key, completion);
      return completion;
    }
    return null;
  }
}

// Get user's microlearning access level and progress
app.get("/api/microlearning/progress/:userId", async (req, res) => {
  try {
    // Check if user is authenticated
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    // Debug logging for session issues
    console.log('Microlearning progress request:', {
      sessionId: req.session.id,
      sessionUserId: req.session.userId,
      headerUserId: req.headers['x-user-id'],
      requestedUserId: req.params.userId,
      cookiePresent: !!req.headers.cookie
    });
    if (!sessionUserId) {
      console.log('Authentication failed - no session userId or header userId');
      return res.status(401).json({ message: 'Authentication required' });
    }
    // Store user ID in session if it's not there but provided via header
    if (!req.session.userId && req.headers['x-user-id']) {
      console.log('Storing userId in session from header:', req.headers['x-user-id']);
      req.session.userId = req.headers['x-user-id'];
      await new Promise(resolve => req.session.save(resolve));
    }
    
    // Convert Firebase UIDs to integer user IDs
    let requestedUser = await getUser(req.params.userId);
    if (!requestedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userId = requestedUser.id;
    
    // Get session user and convert to integer ID
    const sessionUser = await getUser(sessionUserId);
    if (!sessionUser) {
      return res.status(401).json({ message: 'Session user not found' });
    }
    const sessionUserIntId = sessionUser.id;
    
    // Verify user can access this data (either their own or admin)
    if (sessionUserIntId !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const progress = await getMicrolearningProgress(userId);
    const completionStatus = await getMicrolearningCompletion(userId);
    const applicationStatus = await getApplicationStatus(userId);
    // Admins and completed users have unrestricted access regardless of application status
    const isAdmin = sessionUser?.role === 'admin';
    const isCompleted = completionStatus?.confirmed || false;
    const accessLevel = isAdmin || applicationStatus.hasApproved || isCompleted ? 'full' : 'limited';
    res.json({
      success: true,
      progress: progress || [],
      completionConfirmed: completionStatus?.confirmed || false,
      completedAt: completionStatus?.completedAt,
      hasApprovedApplication: applicationStatus.hasApproved,
      accessLevel: accessLevel,
      isAdmin: isAdmin,
      applicationInfo: {
        hasActive: applicationStatus.hasActive,
        hasPending: applicationStatus.hasPending,
        hasRejected: applicationStatus.hasRejected,
        hasCancelled: applicationStatus.hasCancelled,
        latestStatus: applicationStatus.latestStatus,
        canApply: !applicationStatus.hasActive, // Can apply if no active applications
        message: applicationStatus.hasApproved 
          ? "✅ Application approved - Full access granted!" 
          : applicationStatus.hasPending 
          ? "⏳ Application under review - Limited access while pending"
          : applicationStatus.hasRejected || applicationStatus.hasCancelled
          ? "🔄 Previous application was not approved - You can submit a new application"
          : "🚀 Submit an application to unlock full training access"
      }
    });
  } catch (error) {
    console.error('Error fetching microlearning progress:', error);
    res.status(500).json({ message: 'Failed to fetch progress' });
  }
});

// Update video progress
app.post("/api/microlearning/progress", async (req, res) => {
  try {
    // Check if user is authenticated
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    // Debug logging for session issues
    console.log('Microlearning progress update request:', {
      sessionId: req.session.id,
      sessionUserId: req.session.userId,
      headerUserId: req.headers['x-user-id'],
      bodyUserId: req.body.userId,
      cookiePresent: !!req.headers.cookie
    });
    if (!sessionUserId) {
      console.log('Authentication failed - no session userId or header userId');
      return res.status(401).json({ message: 'Authentication required' });
    }
    // Store user ID in session if it's not there but provided via header
    if (!req.session.userId && req.headers['x-user-id']) {
      console.log('Storing userId in session from header:', req.headers['x-user-id']);
      req.session.userId = req.headers['x-user-id'];
      await new Promise(resolve => req.session.save(resolve));
    }
    
    const { userId: rawUserId, videoId, progress, completed, completedAt, watchedPercentage } = req.body;
    
    // Convert Firebase UIDs to integer user IDs
    let requestedUser = await getUser(rawUserId);
    if (!requestedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userId = requestedUser.id;
    
    // Get session user and convert to integer ID
    const sessionUser = await getUser(sessionUserId);
    if (!sessionUser) {
      return res.status(401).json({ message: 'Session user not found' });
    }
    const sessionUserIntId = sessionUser.id;
    
    // Verify user can update this data (either their own or admin)
    if (sessionUserIntId !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    // Check if user has approved application for videos beyond the first one
    const applicationStatus = await getApplicationStatus(userId);
    const completion = await getMicrolearningCompletion(userId);
    const isCompleted = completion?.confirmed || false;
    const firstVideoId = 'basics-cross-contamination'; // First video that everyone can access
    const isAdmin = sessionUser?.role === 'admin';
    // Admins and completed users have unrestricted access to all videos
    if (!applicationStatus.hasApproved && !isAdmin && !isCompleted && videoId !== firstVideoId) {
      const message = applicationStatus.hasPending 
        ? 'Your application is under review. Full access will be granted once approved.'
        : applicationStatus.hasRejected || applicationStatus.hasCancelled
        ? 'Your previous application was not approved. Please submit a new application for full access.'
        : 'Please submit an application to access all training videos.';
      return res.status(403).json({ 
        message: message,
        accessLevel: 'limited',
        firstVideoOnly: true,
        applicationInfo: {
          hasActive: applicationStatus.hasActive,
          hasPending: applicationStatus.hasPending,
          hasRejected: applicationStatus.hasRejected,
          hasCancelled: applicationStatus.hasCancelled,
          canApply: !applicationStatus.hasActive
        }
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
    await updateVideoProgress(progressData);
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
app.post("/api/microlearning/complete", async (req, res) => {
  try {
    // Check if user is authenticated
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    if (!sessionUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const { userId: rawUserId, completionDate, videoProgress } = req.body;
    
    // Convert Firebase UIDs to integer user IDs
    let requestedUser = await getUser(rawUserId);
    if (!requestedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userId = requestedUser.id;
    
    // Get session user and convert to integer ID
    const sessionUser = await getUser(sessionUserId);
    if (!sessionUser) {
      return res.status(401).json({ message: 'Session user not found' });
    }
    const sessionUserIntId = sessionUser.id;
    
    // Verify user can complete this (either their own or admin)
    if (sessionUserIntId !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    // Check if user has approved application to complete full training
    const applicationStatus = await getApplicationStatus(userId);
    const isAdmin = sessionUser?.role === 'admin';
    // Admins can complete certification without application approval
    if (!applicationStatus.hasApproved && !isAdmin) {
      const message = applicationStatus.hasPending 
        ? 'Your application is under review. Certification will be available once approved.'
        : applicationStatus.hasRejected || applicationStatus.hasCancelled
        ? 'Your previous application was not approved. Please submit a new application to complete certification.'
        : 'Please submit an application to complete full certification.';
      return res.status(403).json({ 
        message: message,
        accessLevel: 'limited',
        requiresApproval: true,
        applicationInfo: {
          hasActive: applicationStatus.hasActive,
          hasPending: applicationStatus.hasPending,
          hasRejected: applicationStatus.hasRejected,
          hasCancelled: applicationStatus.hasCancelled,
          canApply: !applicationStatus.hasActive
        }
      });
    }
    // Create completion record
    const completion = await createMicrolearningCompletion({
      userId,
      completedAt: completionDate ? new Date(completionDate) : new Date(),
      confirmed: true, // Default to confirmed when user completes training
      progress: videoProgress
    });
    res.json({
      success: true,
      completion,
      message: "Congratulations! You have completed the microlearning training."
    });
  } catch (error) {
    console.error('Error completing microlearning:', error);
    res.status(500).json({ message: 'Failed to complete microlearning' });
  }
});

// Get microlearning completion status
app.get("/api/microlearning/completion/:userId", async (req, res) => {
  try {
    // Check if user is authenticated - Match pattern from other working endpoints
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    
    // Debug logging for session issues (matching other endpoints)
    console.log('Completion status request:', {
      sessionId: req.session.id,
      sessionUserId: req.session.userId,
      headerUserId: req.headers['x-user-id'],
      requestedUserId: req.params.userId,
      cookiePresent: !!req.headers.cookie
    });
    
    if (!sessionUserId) {
      console.log('Authentication failed - no session userId or header userId');
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Store user ID in session if it's not there but provided via header (matching other endpoints)
    if (!req.session.userId && req.headers['x-user-id']) {
      console.log('Storing userId in session from header:', req.headers['x-user-id']);
      req.session.userId = req.headers['x-user-id'];
      await new Promise(resolve => req.session.save(resolve));
    }

    // Convert Firebase UIDs to integer user IDs
    let requestedUser = await getUser(req.params.userId);
    if (!requestedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userId = requestedUser.id;
    
    // Get session user and convert to integer ID
    const sessionUser = await getUser(sessionUserId);
    if (!sessionUser) {
      return res.status(401).json({ message: 'Session user not found' });
    }
    const sessionUserIntId = sessionUser.id;
    
    // Verify user can access this completion (either their own or admin)
    if (sessionUserIntId !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const completion = await getMicrolearningCompletion(userId);
    
    if (!completion) {
      return res.status(404).json({ message: 'No completion found' });
    }

    res.json(completion);
  } catch (error) {
    console.error('Error getting microlearning completion status:', error);
    res.status(500).json({ message: 'Failed to get completion status' });
  }
});

// Check certificate generation status
app.get('/api/microlearning/certificate-status/:userId', async (req, res) => {
  try {
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    
    if (!sessionUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Convert Firebase UIDs to integer user IDs
    let requestedUser = await getUser(req.params.userId);
    if (!requestedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userId = requestedUser.id;
    
    // Get session user and convert to integer ID
    const sessionUser = await getUser(sessionUserId);
    if (!sessionUser) {
      return res.status(401).json({ message: 'Session user not found' });
    }
    const sessionUserIntId = sessionUser.id;
    
    // Verify user can access this status (either their own or admin)
    if (sessionUserIntId !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const completion = await getMicrolearningCompletion(userId);
    
    if (!completion) {
      return res.status(404).json({ message: 'No completion found' });
    }

    res.json({
      userId: userId,
      confirmed: completion.confirmed,
      certificateGenerated: completion.certificateGenerated,
      completedAt: completion.completedAt,
      canDownloadCertificate: completion.confirmed && completion.certificateGenerated
    });
  } catch (error) {
    console.error('Error checking certificate status:', error);
    res.status(500).json({ message: 'Failed to check certificate status' });
  }
});
// Generate and download certificate
app.get("/api/microlearning/certificate/:userId", async (req, res) => {
  try {
    // Enhanced debug logging to identify the issue
    console.log('=== CERTIFICATE ENDPOINT DEBUG ===');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Full request headers:', JSON.stringify(req.headers, null, 2));
    console.log('Session object:', JSON.stringify(req.session, null, 2));
    console.log('Cookies:', req.headers.cookie);
    console.log('URL params:', req.params);
    
    // Check if user is authenticated - Match pattern from other working endpoints
    let sessionUserId = req.session.userId || req.headers['x-user-id'];
    
    // Production-specific authentication fallback for Vercel serverless
    if (!sessionUserId && process.env.NODE_ENV === 'production') {
      console.log('Production environment detected, checking alternative auth methods');
      
      // Try to get userId from Authorization header
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          // Simple token validation - in production you might decode JWT
          const userId = parseInt(token);
          if (!isNaN(userId)) {
            console.log('Found userId in Authorization header:', userId);
            sessionUserId = userId.toString();
          }
        } catch (e) {
          console.log('Failed to parse auth token:', e.message);
        }
      }
      
      // Try to get from cookie directly (for Vercel Edge Functions)
      if (!sessionUserId && req.headers.cookie) {
        const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
          const [key, value] = cookie.trim().split('=');
          acc[key] = value;
          return acc;
        }, {});
        
        if (cookies.userId) {
          console.log('Found userId in direct cookie:', cookies.userId);
          sessionUserId = cookies.userId;
        }
      }
    }
    
    // If no session userId, try to authenticate using the requested userId and verify it exists
    if (!sessionUserId) {
      const requestedUserId = req.params.userId;
      console.log('No session userId found, attempting to verify requested userId:', requestedUserId);
      
      // Check if the requested user exists in the database (handles both Firebase UID and integer ID)
      const requestedUser = await getUser(requestedUserId);
      if (requestedUser) {
        console.log('Requested user exists, treating as authenticated:', requestedUser.username);
        sessionUserId = requestedUserId.toString();
        
        // Store in session for future requests (if session is available)
        if (req.session) {
          req.session.userId = sessionUserId;
          await new Promise(resolve => req.session.save(resolve));
        }
      }
    }
    
    // Debug logging for session issues (matching other endpoints)
    console.log('Certificate request:', {
      sessionId: req.session?.id,
      sessionUserId: req.session?.userId,
      headerUserId: req.headers['x-user-id'],
      requestedUserId: req.params.userId,
      cookiePresent: !!req.headers.cookie,
      finalSessionUserId: sessionUserId,
      environment: process.env.NODE_ENV
    });
    
    if (!sessionUserId) {
      console.log('Authentication failed - no session userId or header userId');
      console.log('Session userId:', req.session?.userId);
      console.log('Header x-user-id:', req.headers['x-user-id']);
      return res.status(401).json({ 
        message: 'Authentication required',
        debug: process.env.NODE_ENV === 'development' ? {
          sessionExists: !!req.session,
          cookiePresent: !!req.headers.cookie,
          headers: req.headers
        } : undefined
      });
    }

    // Store user ID in session if it's not there but provided via header (matching other endpoints)
    if (req.session && !req.session.userId && req.headers['x-user-id']) {
      console.log('Storing userId in session from header:', req.headers['x-user-id']);
      req.session.userId = req.headers['x-user-id'];
      await new Promise(resolve => req.session.save(resolve));
    }

    // Convert Firebase UIDs to integer user IDs
    let requestedUser = await getUser(req.params.userId);
    if (!requestedUser) {
      return res.status(404).json({ message: 'Requested user not found' });
    }
    const userId = requestedUser.id;
    console.log('Parsed userId:', userId);
    
    // Verify user can access this certificate (either their own or admin)
    const sessionUser = await getUser(sessionUserId);
    if (!sessionUser) {
      return res.status(401).json({ message: 'Session user not found' });
    }
    const sessionUserIntId = sessionUser.id;
    console.log('Session user:', sessionUser ? { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role } : null);
    
    if (sessionUserIntId !== userId && sessionUser?.role !== 'admin') {
      console.log('Access denied - userId mismatch and not admin');
      return res.status(403).json({ message: 'Access denied' });
    }

    const completion = await getMicrolearningCompletion(userId);
    console.log('Microlearning completion:', completion);
    
    if (!completion || !completion.confirmed) {
      console.log('No confirmed completion found');
      return res.status(404).json({ message: 'No confirmed completion found' });
    }

    // Check if certificate was already generated before
    const isFirstTimeGeneration = !completion.certificateGenerated;
    console.log('Certificate generation status:', {
      userId: userId,
      alreadyGenerated: completion.certificateGenerated,
      isFirstTime: isFirstTimeGeneration
    });

    const user = await getUser(userId);
    console.log('Target user:', user ? { id: user.id, username: user.username } : null);
    
    if (!user) {
      console.log('User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's actual name from their most recent application
    let userDisplayName = user.username; // Fallback to username
    
    try {
      if (pool) {
        const appResult = await pool.query(
          'SELECT full_name FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
          [userId]
        );
        if (appResult.rows.length > 0 && appResult.rows[0].full_name) {
          userDisplayName = appResult.rows[0].full_name;
          console.log(`📋 Using application full name: "${userDisplayName}" for certificate`);
        } else {
          console.log(`⚠️ No application full_name found for user ${userId}, using username as fallback`);
        }
      }
    } catch (error) {
      console.error('Error getting user full name from applications:', error);
      console.log(`⚠️ Using username "${user.username}" as fallback for certificate`);
    }

    // Generate professional PDF certificate using React PDF
    const { generateCertificate } = await import('./certificateGenerator.js');
    
    const certificateId = `LC-${userId}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    
    // Ensure completion date is valid
    const completionDate = completion.completedAt ? new Date(completion.completedAt) : new Date();
    if (isNaN(completionDate.getTime())) {
      console.warn('Invalid completion date, using current date as fallback');
      completionDate = new Date();
    }
    
    const certificateData = {
      userName: userDisplayName,
      completionDate: completionDate.toISOString(),
      certificateId: certificateId,
      userId: userId
    };

    console.log('Generating PDF certificate with data:', certificateData);
    
    try {
      // Generate PDF stream and convert to buffer
      const pdfStream = await generateCertificate(certificateData);
      const chunks = [];
      for await (const chunk of pdfStream) {
        chunks.push(chunk);
      }
      const pdfBuffer = Buffer.concat(chunks);
      
      // Update database to mark certificate as generated
      await updateCertificateGenerated(userId, true);
      
      // Set proper headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="LocalCooks-Certificate-${user.username}-${certificateId}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      
      console.log('Certificate PDF generated successfully, size:', pdfBuffer.length, 'bytes');
      console.log('Database updated: certificate_generated = true for user', userId);
      
      // Send the PDF buffer directly
      res.send(pdfBuffer);
      
    } catch (pdfError) {
      console.error('Error generating PDF certificate:', pdfError);
      
      // Fallback to JSON response if PDF generation fails
      const certificateUrl = `/api/certificates/microlearning-${userId}-${Date.now()}.pdf`;
      res.json({
        success: true,
        certificateUrl,
        completionDate: completion.completedAt,
        message: 'Certificate for skillpass.nl food safety training preparation - Complete your official certification at skillpass.nl',
        error: 'PDF generation temporarily unavailable'
      });
    }
  } catch (error) {
    console.error('Error generating certificate:', error);
    res.status(500).json({ message: 'Failed to generate certificate' });
  }
});

// Test email configuration endpoint (development only)
app.post("/api/test-status-email", async (req, res) => {
  try {
    const { status, email, fullName } = req.body;

    if (!status || !email || !fullName) {
      return res.status(400).json({ 
        message: "Missing required fields: status, email, fullName" 
      });
    }

    console.log('Testing status change email with:', { status, email, fullName });

    // Import the email functions
    const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

    const emailContent = generateStatusChangeEmail({
      fullName,
      email,
      status
    });

    const emailSent = await sendEmail(emailContent, {
      trackingId: `test_${status}_${Date.now()}`
    });

    if (emailSent) {
      return res.status(200).json({ 
        message: "Test email sent successfully",
        status,
        email,
        fullName
      });
    } else {
      return res.status(500).json({ 
        message: "Failed to send test email - check email configuration" 
      });
    }
  } catch (error) {
    console.error("Error sending test email:", error);
    return res.status(500).json({ 
      message: "Error sending test email",
      error: error.message 
    });
  }
});

// Test endpoint for sending full verification emails
app.post("/api/test-verification-email", async (req, res) => {
  try {
    const { fullName, email, phone } = req.body;

    if (!fullName || !email || !phone) {
      return res.status(400).json({ 
        message: "Missing required fields: fullName, email, phone" 
      });
    }

    console.log('Testing full verification email with:', { fullName, email, phone });

    // Import the email functions
    const { sendEmail, generateFullVerificationEmail } = await import('../server/email.js');

    const emailContent = generateFullVerificationEmail({
      fullName,
      email,
      phone
    });

    const emailSent = await sendEmail(emailContent, {
      trackingId: `test_verification_${email}_${Date.now()}`
    });

    if (emailSent) {
      return res.status(200).json({ 
        message: "Test verification email sent successfully",
        subject: emailContent.subject,
        to: emailContent.to
      });
    } else {
      return res.status(500).json({ 
        message: "Failed to send test verification email - check email configuration" 
      });
    }
  } catch (error) {
    console.error("Error sending test verification email:", error);
    return res.status(500).json({ 
      message: "Error sending test verification email",
      error: error.message 
    });
  }
});

// Debug endpoint specifically for full verification email testing
app.post("/api/debug/test-full-verification-email", async (req, res) => {
  try {
    const { userId, email, fullName, phone } = req.body;

    console.log('🧪 FULL VERIFICATION EMAIL DEBUG TEST');
    console.log('📝 Input data:', { userId, email, fullName, phone });

    if (!email || !fullName || !phone) {
      return res.status(400).json({ 
        success: false,
        message: "Missing required fields: email, fullName, phone",
        received: { email: !!email, fullName: !!fullName, phone: !!phone }
      });
    }

    // Test 1: Import email functions
    console.log('🔧 Testing email function imports...');
    let sendEmail, generateFullVerificationEmail;
    try {
      const emailModule = await import('../server/email.js');
      sendEmail = emailModule.sendEmail;
      generateFullVerificationEmail = emailModule.generateFullVerificationEmail;
      console.log('✅ Email functions imported successfully');
    } catch (importError) {
      console.error('❌ Failed to import email functions:', importError);
      return res.status(500).json({
        success: false,
        error: 'Failed to import email functions',
        details: importError.message
      });
    }

    // Test 2: Generate email content
    console.log('📧 Generating email content...');
    let emailContent;
    try {
      emailContent = generateFullVerificationEmail({
        fullName,
        email,
        phone
      });
      console.log('✅ Email content generated successfully');
      console.log('📄 Subject:', emailContent.subject);
      console.log('📤 To:', emailContent.to);
    } catch (contentError) {
      console.error('❌ Failed to generate email content:', contentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate email content',
        details: contentError.message
      });
    }

    // Test 3: Send email
    console.log('📬 Attempting to send email...');
    try {
      const trackingId = `debug_full_verification_${userId || 'test'}_${Date.now()}`;
      const emailSent = await sendEmail(emailContent, {
        trackingId
      });

      if (emailSent) {
        console.log('✅ Email sent successfully!');
        
        // Generate credentials for display (don't log password)
        const username = phone.replace(/[^0-9]/g, '');
        const namePrefix = fullName.replace(/[^a-zA-Z]/g, '').toLowerCase().substring(0, 3) || 'usr';
        const phoneSuffix = phone.replace(/[^0-9]/g, '').slice(-4) || '0000';
        
        return res.status(200).json({
          success: true,
          message: "Full verification email sent successfully",
          details: {
            to: email,
            subject: emailContent.subject,
            trackingId,
            credentials: {
              username,
              passwordHint: `${namePrefix}****`
            }
          }
        });
      } else {
        console.error('❌ Email sending failed (returned false)');
        return res.status(500).json({
          success: false,
          error: 'Email sending failed',
          details: 'sendEmail function returned false'
        });
      }
    } catch (sendError) {
      console.error('❌ Error during email sending:', sendError);
      return res.status(500).json({
        success: false,
        error: 'Error during email sending',
        details: sendError.message,
        stack: sendError.stack
      });
    }

  } catch (error) {
    console.error('💥 Debug endpoint error:', error);
    return res.status(500).json({
      success: false,
      error: 'Debug endpoint error',
      details: error.message,
      stack: error.stack
    });
  }
});

// Endpoint to sync Firebase user to SQL users table
app.post('/api/firebase-sync-user', async (req, res) => {
  try {
    // Verify Firebase token for security
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No auth token provided' 
      });
    }

    const token = authHeader.substring(7);
    const decodedToken = await verifyFirebaseToken(token);

    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid auth token' 
      });
    }

    // Use verified token data instead of request body for security
    const uid = decodedToken.uid;
    const email = decodedToken.email;
    const emailVerified = decodedToken.email_verified;
    const { displayName, role, password } = req.body; // These can come from request body
    
    // CRITICAL FIX: For Google OAuth (no password), always treat as verified
    const isGoogleAuth = (!password || password === null || password === undefined) && displayName;
    const effectiveEmailVerified = isGoogleAuth ? true : emailVerified;
    
    if (!uid || !email) {
      return res.status(400).json({ error: 'Missing uid or email in token' });
    }

    const syncResult = await syncFirebaseUser(uid, email, effectiveEmailVerified, displayName, role, password);
    
    if (syncResult.success) {
      res.json(syncResult);
    } else {
      res.status(500).json({ 
        error: 'Sync failed', 
        message: syncResult.error 
      });
    }
  } catch (error) {
    console.error('❌ Error in firebase-sync-user:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Sync failed', 
        message: error.message 
      });
    }
  }
});
// Enhanced Firebase User Registration Endpoint
app.post('/api/firebase-register-user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No auth token provided' 
      });
    }

    const token = authHeader.substring(7);
    const decodedToken = await verifyFirebaseToken(token);

    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid auth token' 
      });
    }

    // Use verified token data for security
    const uid = decodedToken.uid;
    const email = decodedToken.email;
    const emailVerified = decodedToken.email_verified;
    const { displayName, role, password } = req.body;
    
    // CRITICAL FIX: For Google OAuth registration (no password), always treat as verified
    const isGoogleRegistration = (!password || password === null || password === undefined) && displayName;
    const effectiveEmailVerified = isGoogleRegistration ? true : emailVerified;
    
    if (!uid || !email) {
      return res.status(400).json({ error: 'Missing uid or email in token' });
    }
    
    console.log(`📝 Firebase REGISTRATION request for email: ${email}, uid: ${uid}`);
    console.log(`   - Original emailVerified: ${emailVerified}`);
    console.log(`   - Is Google Registration: ${isGoogleRegistration}`);
    console.log(`   - Effective emailVerified: ${effectiveEmailVerified}`);
    
    // Call sync logic directly instead of making internal fetch
    const syncResult = await syncFirebaseUser(uid, email, effectiveEmailVerified, displayName, role, password);
    
    if (syncResult.success) {
      console.log(`✅ Registration sync completed for ${email}`);
      res.json({
        success: true,
        user: syncResult.user,
        isNewUser: syncResult.created,
        message: 'User registered successfully'
      });
    } else {
      console.error(`❌ Registration sync failed for ${email}:`, syncResult.error);
      res.status(500).json({
        error: 'Registration failed',
        message: syncResult.error
      });
    }
  } catch (error) {
    console.error('❌ Error in firebase-register-user:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Registration failed', 
        message: error.message 
      });
    }
  }
});
// Extract sync logic into a reusable function
async function syncFirebaseUser(uid, email, emailVerified, displayName, role, password) {
  try {
    console.log(`🔄 Firebase sync for email: ${email}, uid: ${uid}`);
    console.log(`🔍 ENHANCED SYNC DEBUG:`);
    console.log(`   - Firebase UID: ${uid}`);
    console.log(`   - Email: ${email}`);
    console.log(`   - Display Name: ${displayName}`);
    console.log(`   - emailVerified (from Firebase): ${emailVerified}`);
    console.log(`   - Role: ${role}`);
    console.log(`   - Password provided: ${password ? 'YES (will be hashed)' : 'NO (OAuth user)'}`);
    
    let user = null;
    let wasCreated = false;
    
    if (pool) {
      // STEP 1: Check by Firebase UID FIRST (most reliable)
      console.log(`🔍 Primary check: Looking for user by Firebase UID: ${uid}`);
      const firebaseResult = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [uid]);
      
      if (firebaseResult.rows.length > 0) {
        user = firebaseResult.rows[0];
        console.log(`✅ Found existing user by Firebase UID: ${user.id} (${user.username})`);
        console.log(`   - is_verified in DB: ${user.is_verified}`);
        console.log(`   - has_seen_welcome in DB: ${user.has_seen_welcome}`);
        console.log(`   - emailVerified from Firebase: ${emailVerified}`);
        
        // CRITICAL: Update verification status if Firebase shows user as verified but DB shows unverified
        if (emailVerified === true && !user.is_verified) {
          console.log(`🔄 UPDATING VERIFICATION STATUS - Firebase verified but DB not updated`);
          try {
            const updateResult = await pool.query(
              'UPDATE users SET is_verified = $1 WHERE id = $2 RETURNING *',
              [true, user.id]
            );
            user = updateResult.rows[0];
            console.log(`✅ VERIFICATION STATUS UPDATED - User ${user.id} is now verified in database`);
          } catch (updateError) {
            console.error(`❌ Failed to update verification status for user ${user.id}:`, updateError);
          }
        }
        
        // Also update displayName if it's missing and provided
        if (displayName && !user.display_name) {
          console.log(`🔄 UPDATING DISPLAY NAME - Adding missing display name: ${displayName}`);
          try {
            const updateResult = await pool.query(
              'UPDATE users SET display_name = $1 WHERE id = $2 RETURNING *',
              [displayName, user.id]
            );
            user = updateResult.rows[0];
            console.log(`✅ DISPLAY NAME UPDATED - User ${user.id} now has display name: ${displayName}`);
          } catch (updateError) {
            console.error(`❌ Failed to update display name for user ${user.id}:`, updateError);
          }
        }
      } else {
        // STEP 2: Check by email as secondary (for linking existing accounts)
        console.log(`🔍 Secondary check: Looking for user by email: ${email}`);
        const emailResult = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [email]);
        
        if (emailResult.rows.length > 0) {
          user = emailResult.rows[0];
          console.log(`🔗 Found existing user by email: ${user.id} (${user.username})`);
          
          // Check if this user already has a different Firebase UID
          if (user.firebase_uid && user.firebase_uid !== uid) {
            console.log(`⚠️  User ${user.id} already linked to different Firebase UID: ${user.firebase_uid} vs ${uid}`);
            return { 
              success: false,
              error: 'Email already registered with different account'
            };
          }
          
          
          // Link this user to the Firebase UID if not already linked
          if (!user.firebase_uid) {
            console.log(`🔗 Linking existing user ${user.id} to Firebase UID ${uid}`);
            const updateResult = await pool.query(
              'UPDATE users SET firebase_uid = $1 WHERE id = $2 RETURNING *',
              [uid, user.id]
            );
            user = updateResult.rows[0];
          }
        } else {
          // STEP 3: Create new user (no existing user found)
          const isUserVerified = emailVerified === true;
          console.log(`➕ Creating NEW user for email: ${email}, Firebase UID: ${uid}`);
          console.log(`   - emailVerified: ${emailVerified}, setting is_verified: ${isUserVerified}`);
          console.log(`   - Using EMAIL as username to ensure uniqueness`);
          console.log(`   - Password provided: ${password ? 'YES' : 'NO'}`);
          
          // Hash the password if provided (for email/password users)
          let hashedPassword = '';
          if (password) {
            console.log(`🔐 Hashing password for email/password user`);
            hashedPassword = await hashPassword(password);
          }
          
          try {
            // Enforce mutually exclusive roles - users can only be chef OR delivery partner, not both
            // Exception: Admin users have access to both chef and delivery partner data/functionality
            const isChef = (role === 'chef' || role === 'admin');
            const isDeliveryPartner = (role === 'delivery_partner' || role === 'admin');
            
            if (role === 'admin') {
              console.log(`🎯 Admin role assignment: role="admin" → isChef=true, isDeliveryPartner=true (admin has full access)`);
            } else {
              console.log(`🎯 Exclusive role assignment: role="${role}" → isChef=${isChef}, isDeliveryPartner=${isDeliveryPartner} (mutually exclusive)`);
            }
            
            const insertResult = await pool.query(
              'INSERT INTO users (username, password, role, firebase_uid, is_verified, has_seen_welcome, is_chef, is_delivery_partner) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
              [email, hashedPassword, role || 'chef', uid, isUserVerified, false, isChef, isDeliveryPartner]
            );
            user = insertResult.rows[0];
            wasCreated = true;
            console.log(`✨ Successfully created new user: ${user.id} (${user.username})`);
            console.log(`   - is_verified in DB: ${user.is_verified}`);
            console.log(`   - has_seen_welcome in DB: ${user.has_seen_welcome}`);
            
            // Send welcome email for new users (with delay for better deliverability)
            if (isUserVerified) {
              console.log(`📧 Scheduling welcome email for new user: ${email}`);
              
              // Add 2-second delay to prevent Gmail rate limiting
              // CRITICAL FIX: Remove setTimeout - Make email sending SYNCHRONOUS
              try {
                console.log(`🧪 SYNCHRONOUS TEST: Sending welcome email using APPLICATION EMAIL PATTERN`);
                
                // Use the proper welcome email function
                const { sendEmail, generateWelcomeEmail } = await import('../server/email.js');
                
                // Generate proper welcome email
                const emailContent = generateWelcomeEmail({
                  fullName: displayName || email.split('@')[0],
                  email: email
                });
                
                // Use the exact same tracking pattern as application emails - SYNCHRONOUSLY
                const emailSent = await sendEmail(emailContent, {
                  trackingId: `account_active_${user.id}_${Date.now()}`
                });
                
                if (emailSent) {
                  console.log(`✅ SYNCHRONOUS TEST: Account welcome email sent successfully to ${email} using APPLICATION PATTERN`);
                } else {
                  console.log(`⚠️ SYNCHRONOUS TEST: Account welcome email failed to send to ${email}`);
                }
              } catch (emailError) {
                console.error(`❌ SYNCHRONOUS TEST: Error sending account welcome email to ${email}:`, emailError);
              }
              
            } else {
              // FALLBACK: For Google users, try sending email even if not marked as verified
              if (displayName && !password) {
                console.log(`🔄 SYNCHRONOUS FALLBACK: Sending welcome email for Google user despite verification status`);
                
                try {
                  const { sendEmail, generateWelcomeEmail } = await import('../server/email.js');
                  
                  // Use proper welcome email function
                  const emailContent = generateWelcomeEmail({
                    fullName: displayName || email.split('@')[0],
                    email: email
                  });
                  
                  const emailSent = await sendEmail(emailContent, {
                    trackingId: `account_fallback_${user.id}_${uid}_${Date.now()}`
                  });
                  
                  if (emailSent) {
                    console.log(`✅ SYNCHRONOUS FALLBACK: Welcome email sent successfully to ${email}`);
                  } else {
                    console.log(`⚠️ SYNCHRONOUS FALLBACK: Welcome email failed to send to ${email}`);
                  }
                } catch (emailError) {
                  console.error(`❌ SYNCHRONOUS FALLBACK: Error sending welcome email to ${email}:`, emailError);
                }
                
              } else {
                console.log(`❌ Welcome email NOT sent - user not verified and not Google user`);
                console.log(`   - isUserVerified: ${isUserVerified}`);
                console.log(`   - displayName: ${displayName ? 'YES' : 'NO'}`);
                console.log(`   - password: ${password ? 'YES' : 'NO'}`);
              }
            }
          } catch (insertError) {
            console.error(`❌ Failed to create user:`, insertError);
            
            // Check if it's a uniqueness constraint error
            if (insertError.code === '23505') { // PostgreSQL unique violation
              console.log(`🔄 Uniqueness conflict detected, re-checking for existing user...`);
              
              // Try to find the user again (might have been created by another request)
              const retryResult = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [uid]);
              if (retryResult.rows.length > 0) {
                user = retryResult.rows[0];
                console.log(`✅ Found user on retry: ${user.id} (${user.username})`);
              } else {
                throw insertError; // Re-throw if we still can't find the user
              }
            } else {
              throw insertError; // Re-throw other errors
            }
          }
        }
      }
    } else {
      // In-memory fallback with same Firebase UID first logic
      console.log(`📝 Using in-memory storage (no database connection)`);
      
      // Try to find by Firebase UID first
      for (const u of users.values()) {
        if (u.firebase_uid === uid) {
          user = u;
          console.log(`✅ Found existing in-memory user by Firebase UID: ${u.id} (${u.username})`);
          console.log(`   - is_verified in memory: ${u.is_verified}`);
          console.log(`   - emailVerified from Firebase: ${emailVerified}`);
          
          // Update verification status if Firebase shows verified but memory shows unverified
          if (emailVerified === true && !u.is_verified) {
            console.log(`🔄 UPDATING IN-MEMORY VERIFICATION STATUS - Firebase verified but memory not updated`);
            u.is_verified = true;
            console.log(`✅ IN-MEMORY VERIFICATION STATUS UPDATED - User ${u.id} is now verified`);
          }
          
          // Also update displayName if missing
          if (displayName && !u.display_name) {
            console.log(`🔄 UPDATING IN-MEMORY DISPLAY NAME - Adding: ${displayName}`);
            u.display_name = displayName;
            console.log(`✅ IN-MEMORY DISPLAY NAME UPDATED`);
          }
          
          break;
        }
      }
      
      // If not found by Firebase UID, try by email for linking
      if (!user) {
        for (const u of users.values()) {
          if (u.username && u.username.toLowerCase() === email.toLowerCase()) {
            user = u;
            console.log(`🔗 Found existing in-memory user by email: ${u.id} (${u.username})`);
            
            // Link to Firebase UID if not already linked
            if (!u.firebase_uid) {
              u.firebase_uid = uid;
              console.log(`🔗 Linked in-memory user ${u.id} to Firebase UID ${uid}`);
            }
            break;
          }
        }
      }
      
      // Create new user if none found
      if (!user) {
        const id = Date.now();
        const isUserVerified = emailVerified === true;
        
        // Hash the password if provided (for email/password users)
        let hashedPassword = '';
        if (password) {
          console.log(`🔐 Hashing password for in-memory email/password user`);
          hashedPassword = await hashPassword(password);
        }
        
        user = { 
          id, 
          username: email, 
          role: role || 'applicant', 
          password: hashedPassword, 
          firebase_uid: uid,
          is_verified: isUserVerified,
          has_seen_welcome: false
        };
        users.set(id, user);
        wasCreated = true;
        console.log(`✨ Created new in-memory user: ${id} (${email})`);
        console.log(`   - is_verified: ${isUserVerified}, has_seen_welcome: false`);
        console.log(`   - Password stored: ${hashedPassword ? 'YES' : 'NO'}`);
      }
    }
    
    console.log(`✅ Firebase sync completed for email: ${email}, user ID: ${user.id} (${wasCreated ? 'CREATED' : 'EXISTING'})`);
    
    return { 
      success: true, 
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        firebase_uid: user.firebase_uid,
        is_verified: user.is_verified,
        has_seen_welcome: user.has_seen_welcome
      },
      created: wasCreated,
      uid: uid,
      email: email
    };
  } catch (error) {
    console.error(`❌ Firebase sync error for ${email}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Initialize Firebase Admin SDK for enhanced auth with service account credentials
// This is wrapped in an IIFE to handle async initialization safely
let firebaseAdmin = null;
let firebaseAdminInitialized = false;

// Initialize Firebase Admin asynchronously and safely
(async function initializeFirebaseAdmin() {
  try {
    // Prefer service account credentials (production)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log('🔥 Initializing Firebase Admin with service account credentials...');
      
      try {
        const { initializeApp, getApps, cert } = await import('firebase-admin/app');
        
        if (getApps().length === 0) {
          firebaseAdmin = initializeApp({
            credential: cert({
              projectId: process.env.FIREBASE_PROJECT_ID,
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
              privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
            projectId: process.env.FIREBASE_PROJECT_ID,
          });
          
          firebaseAdminInitialized = true;
          console.log('✅ Firebase Admin SDK initialized with service account for project:', process.env.FIREBASE_PROJECT_ID);
        } else {
          firebaseAdmin = getApps()[0];
          firebaseAdminInitialized = true;
          console.log('✅ Using existing Firebase Admin app');
        }
      } catch (initError) {
        console.error('❌ Failed to initialize Firebase Admin with service account:', initError?.message || 'Unknown error');
        console.error('Init error stack:', initError?.stack);
        firebaseAdmin = null;
      }
    }
    
    // Fallback to VITE variables (development/basic mode) if service account failed
    if (!firebaseAdminInitialized && process.env.VITE_FIREBASE_PROJECT_ID) {
      console.log('🔄 Falling back to basic Firebase Admin initialization...');
      
      try {
        const { initializeApp, getApps } = await import('firebase-admin/app');
        
        if (getApps().length === 0) {
          firebaseAdmin = initializeApp({
            projectId: process.env.VITE_FIREBASE_PROJECT_ID,
          });
          
          firebaseAdminInitialized = true;
          console.log('✅ Firebase Admin SDK initialized with basic config for project:', process.env.VITE_FIREBASE_PROJECT_ID);
          console.warn('⚠️ Using basic credentials - password reset may not work. Consider setting up service account credentials.');
        } else {
          firebaseAdmin = getApps()[0];
          firebaseAdminInitialized = true;
          console.log('✅ Using existing Firebase Admin app');
        }
      } catch (initError) {
        console.error('❌ Failed to initialize Firebase Admin with basic config:', initError?.message || 'Unknown error');
        console.error('Init error stack:', initError?.stack);
        firebaseAdmin = null;
      }
    }
    
    if (!firebaseAdminInitialized) {
      console.warn('⚠️ Firebase Admin SDK not initialized - Firebase auth endpoints will return 503 errors. Please configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables in Vercel.');
    }
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed with unexpected error:', error);
    console.error('Error stack:', error?.stack);
    firebaseAdmin = null;
    firebaseAdminInitialized = false;
  }
})().catch((unhandledError) => {
  // Catch any unhandled promise rejections from the IIFE
  console.error('❌ UNHANDLED ERROR in Firebase Admin initialization IIFE:', unhandledError);
  console.error('Unhandled error stack:', unhandledError?.stack);
  firebaseAdmin = null;
  firebaseAdminInitialized = false;
});

// Enhanced Firebase token verification
async function verifyFirebaseToken(token) {
  try {
    // Validate token input
    if (!token || typeof token !== 'string' || token.trim() === '') {
      console.log('Invalid token provided to verifyFirebaseToken:', typeof token, token ? 'token present' : 'no token');
      return null;
    }

    if (!firebaseAdmin) {
      console.warn('⚠️ verifyFirebaseToken: Firebase Admin SDK not initialized, cannot verify token');
      return null;
    }
    
    try {
      const { getAuth } = await import('firebase-admin/auth');
      const auth = getAuth(firebaseAdmin);
      const decodedToken = await auth.verifyIdToken(token.trim());
      
      if (!decodedToken || !decodedToken.uid) {
        console.error('❌ verifyFirebaseToken: Invalid decoded token - missing UID');
        return null;
      }
      
      return decodedToken;
    } catch (authError) {
      console.error('❌ Firebase Admin Auth error:', authError);
      console.error('Auth error details:', {
        message: authError?.message,
        name: authError?.name,
        code: authError?.code
      });
      return null;
    }
  } catch (error) {
    console.error('❌ Enhanced token verification error:', error);
    console.error('Token verification error details:', {
      message: error?.message,
      name: error?.name,
      code: error?.code,
      stack: error?.stack
    });
    return null;
  }
}

// Helper function to get authenticated user from Firebase token or session/x-user-id
// This ensures compatibility with both localhost (session) and Vercel (Firebase token) deployments
async function getAuthenticatedUser(req) {
  // First, try Firebase Bearer token authentication
  const authHeader = req.headers.authorization;
  const hasBearerToken = authHeader && authHeader.startsWith('Bearer ');
  
  if (hasBearerToken) {
    const token = authHeader.substring(7)?.trim();
    
    if (token && firebaseAdmin) {
      try {
        const decodedToken = await verifyFirebaseToken(token);
        
        if (decodedToken && decodedToken.uid) {
          const firebaseUid = decodedToken.uid;
          console.log('🔥 getAuthenticatedUser - Verified Firebase token for UID:', firebaseUid);
          
          // Get user from database by Firebase UID
          if (!pool) {
            console.error('❌ getAuthenticatedUser: Database pool not available');
            return null;
          }
          
          try {
            const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [firebaseUid]);
            const user = result.rows[0] || null;
            
            if (user) {
              console.log('✅ getAuthenticatedUser - Found user:', { id: user.id, username: user.username, role: user.role });
              return user;
            } else {
              console.warn('⚠️ getAuthenticatedUser - User not found in database for Firebase UID:', firebaseUid);
              return null;
            }
          } catch (dbError) {
            console.error('❌ getAuthenticatedUser - Database error:', dbError);
            return null;
          }
        }
      } catch (tokenError) {
        console.error('❌ getAuthenticatedUser - Token verification error:', tokenError);
        // Fall through to session auth
      }
    }
  }
  
  // Fallback to session authentication (for localhost/managers/admins)
  const rawUserId = req.session?.userId || req.headers['x-user-id'];
  if (rawUserId) {
    console.log('📋 getAuthenticatedUser - Using session/x-user-id auth for user ID:', rawUserId);
    
    if (!pool) {
      console.error('❌ getAuthenticatedUser: Database pool not available');
      return null;
    }
    
    try {
      const user = await getUser(rawUserId);
      if (user) {
        console.log('✅ getAuthenticatedUser - Found user via session:', { id: user.id, username: user.username, role: user.role });
        return user;
      }
    } catch (dbError) {
      console.error('❌ getAuthenticatedUser - Database error fetching user:', dbError);
      return null;
    }
  }
  
  // No authentication provided
  console.warn('⚠️ getAuthenticatedUser - No authentication provided');
  return null;
}

// Enhanced Firebase Auth Middleware
async function verifyFirebaseAuth(req, res, next) {
  try {
    // Check if Firebase Admin is initialized
    if (!firebaseAdmin) {
      console.error('❌ verifyFirebaseAuth: Firebase Admin SDK not initialized');
      if (!res.headersSent) {
        return res.status(500).json({ 
          error: 'Server configuration error', 
          message: 'Firebase Admin SDK not initialized. Please check server configuration.' 
        });
      }
      return;
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ verifyFirebaseAuth: No Bearer token in Authorization header');
      if (!res.headersSent) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'No auth token provided' 
        });
      }
      return;
    }

    const token = authHeader.substring(7);
    if (!token || token.trim() === '') {
      console.log('❌ verifyFirebaseAuth: Empty token after Bearer prefix');
      if (!res.headersSent) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Invalid auth token format' 
        });
      }
      return;
    }

    let decodedToken;
    try {
      decodedToken = await verifyFirebaseToken(token);
    } catch (tokenError) {
      console.error('❌ verifyFirebaseAuth: Token verification threw error:', tokenError);
      console.error('Token error stack:', tokenError.stack);
      if (!res.headersSent) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Token verification failed',
          details: process.env.NODE_ENV === 'development' ? tokenError.message : undefined
        });
      }
      return;
    }

    if (!decodedToken) {
      console.log('❌ verifyFirebaseAuth: Token verification returned null');
      if (!res.headersSent) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Invalid auth token' 
        });
      }
      return;
    }

    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
    };

    console.log('✅ verifyFirebaseAuth: Token verified for UID:', decodedToken.uid);
    
    // Call next() safely
    if (typeof next === 'function') {
      next();
    }
  } catch (error) {
    console.error('❌ Enhanced Firebase auth verification error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      code: error.code
    });
    
    // Make sure we haven't already sent a response
    if (!res.headersSent) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Token verification failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else {
      console.error('⚠️ Response already sent in verifyFirebaseAuth, cannot send error response');
    }
  }
}
// Enhanced Firebase Auth with User Loading Middleware
// Wrapped in a factory function to ensure it's always safe
function requireFirebaseAuthWithUser(req, res, next) {
  // Wrap everything in a promise to catch any async errors
  (async () => {
    try {
      // Ensure JSON response from the start
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
      }
      
      // Check if Firebase Admin is initialized
      if (!firebaseAdmin) {
        console.error('❌ requireFirebaseAuthWithUser: Firebase Admin SDK not initialized');
        if (!res.headersSent) {
          return res.status(503).json({ 
            error: 'Service unavailable', 
            message: 'Authentication service is temporarily unavailable. Please try again later.',
            code: 'FIREBASE_NOT_INITIALIZED'
          });
        }
        return;
      }

      // Check for auth token
      const authHeader = req.headers?.authorization;
      
      if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        if (!res.headersSent) {
          return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'No auth token provided' 
          });
        }
        return;
      }

      const token = authHeader.substring(7)?.trim();
      if (!token) {
        if (!res.headersSent) {
          return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Invalid auth token format' 
          });
        }
        return;
      }

      let decodedToken = null;
      try {
        decodedToken = await verifyFirebaseToken(token);
      } catch (tokenError) {
        console.error('❌ requireFirebaseAuthWithUser: Token verification threw error:', tokenError);
        console.error('Token error details:', {
          message: tokenError?.message,
          name: tokenError?.name,
          stack: tokenError?.stack
        });
        if (!res.headersSent) {
          return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Token verification failed' 
          });
        }
        return;
      }

      if (!decodedToken || !decodedToken.uid) {
        if (!res.headersSent) {
          return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Invalid auth token' 
          });
        }
        return;
      }

      req.firebaseUser = {
        uid: decodedToken.uid,
        email: decodedToken.email || null,
        email_verified: decodedToken.email_verified || false,
      };

      // Load Neon user from Firebase UID
      if (!pool) {
        console.error('❌ requireFirebaseAuthWithUser: Database pool not available');
        if (!res.headersSent) {
          return res.status(500).json({ 
            error: 'Database error', 
            message: 'Database connection not available' 
          });
        }
        return;
      }
      
      let neonUser = null;
      try {
        const result = await pool.query(
          'SELECT * FROM users WHERE firebase_uid = $1',
          [req.firebaseUser.uid]
        );
        neonUser = result?.rows?.[0] || null;
      } catch (dbError) {
        console.error('❌ requireFirebaseAuthWithUser: Database query error:', dbError);
        console.error('Error stack:', dbError?.stack);
        if (!res.headersSent) {
          return res.status(500).json({ 
            error: 'Database error', 
            message: dbError?.message || 'Failed to fetch user from database',
            ...(process.env.NODE_ENV === 'development' && { stack: dbError?.stack })
          });
        }
        return;
      }
      
      if (!neonUser) {
        if (!res.headersSent) {
          return res.status(404).json({ 
            error: 'User not found', 
            message: 'No matching user in database. Please complete registration.' 
          });
        }
        return;
      }

      req.neonUser = {
        id: neonUser.id,
        username: neonUser.username || '',
        role: neonUser.role || null,
        firebaseUid: neonUser.firebase_uid || undefined,
        isVerified: neonUser.is_verified !== undefined ? neonUser.is_verified : true,
        hasSeenWelcome: neonUser.has_seen_welcome !== undefined ? neonUser.has_seen_welcome : false,
        isChef: neonUser.is_chef || false,
        isDeliveryPartner: neonUser.is_delivery_partner || false,
      };

      console.log(`🔄 Enhanced auth: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${neonUser.id}`);
      
      // Call next() safely
      if (typeof next === 'function' && !res.headersSent) {
        next();
      }
    } catch (error) {
      console.error('❌ CRITICAL ERROR in requireFirebaseAuthWithUser:', error);
      console.error('Error stack:', error?.stack);
      console.error('Error details:', {
        message: error?.message,
        name: error?.name,
        code: error?.code
      });
      
      if (!res.headersSent) {
        try {
          res.setHeader('Content-Type', 'application/json');
          res.status(500).json({ 
            error: 'Internal server error', 
            message: 'Authentication verification failed',
            ...(process.env.NODE_ENV === 'development' && { 
              details: error?.message,
              stack: error?.stack 
            })
          });
        } catch (sendError) {
          console.error('❌ Failed to send error response:', sendError);
        }
      } else {
        console.error('⚠️ Response already sent in requireFirebaseAuthWithUser, cannot send error response');
      }
    }
  })().catch((unhandledError) => {
    // Catch any unhandled promise rejections
    console.error('❌ UNHANDLED ERROR in requireFirebaseAuthWithUser promise:', unhandledError);
    if (!res.headersSent) {
      try {
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ 
          error: 'Internal server error', 
          message: 'An unexpected error occurred during authentication'
        });
      } catch (sendError) {
        console.error('❌ Failed to send error response for unhandled error:', sendError);
      }
    }
  });
}

// Enhanced Admin Role Verification
function requireAdmin(req, res, next) {
  if (!req.neonUser) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Authentication required' 
    });
  }

  if (req.neonUser.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Admin access required' 
    });
  }

  next();
}

// Session-based admin middleware (for admin endpoints that use session auth)
// IMPORTANT: This middleware ONLY checks session auth and IGNORES any Firebase tokens
async function requireSessionAdmin(req, res, next) {
  try {
    // Explicitly ignore any Authorization headers - this endpoint uses session auth only
    // Delete any Firebase-related request properties to prevent accidental Firebase auth
    delete req.firebaseUser;
    
    // Check session data (for admin login via req.session.userId)
    const sessionUserId = req.session.userId;
    
    if (!sessionUserId) {
      // Also check session user object
      if (req.session.user && req.session.user.id) {
        const user = req.session.user;
        if (user.role !== 'admin') {
          return res.status(403).json({ 
            error: 'Forbidden', 
            message: 'Admin access required',
            userRole: user.role || 'none'
          });
        }
        req.neonUser = {
          id: user.id,
          username: user.username,
          role: user.role
        };
        console.log(`📱 Session admin auth: User ${user.id} (${user.username}) authenticated via session`);
        return next();
      }
      
      console.log('❌ Session admin auth failed: No session found');
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Session authentication required. Please login as an admin.' 
      });
    }

    // Get user from database
    const user = await getUser(sessionUserId);
    
    if (!user) {
      console.log(`❌ Session admin auth failed: User ${sessionUserId} not found in database`);
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'User not found in session' 
      });
    }

    if (user.role !== 'admin') {
      console.log(`❌ Session admin auth failed: User ${user.id} is not an admin (role: ${user.role})`);
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Admin access required',
        userRole: user.role || 'none'
      });
    }

    // Set user on request for use in handlers
    req.neonUser = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    console.log(`✅ Session admin auth: User ${user.id} (${user.username}) authenticated as admin`);
    next();
  } catch (error) {
    console.error('Session admin auth error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Authentication verification failed' 
    });
  }
}

// ===================================
// ENHANCED FIREBASE ROUTES
// ===================================


// Enhanced Get Current User Profile (Firebase + Hybrid Support)
app.get('/api/user/profile', requireFirebaseAuthWithUser, async (req, res) => {
  // Double-wrap in try-catch to ensure we never crash
  try {
    // Ensure JSON response
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    
    // Check if middleware set the user objects
    if (!req.neonUser || !req.firebaseUser) {
      console.error('❌ /api/user/profile - Missing neonUser or firebaseUser');
      if (!res.headersSent) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      return;
    }

    const response = {
      id: req.neonUser.id,
      username: req.neonUser.username || '',
      role: req.neonUser.role || null,
      is_verified: req.neonUser.isVerified !== undefined ? req.neonUser.isVerified : true,
      has_seen_welcome: req.neonUser.hasSeenWelcome !== undefined ? req.neonUser.hasSeenWelcome : false,
      isChef: req.neonUser.isChef || false,
      isDeliveryPartner: req.neonUser.isDeliveryPartner || false,
      firebaseUid: req.firebaseUser.uid || null,
      email: req.firebaseUser.email || null,
      emailVerified: req.firebaseUser.email_verified || false
    };

    console.log('✅ /api/user/profile - Returning profile for user:', req.neonUser.id);
    
    if (!res.headersSent) {
      return res.json(response);
    }
  } catch (error) {
    console.error('❌ Error getting enhanced user profile:', error);
    console.error('Error stack:', error?.stack);
    if (!res.headersSent) {
      try {
        res.setHeader('Content-Type', 'application/json');
        return res.status(500).json({ 
          error: 'Failed to get user profile',
          message: error?.message || 'Unknown error',
          ...(process.env.NODE_ENV === 'development' && { stack: error?.stack })
        });
      } catch (sendError) {
        console.error('❌ Failed to send error response:', sendError);
      }
    } else {
      console.error('⚠️ Response already sent, cannot send error response');
    }
  }
});

// 🔥 Update User Roles (Firebase Auth, NO SESSIONS)
app.post('/api/firebase/user/update-roles', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const { isChef, isDeliveryPartner } = req.body;

    if (typeof isChef !== 'boolean' || typeof isDeliveryPartner !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid role data. isChef and isDeliveryPartner must be boolean values'
      });
    }

    if (!isChef && !isDeliveryPartner) {
      return res.status(400).json({
        error: 'User must have at least one role (chef or delivery partner)'
      });
    }

    console.log(`🎯 Updating user roles: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${req.neonUser.id} → Chef: ${isChef}, Delivery: ${isDeliveryPartner}`);

    // Update user roles in database
    if (pool) {
      // Determine the main role based on selected roles
      let mainRole = 'chef'; // default
      if (isDeliveryPartner && !isChef) {
        mainRole = 'delivery_partner';
      } else if (isChef && isDeliveryPartner) {
        mainRole = 'chef'; // For dual roles, default to chef
      } else if (isChef) {
        mainRole = 'chef';
      }

      await pool.query(
        `UPDATE users SET 
          is_chef = $1, 
          is_delivery_partner = $2, 
          role = $3 
        WHERE id = $4`,
        [isChef, isDeliveryPartner, mainRole, req.neonUser.id]
      );
    } else {
      // In-memory fallback
      const user = Array.from(users.values()).find(u => u.id === req.neonUser.id);
      if (user) {
        user.isChef = isChef;
        user.isDeliveryPartner = isDeliveryPartner;
        user.role = isDeliveryPartner && !isChef ? 'delivery_partner' : 'chef';
      }
    }

    res.json({
      success: true,
      message: 'User roles updated successfully'
    });
  } catch (error) {
    console.error('Error updating user roles:', error);
    res.status(500).json({
      error: 'Failed to update user roles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
// Enhanced Submit Application
app.post('/api/firebase/applications', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    // Validate the request body (you can add zod validation here if needed)
    const applicationData = {
      ...req.body,
      userId: req.neonUser.id
    };

    console.log(`📝 Enhanced application: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${req.neonUser.id}`);

    // Use existing createApplication logic or replicate it here
    let application;
    if (pool) {
      const result = await pool.query(
        `INSERT INTO applications (
          user_id, full_name, email, phone, food_safety_license, 
          food_establishment_cert, kitchen_preference, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          applicationData.userId,
          applicationData.fullName,
          applicationData.email,
          applicationData.phone,
          applicationData.foodSafetyLicense,
          applicationData.foodEstablishmentCert,
          applicationData.kitchenPreference,
          'inReview',
          new Date()
        ]
      );
      application = result.rows[0];
    } else {
      // In-memory fallback
      const id = Date.now();
      application = {
        id,
        user_id: applicationData.userId,
        full_name: applicationData.fullName,
        email: applicationData.email,
        phone: applicationData.phone,
        food_safety_license: applicationData.foodSafetyLicense,
        food_establishment_cert: applicationData.foodEstablishmentCert,
        kitchen_preference: applicationData.kitchenPreference,
        status: 'inReview',
        created_at: new Date()
      };
    }

    res.json({ 
      success: true, 
      application,
      message: 'Application submitted successfully'
    });
  } catch (error) {
    console.error('Error creating enhanced application:', error);
    res.status(500).json({ 
      error: 'Failed to create application',
      message: error.message
    });
  }
});

// Enhanced Get User's Applications
app.get('/api/firebase/applications/my', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    let applications = [];
    
    if (pool) {
      const result = await pool.query(
        'SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC',
        [req.neonUser.id]
      );
      applications = result.rows;
    } else {
      // In-memory fallback
      applications = Array.from(applications.values()).filter(
        app => app.user_id === req.neonUser.id
      );
    }
    
    console.log(`📋 Enhanced retrieval: ${applications.length} applications for Firebase UID ${req.firebaseUser.uid} → Neon User ID ${req.neonUser.id}`);

    res.json(applications);
  } catch (error) {
    console.error('Error getting enhanced user applications:', error);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

// Enhanced Admin Routes
app.get('/api/firebase/admin/applications', requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    let applications = [];
    
    if (pool) {
      const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
      applications = result.rows;
    } else {
      // In-memory fallback
      applications = Array.from(applications.values());
    }
    
    console.log(`👑 Enhanced admin ${req.firebaseUser.uid} requested all applications`);

    res.json(applications);
  } catch (error) {
    console.error('Error getting enhanced admin applications:', error);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

// Enhanced Dashboard Data
app.get('/api/firebase/dashboard', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const userId = req.neonUser.id;
    const firebaseUid = req.firebaseUser.uid;

    console.log(`🏠 Enhanced dashboard: Firebase UID ${firebaseUid} → Neon User ID ${userId}`);

    // Get applications and microlearning progress
    let applications = [];
    let microlearningProgress = [];

    if (pool) {
      const [appResult, progressResult] = await Promise.all([
        pool.query('SELECT * FROM applications WHERE user_id = $1', [userId]),
        getMicrolearningProgress(userId)
      ]);
      applications = appResult.rows;
      microlearningProgress = progressResult;
    }

    res.json({
      user: {
        id: userId,
        username: req.neonUser.username,
        role: req.neonUser.role,
        firebaseUid: firebaseUid
      },
      applications,
      microlearningProgress,
      stats: {
        totalApplications: applications.length,
        approvedApplications: applications.filter(app => app.status === 'approved').length,
        completedLessons: microlearningProgress.length
      }
    });
  } catch (error) {
    console.error('Error getting enhanced dashboard data:', error);
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});
// ===============================
// FIREBASE DELIVERY PARTNER ENDPOINTS
// ===============================
// Submit Delivery Partner Application (with Firebase Auth)
app.post('/api/firebase/delivery-partner-applications', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    // Validate required fields
    const requiredFields = ['fullName', 'email', 'phone', 'address', 'city', 'province', 'postalCode', 'vehicleType', 'vehicleMake', 'vehicleModel', 'vehicleYear', 'licensePlate', 'insuranceUrl'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: "Validation error",
        errors: missingFields.map(field => ({ field, message: `${field} is required` }))
      });
    }

    // Associate application with the authenticated Neon user
    const applicationData = {
      ...req.body,
      userId: req.neonUser.id
    };

    console.log(`🚚 Creating delivery partner application: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${req.neonUser.id}`);

    let application;
    if (pool) {
      const result = await pool.query(
        `INSERT INTO delivery_partner_applications (
          user_id, full_name, email, phone, address, city, province, postal_code,
          vehicle_type, vehicle_make, vehicle_model, vehicle_year, license_plate,
          drivers_license_url, vehicle_registration_url, insurance_url,
          status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
        [
          applicationData.userId,
          applicationData.fullName,
          applicationData.email,
          applicationData.phone,
          applicationData.address,
          applicationData.city,
          applicationData.province,
          applicationData.postalCode,
          applicationData.vehicleType,
          applicationData.vehicleMake,
          applicationData.vehicleModel,
          applicationData.vehicleYear,
          applicationData.licensePlate,
          applicationData.driversLicenseUrl || null,
          applicationData.vehicleRegistrationUrl || null,
          applicationData.insuranceUrl || null,
          'inReview',
          new Date()
        ]
      );
      application = result.rows[0];
    } else {
      // In-memory fallback
      const id = Date.now();
      application = {
        id,
        user_id: applicationData.userId,
        full_name: applicationData.fullName,
        email: applicationData.email,
        phone: applicationData.phone,
        address: applicationData.address,
        city: applicationData.city,
        province: applicationData.province,
        postal_code: applicationData.postalCode,
        vehicle_type: applicationData.vehicleType,
        vehicle_make: applicationData.vehicleMake,
        vehicle_model: applicationData.vehicleModel,
        vehicle_year: applicationData.vehicleYear,
        license_plate: applicationData.licensePlate,
        status: 'inReview',
        created_at: new Date()
      };
    }

    // Send email notification for new delivery partner application
    try {
      if (application.email) {
        const hasDocuments = !!(application.drivers_license_url || application.vehicle_registration_url || application.insurance_url);
        
        if (hasDocuments) {
          // Application submitted WITH documents - send combined email
          console.log("📧 Sending delivery partner WITH documents email...");
          const { sendEmail, generateDeliveryPartnerApplicationWithDocumentsEmail } = await import('../server/email.js');
          const emailContent = generateDeliveryPartnerApplicationWithDocumentsEmail({
            fullName: application.full_name || "Applicant",
            email: application.email
          });
          console.log("📧 WITH docs email content generated:", { to: emailContent.to, subject: emailContent.subject });

          const emailResult = await sendEmail(emailContent, {
            trackingId: `delivery_app_with_docs_${application.id}_${Date.now()}`
          });
          console.log(`✅ Delivery partner application with documents email result: ${emailResult ? 'SUCCESS' : 'FAILED'} to ${application.email} for application ${application.id}`);
        } else {
          // Application submitted WITHOUT documents - prompt to upload
          console.log("📧 Sending delivery partner WITHOUT documents email...");
          const { sendEmail, generateDeliveryPartnerApplicationWithoutDocumentsEmail } = await import('../server/email.js');
          const emailContent = generateDeliveryPartnerApplicationWithoutDocumentsEmail({
            fullName: application.full_name || "Applicant",
            email: application.email
          });
          console.log("📧 WITHOUT docs email content generated:", { to: emailContent.to, subject: emailContent.subject });

          const emailResult = await sendEmail(emailContent, {
            trackingId: `delivery_app_no_docs_${application.id}_${Date.now()}`
          });
          console.log(`✅ Delivery partner application without documents email result: ${emailResult ? 'SUCCESS' : 'FAILED'} to ${application.email} for application ${application.id}`);
        }
      } else {
        console.warn(`Cannot send delivery partner application email: Missing email address`);
      }
    } catch (emailError) {
      // Log the error but don't fail the request
      console.error("❌ DELIVERY PARTNER EMAIL ERROR:", {
        error: emailError.message,
        stack: emailError.stack,
        applicationId: application.id,
        email: application.email,
        hasDocuments: !!(application.drivers_license_url || application.vehicle_registration_url || application.insurance_url),
        environment: process.env.NODE_ENV
      });
    }

    res.json({
      success: true,
      application,
      message: 'Delivery partner application submitted successfully'
    });
  } catch (error) {
    console.error('Error creating delivery partner application:', error);
    res.status(500).json({
      error: 'Failed to create delivery partner application',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
// Get User's Delivery Partner Applications (with Firebase Auth)
app.get('/api/firebase/delivery-partner-applications/my', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    let applications = [];
    
    if (pool) {
      const result = await pool.query(
        'SELECT * FROM delivery_partner_applications WHERE user_id = $1 ORDER BY created_at DESC',
        [req.neonUser.id]
      );
      applications = result.rows;
    } else {
      // In-memory fallback
      applications = []; // Would need proper in-memory storage implementation
    }
    
    console.log(`🚚 Retrieved ${applications.length} delivery partner applications: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${req.neonUser.id}`);

    res.json(applications);
  } catch (error) {
    console.error('Error getting delivery partner applications:', error);
    res.status(500).json({ error: 'Failed to get delivery partner applications' });
  }
});

// Admin - Get All Delivery Partner Applications (with Firebase Auth and Admin Check)
app.get('/api/firebase/admin/delivery-partner-applications', requireFirebaseAuthWithUser, requireAdmin, async (req, res) => {
  try {
    let applications = [];
    
    if (pool) {
      const result = await pool.query('SELECT * FROM delivery_partner_applications ORDER BY created_at DESC');
      applications = result.rows;
    } else {
      // In-memory fallback
      applications = []; // Would need proper in-memory storage implementation
    }
    
    console.log(`👑 Admin ${req.firebaseUser.uid} requested all delivery partner applications`);

    res.json(applications);
  } catch (error) {
    console.error('Error getting admin delivery partner applications:', error);
    res.status(500).json({ error: 'Failed to get delivery partner applications' });
  }
});

// Admin - Get All Delivery Partner Applications (Session-based auth)
app.get('/api/delivery-partner-applications', async (req, res) => {
  try {
    // Check if user is authenticated via session
    const rawUserId = req.headers['x-user-id'] || req.session?.userId;
    
    if (!rawUserId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    // Get user from database
    let user;
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [rawUserId]);
      user = result.rows[0];
    } else {
      // In-memory fallback
      user = null; // Would need proper in-memory storage implementation
    }

    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can access this endpoint'
      });
    }

    // Get delivery partner applications from database
    let applications = [];
    if (pool) {
      const result = await pool.query('SELECT * FROM delivery_partner_applications ORDER BY created_at DESC');
      applications = result.rows;
    } else {
      // In-memory fallback
      applications = []; // Would need proper in-memory storage implementation
    }

    console.log(`👑 Admin ${user.id} requested all delivery partner applications`);

    res.json(applications);
  } catch (error) {
    console.error('Error getting admin delivery partner applications:', error);
    res.status(500).json({ error: 'Failed to get delivery partner applications' });
  }
});

// Update Delivery Partner Application Documents
app.put('/api/firebase/delivery-partner-applications/:id', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { driversLicenseUrl, vehicleRegistrationUrl, insuranceUrl, backgroundCheckUrl } = req.body;
    
    // Verify the application belongs to the current user
    let application = null;
    if (pool) {
      const result = await pool.query('SELECT * FROM delivery_partner_applications WHERE id = $1', [id]);
      application = result.rows[0];
    }
    
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    if (application.user_id !== req.neonUser.id) {
      return res.status(403).json({ error: 'Not authorized to update this application' });
    }
    
    // Update the application with new document URLs
    const updateData = {};
    if (driversLicenseUrl !== undefined) updateData.drivers_license_url = driversLicenseUrl;
    if (vehicleRegistrationUrl !== undefined) updateData.vehicle_registration_url = vehicleRegistrationUrl;
    if (insuranceUrl !== undefined) updateData.insurance_url = insuranceUrl;
    if (backgroundCheckUrl !== undefined) updateData.background_check_url = backgroundCheckUrl;
    
    // Reset status to pending when documents are updated
    updateData.drivers_license_status = 'pending';
    updateData.vehicle_registration_status = 'pending';
    updateData.insurance_status = 'pending';
    updateData.background_check_status = 'pending';
    
    if (pool) {
      const updateQuery = `
        UPDATE delivery_partner_applications 
        SET 
          drivers_license_url = COALESCE($1, drivers_license_url),
          vehicle_registration_url = COALESCE($2, vehicle_registration_url),
          insurance_url = COALESCE($3, insurance_url),
          background_check_url = COALESCE($4, background_check_url),
          drivers_license_status = 'pending',
          vehicle_registration_status = 'pending',
          insurance_status = 'pending',
          background_check_status = 'pending'
        WHERE id = $5
        RETURNING *
      `;
      
      const result = await pool.query(updateQuery, [
        driversLicenseUrl || null,
        vehicleRegistrationUrl || null,
        insuranceUrl || null,
        backgroundCheckUrl || null,
        id
      ]);
      
      const updatedApplication = result.rows[0];
      console.log(`📄 Updated delivery partner application ${id} documents for user ${req.neonUser.id}`);
      
      res.json(updatedApplication);
    } else {
      res.status(500).json({ error: 'Database not available' });
    }
  } catch (error) {
    console.error('Error updating delivery partner application:', error);
    res.status(500).json({ error: 'Failed to update delivery partner application' });
  }
});

// Update delivery partner application document verification status (admin only)
app.patch("/api/delivery-partner-applications/:id/document-verification", async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }
    const userId = user.id;

    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    // Get the application to find the user_id
    const appResult = await pool.query(`
      SELECT user_id FROM delivery_partner_applications WHERE id = $1
    `, [applicationId]);

    if (appResult.rows.length === 0) {
      return res.status(404).json({ message: "Application not found" });
    }

    const targetUserId = appResult.rows[0].user_id;

    // Build update data for delivery_partner_applications table (document verification fields)
    const updateData = {
      documents_reviewed_by: userId,
      documents_reviewed_at: new Date()
    };

    // Map camelCase field names to snake_case database column names
    const fieldMapping = {
      'driversLicenseStatus': 'drivers_license_status',
      'vehicleRegistrationStatus': 'vehicle_registration_status',
      'insuranceStatus': 'insurance_status',
      'documentsAdminFeedback': 'documents_admin_feedback'
    };

    // Apply field mapping and add to update data
    Object.keys(req.body).forEach(key => {
      const mappedKey = fieldMapping[key] || key;
      updateData[mappedKey] = req.body[key];
    });

    // Update the application record directly with document verification status
    const setClause = Object.keys(updateData).map((key, index) => `${key} = $${index + 2}`).join(', ');
    const values = [applicationId, ...Object.values(updateData)];
    
    const result = await pool.query(`
      UPDATE delivery_partner_applications 
      SET ${setClause}
      WHERE id = $1
      RETURNING *;
    `, values);

    if (result.rowCount === 0) {
      return res.status(500).json({ message: "Failed to update document verification" });
    }

    const updatedApplication = result.rows[0];

    console.log(`Delivery partner document verification updated for application ${applicationId}:`, {
      driversLicenseStatus: updatedApplication.drivers_license_status,
      vehicleRegistrationStatus: updatedApplication.vehicle_registration_status,
      insuranceStatus: updatedApplication.insurance_status,
      reviewedBy: userId,
      timestamp: new Date().toISOString()
    });

    // Check if all documents are approved and send consolidated email
    try {
      if (updatedApplication.email) {
        // Import the email functions
        const { sendEmail, generateDeliveryPartnerAllDocumentsApprovedEmail } = await import('../server/email.js');

        // Check if all documents are approved
        const hasDriversLicense = updatedApplication.drivers_license_url;
        const hasVehicleRegistration = updatedApplication.vehicle_registration_url;
        const hasInsurance = updatedApplication.insurance_url;
        
        const driversLicenseApproved = updatedApplication.drivers_license_status === "approved";
        const vehicleRegistrationApproved = updatedApplication.vehicle_registration_status === "approved";
        const insuranceApproved = updatedApplication.insurance_status === "approved";
        
        // If all documents are approved, send consolidated email
        if (driversLicenseApproved && vehicleRegistrationApproved && insuranceApproved) {
          const approvedDocuments = [];
          if (hasDriversLicense) approvedDocuments.push("Driver's License");
          if (hasVehicleRegistration) approvedDocuments.push("Vehicle Registration");
          if (hasInsurance) approvedDocuments.push("Vehicle Insurance");
          
          const emailContent = generateDeliveryPartnerAllDocumentsApprovedEmail({
            fullName: updatedApplication.full_name || "Delivery Partner",
            email: updatedApplication.email,
            approvedDocuments: approvedDocuments,
            adminFeedback: req.body.documentsAdminFeedback
          });

          await sendEmail(emailContent, {
            trackingId: `all_docs_approved_delivery_${updatedApplication.id}_${Date.now()}`
          });
          
          console.log(`All documents approved email sent to ${updatedApplication.email} for delivery partner application ${updatedApplication.id}`);
        }
      } else {
        console.warn(`Cannot send all documents approved email for delivery partner application ${updatedApplication.id}: No email address found`);
      }
    } catch (emailError) {
      // Log the error but don't fail the request
      console.error("Error sending all documents approved email:", emailError);
    }

    // Return the application data in the format expected by the frontend
    const responseData = updatedApplication;

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Error updating delivery partner application document verification:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});
// Cancel delivery partner application endpoint (users can cancel their own applications)
app.patch('/api/delivery-partner-applications/:id/cancel', async (req, res) => {
  console.log('🚫 CANCEL DELIVERY PARTNER APPLICATION - Request received:', {
    applicationId: req.params.id,
    sessionId: req.session.id,
    sessionUserId: req.session.userId || null,
    headerUserId: req.headers['x-user-id'] || null,
    method: req.method,
    url: req.url
  });

  // Get user ID from session or header
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    console.log('🚫 CANCEL ERROR: No userId in session or header');
    return res.status(401).json({ error: 'Authentication required' });
  }

  console.log('🚫 Looking up user for rawUserId:', rawUserId);

  // Convert Firebase UID to integer user ID
  const user = await getUser(rawUserId);
  if (!user) {
    console.log('🚫 CANCEL ERROR: User not found for ID:', rawUserId);
    return res.status(401).json({ error: 'User not found' });
  }
  const userId = user.id;

  console.log('🚫 User lookup successful:', {
    firebaseUid: rawUserId,
    integerUserId: userId,
    userRole: user.role,
    userEmail: user.email
  });

  // Store user ID in session if it's not there
  if (!req.session.userId && rawUserId) {
    console.log('Storing userId in session from header:', rawUserId);
    req.session.userId = rawUserId;
    await new Promise(resolve => req.session.save(resolve));
  }

  try {
    const { id } = req.params;

    // Get from database if available
    if (pool) {
      // Check if delivery_partner_applications table exists
      const tableCheck = await pool.query(`
        SELECT to_regclass('public.delivery_partner_applications') as table_exists;
      `);

      if (!tableCheck.rows[0].table_exists) {
        return res.status(404).json({ error: 'Application not found' });
      }

      // Update the application
      let result;
      if (user.role === 'admin') {
        // Admins can cancel any delivery partner application
        result = await pool.query(`
          UPDATE delivery_partner_applications
          SET status = 'cancelled'
          WHERE id = $1
          RETURNING *;
        `, [id]);
      } else {
        // Users can only cancel their own delivery partner applications
        result = await pool.query(`
          UPDATE delivery_partner_applications
          SET status = 'cancelled'
          WHERE id = $1 AND user_id = $2
          RETURNING *;
        `, [id, userId]);
      }

      console.log('🚫 Database update result:', {
        rowCount: result.rowCount,
        applicationId: id,
        userId: userId,
        success: result.rowCount > 0
      });

      if (result.rowCount === 0) {
        console.log('🚫 CANCEL ERROR: Delivery partner application not found or not owned by user');
        return res.status(404).json({ error: 'Application not found or not owned by you' });
      }

      // Get the user_id for the cancelled application
      const cancelledApp = result.rows[0];
      const cancelledUserId = cancelledApp.user_id;

      console.log('🚫 Delivery partner application cancelled successfully:', {
        applicationId: cancelledApp.id,
        status: cancelledApp.status,
        userId: cancelledUserId
      });

      // Get document URLs before deletion for blob cleanup
      const docResult = await pool.query(`
        SELECT drivers_license_url, vehicle_registration_url, insurance_url 
        FROM delivery_partner_applications
        WHERE id = $1
      `, [result.rows[0].id]);

      // Clean up Vercel blob files if they exist
      if (docResult.rows.length > 0) {
        const docUrls = docResult.rows[0];
        await cleanupBlobFiles([
          docUrls.drivers_license_url,
          docUrls.vehicle_registration_url,
          docUrls.insurance_url
        ]);
      }

      // Send email notification about application cancellation
      try {
        // Import the email functions
        const { sendEmail, generateDeliveryPartnerStatusChangeEmail } = await import('../server/email.js');

        if (cancelledApp.email) {
          const emailContent = generateDeliveryPartnerStatusChangeEmail({
            fullName: cancelledApp.full_name || cancelledApp.applicant_name || "Delivery Partner",
            email: cancelledApp.email,
            status: 'cancelled'
          });

          await sendEmail(emailContent, {
            trackingId: `delivery_cancel_${cancelledApp.id}_${Date.now()}`
          });
          console.log(`Delivery partner cancellation email sent to ${cancelledApp.email} for application ${cancelledApp.id}`);
        } else {
          console.warn(`Cannot send delivery partner cancellation email for application ${cancelledApp.id}: No email address found`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending delivery partner cancellation email:", emailError);
      }

      return res.status(200).json(cancelledApp);
    }

    // Fallback error - no storage
    res.status(500).json({ error: 'No storage available' });
  } catch (error) {
    console.error('Cancel delivery partner application error:', error);
    res.status(500).json({ error: 'Failed to cancel delivery partner application' });
  }
});
// Update delivery partner application status endpoint (admin only)
app.patch("/api/delivery-partner-applications/:id/status", async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    // Check if the application exists
    const appResult = await pool.query(`
      SELECT * FROM delivery_partner_applications WHERE id = $1
    `, [id]);

    if (appResult.rows.length === 0) {
      return res.status(404).json({ message: "Delivery partner application not found" });
    }

    const application = appResult.rows[0];

    // Validate the status
    const { status } = req.body;
    if (!status || !['pending', 'inReview', 'approved', 'rejected', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be one of: pending, inReview, approved, rejected, cancelled" });
    }

    // Update the application status
    const updateResult = await pool.query(`
      UPDATE delivery_partner_applications 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: "Application not found or could not be updated" });
    }

    const updatedApplication = updateResult.rows[0];

    // Send email notification about status change
    try {
      if (updatedApplication.email) {
        // Import the email functions
        const { sendEmail, generateDeliveryPartnerStatusChangeEmail } = await import('../server/email.js');

        const emailContent = generateDeliveryPartnerStatusChangeEmail({
          fullName: updatedApplication.full_name || "Delivery Partner",
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

// ===============================
// FIREBASE MICROLEARNING ENDPOINTS
// ===============================

// Get microlearning progress (Firebase)
app.get('/api/firebase/microlearning/progress/:userId', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = req.neonUser.id;
    
    // Users can only access their own progress unless they're admin
    if (req.firebaseUser.uid !== requestedUserId && req.neonUser.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Get the user ID for the requested Firebase UID
    let targetUser = null;
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [requestedUserId]);
      targetUser = result.rows[0];
    }
    
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const progress = await getMicrolearningProgress(targetUser.id);
    const completion = await getMicrolearningCompletion(targetUser.id);
    const applicationStatus = await getApplicationStatus(targetUser.id);
    
    // Admins and completed users have unrestricted access regardless of application status
    const isAdmin = req.neonUser.role === 'admin';
    const isCompleted = completion?.confirmed || false;
    const accessLevel = isAdmin || applicationStatus.hasApproved || isCompleted ? 'full' : 'limited';
    
    console.log(`📺 Firebase microlearning progress: UID ${requestedUserId} → User ID ${targetUser.id} (Access: ${accessLevel})`);
    
    res.json({
      success: true,
      progress: progress || [],
      completion: completion || null,
      userId: targetUser.id,
      firebaseUid: requestedUserId,
      // Add convenience fields for easier access
      confirmed: completion?.confirmed || false,
      certificateGenerated: completion?.certificateGenerated || false,
      completedAt: completion?.completedAt || null,
      hasApprovedApplication: applicationStatus.hasApproved,
      accessLevel: accessLevel,
      isAdmin: isAdmin,
      applicationInfo: {
        hasActive: applicationStatus.hasActive,
        hasPending: applicationStatus.hasPending,
        hasRejected: applicationStatus.hasRejected,
        hasCancelled: applicationStatus.hasCancelled,
        latestStatus: applicationStatus.latestStatus,
        canApply: !applicationStatus.hasActive, // Can apply if no active applications
        message: applicationStatus.hasApproved 
          ? "✅ Application approved - Full access granted!" 
          : applicationStatus.hasPending 
          ? "⏳ Application under review - Limited access until approved"
          : applicationStatus.hasRejected || applicationStatus.hasCancelled
          ? "❌ Previous application not approved - Please reapply for full access"
          : "📝 Submit application for full training access"
      },
    });
  } catch (error) {
    console.error('Error getting Firebase microlearning progress:', error);
    res.status(500).json({ message: 'Failed to get progress' });
  }
});
// Update microlearning progress (Firebase)
app.post('/api/firebase/microlearning/progress', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const { videoId, progress, completed, completedAt, watchedPercentage } = req.body;
    const userId = req.neonUser.id;

    console.log(`📺 Firebase video progress: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${userId}`);

    // Check if user has approved application for videos beyond the first one
    const applicationStatus = await getApplicationStatus(userId);
    const completion = await getMicrolearningCompletion(userId);
    const isCompleted = completion?.confirmed || false;
    const firstVideoId = 'basics-cross-contamination'; // First video that everyone can access
    const isAdmin = req.neonUser.role === 'admin';
    
    // Admins and completed users have unrestricted access to all videos
    if (!applicationStatus.hasApproved && !isAdmin && !isCompleted && videoId !== firstVideoId) {
      const message = applicationStatus.hasPending 
        ? 'Your application is under review. Full access will be granted once approved.'
        : applicationStatus.hasRejected || applicationStatus.hasCancelled
        ? 'Your previous application was not approved. Please submit a new application for full access.'
        : 'Please submit an application to access all training videos.';
      return res.status(403).json({ 
        message: message,
        accessLevel: 'limited',
        firstVideoOnly: true,
        applicationInfo: {
          hasActive: applicationStatus.hasActive,
          hasPending: applicationStatus.hasPending,
          hasRejected: applicationStatus.hasRejected,
          hasCancelled: applicationStatus.hasCancelled,
          canApply: !applicationStatus.hasActive
        }
      });
    }

    const progressData = {
      userId,
      videoId,
      progress: Math.max(0, Math.min(100, progress)), // Clamp between 0-100
      watchedPercentage: Math.max(0, Math.min(100, watchedPercentage || 0)), // Clamp between 0-100
      completed: completed,
      completedAt: completed ? (completedAt ? new Date(completedAt) : new Date()) : null,
      updatedAt: new Date()
    };

    await updateVideoProgress(progressData);

    res.json({ success: true, message: 'Progress updated successfully' });
  } catch (error) {
    console.error('Error updating Firebase video progress:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});
// Complete microlearning (Firebase)
app.post('/api/firebase/microlearning/complete', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const { completionDate, videoProgress } = req.body;
    const userId = req.neonUser.id;
    
    console.log(`📺 Firebase microlearning completion: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${userId}`);
    
    // Check if user has approved application to complete full training
    const applicationStatus = await getApplicationStatus(userId);
    const isAdmin = req.neonUser.role === 'admin';
    
    // Admins can complete certification without application approval
    if (!applicationStatus.hasApproved && !isAdmin) {
      const message = applicationStatus.hasPending 
        ? 'Your application is under review. Certification will be available once approved.'
        : applicationStatus.hasRejected || applicationStatus.hasCancelled
        ? 'Your previous application was not approved. Please submit a new application to complete certification.'
        : 'Please submit an application to complete full certification.';
      return res.status(403).json({ 
        message: message,
        accessLevel: 'limited',
        requiresApproval: true,
        applicationInfo: {
          hasActive: applicationStatus.hasActive,
          hasPending: applicationStatus.hasPending,
          hasRejected: applicationStatus.hasRejected,
          hasCancelled: applicationStatus.hasCancelled,
          canApply: !applicationStatus.hasActive
        }
      });
    }
    
    // Create completion record
    const completion = await createMicrolearningCompletion({
      userId,
      completedAt: completionDate ? new Date(completionDate) : new Date(),
      confirmed: true, // Default to confirmed when user completes training
      progress: videoProgress
    });
    
    res.json({
      success: true,
      completion,
      message: "Congratulations! You have completed the microlearning training."
    });
  } catch (error) {
    console.error('Error completing Firebase microlearning:', error);
    res.status(500).json({ message: 'Failed to complete microlearning' });
  }
});

// Get microlearning completion status (Firebase)
app.get('/api/firebase/microlearning/completion/:userId', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    
    // Users can only access their own completion unless they're admin
    if (req.firebaseUser.uid !== requestedUserId && req.neonUser.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Get the user ID for the requested Firebase UID
    let targetUser = null;
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [requestedUserId]);
      targetUser = result.rows[0];
    }
    
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const completion = await getMicrolearningCompletion(targetUser.id);
    
    console.log(`📺 Firebase microlearning completion status: UID ${requestedUserId} → User ID ${targetUser.id}`);
    
    res.json({
      success: true,
      completion: completion || null,
      userId: targetUser.id,
      firebaseUid: requestedUserId,
      // Add convenience fields for easier access
      confirmed: completion?.confirmed || false,
      certificateGenerated: completion?.certificateGenerated || false,
      completedAt: completion?.completedAt || null
    });
  } catch (error) {
    console.error('Error getting Firebase microlearning completion:', error);
    res.status(500).json({ message: 'Failed to get completion status' });
  }
});

// Get microlearning certificate (Firebase)
app.get('/api/firebase/microlearning/certificate/:userId', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    
    // Users can only access their own certificate unless they're admin
    if (req.firebaseUser.uid !== requestedUserId && req.neonUser.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Get the user ID for the requested Firebase UID
    let targetUser = null;
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [requestedUserId]);
      targetUser = result.rows[0];
    }
    
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get completion status
    const completion = await getMicrolearningCompletion(targetUser.id);
    
    if (!completion || !completion.confirmed) {
      return res.status(404).json({ 
        message: 'Certificate not available',
        reason: completion ? 'Not confirmed' : 'Training not completed'
      });
    }
    
    console.log(`📺 Firebase microlearning certificate: UID ${requestedUserId} → User ID ${targetUser.id}`);
    
    // Check if certificate was already generated before
    const isFirstTimeGeneration = !completion.certificateGenerated;
    console.log('Firebase certificate generation status:', {
      userId: targetUser.id,
      alreadyGenerated: completion.certificateGenerated,
      isFirstTime: isFirstTimeGeneration
    });

    // Get user's actual name from their most recent application
    let userDisplayName = targetUser.username; // Fallback to username
    
    try {
      if (pool) {
        const appResult = await pool.query(
          'SELECT full_name FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
          [targetUser.id]
        );
        if (appResult.rows.length > 0 && appResult.rows[0].full_name) {
          userDisplayName = appResult.rows[0].full_name;
          console.log(`📋 Firebase certificate: Using application full name: "${userDisplayName}" for user ${targetUser.id}`);
        } else {
          console.log(`⚠️ Firebase certificate: No application full_name found for user ${targetUser.id}, using username as fallback`);
        }
      }
    } catch (error) {
      console.error('Error getting user full name from applications for Firebase certificate:', error);
      console.log(`⚠️ Firebase certificate: Using username "${targetUser.username}" as fallback`);
    }

    // Generate professional PDF certificate using React PDF (same as session-based endpoint)
    const { generateCertificate } = await import('./certificateGenerator.js');
    
    const certificateId = `LC-${targetUser.id}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    
    // Ensure completion date is valid
    const completionDate = completion.completedAt ? new Date(completion.completedAt) : new Date();
    if (isNaN(completionDate.getTime())) {
      console.warn('Invalid completion date, using current date as fallback');
      completionDate = new Date();
    }
    
    const certificateData = {
      userName: userDisplayName,
      completionDate: completionDate.toISOString(),
      certificateId: certificateId,
      userId: targetUser.id
    };

    console.log('Generating Firebase PDF certificate with data:', certificateData);
    
    try {
      // Generate PDF stream and convert to buffer
      const pdfStream = await generateCertificate(certificateData);
      const chunks = [];
      for await (const chunk of pdfStream) {
        chunks.push(chunk);
      }
      const pdfBuffer = Buffer.concat(chunks);
      
      // Update database to mark certificate as generated
      await updateCertificateGenerated(targetUser.id, true);
      
      // Set proper headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="LocalCooks-Certificate-${targetUser.username}-${certificateId}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      
      console.log('Firebase certificate PDF generated successfully, size:', pdfBuffer.length, 'bytes');
      console.log('Database updated: certificate_generated = true for user', targetUser.id);
      
      // Send the PDF buffer directly
      res.send(pdfBuffer);
      
    } catch (pdfError) {
      console.error('Error generating Firebase PDF certificate:', pdfError);
      
      // Fallback to JSON response if PDF generation fails
      const certificateUrl = `/api/microlearning/certificate/${targetUser.id}`;
      res.json({
        success: true,
        certificate: {
          userId: targetUser.id,
          firebaseUid: requestedUserId,
          completedAt: completion.completedAt,
          certificateUrl: certificateUrl,
          confirmed: completion.confirmed
        },
        error: 'PDF generation temporarily unavailable'
      });
    }
  } catch (error) {
    console.error('Error getting Firebase microlearning certificate:', error);
    res.status(500).json({ message: 'Failed to get certificate' });
  }
});
// Firebase-authenticated file upload endpoint
app.post("/api/firebase/upload-file", 
  requireFirebaseAuthWithUser,
  upload.single('file'), 
  async (req, res) => {
    try {
      console.log('🔄 === FIREBASE FILE UPLOAD DEBUG START ===');
      console.log('📤 Firebase Upload: User data:', {
        firebaseUid: req.firebaseUser?.uid,
        neonUserId: req.neonUser?.id,
        hasFile: !!req.file,
        fileDetails: req.file ? {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        } : null
      });
      
      const userId = req.neonUser.id;

      if (!req.file) {
        console.log('❌ Firebase Upload: No file in request');
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log('✅ Firebase Upload: File received successfully');

      const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
      console.log('🌍 Environment:', isProduction ? 'Production (Vercel)' : 'Development');
      
      let fileUrl;
      let fileName;

      if (isProduction) {
        // Upload to Vercel Blob in production
        try {
          console.log('☁️ Starting Vercel Blob upload...');
          // Import Vercel Blob
          const { put } = await import('@vercel/blob');
          
          const timestamp = Date.now();
          const documentType = req.file.fieldname || 'file';
          const ext = path.extname(req.file.originalname);
          const baseName = path.basename(req.file.originalname, ext);
          
          const filename = `${userId}_${documentType}_${timestamp}_${baseName}${ext}`;
          
          console.log('☁️ Uploading to Vercel Blob:', {
            filename,
            size: req.file.size,
            mimetype: req.file.mimetype
          });
          
          const blob = await put(filename, req.file.buffer, {
            access: 'public',
            contentType: req.file.mimetype,
          });
          
          console.log(`✅ File uploaded to Vercel Blob successfully: ${filename} -> ${blob.url}`);
          fileUrl = blob.url;
          fileName = filename;
        } catch (error) {
          console.error('❌ Error uploading to Vercel Blob:', error);
          return res.status(500).json({ 
            error: "File upload failed",
            details: "Failed to upload file to cloud storage"
          });
        }
      } else {
        // In development, return a local file path (note: file serving is limited in this environment)
        fileUrl = `/api/files/documents/${req.file.filename}`;
        fileName = req.file.filename;
        console.log('💻 Development upload - file saved locally:', {
          fileUrl,
          fileName
        });
      }

      // Return success response with file information
      const response = {
        success: true,
        url: fileUrl,
        fileName: fileName,
        size: req.file.size,
        type: req.file.mimetype
      };
      
      console.log('📤 Firebase Upload successful, returning response:', response);
      console.log('🔄 === FIREBASE FILE UPLOAD DEBUG END (SUCCESS) ===');
      
      return res.status(200).json(response);
    } catch (error) {
      console.error("❌ Firebase File upload error:", error);
      console.error("Error stack:", error.stack);
      
      // Clean up uploaded file on error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error('Error cleaning up file:', e);
        }
      }
      
      console.log('🔄 === FIREBASE FILE UPLOAD DEBUG END (ERROR) ===');
      return res.status(500).json({ 
        error: "File upload failed",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
);

// Enhanced Health Check
app.get('/api/firebase-health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'Enhanced Firebase Auth → Neon DB bridge is working',
    architecture: 'Hybrid: Stateless JWT + Legacy Session Support',
    auth: {
      firebaseConfigured: !!process.env.VITE_FIREBASE_PROJECT_ID,
      neonConfigured: !!process.env.DATABASE_URL,
      legacySessionsActive: true,
      enhancedFirebaseActive: !!firebaseAdmin
    }
  });
});

  // 🔥 Public Platform Settings Endpoint (for chefs to see service fee rate)
  app.get('/api/platform-settings/service-fee-rate', async (req, res) => {
    try {
      if (!pool) {
        return res.json({
          key: 'service_fee_rate',
          value: '0.05',
          rate: 0.05,
          percentage: '5.00',
          description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
        });
      }

      const result = await pool.query(
        'SELECT key, value, description FROM platform_settings WHERE key = $1 LIMIT 1',
        ['service_fee_rate']
      );
      
      if (result.rows.length > 0) {
        const setting = result.rows[0];
        const rate = parseFloat(setting.value);
        if (!isNaN(rate) && rate >= 0 && rate <= 1) {
          return res.json({
            key: 'service_fee_rate',
            value: setting.value,
            rate: rate,
            percentage: (rate * 100).toFixed(2),
            description: setting.description,
          });
        }
      }
      
      // Return default if not set
      return res.json({
        key: 'service_fee_rate',
        value: '0.05',
        rate: 0.05,
        percentage: '5.00',
        description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
      });
    } catch (error) {
      console.error('Error getting service fee rate:', error);
      res.status(500).json({
        error: 'Failed to get service fee rate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 🔥 Admin Platform Settings Endpoints
  // Get service fee rate (admin endpoint with full details)
  // NOTE: Admins use session-based auth, not Firebase auth
  // IMPORTANT: This endpoint MUST use session auth only - no Firebase tokens
  app.get('/api/admin/platform-settings/service-fee-rate', (req, res, next) => {
    // Explicitly log that we're using session auth for this endpoint
    console.log('📱 Platform settings GET: Using session auth only, ignoring any Authorization headers');
    // Delete any Firebase-related properties before middleware runs
    delete req.firebaseUser;
    // Note: Can't delete headers.authorization directly, but requireSessionAdmin ignores it
    requireSessionAdmin(req, res, next);
  }, async (req, res) => {
    try {
      if (!pool) {
        return res.json({
          key: 'service_fee_rate',
          value: '0.05',
          rate: 0.05,
          percentage: '5.00',
          description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
        });
      }

      const result = await pool.query(
        'SELECT key, value, description, updated_at, updated_by FROM platform_settings WHERE key = $1 LIMIT 1',
        ['service_fee_rate']
      );
      
      if (result.rows.length > 0) {
        const setting = result.rows[0];
        const rate = parseFloat(setting.value);
        if (!isNaN(rate) && rate >= 0 && rate <= 1) {
          return res.json({
            key: 'service_fee_rate',
            value: setting.value,
            rate: rate,
            percentage: (rate * 100).toFixed(2),
            description: setting.description,
            updatedAt: setting.updated_at,
          });
        }
      }
      
      // Return default if not set
      return res.json({
        key: 'service_fee_rate',
        value: '0.05',
        rate: 0.05,
        percentage: '5.00',
        description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
      });
    } catch (error) {
      console.error('Error getting service fee rate:', error);
      res.status(500).json({
        error: 'Failed to get service fee rate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update service fee rate
  // NOTE: Admins use session-based auth, not Firebase auth
  // IMPORTANT: This endpoint MUST use session auth only - no Firebase tokens
  app.put('/api/admin/platform-settings/service-fee-rate', (req, res, next) => {
    // Explicitly log that we're using session auth for this endpoint
    console.log('📱 Platform settings PUT: Using session auth only, ignoring any Authorization headers');
    // Delete any Firebase-related properties before middleware runs
    delete req.firebaseUser;
    // Note: Can't delete headers.authorization directly, but requireSessionAdmin ignores it
    requireSessionAdmin(req, res, next);
  }, async (req, res) => {
    try {
      if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
      }

      const { rate } = req.body;
      
      if (rate === undefined || rate === null) {
        return res.status(400).json({ error: 'Rate is required' });
      }
      
      const rateValue = typeof rate === 'string' ? parseFloat(rate) : rate;
      
      if (isNaN(rateValue) || rateValue < 0 || rateValue > 1) {
        return res.status(400).json({ error: 'Rate must be a number between 0 and 1 (e.g., 0.05 for 5%)' });
      }
      
      // Get current user ID from session (set by requireSessionAdmin middleware)
      const userId = req.neonUser?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      // Check if setting exists
      const existingResult = await pool.query(
        'SELECT * FROM platform_settings WHERE key = $1 LIMIT 1',
        ['service_fee_rate']
      );
      
      if (existingResult.rows.length > 0) {
        // Update existing
        const updateResult = await pool.query(
          `UPDATE platform_settings 
           SET value = $1, updated_by = $2, updated_at = now() 
           WHERE key = 'service_fee_rate' 
           RETURNING key, value, description, updated_at`,
          [rateValue.toString(), userId]
        );
        
        const updated = updateResult.rows[0];
        return res.json({
          key: 'service_fee_rate',
          value: updated.value,
          rate: rateValue,
          percentage: (rateValue * 100).toFixed(2),
          description: updated.description,
          updatedAt: updated.updated_at,
          message: 'Service fee rate updated successfully',
        });
      } else {
        // Create new
        const insertResult = await pool.query(
          `INSERT INTO platform_settings (key, value, description, updated_by) 
           VALUES ('service_fee_rate', $1, 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.', $2) 
           RETURNING key, value, description, updated_at`,
          [rateValue.toString(), userId]
        );
        
        const created = insertResult.rows[0];
        return res.json({
          key: 'service_fee_rate',
          value: created.value,
          rate: rateValue,
          percentage: (rateValue * 100).toFixed(2),
          description: created.description,
          updatedAt: created.updated_at,
          message: 'Service fee rate created successfully',
        });
      }
    } catch (error) {
      console.error('Error updating service fee rate:', error);
      res.status(500).json({
        error: 'Failed to update service fee rate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('🔥 Enhanced Firebase authentication routes added to existing API');
  console.log('✨ Hybrid architecture: Both session-based and Firebase JWT authentication available');
  console.log('📧 Email-based login now supported alongside username login');
  console.log('🚀 Hybrid endpoints: /api/hybrid/* support both auth methods');
  console.log('👥 Admin support: Both Firebase and session admins fully supported');
  console.log('🐛 Debug endpoints: /api/debug-login, /api/auth-status available for troubleshooting');
  console.log('⚙️ Admin platform settings endpoints registered successfully');

// Utility function to create admin user in Firebase (run once)
async function createAdminInFirebase() {
  try {
    const admin = require('firebase-admin');
    
    // Check if admin user exists in Firebase
    try {
      const adminUser = await admin.auth().getUserByEmail('admin@localcooks.com');
      console.log('Admin user already exists in Firebase:', adminUser.uid);
      return adminUser;
    } catch (error) {
      // User doesn't exist, create them
      console.log('Creating admin user in Firebase...');
      
      const adminUser = await admin.auth().createUser({
        email: 'admin@localcooks.com',
        password: 'localcooks',
        displayName: 'Admin',
        emailVerified: true,
      });
      
      // Set custom claims for admin role
      await admin.auth().setCustomUserClaims(adminUser.uid, {
        role: 'admin',
        isAdmin: true
      });
      
      console.log('Admin user created in Firebase:', adminUser.uid);
      return adminUser;
    }
  } catch (error) {
    console.error('Failed to create admin in Firebase:', error);
    throw error;
  }
}

// Hybrid Authentication - supports both session and Firebase
async function requireHybridAuth(req, res, next) {
  try {
    // Try Firebase auth first
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      try {
        await verifyFirebaseAuth(req, res, () => {});
        if (req.firebaseUser) {
          // Load Neon user from Firebase UID
          let neonUser = null;
          if (pool) {
            const result = await pool.query(
              'SELECT * FROM users WHERE firebase_uid = $1',
              [req.firebaseUser.uid]
            );
            neonUser = result.rows[0] || null;
          }
          
          if (neonUser) {
            req.user = {
              id: neonUser.id,
              username: neonUser.username,
              role: neonUser.role,
              authMethod: 'firebase'
            };
            req.neonUser = req.user; // For backward compatibility
            console.log(`🔥 Hybrid auth: Firebase user ${req.firebaseUser.uid} → Neon user ${neonUser.id}`);
            return next();
          }
        }
      } catch (firebaseError) {
        console.log('Firebase auth failed, trying session auth...');
      }
    }
    
    // Fallback to session auth
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    console.log('Checking session auth - userId:', sessionUserId, 'sessionId:', req.session.id);
    
    if (sessionUserId) {
      const user = await getUser(sessionUserId);
      console.log('Found user for session:', user ? `${user.id}:${user.username}:${user.role}` : 'null');
      
      if (user) {
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          authMethod: 'session'
        };
        req.neonUser = req.user; // For backward compatibility
        console.log(`📱 Hybrid auth: Session user ${user.id} (${user.username}, ${user.role})`);
        return next();
      }
    }
    
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please login with either Firebase or session authentication'
    });
  } catch (error) {
    console.error('Hybrid auth error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

// Hybrid Admin Authentication
async function requireHybridAdmin(req, res, next) {
  try {
    // First authenticate the user
    await new Promise((resolve, reject) => {
      requireHybridAuth(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Then check if they're an admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Admin access required',
        message: 'This endpoint requires admin privileges',
        userRole: req.user?.role || 'none'
      });
    }
    
    next();
  } catch (error) {
    console.error('Hybrid admin auth error:', error);
    return res.status(401).json({ 
      error: 'Authentication failed',
      message: 'Please login as an admin'
    });
  }
}

// Add this endpoint to manually sync admin to Firebase
app.post('/api/sync-admin-to-firebase', async (req, res) => {
  try {
    console.log('Sync admin endpoint called');
    console.log('Session data:', { 
      sessionId: req.session.id, 
      userId: req.session.userId,
      user: req.session.user 
    });
    console.log('Headers:', {
      'x-user-id': req.headers['x-user-id'],
      'authorization': req.headers.authorization ? 'present' : 'missing'
    });
    
    // Check if user is authenticated (session or Firebase)
    let authUser = null;
    
    // Try session auth first
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    console.log('Checking session authentication:', {
      sessionUserId,
      sessionId: req.session.id,
      headerUserId: req.headers['x-user-id']
    });
    
    if (sessionUserId) {
      const user = await getUser(sessionUserId);
      console.log('Found user:', user ? `${user.id}:${user.username}:${user.role}` : null);
      
      if (user && user.role === 'admin') {
        authUser = user;
        console.log('Authenticated via session:', user.username);
      } else if (user) {
        console.log('User found but not admin:', user.role);
      }
    } else {
      console.log('No session userId found');
    }
    
    // If no session auth, try Firebase (for future use)
    if (!authUser && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      try {
        await verifyFirebaseAuth(req, res, () => {});
        if (req.firebaseUser) {
          const result = await pool.query(
            'SELECT * FROM users WHERE firebase_uid = $1 AND role = $2',
            [req.firebaseUser.uid, 'admin']
          );
          if (result.rows.length > 0) {
            authUser = result.rows[0];
            console.log('Authenticated via Firebase:', authUser.username);
          }
        }
      } catch (firebaseError) {
        console.log('Firebase auth failed:', firebaseError.message);
      }
    }
    
    if (!authUser) {
      return res.status(401).json({ 
        error: 'Admin authentication required',
        message: 'Please login as an admin first',
        debug: {
          sessionUserId,
          sessionId: req.session.id,
          hasFirebaseAuth: !!req.headers.authorization
        }
      });
    }
    
    console.log('Creating admin in Firebase...');
    const firebaseUser = await createAdminInFirebase();
    
    // Update the admin user in Neon DB with Firebase UID
    if (pool) {
      console.log('Updating admin user with Firebase UID...');
      await pool.query(
        'UPDATE users SET firebase_uid = $1 WHERE id = $2',
        [firebaseUser.uid, authUser.id]
      );
    }
    
    res.json({ 
      success: true, 
      message: 'Admin user synced to Firebase',
      firebaseUid: firebaseUser.uid,
      email: 'admin@localcooks.com',
      neonUserId: authUser.id,
      username: authUser.username
    });
  } catch (error) {
    console.error('Error syncing admin to Firebase:', error);
    res.status(500).json({ 
      error: 'Failed to sync admin to Firebase',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Endpoint to help users find their login credentials
app.post('/api/find-login-info', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Search for user by email in applications table
    const result = await pool.query(`
      SELECT u.username, u.role, u.firebase_uid, a.email, a.full_name 
      FROM users u 
      JOIN applications a ON u.id = a.user_id 
      WHERE LOWER(a.email) = LOWER($1) 
      ORDER BY a.created_at DESC 
      LIMIT 1
    `, [email]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No account found with this email',
        suggestion: 'Try registering a new account or check if you used a different email'
      });
    }
    
    const userInfo = result.rows[0];
    
    const loginOptions = [
      {
        method: 'Firebase Login (Enhanced)',
        url: '/auth',
        credentials: `Email: ${userInfo.email} + your password`,
        available: !!userInfo.firebase_uid,
        description: 'Modern authentication with enhanced features'
      },
      {
        method: 'Email Login (Legacy)',
        url: '/auth',
        credentials: `Email: ${userInfo.email} + your password`,
        available: true,
        description: 'Traditional email/password login'
      },
      {
        method: 'Username Login (Legacy)', 
        url: '/auth',
        credentials: `Username: ${userInfo.username} + your password`,
        available: true,
        description: 'Username-based login'
      }
    ];
    
    if (userInfo.role === 'admin') {
      loginOptions.push({
        method: 'Admin Panel Login',
        url: '/admin/login',
        credentials: `Username: ${userInfo.username} + your password`,
        available: true,
        description: 'Direct admin panel access'
      });
    }
    
    res.json({
      found: true,
      username: userInfo.username,
      email: userInfo.email,
      name: userInfo.full_name,
      role: userInfo.role,
      firebaseEnabled: !!userInfo.firebase_uid,
      loginOptions
    });
    
  } catch (error) {
    console.error('Error finding login info:', error);
    res.status(500).json({ error: 'Failed to find login information' });
  }
});

// Hybrid User Profile Endpoint
app.get('/api/hybrid/user/profile', requireHybridAuth, async (req, res) => {
  try {
    // Get additional user data if available
    let applicationData = null;
    if (pool) {
      const appResult = await pool.query(
        'SELECT email, full_name, phone FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );
      applicationData = appResult.rows[0] || null;
    }
    
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        authMethod: req.user.authMethod,
        email: applicationData?.email || null,
        fullName: applicationData?.full_name || null,
        phone: applicationData?.phone || null
      },
      firebase: req.firebaseUser ? {
        uid: req.firebaseUser.uid,
        email: req.firebaseUser.email,
        emailVerified: req.firebaseUser.email_verified
      } : null
    });
  } catch (error) {
    console.error('Error getting hybrid user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});
// Hybrid Applications Endpoint
app.get('/api/hybrid/applications', requireHybridAuth, async (req, res) => {
  try {
    let applications = [];
    
    if (pool) {
      const result = await pool.query(
        'SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC',
        [req.user.id]
      );
      applications = result.rows;
    }
    
    res.json({
      applications,
      authMethod: req.user.authMethod,
      userId: req.user.id
    });
  } catch (error) {
    console.error('Error getting hybrid applications:', error);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});
// Hybrid Admin Dashboard Endpoint
app.get('/api/hybrid/admin/dashboard', requireHybridAdmin, async (req, res) => {
  try {
    let stats = {};
    
    if (pool) {
      // Get user statistics
      const userStats = await pool.query('SELECT role, COUNT(*) as count FROM users GROUP BY role');
      const appStats = await pool.query('SELECT status, COUNT(*) as count FROM applications GROUP BY status');
      
      stats = {
        users: userStats.rows.reduce((acc, row) => ({ ...acc, [row.role]: parseInt(row.count) }), {}),
        applications: appStats.rows.reduce((acc, row) => ({ ...acc, [row.status]: parseInt(row.count) }), {})
      };
    }
    
    res.json({
      admin: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        authMethod: req.user.authMethod
      },
      stats,
      message: `Welcome ${req.user.username}! You're authenticated via ${req.user.authMethod}.`
    });
  } catch (error) {
    console.error('Error getting hybrid admin dashboard:', error);
    res.status(500).json({ error: 'Failed to get admin dashboard data' });
  }
});
// Comprehensive Authentication Status Endpoint
app.get('/api/auth-status', async (req, res) => {
  try {
    const status = {
      session: null,
      firebase: null,
      hybrid: null,
      recommendations: []
    };
    
    // Check session auth
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    if (sessionUserId) {
      const user = await getUser(sessionUserId);
      if (user) {
        status.session = {
          authenticated: true,
          userId: user.id,
          username: user.username,
          role: user.role,
          firebaseUid: user.firebase_uid || null
        };
      }
    }
    
    // Check Firebase auth
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decodedToken = await verifyFirebaseToken(token);
        
        if (decodedToken) {
          status.firebase = {
            authenticated: true,
            uid: decodedToken.uid,
            email: decodedToken.email,
            emailVerified: decodedToken.email_verified
          };
          
          // Try to find linked Neon user
          if (pool) {
            const result = await pool.query(
              'SELECT * FROM users WHERE firebase_uid = $1',
              [decodedToken.uid]
            );
            if (result.rows.length > 0) {
              status.firebase.linkedNeonUser = {
                id: result.rows[0].id,
                username: result.rows[0].username,
                role: result.rows[0].role
              };
            }
          }
        }
      } catch (firebaseError) {
        status.firebase = { authenticated: false, error: firebaseError.message };
      }
    }
    
    // Determine hybrid status
    status.hybrid = {
      authenticated: !!(status.session?.authenticated || status.firebase?.authenticated),
      primaryMethod: status.firebase?.authenticated ? 'firebase' : 
                    status.session?.authenticated ? 'session' : null,
      bothAvailable: !!(status.session?.authenticated && status.firebase?.authenticated)
    };
    
    // Add recommendations
    if (!status.hybrid.authenticated) {
      status.recommendations.push({
        action: 'login',
        message: 'Please login using either /auth (modern) or /admin/login (admin)',
        urls: ['/auth', '/admin/login']
      });
    } else {
      if (status.session?.authenticated && !status.session.firebaseUid) {
        status.recommendations.push({
          action: 'sync-to-firebase',
          message: 'Sync your account to Firebase for enhanced features',
          url: '/api/sync-admin-to-firebase'
        });
      }
      
      if (status.firebase?.authenticated && !status.firebase.linkedNeonUser) {
        status.recommendations.push({
          action: 'sync-to-neon',
          message: 'Link your Firebase account to the database',
          url: '/api/firebase-sync-user'
        });
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      authStatus: status,
      availableEndpoints: {
        legacy: ['/api/login', '/api/admin-login', '/api/user'],
        firebase: ['/api/user/profile', '/api/firebase/*'],
        hybrid: ['/api/hybrid/user/profile', '/api/hybrid/applications', '/api/hybrid/admin/dashboard']
      }
    });
  } catch (error) {
    console.error('Error getting auth status:', error);
    res.status(500).json({ error: 'Failed to get authentication status' });
  }
});
// Debug endpoint for troubleshooting login issues
app.post('/api/debug-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('=== DEBUG LOGIN ===');
    console.log('Username:', username);
    console.log('Password length:', password ? password.length : 0);
    
    const debugInfo = {
      step1_input: { username, passwordProvided: !!password },
      step2_usernameLookup: null,
      step3_emailLookup: null,
      step4_passwordCheck: null,
      step5_finalResult: null
    };
    
    // Step 1: Try username lookup
    let user = await getUserByUsername(username);
    debugInfo.step2_usernameLookup = {
      found: !!user,
      userInfo: user ? { id: user.id, username: user.username, role: user.role } : null
    };
    
    // Step 2: If no user found by username, try email lookup
    if (!user && username.includes('@')) {
      console.log('Trying email lookup...');
      try {
        const emailResult = await pool.query(`
          SELECT u.* FROM users u 
          JOIN applications a ON u.id = a.user_id 
          WHERE LOWER(a.email) = LOWER($1) 
          ORDER BY a.created_at DESC 
          LIMIT 1
        `, [username]);
        
        if (emailResult.rows.length > 0) {
          user = emailResult.rows[0];
          debugInfo.step3_emailLookup = {
            found: true,
            userInfo: { id: user.id, username: user.username, role: user.role }
          };
        } else {
          debugInfo.step3_emailLookup = { found: false, reason: 'No user found with this email' };
        }
      } catch (emailError) {
        debugInfo.step3_emailLookup = { found: false, error: emailError.message };
      }
    }
    
    // Step 3: Check password if user found
    if (user && password) {
      try {
        const passwordMatch = await comparePasswords(password, user.password);
        debugInfo.step4_passwordCheck = {
          match: passwordMatch,
          storedPasswordLength: user.password ? user.password.length : 0
        };
        
        if (passwordMatch) {
          debugInfo.step5_finalResult = {
            success: true,
            userId: user.id,
            username: user.username,
            role: user.role
          };
        } else {
          debugInfo.step5_finalResult = { success: false, reason: 'Password mismatch' };
        }
      } catch (passwordError) {
        debugInfo.step4_passwordCheck = { error: passwordError.message };
      }
    } else if (!user) {
      debugInfo.step5_finalResult = { success: false, reason: 'User not found' };
    } else {
      debugInfo.step5_finalResult = { success: false, reason: 'No password provided' };
    }
    
    // Also check available users for reference
    const availableUsers = await pool.query('SELECT id, username, role FROM users ORDER BY id LIMIT 10');
    debugInfo.availableUsers = availableUsers.rows;
    
    // Check applications with emails
    const availableEmails = await pool.query('SELECT DISTINCT email, user_id FROM applications ORDER BY user_id LIMIT 10');
    debugInfo.availableEmails = availableEmails.rows;
    
    res.json(debugInfo);
  } catch (error) {
    console.error('Debug login error:', error);
    res.status(500).json({ error: 'Debug failed', message: error.message });
  }
});

// Quick admin test endpoint
app.get('/api/test-admin', async (req, res) => {
  try {
    // Check if admin user exists
    const admin = await getUserByUsername('admin');
    
    if (!admin) {
      return res.json({
        adminExists: false,
        message: 'Admin user not found in database'
      });
    }
    
    // Test password comparison
    const passwordWorks = await comparePasswords('localcooks', admin.password);
    
    res.json({
      adminExists: true,
      adminInfo: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        passwordLength: admin.password ? admin.password.length : 0
      },
      passwordTest: {
        works: passwordWorks,
        message: passwordWorks ? 'Password matches' : 'Password does not match'
      },
      hardcodedTest: 'localcooks' === 'localcooks' ? 'Hardcoded check passes' : 'Hardcoded check fails'
    });
  } catch (error) {
    console.error('Admin test error:', error);
    res.status(500).json({ error: 'Test failed', message: error.message });
  }
});

// Debug endpoint for session troubleshooting
app.get('/api/debug-session', (req, res) => {
  console.log('=== SESSION DEBUG ===');
  console.log('Session ID:', req.session.id);
  console.log('Session data:', JSON.stringify(req.session, null, 2));
  console.log('Cookies:', req.headers.cookie);
  console.log('User-Agent:', req.headers['user-agent']);
  
  res.json({
    sessionId: req.session.id,
    sessionData: req.session,
    cookies: req.headers.cookie,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
});

// Test endpoint to debug session persistence
app.get('/api/session-test', (req, res) => {
  const sessionCounter = req.session.counter || 0;
  req.session.counter = sessionCounter + 1;

  res.status(200).json({
    sessionId: req.session.id,
    counter: req.session.counter,
    userId: req.session.userId || null,
    isAuthenticated: !!req.session.userId,
    cookiePresent: !!req.headers.cookie
  });
});
// New Hybrid Login Endpoint - tries Firebase first, then NeonDB
app.post('/api/hybrid-login', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const loginIdentifier = email || username;

    console.log('=== HYBRID LOGIN ATTEMPT ===');
    console.log('Login identifier:', loginIdentifier);
    console.log('Has password:', !!password);
    console.log('Environment:', {
      hasFirebaseAdmin: !!firebaseAdmin,
      hasPool: !!pool,
      nodeEnv: process.env.NODE_ENV
    });

    if (!loginIdentifier || !password) {
      return res.status(400).json({ 
        error: 'Email/Username and password are required' 
      });
    }

    let authResult = null;
    let authMethod = null;
    let neonUser = null;

    // Step 1: Try Firebase Authentication (only if properly configured)
    if (email && firebaseAdmin) {
      try {
        console.log('🔥 Attempting Firebase authentication...');
        
        // Safely import Firebase Admin Auth
        let auth;
        try {
          const { getAuth } = await import('firebase-admin/auth');
          auth = getAuth(firebaseAdmin);
        } catch (importError) {
          console.warn('Firebase Admin Auth import failed:', importError.message);
          // Skip Firebase auth and continue to Neon auth
        }
        
        if (auth) {
          try {
            const firebaseUser = await auth.getUserByEmail(email);
            console.log('Firebase user found:', firebaseUser.uid);
            
            // Check if this Firebase user is linked to a Neon user
            if (pool) {
              const result = await pool.query(
                'SELECT * FROM users WHERE firebase_uid = $1',
                [firebaseUser.uid]
              );
              
              if (result.rows.length > 0) {
                const linkedUser = result.rows[0];
                console.log('Found linked Neon user for Firebase user');
                
                // Verify password against Neon database
                const passwordMatch = await comparePasswords(password, linkedUser.password);
                
                if (passwordMatch) {
                  console.log('✅ Firebase-linked user authenticated via Neon password');
                  authResult = {
                    firebaseUid: firebaseUser.uid,
                    email: firebaseUser.email,
                    emailVerified: firebaseUser.emailVerified
                  };
                  authMethod = 'firebase-neon-hybrid';
                  neonUser = linkedUser;
                } else {
                  console.log('❌ Password mismatch for Firebase-linked user');
                }
              }
            }
          } catch (firebaseUserError) {
            console.log('Firebase user lookup failed:', firebaseUserError.message);
            // This is expected if user doesn't exist in Firebase, continue to Neon auth
          }
        }
      } catch (firebaseError) {
        console.warn('Firebase authentication attempt failed:', firebaseError.message);
        // Continue to Neon authentication
      }
    } else {
      console.log('Skipping Firebase auth (not configured or no email provided)');
    }

    // Step 2: Try NeonDB authentication (always attempt this as fallback)
    if (!authResult) {
      console.log('🗃️ Attempting Neon database authentication...');
      
      if (!pool) {
        console.error('❌ No database connection available');
        return res.status(500).json({
          error: 'Database unavailable',
          message: 'Authentication service is temporarily unavailable'
        });
      }
      
      try {
        // First try to find user by username
        let user = await getUserByUsername(loginIdentifier);
        
        // If not found by username, try to find by email in applications table
        if (!user && loginIdentifier.includes('@')) {
          console.log('Trying email lookup in applications table...');
          try {
            const emailResult = await pool.query(`
              SELECT u.* FROM users u 
              JOIN applications a ON u.id = a.user_id 
              WHERE LOWER(a.email) = LOWER($1) 
              ORDER BY a.created_at DESC 
              LIMIT 1
            `, [loginIdentifier]);
            
            if (emailResult.rows.length > 0) {
              user = emailResult.rows[0];
              console.log('Found user by email in applications table:', user.username);
            }
          } catch (emailError) {
            console.error('Error searching by email:', emailError);
          }
        }
        
        if (user) {
          console.log('Found Neon user:', user.username);
          
          // Verify password
          const passwordMatch = await comparePasswords(password, user.password);
          
          if (passwordMatch) {
            console.log('✅ Neon database authentication successful');
            authResult = {
              userId: user.id,
              username: user.username,
              role: user.role
            };
            authMethod = 'neon-database';
            neonUser = user;
          } else {
            console.log('❌ Password mismatch for Neon user');
          }
        } else {
          console.log('❌ User not found in Neon database');
        }
      } catch (neonError) {
        console.error('❌ Neon database authentication error:', neonError);
        return res.status(500).json({
          error: 'Database error',
          message: 'Authentication service error'
        });
      }
    }

    // Step 3: Handle authentication result
    if (!authResult || !neonUser) {
      console.log('❌ Authentication failed on both Firebase and Neon');
      return res.status(401).json({ 
        error: 'Invalid credentials',
        message: 'Email/username or password is incorrect',
        debug: process.env.NODE_ENV === 'development' ? {
          triedFirebase: !!email && !!firebaseAdmin,
          triedNeon: true,
          identifier: loginIdentifier,
          hasPool: !!pool
        } : undefined
      });
    }

    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = neonUser;

    // Set session for compatibility - use user ID that works with existing endpoints
    const sessionUserId = neonUser.firebase_uid || neonUser.id.toString();
    req.session.userId = sessionUserId;
    req.session.user = userWithoutPassword;

    console.log('✅ Hybrid login successful:', {
      authMethod,
      userId: neonUser.id,
      username: neonUser.username,
      role: neonUser.role,
      sessionUserId: sessionUserId
    });

    // Save session
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({
          error: 'Session creation failed',
          message: 'Authentication succeeded but session creation failed'
        });
      }
      
      console.log('Session saved successfully for hybrid login:', {
        sessionId: req.session.id,
        userId: req.session.userId,
        username: userWithoutPassword.username
      });
      
      res.status(200).json({
        success: true,
        authMethod,
        user: {
          ...userWithoutPassword,
          authMethod
        },
        session: {
          userId: sessionUserId,
          sessionId: req.session.id
        },
        firebase: authResult.firebaseUid ? {
          uid: authResult.firebaseUid,
          email: authResult.email,
          emailVerified: authResult.emailVerified
        } : null,
        message: authMethod === 'firebase-neon-hybrid' 
          ? 'Authenticated via Firebase account linked to database'
          : 'Authenticated via database'
      });
    });

  } catch (error) {
    console.error('❌ Hybrid login error:', error);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({ 
      error: 'Login failed', 
      message: process.env.NODE_ENV === 'development' 
        ? error.message 
        : 'Internal server error during authentication',
      details: process.env.NODE_ENV === 'development' 
        ? {
            errorType: error.constructor.name,
            stack: error.stack
          } 
        : undefined
    });
  }
});

// Test endpoint to debug applications endpoint specifically
app.get('/api/test-applications-auth', async (req, res) => {
  try {
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    
    const result = {
      timestamp: new Date().toISOString(),
      authentication: {
        sessionUserId: req.session.userId || null,
        headerUserId: req.headers['x-user-id'] || null,
        resolvedUserId: sessionUserId || null,
        authenticated: !!sessionUserId
      },
      database: {
        hasPool: !!pool,
        userFound: false,
        applications: []
      }
    };
    
    if (sessionUserId) {
      // Test user lookup
      const user = await getUser(sessionUserId);
      if (user) {
        result.database.userFound = true;
        result.authentication.userDetails = {
          id: user.id,
          username: user.username,
          role: user.role,
          firebase_uid: user.firebase_uid
        };
        
        // Test applications query
        if (pool) {
          const appResult = await pool.query(
            'SELECT id, user_id, status, full_name, created_at FROM applications WHERE user_id = $1 ORDER BY created_at DESC',
            [user.id]
          );
          result.database.applications = appResult.rows;
          result.database.applicationsCount = appResult.rows.length;
        }
      } else {
        result.authentication.userNotFound = sessionUserId;
      }
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Test applications auth failed',
      message: error.message,
      stack: error.stack
    });
  }
});

// Simple test endpoint to check current authentication status
app.get('/api/test-auth', async (req, res) => {
  try {
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    
    const result = {
      authenticated: !!sessionUserId,
      sessionId: req.session.id,
      sessionUserId: req.session.userId || null,
      headerUserId: req.headers['x-user-id'] || null,
      hasSession: !!req.session.userId,
      hasHeader: !!req.headers['x-user-id'],
      hasCookies: !!req.headers.cookie,
      timestamp: new Date().toISOString()
    };
    
    if (sessionUserId) {
      const user = await getUser(sessionUserId);
      if (user) {
        result.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          firebase_uid: user.firebase_uid
        };
      } else {
        result.userNotFound = sessionUserId;
      }
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Test auth failed',
      message: error.message
    });
  }
});

// Debug endpoint to test hybrid login dependencies
app.get('/api/debug-hybrid-login', async (req, res) => {
  try {
    const debug = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hasFirebaseAdmin: !!firebaseAdmin,
        hasPool: !!pool,
        firebaseConfigExists: !!process.env.VITE_FIREBASE_PROJECT_ID
      },
      functions: {
        getUserByUsername: typeof getUserByUsername,
        comparePasswords: typeof comparePasswords,
      },
      dependencies: {}
    };

    // Test Firebase Admin import
    try {
      const { getAuth } = await import('firebase-admin/auth');
      debug.dependencies.firebaseAdminAuth = 'available';
      if (firebaseAdmin) {
        const auth = getAuth(firebaseAdmin);
        debug.dependencies.firebaseAuthInstance = 'created';
      }
    } catch (firebaseError) {
      debug.dependencies.firebaseAdminAuth = `error: ${firebaseError.message}`;
    }

    // Test database connection
    if (pool) {
      try {
        const result = await pool.query('SELECT COUNT(*) FROM users');
        debug.dependencies.database = `connected, ${result.rows[0].count} users`;
      } catch (dbError) {
        debug.dependencies.database = `error: ${dbError.message}`;
      }
    } else {
      debug.dependencies.database = 'not connected';
    }

    res.json(debug);
  } catch (error) {
    res.status(500).json({
      error: 'Debug endpoint failed',
      message: error.message,
      stack: error.stack
    });
  }
});
// Quick verification endpoint to test all auth methods still work
app.get('/api/verify-auth-methods', async (req, res) => {
  try {
    console.log('=== VERIFICATION: Testing all auth methods ===');
    
    const results = {
      timestamp: new Date().toISOString(),
      existingEndpoints: {},
      authMethods: {},
      recommendations: []
    };
    
    // Test 1: Check if admin user exists (for admin login)
    try {
      const admin = await getUserByUsername('admin');
      results.authMethods.adminLogin = {
        status: admin ? 'available' : 'needs_setup',
        endpoint: '/api/admin-login',
        credentials: admin ? 'admin/localcooks' : 'admin user not found',
        working: !!admin
      };
    } catch (error) {
      results.authMethods.adminLogin = {
        status: 'error',
        error: error.message
      };
    }
    
    // Test 2: Check if regular login endpoint is accessible
    results.existingEndpoints.regularLogin = {
      endpoint: '/api/login',
      status: 'available', 
      method: 'POST',
      description: 'Original email/username login - unchanged'
    };
    
    // Test 3: Check if user endpoint is accessible
    results.existingEndpoints.userEndpoint = {
      endpoint: '/api/user',
      status: 'available', 
      method: 'GET',
      description: 'Original session user endpoint - unchanged'
    };
    
    // Test 4: Check session functionality
    results.authMethods.sessionAuth = {
      status: req.session ? 'available' : 'unavailable',
      sessionId: req.session?.id || null,
      userId: req.session?.userId || null,
      working: !!req.session
    };
    
    // Test 5: Check Firebase admin availability
    results.authMethods.firebaseAdmin = {
      status: firebaseAdmin ? 'available' : 'not_configured',
      working: !!firebaseAdmin,
      note: firebaseAdmin ? 'Enhanced Firebase features available' : 'Firebase Admin SDK not configured'
    };
    
    // Test 6: List sample users for verification
    if (pool) {
      try {
        const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
        const sampleUsers = await pool.query('SELECT id, username, role FROM users LIMIT 5');
        
        results.authMethods.databaseAuth = {
          status: 'available',
          userCount: parseInt(userCount.rows[0].count),
          sampleUsers: sampleUsers.rows,
          working: true
        };
      } catch (dbError) {
        results.authMethods.databaseAuth = {
          status: 'error',
          error: dbError.message,
          working: false
        };
      }
    } else {
      results.authMethods.databaseAuth = {
        status: 'no_database',
        working: false
      };
    }
    
    const allWorking = 
      results.authMethods.adminLogin.working &&
      results.authMethods.sessionAuth.working &&
      results.authMethods.databaseAuth.working;
    
    results.overallStatus = allWorking ? 'all_systems_operational' : 'some_issues_detected';
    results.message = allWorking 
      ? '✅ All existing authentication methods are working properly'
      : '⚠️ Some authentication methods need attention';
    
    console.log('Verification results:', results);
    
    res.json(results);
  } catch (error) {
    console.error('Verification endpoint error:', error);
    res.status(500).json({ 
      error: 'Verification failed', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
// Password reset request endpoint - DEPRECATED: Use Firebase-based password reset instead
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    console.log(`🚨 DEPRECATED ENDPOINT CALLED: /api/auth/forgot-password for email: ${email}`);
    console.log(`🔄 Redirecting to Firebase-based password reset system`);

    // This endpoint is deprecated in favor of Firebase-based password reset
    // Return a helpful message directing users to the new system
    return res.status(400).json({ 
      message: "This password reset method is no longer supported. Please use the 'Forgot Password' button on the login page which uses our secure Firebase authentication system.",
      deprecated: true,
      redirectTo: "/auth"
    });

  } catch (error) {
    console.error("Error in deprecated forgot password:", error);
    return res.status(500).json({ 
      message: "This password reset method is no longer supported. Please use the login page to reset your password."
    });
  }
});
// Password reset confirmation endpoint
app.post("/api/auth/reset-password", async (req, res) => {
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
    const result = await pool.query(`
      SELECT u.* FROM users u 
      JOIN password_reset_tokens prt ON u.id = prt.user_id 
      WHERE prt.token = $1 AND prt.expires_at > NOW()
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    const user = result.rows[0];

    // Update password
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, user.id]);

    // Clear reset token
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    console.log(`Password successfully reset for user ${user.id}`);
    return res.status(200).json({ message: "Password reset successfully" });

  } catch (error) {
    console.error("Error in reset password:", error);
    return res.status(500).json({ 
      message: "Internal server error. Please try again later." 
    });
  }
});

// Email verification endpoint
app.post("/api/auth/send-verification-email", async (req, res) => {
  try {
    const { email, fullName } = req.body;

    if (!email || !fullName) {
      return res.status(400).json({ message: "Email and full name are required" });
    }

    // Generate verification token
    const crypto = await import('crypto');
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiry = new Date(Date.now() + 86400000); // 24 hours from now
    
    // Store verification token
    await pool.query(`
      INSERT INTO email_verification_tokens (email, token, expires_at, created_at) 
      VALUES ($1, $2, $3, NOW()) 
      ON CONFLICT (email) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()
    `, [email, verificationToken, verificationTokenExpiry]);

    // Generate verification URL
    const verificationUrl = `${process.env.BASE_URL || 'https://your-app.vercel.app'}/auth/verify-email?token=${verificationToken}`;

    // Send verification email
    const { sendEmail, generateEmailVerificationEmail } = await import('../server/email.js');
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

// Email verification confirmation endpoint
app.get("/api/auth/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: "Verification token is required" });
    }

    console.log(`📧 VERIFICATION ATTEMPT - Token: ${token.substring(0, 8)}...`);

    // Verify token and get email - using direct database query
    const result = await pool.query(
      'SELECT email FROM email_verification_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      console.log(`❌ VERIFICATION FAILED - Invalid or expired token`);
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    const { email } = result.rows[0];
    console.log(`✅ VERIFICATION TOKEN VALID - Email: ${email}`);

    // Mark user as verified in the database
    // Update both possible user records (by email as username and by actual email column if exists)
    const updateResult = await pool.query(
      'UPDATE users SET is_verified = true, updated_at = NOW() WHERE username = $1 OR email = $1',
      [email]
    );

    console.log(`📝 Updated ${updateResult.rowCount} user record(s) for email: ${email}`);

    // Clear verification token
    await pool.query('DELETE FROM email_verification_tokens WHERE token = $1', [token]);
    console.log(`🗑️ Cleared verification token for email: ${email}`);

    console.log(`✅ Email verified successfully: ${email}`);
    
    // Redirect to auth page with verification success and login prompt
    // The frontend will show a success message and prompt the user to log in
    // Determine subdomain based on user type (default to chef)
    const baseDomain = process.env.BASE_DOMAIN || 'localcooks.ca';
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? `https://chef.${baseDomain}`
      : (process.env.BASE_URL || 'http://localhost:5000');
    return res.redirect(`${baseUrl}/auth?verified=true&message=verification-success`);

  } catch (error) {
    console.error("❌ Error in email verification:", error);
    return res.status(500).json({ 
      message: "Internal server error. Please try again later." 
    });
  }
});

// Check if user exists by email in both Firebase and NeonDB
app.post('/api/check-user-exists', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // SECURITY FIX: Don't reveal whether an email exists or not
    // This prevents attackers from enumerating valid email addresses
    console.log(`🔒 Email existence check requested for: ${email} (response: always available)`);
    
    // Always return that the email is available for registration
    // This prevents email enumeration attacks while still allowing registration flow
    return res.json({
      email,
      canRegister: true,
      status: 'available',
      message: 'Email is available for registration',
      firebase: {
        exists: false,
        user: null,
        error: null
      },
      neon: {
        exists: false,
        user: null
      },
      suggestion: 'Email is available for registration.'
    });
  } catch (error) {
    console.error('❌ Error in email existence check:', error);
    res.status(500).json({ 
      error: 'Failed to process request', 
      message: 'An error occurred while processing your request' 
    });
  }
});

// Debug endpoint to check if email exists in Firebase
app.post('/api/debug/check-firebase-user', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Check if Firebase Admin is available
    const admin = await import('firebase-admin');
    if (!admin.default.apps.length) {
      // Try to initialize with VITE variables
      const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
      if (projectId) {
        try {
          admin.default.initializeApp({
            projectId: projectId,
          });
        } catch (e) {
          return res.status(500).json({ 
            error: 'Firebase Admin not configured',
            message: 'Cannot check Firebase users'
          });
        }
      } else {
        return res.status(500).json({ 
          error: 'Firebase Admin not configured',
          message: 'Cannot check Firebase users'
        });
      }
    }

    try {
      // Try to get user by email
      const userRecord = await admin.default.auth().getUserByEmail(email);
      
      return res.json({
        exists: true,
        user: {
          uid: userRecord.uid,
          email: userRecord.email,
          emailVerified: userRecord.emailVerified,
          disabled: userRecord.disabled,
          metadata: {
            creationTime: userRecord.metadata.creationTime,
            lastSignInTime: userRecord.metadata.lastSignInTime
          }
        },
        suggestion: 'User exists in Firebase. You can either use a different email or delete this user.'
      });
    } catch (firebaseError) {
      if (firebaseError.code === 'auth/user-not-found') {
        return res.json({
          exists: false,
          message: 'User does not exist in Firebase',
          suggestion: 'Email should be available for registration'
        });
      } else {
        throw firebaseError;
      }
    }
  } catch (error) {
    console.error('Error checking Firebase user:', error);
    res.status(500).json({ 
      error: 'Failed to check user', 
      message: error.message 
    });
  }
});

// Debug endpoint to delete user from Firebase (use with caution)
app.post('/api/debug/delete-firebase-user', async (req, res) => {
  try {
    const { email, confirmDelete } = req.body;
    
    if (!email || !confirmDelete) {
      return res.status(400).json({ 
        error: 'Email and confirmDelete=true required',
        message: 'This endpoint requires explicit confirmation'
      });
    }

    // Check if Firebase Admin is available
    const admin = await import('firebase-admin');
    if (!admin.default.apps.length) {
      // Try to initialize with VITE variables
      const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
      if (projectId) {
        try {
          admin.default.initializeApp({
            projectId: projectId,
          });
        } catch (e) {
          return res.status(500).json({ 
            error: 'Firebase Admin not configured',
            message: 'Cannot delete Firebase users'
          });
        }
      } else {
        return res.status(500).json({ 
          error: 'Firebase Admin not configured',
          message: 'Cannot delete Firebase users'
        });
      }
    }

    try {
      // Get user first
      const userRecord = await admin.default.auth().getUserByEmail(email);
      
      // Delete user
      await admin.default.auth().deleteUser(userRecord.uid);
      
      console.log(`Deleted Firebase user: ${email} (${userRecord.uid})`);
      
      return res.json({
        success: true,
        message: `User ${email} deleted from Firebase`,
        deletedUid: userRecord.uid
      });
    } catch (firebaseError) {
      if (firebaseError.code === 'auth/user-not-found') {
        return res.json({
          success: true,
          message: 'User did not exist in Firebase',
          alreadyDeleted: true
        });
      } else {
        throw firebaseError;
      }
    }
  } catch (error) {
    console.error('Error deleting Firebase user:', error);
    res.status(500).json({ 
      error: 'Failed to delete user', 
      message: error.message 
    });
  }
});

// Manual email verification sync endpoint
app.post('/api/sync-verification-status', async (req, res) => {
  try {
    // Verify Firebase token for security
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No auth token provided' 
      });
    }

    const token = authHeader.substring(7);
    const decodedToken = await verifyFirebaseToken(token);

    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid auth token' 
      });
    }

    const uid = decodedToken.uid;
    const email = decodedToken.email;
    const emailVerified = decodedToken.email_verified;
    
    console.log(`🔄 MANUAL VERIFICATION SYNC requested for ${email} (${uid})`);
    console.log(`   - Firebase emailVerified: ${emailVerified}`);
    
    // Force sync the user's verification status
    const syncResult = await syncFirebaseUser(uid, email, emailVerified, null, null, null);
    
    if (syncResult.success) {
      console.log(`✅ MANUAL VERIFICATION SYNC completed for ${email}`);
      
      res.json({
        success: true,
        message: 'Verification status synced successfully',
        user: syncResult.user,
        firebaseVerified: emailVerified,
        databaseVerified: syncResult.user.is_verified
      });
    } else {
      console.error(`❌ MANUAL VERIFICATION SYNC failed for ${email}:`, syncResult.error);
      res.status(500).json({
        error: 'Verification sync failed',
        message: syncResult.error
      });
    }
  } catch (error) {
    console.error('❌ Error in sync-verification-status:', error);
    res.status(500).json({ 
      error: 'Verification sync failed', 
      message: error.message 
    });
  }
});

// Test email deliverability endpoint
app.post("/api/test-email-delivery", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        message: "Email address is required" 
      });
    }

    console.log('🧪 Testing email delivery to:', email);

    // Import the email functions
    const { sendEmail } = await import('../server/email.js');

    const testEmailContent = {
      to: email,
      subject: 'Email Delivery Test - Local Cooks',
      html: `
        <h2>Email Delivery Test</h2>
        <p>This is a simple test email to verify email delivery is working.</p>
        <p>If you received this email, your email system is functioning correctly.</p>
        <p>Time: ${new Date().toISOString()}</p>
        <p>From: Local Cooks Community</p>
      `,
      text: `
Email Delivery Test

This is a simple test email to verify email delivery is working.
If you received this email, your email system is functioning correctly.

Time: ${new Date().toISOString()}
From: Local Cooks Community
      `
    };

    console.log('📧 Email configuration check:', {
      hasEmailUser: !!process.env.EMAIL_USER,
      hasEmailPass: !!process.env.EMAIL_PASS,
      hasEmailFrom: !!process.env.EMAIL_FROM,
      emailHost: process.env.EMAIL_HOST,
      emailPort: process.env.EMAIL_PORT,
      emailUser: process.env.EMAIL_USER ? process.env.EMAIL_USER.substring(0, 5) + '***' : 'NOT SET'
    });

    const emailSent = await sendEmail(testEmailContent, {
      trackingId: `test_delivery_${Date.now()}`
    });

    if (emailSent) {
      console.log('✅ Test email sent successfully to:', email);
      return res.status(200).json({ 
        message: "Test email sent successfully",
        email: email,
        timestamp: new Date().toISOString(),
        note: "Check your inbox, promotions, and spam folders"
      });
    } else {
      console.error('❌ Test email failed to send to:', email);
      return res.status(500).json({ 
        message: "Failed to send test email - check email configuration" 
      });
    }
  } catch (error) {
    console.error("❌ Error sending test email:", error);
    return res.status(500).json({ 
      message: "Error sending test email",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
// Test welcome email using working status change function
app.post("/api/test-welcome-as-status", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        message: "Email address is required" 
      });
    }

    console.log('🧪 Testing welcome email using STATUS CHANGE function (that works):', email);

    // Import the proper welcome email function
    const { sendEmail, generateWelcomeEmail } = await import('../server/email.js');

    // Use the proper welcome email function
    const emailContent = generateWelcomeEmail({
      fullName: email.split('@')[0],
      email: email
    });
    
    const emailSent = await sendEmail(emailContent, {
      trackingId: `test_welcome_as_status_${Date.now()}`
    });

    if (emailSent) {
      return res.status(200).json({ 
        message: "Test welcome email sent using proper welcome function",
        email: email,
        subject: emailContent.subject
      });
    } else {
      return res.status(500).json({ 
        message: "Failed to send test email - check email configuration" 
      });
    }
  } catch (error) {
    console.error("Error sending test welcome email:", error);
    return res.status(500).json({ 
      message: "Error sending test email",
      error: error.message 
    });
  }
});
// COMPARISON TEST: Send both working status email and registration email simultaneously
app.post("/api/test-email-comparison", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        message: "Email address is required" 
      });
    }

    console.log('🆚 COMPARISON TEST: Sending both email types to:', email);

    const results = {
      applicationEmail: null,
      registrationEmail: null
    };

    // Import email functions
    const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

    // Test 1: Send WORKING application status email (this should work)
    try {
      console.log('📧 TEST 1: Sending WORKING application status email...');
      const statusEmailContent = generateStatusChangeEmail({
        fullName: email.split('@')[0],
        email: email,
        status: 'approved'
      });

      const statusEmailSent = await sendEmail(statusEmailContent, {
        trackingId: `test_status_${Date.now()}`
      });

      results.applicationEmail = {
        success: statusEmailSent,
        subject: statusEmailContent.subject,
        messageId: `test_status_${Date.now()}`,
        note: "This is the WORKING application email type"
      };

      console.log('✅ TEST 1 COMPLETE: Application status email sent');
    } catch (error) {
      results.applicationEmail = { error: error.message };
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 2: Send registration welcome email (proper function)
    try {
      console.log('📧 TEST 2: Sending registration welcome email (proper function)...');
      const welcomeEmailContent = generateWelcomeEmail({
        fullName: email.split('@')[0],
        email: email
      });

      const welcomeEmailSent = await sendEmail(welcomeEmailContent, {
        trackingId: `test_welcome_${Date.now()}`
      });

      results.registrationEmail = {
        success: welcomeEmailSent,
        subject: welcomeEmailContent.subject,
        messageId: `test_welcome_${Date.now()}`,
        note: "This is the proper welcome email function"
      };

      console.log('✅ TEST 2 COMPLETE: Registration welcome email sent');
    } catch (error) {
      results.registrationEmail = { error: error.message };
    }

    return res.status(200).json({ 
      message: "Email comparison test complete - Check which emails you receive",
      email: email,
      results: results,
      instructions: "The application email should arrive, but the registration email might not. This will help us identify the exact difference."
    });

  } catch (error) {
    console.error("Error in email comparison test:", error);
    return res.status(500).json({ 
      message: "Comparison test failed",
      error: error.message 
    });
  }
});

// FINAL TEST: Send registration email with EXACT same subject as working emails
app.post("/api/test-identical-subject", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        message: "Email address is required" 
      });
    }

    console.log('🎯 IDENTICAL SUBJECT TEST: Using exact working subject line');

    // Import email functions
    const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

    // Generate using the exact same pattern as working emails
    const emailContent = generateStatusChangeEmail({
      fullName: email.split('@')[0],
      email: email,
      status: 'approved'
    });

    // DON'T change the subject at all - use the exact working subject
    console.log(`📧 Using EXACT working subject: "${emailContent.subject}"`);

    const emailSent = await sendEmail(emailContent, {
      trackingId: `identical_test_${Date.now()}`
    });

    if (emailSent) {
      return res.status(200).json({ 
        message: "Test email sent with IDENTICAL subject as working emails",
        email: email,
        subject: emailContent.subject,
        note: "This should definitely arrive since it's identical to working application emails"
      });
    } else {
      return res.status(500).json({ 
        message: "Failed to send test email" 
      });
    }
  } catch (error) {
    console.error("Error in identical subject test:", error);
    return res.status(500).json({ 
      message: "Test failed",
      error: error.message 
    });
  }
});

// TIMING TEST: Send registration email with 5-minute delay
app.post("/api/test-delayed-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        message: "Email address is required" 
      });
    }

    console.log('⏰ TIMING TEST: Scheduling delayed email for:', email);

    // Import email functions
    const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

    // Generate the email content
    const emailContent = generateStatusChangeEmail({
      fullName: email.split('@')[0],
      email: email,
      status: 'approved'
    });

    // Schedule email to be sent in 5 minutes
    setTimeout(async () => {
      try {
        console.log('📧 DELAYED SEND: Now sending email after 5-minute delay...');
        const emailSent = await sendEmail(emailContent, {
          trackingId: `delayed_test_${Date.now()}`
        });

        if (emailSent) {
          console.log('✅ DELAYED EMAIL SENT SUCCESSFULLY');
        } else {
          console.log('❌ DELAYED EMAIL FAILED');
        }
      } catch (error) {
        console.error('❌ Error sending delayed email:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return res.status(200).json({ 
      message: "Email scheduled for delivery in 5 minutes",
      email: email,
      subject: emailContent.subject,
      scheduledFor: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      note: "Check your email in 5 minutes to see if timing affects delivery"
    });

  } catch (error) {
    console.error("Error in delayed email test:", error);
    return res.status(500).json({ 
      message: "Delayed email test failed",
      error: error.message 
    });
  }
});
// COMPREHENSIVE DIAGNOSTIC: Test all theories about email delivery failure
app.post("/api/comprehensive-email-diagnostic", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        message: "Email address is required" 
      });
    }

    console.log('🔬 COMPREHENSIVE DIAGNOSTIC for:', email);

    const results = {
      emailAnalysis: {},
      tests: []
    };

    // Analyze the email address for potential issues
    results.emailAnalysis = {
      email: email,
      domain: email.split('@')[1],
      localPart: email.split('@')[0],
      hasMultipleDots: email.split('@')[0].includes('.'),
      dotCount: (email.split('@')[0].match(/\./g) || []).length,
      hasSubdomainLike: email.includes('loco') || email.includes('test') || email.includes('temp'),
      isGmail: email.includes('@gmail.com'),
      potentialSpamTriggers: []
    };

    // Check for potential spam triggers
    if (results.emailAnalysis.hasMultipleDots) {
      results.emailAnalysis.potentialSpamTriggers.push('Multiple dots in local part');
    }
    if (results.emailAnalysis.hasSubdomainLike) {
      results.emailAnalysis.potentialSpamTriggers.push('Contains subdomain-like patterns');
    }
    if (results.emailAnalysis.localPart.length > 20) {
      results.emailAnalysis.potentialSpamTriggers.push('Long local part');
    }

    // Import email functions
    const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

    // Test 1: Standard application email (should work)
    try {
      console.log('🧪 TEST 1: Standard application email...');
      const appEmailContent = generateStatusChangeEmail({
        fullName: email.split('@')[0].replace(/\./g, ' '),
        email: email,
        status: 'approved'
      });

      const appEmailSent = await sendEmail(appEmailContent, {
        trackingId: `diagnostic_app_${Date.now()}`
      });

      results.tests.push({
        test: 'Standard Application Email',
        success: appEmailSent,
        subject: appEmailContent.subject,
        note: 'This should work - same as working application emails'
      });
    } catch (error) {
      results.tests.push({
        test: 'Standard Application Email',
        success: false,
        error: error.message
      });
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: Registration-style email with different subject
    try {
      console.log('🧪 TEST 2: Registration email with custom subject...');
      const regEmailContent = generateStatusChangeEmail({
        fullName: email.split('@')[0].replace(/\./g, ' '),
        email: email,
        status: 'approved'
      });

      // Change to registration-style subject
      regEmailContent.subject = 'Welcome to Local Cooks Community';

      const regEmailSent = await sendEmail(regEmailContent, {
        trackingId: `diagnostic_reg_${Date.now()}`
      });

      results.tests.push({
        test: 'Registration Style Subject',
        success: regEmailSent,
        subject: regEmailContent.subject,
        note: 'Testing if registration-style subjects are filtered'
      });
    } catch (error) {
      results.tests.push({
        test: 'Registration Style Subject',
        success: false,
        error: error.message
      });
    }

    // Test 3: Simple test email to a clean address (if provided)
    const cleanEmail = email.replace(/\./g, '').replace(/loco/g, 'test') + '@gmail.com';
    if (cleanEmail !== email && cleanEmail.includes('@gmail.com')) {
      try {
        console.log('🧪 TEST 3: Clean email address test...');
        const cleanEmailContent = generateStatusChangeEmail({
          fullName: 'Test User',
          email: cleanEmail,
          status: 'approved'
        });

        const cleanEmailSent = await sendEmail(cleanEmailContent, {
          trackingId: `diagnostic_clean_${Date.now()}`
        });

        results.tests.push({
          test: 'Clean Email Address',
          success: cleanEmailSent,
          subject: cleanEmailContent.subject,
          email: cleanEmail,
          note: 'Testing if email address pattern affects delivery'
        });
      } catch (error) {
        results.tests.push({
          test: 'Clean Email Address',
          success: false,
          error: error.message
        });
      }
    }

    return res.status(200).json({ 
      message: "Comprehensive diagnostic complete",
      originalEmail: email,
      analysis: results.emailAnalysis,
      tests: results.tests,
      recommendations: generateRecommendations(results.emailAnalysis),
      instructions: "Check your email(s) to see which tests delivered successfully"
    });

  } catch (error) {
    console.error("Error in comprehensive diagnostic:", error);
    return res.status(500).json({ 
      message: "Diagnostic failed",
      error: error.message 
    });
  }
});

// Generate recommendations based on email analysis
function generateRecommendations(analysis) {
  const recommendations = [];
  
  if (analysis.potentialSpamTriggers.length > 0) {
    recommendations.push('Consider testing with a simpler email address (fewer dots, no subdomain-like patterns)');
  }
  
  if (analysis.hasMultipleDots) {
    recommendations.push('Email has multiple dots - Gmail might treat this as an alias or suspicious pattern');
  }
  
  if (analysis.hasSubdomainLike) {
    recommendations.push('Email contains subdomain-like patterns that might trigger spam filters');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('Email address appears clean - issue likely related to timing or context');
  }
  
  return recommendations;
}

// Serve the email testing page
app.get("/test-subject", (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <title>Gmail OAuth Email Filtering Test</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .test-section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; }
        button { padding: 10px 20px; margin: 10px 0; background: #007bff; color: white; border: none; cursor: pointer; }
        button:hover { background: #0056b3; }
        .result { margin: 10px 0; padding: 10px; background: #f8f9fa; border-left: 4px solid #007bff; }
        .warning { background: #fff3cd; border-left-color: #ffc107; }
        .success { background: #d4edda; border-left-color: #28a745; }
    </style>
</head>
<body>
    <h1>🎯 Gmail OAuth Email Filtering Test</h1>
    <p>Testing different theories about why registration emails aren't being delivered.</p>
    
    <div class="test-section">
        <h3>Theory 1: Subject Line Filtering</h3>
        <p>Send with IDENTICAL subject as working application emails.</p>
        <input type="email" id="email1" placeholder="Your email address" value="satyajit.debnath.loco@gmail.com" style="width: 300px; padding: 8px; margin: 10px 0;">
        <br>
        <button onclick="testIdenticalSubject()">Test Identical Subject</button>
        <div id="result1"></div>
    </div>

    <div class="test-section">
        <h3>Theory 2: OAuth Context Filtering</h3>
        <p>Send the same email but from a standalone context (not during OAuth registration).</p>
        <input type="email" id="email2" placeholder="Your email address" value="satyajit.debnath.loco@gmail.com" style="width: 300px; padding: 8px; margin: 10px 0;">
        <br>
        <button onclick="testStandaloneContext()">Test Standalone Context</button>
        <div id="result2"></div>
    </div>

    <div class="test-section">
        <h3>Theory 3: Rate Limiting</h3>
        <p>Test if multiple emails to the same address are being rate limited.</p>
        <input type="email" id="email3" placeholder="Your email address" value="satyajit.debnath.loco@gmail.com" style="width: 300px; padding: 8px; margin: 10px 0;">
        <br>
        <button onclick="testRateLimiting()">Test Rate Limiting</button>
        <div id="result3"></div>
    </div>

    <div class="test-section">
        <h3>Theory 4: Different Email Address</h3>
        <p>Test with a completely different email address to rule out address-specific filtering.</p>
        <input type="email" id="email4" placeholder="Different email address" style="width: 300px; padding: 8px; margin: 10px 0;">
        <br>
        <button onclick="testDifferentAddress()">Test Different Address</button>
        <div id="result4"></div>
    </div>

    <div class="test-section">
        <h3>🔬 Comprehensive Diagnostic</h3>
        <p>Run all tests and analyze the email address for potential spam triggers.</p>
        <input type="email" id="email5" placeholder="Email to analyze" value="satyajit.debnath.loco@gmail.com" style="width: 300px; padding: 8px; margin: 10px 0;">
        <br>
        <button onclick="runComprehensiveDiagnostic()">Run Full Diagnostic</button>
        <div id="result5"></div>
    </div>

    <script>
        async function testIdenticalSubject() {
            await runTest('email1', 'result1', '/api/test-identical-subject', 'Testing identical subject line...');
        }

        async function testStandaloneContext() {
            const email = document.getElementById('email2').value;
            const resultDiv = document.getElementById('result2');
            
            if (!email) {
                resultDiv.innerHTML = '<div class="result warning">Please enter an email address</div>';
                return;
            }

            resultDiv.innerHTML = '<div class="result">🔄 Testing standalone context...</div>';

            try {
                // This simulates sending the registration email but NOT during OAuth
                const response = await fetch('/api/test-identical-subject', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        email: email,
                        context: 'standalone_test' 
                    })
                });

                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.innerHTML = \`
                        <div class="result success">
                            ✅ <strong>Standalone test sent!</strong><br>
                            Email: \${email}<br>
                            Subject: \${data.subject}<br>
                            Context: Standalone (not during OAuth)<br><br>
                            <strong>Check your email!</strong>
                        </div>
                    \`;
                } else {
                    resultDiv.innerHTML = \`
                        <div class="result warning">
                            ❌ <strong>Test failed:</strong><br>
                            \${data.message}
                        </div>
                    \`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`
                    <div class="result warning">
                        ❌ <strong>Error:</strong><br>
                        \${error.message}
                    </div>
                \`;
            }
        }

        async function testRateLimiting() {
            await runTest('email3', 'result3', '/api/test-identical-subject', 'Testing rate limiting...');
        }

        async function testDifferentAddress() {
            await runTest('email4', 'result4', '/api/test-identical-subject', 'Testing different email address...');
        }

        async function runComprehensiveDiagnostic() {
            const email = document.getElementById('email5').value;
            const resultDiv = document.getElementById('result5');
            
            if (!email) {
                resultDiv.innerHTML = '<div class="result warning">Please enter an email address</div>';
                return;
            }

            resultDiv.innerHTML = '<div class="result">🔬 Running comprehensive diagnostic...</div>';

            try {
                const response = await fetch('/api/comprehensive-email-diagnostic', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email: email })
                });

                const data = await response.json();
                
                if (response.ok) {
                    let analysisHtml = \`
                        <div class="result success">
                            <h4>📊 Email Analysis for: \${data.originalEmail}</h4>
                            <p><strong>Domain:</strong> \${data.analysis.domain}</p>
                            <p><strong>Local Part:</strong> \${data.analysis.localPart}</p>
                            <p><strong>Dots in Local Part:</strong> \${data.analysis.dotCount}</p>
                            <p><strong>Potential Spam Triggers:</strong> \${data.analysis.potentialSpamTriggers.length > 0 ? data.analysis.potentialSpamTriggers.join(', ') : 'None detected'}</p>
                            
                            <h4>🧪 Test Results:</h4>
                    \`;

                    data.tests.forEach(test => {
                        analysisHtml += \`
                            <div style="margin: 10px 0; padding: 10px; background: \${test.success ? '#d4edda' : '#f8d7da'}; border-radius: 4px;">
                                <strong>\${test.test}:</strong> \${test.success ? '✅ Success' : '❌ Failed'}<br>
                                \${test.subject ? \`<em>Subject: \${test.subject}</em><br>\` : ''}
                                \${test.email ? \`<em>Email: \${test.email}</em><br>\` : ''}
                                <small>\${test.note || test.error || ''}</small>
                            </div>
                        \`;
                    });

                    analysisHtml += \`
                            <h4>💡 Recommendations:</h4>
                            <ul>
                    \`;

                    data.recommendations.forEach(rec => {
                        analysisHtml += \`<li>\${rec}</li>\`;
                    });

                    analysisHtml += \`
                            </ul>
                            <p><strong>Now check your email(s) to see which tests delivered!</strong></p>
                        </div>
                    \`;

                    resultDiv.innerHTML = analysisHtml;
                } else {
                    resultDiv.innerHTML = \`
                        <div class="result warning">
                            ❌ <strong>Diagnostic failed:</strong><br>
                            \${data.message}
                        </div>
                    \`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`
                    <div class="result warning">
                        ❌ <strong>Error:</strong><br>
                        \${error.message}
                    </div>
                \`;
            }
        }

        async function runTest(emailId, resultId, endpoint, loadingMessage) {
            const email = document.getElementById(emailId).value;
            const resultDiv = document.getElementById(resultId);
            
            if (!email) {
                resultDiv.innerHTML = '<div class="result warning">Please enter an email address</div>';
                return;
            }

            resultDiv.innerHTML = \`<div class="result">🔄 \${loadingMessage}</div>\`;

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email: email })
                });

                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.innerHTML = \`
                        <div class="result success">
                            ✅ <strong>Test sent successfully!</strong><br>
                            Email: \${email}<br>
                            Subject: \${data.subject}<br>
                            <em>\${data.note || 'Test completed'}</em><br><br>
                            <strong>Now check your email inbox!</strong>
                        </div>
                    \`;
                } else {
                    resultDiv.innerHTML = \`
                        <div class="result warning">
                            ❌ <strong>Test failed:</strong><br>
                            \${data.message}
                        </div>
                    \`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`
                    <div class="result warning">
                        ❌ <strong>Error:</strong><br>
                        \${error.message}
                    </div>
                \`;
            }
        }
    </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});
// DIAGNOSTIC: Test Google OAuth registration flow step by step
app.post("/api/debug-google-registration", async (req, res) => {
  try {
    const { email, displayName } = req.body;

    if (!email) {
      return res.status(400).json({ 
        message: "Email address is required" 
      });
    }

    const testResults = {
      step1_userCheck: null,
      step2_emailGeneration: null,
      step3_emailSending: null,
      step4_comparison: null
    };

    console.log('🔍 DIAGNOSTIC: Testing Google OAuth registration flow for:', email);

    // Step 1: Check if user exists in database
    try {
      if (pool) {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [email]);
        testResults.step1_userCheck = {
          userExists: userResult.rows.length > 0,
          userData: userResult.rows[0] || null
        };
      } else {
        testResults.step1_userCheck = {
          userExists: false,
          userData: null,
          note: "Using in-memory storage"
        };
      }
    } catch (error) {
      testResults.step1_userCheck = { error: error.message };
    }

    // Step 2: Test welcome email generation
    try {
      const { generateWelcomeEmail } = await import('../server/email.js');
      const emailContent = generateWelcomeEmail({
        fullName: displayName || email.split('@')[0],
        email: email
      });
      
      testResults.step2_emailGeneration = {
        success: true,
        subject: emailContent.subject,
        hasHtml: !!emailContent.html,
        hasText: !!emailContent.text,
        to: emailContent.to
      };
    } catch (error) {
      testResults.step2_emailGeneration = { error: error.message };
    }

    // Step 3: Test email configuration (using main email system)
    try {
      const { sendEmail } = await import('../server/email.js');
      
      testResults.step3_emailSending = {
        configValid: !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS),
        config: {
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          user: process.env.EMAIL_USER ? `${process.env.EMAIL_USER.substring(0, 5)}...` : null
        },
        note: "Using main email system from server/email.js"
      };
    } catch (error) {
      testResults.step3_emailSending = { error: error.message };
    }

    // Step 4: Compare with working status email
    try {
      const { generateStatusChangeEmail } = await import('../server/email.js');
      const statusEmail = generateStatusChangeEmail({
        fullName: displayName || email.split('@')[0],
        email: email,
        status: 'approved'
      });
      
      const { generateWelcomeEmail } = await import('../server/email.js');
      const welcomeEmail = generateWelcomeEmail({
        fullName: displayName || email.split('@')[0],
        email: email
      });
      
      testResults.step4_comparison = {
        statusEmail: {
          subject: statusEmail.subject,
          hasHtml: !!statusEmail.html,
          hasText: !!statusEmail.text
        },
        welcomeEmail: {
          subject: welcomeEmail.subject,
          hasHtml: !!welcomeEmail.html,
          hasText: !!welcomeEmail.text
        },
        identical: statusEmail.subject === welcomeEmail.subject
      };
    } catch (error) {
      testResults.step4_comparison = { error: error.message };
    }

    return res.status(200).json({ 
      message: "Google OAuth registration diagnostic complete",
      email: email,
      displayName: displayName,
      results: testResults
    });

  } catch (error) {
    console.error("Error in Google OAuth diagnostic:", error);
    return res.status(500).json({ 
      message: "Diagnostic failed",
      error: error.message 
    });
  }
});
// Admin endpoint to send promo code emails
// Admin endpoint to send test emails
app.post('/api/admin/test-email', async (req, res) => {
  // Check if user is authenticated via session
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  console.log('Test email request - Auth info:', {
    sessionUserId: req.session.userId,
    headerUserId: req.headers['x-user-id'],
    rawUserId: rawUserId
  });

  if (!rawUserId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Check if the user is an admin
    const user = await getUser(rawUserId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can send test emails'
      });
    }

    const { email, recipients, subject, previewText, sections, header, footer, usageSteps, emailContainer, customDesign } = req.body;

    // Handle recipients - support both single email and multiple recipients
    let emailList = [];
    if (recipients && Array.isArray(recipients) && recipients.length > 0) {
      emailList = recipients;
    } else if (email) {
      emailList = [{ email: email, name: 'Test User' }];
    }

    // Validate required fields
    if (emailList.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Recipients are required'
      });
    }

    // Validate email formats
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const recipient of emailList) {
      if (!emailRegex.test(recipient.email)) {
        return res.status(400).json({
          error: 'Invalid email',
          message: `Please provide a valid email address: ${recipient.email}`
        });
      }
    }

    console.log(`Admin ${user.username} sending test email to ${emailList.length} recipients`);

    // Import the email functions
    const { sendEmail, generatePromoCodeEmail } = await import('../server/email.js');

    // Send test emails to all recipients
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const recipient of emailList) {
      try {
        // Generate test email content
        const emailContent = generatePromoCodeEmail({
          email: recipient.email,
          customerName: recipient.name || 'Test User',
          promoCode: 'TEST123',
          customMessage: 'This is a test email from the Local Cooks admin panel. If you receive this, the email system is working correctly!',
          message: 'This is a test email from the Local Cooks admin panel.',
          greeting: 'Hello!',
          promoStyle: { colorTheme: 'blue', borderStyle: 'solid' },
          promoCodeStyling: customDesign?.content?.promoCodeStyling,
          designSystem: customDesign?.designSystem,
          isPremium: true,
          sections: sections || [],
          orderButton: {
            text: 'Test Button',
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
          },
          header: header,
          footer: footer,
          usageSteps: usageSteps,
          emailContainer: emailContainer,
          subject: subject || 'Test Email from Local Cooks',
          previewText: previewText || 'This is a test email',
          promoCodeLabel: '🧪 Test Code'
        });

        // Send the email
        const emailSent = await sendEmail(emailContent, {
          trackingId: `test_email_${recipient.email}_${Date.now()}`
        });

        if (emailSent) {
          console.log(`Test email sent successfully to ${recipient.email}`);
          results.push({ email: recipient.email, status: 'success' });
          successCount++;
        } else {
          console.error(`Failed to send test email to ${recipient.email}`);
          results.push({ email: recipient.email, status: 'failed', error: 'Email sending failed' });
          failureCount++;
        }
      } catch (error) {
        console.error(`Error sending test email to ${recipient.email}:`, error);
        results.push({ email: recipient.email, status: 'failed', error: error.message });
        failureCount++;
      }
    }

    // Return results
    if (successCount > 0) {
      return res.status(200).json({
        message: `Test emails sent: ${successCount} successful, ${failureCount} failed`,
        results: results,
        sentBy: user.username,
        timestamp: new Date().toISOString(),
        summary: {
          total: emailList.length,
          successful: successCount,
          failed: failureCount
        }
      });
    } else {
      return res.status(500).json({
        error: 'All test email sending failed',
        message: 'Failed to send test emails to any recipients.',
        results: results
      });
    }

  } catch (error) {
    console.error('Error sending test email:', error);
    return res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while sending test email'
    });
  }
});
// Admin endpoint to send flexible company emails (promotional or general)
app.post('/api/admin/send-company-email', async (req, res) => {
  // Check if user is authenticated via session
  const rawUserId = req.session.userId || req.headers['x-user-id'];
  const userId = parseInt(rawUserId);

  console.log(`POST /api/admin/send-company-email - User ID: ${userId}`);

  if (!userId) {
    console.log('Company email request - User not authenticated');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Check if user is admin
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0 || userResult.rows[0].role !== 'admin') {
      console.log(`Company email request - User ${userId} is not admin`);
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      emailType = 'general', // 'promotional', 'general', 'announcement', 'newsletter'
      emailMode,
      recipients,
      promoCode, // Optional for non-promotional emails
      promoCodeLabel, 
      message, 
      customMessage, 
      greeting,
      subject,
      previewText,
      header,
      footer,
      orderButton,
      usageSteps,
      emailContainer,
      dividers,
      promoCodeStyling,
      promoStyle,
      sections,
      customDesign
    } = req.body;

    // Validate required fields
    const messageContent = customMessage || message;
    if (!messageContent || messageContent.length < 10) {
      console.log('Company email request - Invalid message:', { 
        customMessage: customMessage?.substring(0, 50), 
        message: message?.substring(0, 50),
        messageLength: messageContent?.length 
      });
      return res.status(400).json({ error: 'Message content is required (minimum 10 characters)' });
    }

    // For promotional emails, require promo code
    if (emailType === 'promotional' && !promoCode) {
      console.log('Company email request - Missing promo code for promotional email');
      return res.status(400).json({ error: 'Promo code is required for promotional emails' });
    }

    // Parse recipients
    let targetEmails = [];
    if (emailMode === 'all') {
      // Get all user emails from database
      try {
        const result = await pool.query('SELECT email FROM users WHERE email IS NOT NULL AND email != \'\'');
        targetEmails = result.rows.map(row => row.email);
      } catch (error) {
        console.error('Error fetching user emails:', error);
        return res.status(500).json({ error: 'Failed to fetch user emails' });
      }
    } else if (emailMode === 'custom' && recipients) {
      const customEmails = recipients.split(',').map(email => email.trim()).filter(email => email.length > 0);
      targetEmails = customEmails;
    } else {
      return res.status(400).json({ error: 'Invalid email mode or recipients' });
    }

    // Validate that we have at least one email
    if (targetEmails.length === 0) {
      console.log('Company email request - No valid email addresses provided');
      return res.status(400).json({ error: 'At least one email address is required' });
    }

    console.log('Company email request - Validation passed, generating email');
    console.log(`Company email request - Sending to ${targetEmails.length} recipient(s)`);

    // Import the email functions
    const { sendEmail, generateFlexibleEmail } = await import('../server/email.js');

    // Send emails to all recipients
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const targetEmail of targetEmails) {
      try {
        // Generate flexible email for each recipient
        const emailContent = generateFlexibleEmail({
          email: targetEmail,
          emailType,
          promoCode,
          promoCodeLabel: promoCodeLabel || (emailType === 'promotional' ? '🎁 Special Offer Code For You' : undefined),
          customMessage: messageContent,
          greeting: greeting || 'Hello! 👋',
          subject: subject || (emailType === 'promotional' ? `🎁 Special Offer: ${promoCode}` : 'Important Update from Local Cooks'),
          previewText,
          header: header || {
            title: emailType === 'promotional' ? 'Special Offer Just For You!' : 'Local Cooks Community',
            subtitle: emailType === 'promotional' ? 'Don\'t miss out on this exclusive deal' : 'Connecting local cooks with food lovers'
          },
          footer,
          orderButton: emailType === 'promotional' ? (orderButton || {
            text: '🌟 Start Shopping Now',
            url: 'https://localcooks.ca'
          }) : orderButton,
          usageSteps: emailType === 'promotional' ? (usageSteps || {
            enabled: true,
            title: '🚀 How to use your offer:',
            steps: [
              `Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>`,
              'Browse our amazing local cooks and their delicious offerings',
              promoCode ? 'Apply your promo code during checkout' : 'Complete your order',
              'Enjoy your special offer!'
            ]
          }) : usageSteps,
          emailContainer: emailContainer || {
            maxWidth: '600px',
            backgroundColor: '#f1f5f9',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            opacity: '1'
          },
          dividers,
          promoCodeStyling,
          promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
          sections,
          customDesign
        });

        // Send email
        const emailSent = await sendEmail(emailContent, {
          trackingId: `${emailType}_email_${targetEmail}_${Date.now()}`
        });

        if (emailSent) {
          console.log(`${emailType} email sent successfully to ${targetEmail}`);
          results.push({ email: targetEmail, status: 'success' });
          successCount++;
        } else {
          console.error(`Failed to send ${emailType} email to ${targetEmail}`);
          results.push({ email: targetEmail, status: 'failed', error: 'Email sending failed' });
          failureCount++;
        }
      } catch (error) {
        console.error(`Error sending ${emailType} email to ${targetEmail}:`, error);
        results.push({ email: targetEmail, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' });
        failureCount++;
      }
    }

    // Return results
    if (successCount > 0) {
      res.json({ 
        success: true, 
        message: `${emailType} emails sent: ${successCount} successful, ${failureCount} failed`,
        emailType,
        results: results,
        summary: {
          total: targetEmails.length,
          successful: successCount,
          failed: failureCount
        }
      });
    } else {
      res.status(500).json({ 
        error: 'All email sending failed',
        message: `Failed to send ${emailType} emails to any recipients.`,
        results: results
      });
    }
  } catch (error) {
    console.error('Error sending company email:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});
// Legacy promo email endpoint for backward compatibility
app.post('/api/admin/send-promo-email', async (req, res) => {
  // Check if user is authenticated via session
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  console.log('Promo email request - Auth info:', {
    sessionUserId: req.session.userId,
    headerUserId: req.headers['x-user-id'],
    rawUserId: rawUserId
  });

  if (!rawUserId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Check if the user is an admin
    const user = await getUser(rawUserId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can send promo code emails'
      });
    }

    const { email, recipients, customEmails, emailMode, promoCode, customMessage, message, promoStyle, designSystem, isPremium, sections, orderButton, header, subject, previewText, greeting, promoCodeLabel } = req.body;

    // Handle both customMessage and message fields (different frontend components use different names)
    const messageContent = customMessage || message;

    // Handle recipients - support both database users and custom emails
    let emailList = [];
    if (emailMode === 'custom' && customEmails && Array.isArray(customEmails) && customEmails.length > 0) {
      // Custom email mode - use the provided email addresses
      emailList = customEmails.map(email => ({ email: email, name: 'Valued Customer' }));
    } else if (recipients && Array.isArray(recipients) && recipients.length > 0) {
      // Database mode - use selected users
      emailList = recipients;
    } else if (email) {
      // Fallback to single email
      emailList = [{ email: email, name: 'Recipient' }];
    }

    // Validate required fields
    if (emailList.length === 0 || !messageContent) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Recipients and message are required'
      });
    }

    // Validate promo code if provided
    if (promoCode && promoCode.length > 0 && promoCode.length < 3) {
      return res.status(400).json({
        error: 'Invalid promo code',
        message: 'Promo code must be at least 3 characters long if provided'
      });
    }

    // Validate email formats
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const recipient of emailList) {
      if (!emailRegex.test(recipient.email)) {
        return res.status(400).json({
          error: 'Invalid email',
          message: `Please provide a valid email address: ${recipient.email}`
        });
      }
    }

    // Validate promo code only if provided (basic validation - alphanumeric, length check)
    if (promoCode && promoCode.length > 0 && (promoCode.length < 3 || promoCode.length > 50)) {
      return res.status(400).json({
        error: 'Invalid promo code',
        message: 'Promo code must be between 3 and 50 characters'
      });
    }

    // Validate message
    if (messageContent.length < 10 || messageContent.length > 1000) {
      return res.status(400).json({
        error: 'Invalid message',
        message: 'Message must be between 10 and 1000 characters'
      });
    }

    console.log(`Admin ${user.username} sending promo email to ${emailList.length} recipients with code: ${promoCode}`);

    // Import the email functions
    const { sendEmail, generatePromoCodeEmail } = await import('../server/email.js');

    // Send emails to all recipients
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const recipient of emailList) {
      try {
        // Generate the promo email with custom message and styling for each recipient
        const emailContent = generatePromoCodeEmail({
          email: recipient.email,
          customerName: recipient.name || 'Valued Customer',
          promoCode: promoCode.trim(),
          customMessage: messageContent.trim(),
          message: messageContent.trim(), // Also pass as message for compatibility
          greeting: greeting,
          promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
          promoCodeStyling: req.body.promoCodeStyling,
          designSystem: designSystem,
          isPremium: isPremium || false,
          sections: sections || [],
          orderButton: orderButton || {
            text: 'Get Started',
            url: 'https://localcooks.com',
            styling: {
              backgroundColor: '#F51042',
              color: '#ffffff',
              fontSize: '16px',
              fontWeight: '600',
              padding: '12px 24px',
              borderRadius: '8px',
              textAlign: 'center'
            }
          },
          header: header,
          footer: req.body.footer,
          usageSteps: req.body.usageSteps,
          emailContainer: req.body.emailContainer,
          subject: subject,
          previewText: previewText,
          promoCodeLabel: promoCodeLabel
        });

        // Send the email
        const emailSent = await sendEmail(emailContent, {
          trackingId: `promo_custom_${recipient.email}_${promoCode}_${Date.now()}`
        });

        if (emailSent) {
          console.log(`Promo email sent successfully to ${recipient.email} with code ${promoCode}`);
          results.push({ email: recipient.email, status: 'success' });
          successCount++;
        } else {
          console.error(`Failed to send promo email to ${recipient.email}`);
          results.push({ email: recipient.email, status: 'failed', error: 'Email sending failed' });
          failureCount++;
        }
      } catch (error) {
        console.error(`Error sending promo email to ${recipient.email}:`, error);
        results.push({ email: recipient.email, status: 'failed', error: error.message });
        failureCount++;
      }
    }

    // Return results
    if (successCount > 0) {
      return res.status(200).json({
        message: `Promo code emails sent: ${successCount} successful, ${failureCount} failed`,
        results: results,
        promoCode: promoCode,
        sentBy: user.username,
        timestamp: new Date().toISOString(),
        summary: {
          total: emailList.length,
          successful: successCount,
          failed: failureCount
        }
      });
    } else {
      return res.status(500).json({
        error: 'All email sending failed',
        message: 'Failed to send promo code emails to any recipients.',
        results: results
      });
    }

  } catch (error) {
    console.error('Error sending promo email:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred while sending the promo code email'
    });
  }
});
// Test endpoint for promo code emails (admin only)
app.post('/api/test-promo-email', async (req, res) => {
  // Check if user is authenticated via session
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Check if the user is an admin
    const user = await getUser(rawUserId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can test promo emails'
      });
    }

    const { email, promoCode, customMessage, message, promoStyle, designSystem, isPremium, sections, orderButton, header, subject, previewText, greeting, promoCodeLabel } = req.body;

    // Handle both customMessage and message fields
    const messageContent = customMessage || message;

    console.log(`Admin ${user.username} testing promo email`);

    // Import the email functions
    const { sendEmail, generatePromoCodeEmail } = await import('../server/email.js');

    // Generate test promo email with custom message and styling
    const emailContent = generatePromoCodeEmail({
      email: email || 'test@example.com',
      promoCode: promoCode || 'TEST20',
      customMessage: messageContent || 'This is a test promo code email from the admin panel. Thank you for being an amazing customer!',
      message: messageContent || 'This is a test promo code email from the admin panel. Thank you for being an amazing customer!',
      greeting: greeting,
      promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
      promoCodeStyling: req.body.promoCodeStyling,
      designSystem: designSystem,
      isPremium: isPremium || false,
      sections: sections || [],
      orderButton: orderButton || {
        text: 'Get Started',
        url: 'https://localcooks.com',
        styling: {
          backgroundColor: '#F51042',
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: '600',
          padding: '12px 24px',
          borderRadius: '8px',
          textAlign: 'center'
        }
      },
      header: header,
      footer: req.body.footer,
      usageSteps: req.body.usageSteps,
      emailContainer: req.body.emailContainer,
      subject: subject,
      previewText: previewText,
      promoCodeLabel: promoCodeLabel
    });

    // Send the email
    const emailSent = await sendEmail(emailContent, {
      trackingId: `test_promo_custom_${email || 'test'}_${Date.now()}`
    });

    if (emailSent) {
      return res.status(200).json({
        message: 'Test promo email sent successfully',
        email: email || 'test@example.com',
        promoCode: promoCode || 'TEST20'
      });
    } else {
      return res.status(500).json({
        error: 'Test email failed',
        message: 'Failed to send test promo email'
      });
    }

  } catch (error) {
    console.error('Error sending test promo email:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred while testing promo email'
    });
  }
});

// Preview endpoint for promo code emails (admin only) - returns HTML without sending
app.post('/api/preview-promo-email', async (req, res) => {
  // Check if user is authenticated via session
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Check if the user is an admin
    const user = await getUser(rawUserId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can preview promo emails'
      });
    }

    const { promoCode, customMessage, message, promoStyle, designSystem, isPremium, sections, orderButton, header, subject, previewText, greeting, promoCodeLabel } = req.body;

    // Handle both customMessage and message fields
    const messageContent = customMessage || message;

    // Validate required fields for preview
    if (!messageContent) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Message is required for preview'
      });
    }

    // Validate promo code if provided
    if (promoCode && promoCode.length > 0 && promoCode.length < 3) {
      return res.status(400).json({
        error: 'Invalid promo code',
        message: 'Promo code must be at least 3 characters long if provided'
      });
    }

    console.log(`Admin ${user.username} previewing promo email`);

    // Import the email functions
    const { generatePromoCodeEmail } = await import('../server/email.js');

    // Generate promo email content for preview
    const emailContent = generatePromoCodeEmail({
      email: 'preview@example.com', // Dummy email for preview
      promoCode: promoCode.trim(),
      customMessage: messageContent.trim(),
      message: messageContent.trim(),
      greeting: greeting,
      promoStyle: promoStyle || { colorTheme: 'green', borderStyle: 'dashed' },
      promoCodeStyling: req.body.promoCodeStyling,
      designSystem: designSystem,
      isPremium: isPremium || false,
      sections: sections || [],
      orderButton: orderButton || {
        text: 'Get Started',
        url: 'https://localcooks.com',
        styling: {
          backgroundColor: '#F51042',
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: '600',
          padding: '12px 24px',
          borderRadius: '8px',
          textAlign: 'center'
        }
      },
      header: header,
      footer: req.body.footer,
      usageSteps: req.body.usageSteps,
      emailContainer: req.body.emailContainer,
      subject: subject,
      previewText: previewText,
      promoCodeLabel: promoCodeLabel
    });

    // Return the HTML content directly for preview
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(emailContent.html || '<p>No HTML content generated</p>');

  } catch (error) {
    console.error('Error generating promo email preview:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred while generating email preview'
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
  cacheExpiry: 10 * 60 * 1000 // 10 minutes
};

const isCacheValid = () => Date.now() - vehicleCache.lastFetch < vehicleCache.cacheExpiry;

// Get all vehicle makes (4-wheeled vehicles only)
app.get('/api/vehicles/makes', async (req, res) => {
  try {
    const { type } = req.query;
    
    // Check cache first
    if (type && vehicleCache.makesByType.has(type) && isCacheValid()) {
      return res.json({
        success: true,
        makes: vehicleCache.makesByType.get(type)
      });
    }
    
    if (!type && vehicleCache.makes && isCacheValid()) {
      return res.json({
        success: true,
        makes: vehicleCache.makes
      });
    }

    const response = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json');
    if (!response.ok) {
      throw new Error(`NHTSA API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Filter for 4-wheeled vehicles only (exclude motorcycles, etc.)
    const fourWheeledMakes = data.Results.filter((make) => {
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

    const formattedMakes = fourWheeledMakes.map((make) => ({
      id: make.Make_ID,
      name: make.Make_Name
    }));

    // Cache the results
    if (type) {
      vehicleCache.makesByType.set(type, formattedMakes);
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
app.get('/api/vehicles/makes/type/:vehicleType', async (req, res) => {
  try {
    const { vehicleType } = req.params;
    
    // Check cache first
    if (vehicleCache.makesByType.has(vehicleType) && isCacheValid()) {
      return res.json({
        success: true,
        makes: vehicleCache.makesByType.get(vehicleType)
      });
    }

    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/${encodeURIComponent(vehicleType)}?format=json`);
    if (!response.ok) {
      throw new Error(`NHTSA API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Filter for 4-wheeled vehicles only
    const fourWheeledMakes = data.Results.filter((make) => {
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

    const formattedMakes = fourWheeledMakes.map((make) => ({
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
app.get('/api/vehicles/models/by-name/:makeName', async (req, res) => {
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
    const fourWheeledModels = data.Results.filter((model) => {
      const modelName = model.Model_Name.toUpperCase();
      const excludedPatterns = [
        /MOTORCYCLE$/i, /BIKE$/i, /SCOOTER$/i, /MOPED$/i, /ATV$/i,
        /SNOWMOBILE$/i, /WATERCRAFT$/i, /BOAT$/i, /JET.?SKI$/i
      ];
      return !excludedPatterns.some(pattern => pattern.test(modelName));
    });

    const formattedModels = fourWheeledModels.map((model) => ({
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
app.get('/api/vehicles/models/:makeId', async (req, res) => {
  try {
    const { makeId } = req.params;
    
    // First get the make name from our makes list
    const makesResponse = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json`);
    if (!makesResponse.ok) {
      throw new Error(`NHTSA API error: ${makesResponse.status}`);
    }
    
    const makesData = await makesResponse.json();
    const selectedMake = makesData.Results.find((make) => make.Make_ID === parseInt(makeId));
    
    if (!selectedMake) {
      throw new Error('Make not found');
    }
    
    // Check cache with make name
    if (vehicleCache.modelsByMake.has(selectedMake.Make_Name) && isCacheValid()) {
      return res.json({
        success: true,
        models: vehicleCache.modelsByMake.get(selectedMake.Make_Name)
      });
    }
    
    // Get all models for this make (without year)
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(selectedMake.Make_Name)}?format=json`);
    if (!response.ok) {
      throw new Error(`NHTSA API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log(`🚗 NHTSA API returned ${data.Results?.length || 0} models for make: ${selectedMake.Make_Name}`);
    
    // Filter for 4-wheeled vehicles only, but be much less aggressive
    const fourWheeledModels = data.Results.filter((model) => {
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
    
    const formattedModels = fourWheeledModels.map((model) => ({
      id: model.Model_ID || model.Model_ID, // Use actual NHTSA ID if available
      name: model.Model_Name
    }));

    // Cache the results using make name for consistency with new endpoint
    vehicleCache.modelsByMake.set(selectedMake.Make_Name, formattedModels);

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
app.get('/api/vehicles/years/:makeId', async (req, res) => {
  try {
    const { makeId } = req.params;
    
    // Check cache first
    if (vehicleCache.yearsByMake.has(makeId) && isCacheValid()) {
      return res.json({
        success: true,
        years: vehicleCache.yearsByMake.get(makeId)
      });
    }
    
    // Get the make name from existing cached data first
    let selectedMake = null;
    
    // Strategy 1: Check our car makes cache 
    if (vehicleCache.makesByType.has('car') && isCacheValid()) {
      const carMakes = vehicleCache.makesByType.get('car');
      selectedMake = carMakes?.find((make) => make.id === parseInt(makeId));
      if (selectedMake) {
        // Convert our cache format to NHTSA format
        selectedMake = { Make_ID: selectedMake.id, Make_Name: selectedMake.name };
      }
    }
    
    // Strategy 2: If not in car cache, make ONE strategic API call to get ALL makes
    if (!selectedMake) {
      try {
        console.log(`🚗 Make ID ${makeId} not in cache, fetching from NHTSA API...`);
        const makesResponse = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json`, {
          signal: AbortSignal.timeout(5000)
        });
        
        if (makesResponse.ok) {
          const makesData = await makesResponse.json();
          selectedMake = makesData.Results.find((make) => make.Make_ID === parseInt(makeId));
          
          // Cache ALL makes to prevent future API calls
          if (makesData.Results && makesData.Results.length > 0) {
            console.log(`🚗 Caching ${makesData.Results.length} makes from NHTSA API`);
            // This will help future requests avoid API calls
          }
        }
      } catch (error) {
        console.log(`⚠️ NHTSA API failed for makeId ${makeId}: ${error.message}`);
      }
    }
    
    // Strategy 3: Only if API completely fails, generate a basic fallback
    if (!selectedMake) {
      selectedMake = { 
        Make_ID: parseInt(makeId), 
        Make_Name: `MAKE_${makeId}` 
      };
      console.log(`🚗 Using generic fallback for make ID ${makeId}`);
    }
    
    // Use intelligent fallback for year generation (production-safe)
    const currentYear = new Date().getFullYear();
    
    // Defensive null check for Make_Name
    const makeNameRaw = selectedMake?.Make_Name || selectedMake?.name || `MAKE_${makeId}`;
    const makeName = makeNameRaw.toUpperCase();
    console.log(`🚗 Generating year range for ${makeNameRaw} (ID: ${makeId})`);
    
    // Generate a reasonable modern year range (most users want recent vehicles)
    const years = [];
    const startYear = Math.max(1990, currentYear - 35); // Last 35 years, but not before 1990
    const endYear = currentYear + 1; // Include next model year
    
    for (let year = endYear; year >= startYear; year--) {
      years.push(year);
    }
    
    console.log(`🚗 Generated ${years.length} years for ${makeNameRaw}: ${endYear} to ${startYear} (universal modern range)`);

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
// KITCHEN BOOKING SYSTEM - ADMIN ROUTES
// ===================================

// Create manager account
app.post("/api/admin/managers", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { username, password, email, name } = req.body;
    
    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    
    // Check if user already exists
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Create manager user with hashed password
    const hashedPassword = await hashPassword(password);
    const manager = await createUser({
      username,
      password: hashedPassword,
      role: 'manager',
      firebase_uid: null,
      is_verified: false,
      has_seen_welcome: false,
      is_manager: true
    });
    
    // Send welcome email to manager with credentials
    try {
      const { sendEmail, generateManagerCredentialsEmail } = await import('../server/email.js');
      
      // Use email field if provided, otherwise fallback to username
      const managerEmail = email || username;
      
      const welcomeEmail = generateManagerCredentialsEmail({
        email: managerEmail,
        name: name || 'Manager',
        username: username,
        password: password
      });
      
      await sendEmail(welcomeEmail);
      console.log(`✅ Welcome email with credentials sent to manager: ${managerEmail}`);
    } catch (emailError) {
      console.error("Error sending manager welcome email:", emailError);
      console.error("Email error details:", emailError instanceof Error ? emailError.message : emailError);
      // Don't fail manager creation if email fails
    }
    
    res.status(201).json({ success: true, managerId: manager.id });
  } catch (error) {
    console.error("Error creating manager:", error);
    res.status(500).json({ error: error.message || "Failed to create manager" });
  }
});

// Get all managers (admin only)
app.get("/api/admin/managers", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Fetch all managers with their locations and notification emails
    if (pool) {
      // Get managers with their locations and notification emails
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
      
      // Transform the result to include notification emails
      const managersWithEmails = result.rows.map((row) => {
        // Parse JSON if it's a string, otherwise use as-is
        let locations = row.locations;
        if (typeof locations === 'string') {
          try {
            locations = JSON.parse(locations);
          } catch (e) {
            console.warn(`Failed to parse locations JSON for manager ${row.id}:`, e);
            locations = [];
          }
        }
        
        // Ensure locations is an array
        if (!Array.isArray(locations)) {
          locations = [];
        }
        
        // Map to consistent structure (camelCase)
        const mappedLocations = locations.map((loc) => ({
          locationId: loc.locationId || loc.location_id || loc.id,
          locationName: loc.locationName || loc.location_name || loc.name,
          notificationEmail: loc.notificationEmail || loc.notification_email || null
        }));
        
        return {
          id: row.id,
          username: row.username,
          role: row.role,
          locations: mappedLocations
        };
      });
      
      return res.json(managersWithEmails);
    } else {
      return res.json([]);
    }
  } catch (error) {
    console.error("Error fetching managers:", error);
    res.status(500).json({ error: error.message || "Failed to fetch managers" });
  }
});

// Delete manager (admin)
app.delete("/api/admin/managers/:id", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
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

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the user exists and is a manager
    const managerResult = await pool.query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [managerId]
    );

    if (managerResult.rows.length === 0) {
      return res.status(404).json({ error: "Manager not found" });
    }

    const manager = managerResult.rows[0];
    if (manager.role !== 'manager') {
      return res.status(400).json({ error: "User is not a manager" });
    }

    // Check if manager has locations assigned
    const locationsResult = await pool.query(
      'SELECT id FROM locations WHERE manager_id = $1',
      [managerId]
    );

    // Use transaction to update locations and delete manager
    await pool.query('BEGIN');
    try {
      // Set manager_id to NULL for all locations managed by this user
      if (locationsResult.rows.length > 0) {
        await pool.query(
          'UPDATE locations SET manager_id = NULL WHERE manager_id = $1',
          [managerId]
        );
        console.log(`⚠️ Removed manager ${managerId} from ${locationsResult.rows.length} location(s)`);
      }

      // Delete the manager user
      const deleteResult = await pool.query(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [managerId]
      );

      if (deleteResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ error: "Manager not found" });
      }

      await pool.query('COMMIT');
      console.log(`✅ Deleted manager ${managerId}`);
      
      res.json({ success: true, message: "Manager deleted successfully" });
    } catch (deleteError) {
      await pool.query('ROLLBACK');
      throw deleteError;
    }
  } catch (error) {
    console.error("Error deleting manager:", error);
    res.status(500).json({ error: error.message || "Failed to delete manager" });
  }
});

// ===================================
// KITCHEN BOOKING SYSTEM - MANAGER ROUTES
// ===================================

// Get all locations for manager
app.get("/api/manager/locations", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    // Get locations for this manager
    if (!pool) {
      return res.json([]);
    }
    const result = await pool.query(`
      SELECT id, name, address, manager_id as "managerId", 
             cancellation_policy_hours as "cancellationPolicyHours",
             cancellation_policy_message as "cancellationPolicyMessage",
             default_daily_booking_limit as "defaultDailyBookingLimit",
             minimum_booking_window_hours as "minimumBookingWindowHours",
             notification_email as "notificationEmail",
             notification_phone as "notificationPhone",
             logo_url as "logoUrl",
             kitchen_license_url as "kitchenLicenseUrl",
             kitchen_license_status as "kitchenLicenseStatus",
             kitchen_license_approved_by as "kitchenLicenseApprovedBy",
             kitchen_license_approved_at as "kitchenLicenseApprovedAt",
             kitchen_license_feedback as "kitchenLicenseFeedback",
             created_at, updated_at 
      FROM locations 
      WHERE manager_id = $1
      ORDER BY created_at DESC
    `, [user.id]);
    
    // Log to verify logoUrl is included in response
    console.log('[GET] /api/manager/locations - Returning locations:', 
      result.rows.map(loc => ({
        id: loc.id,
        name: loc.name,
        notificationEmail: loc.notificationEmail || 'not set',
        logoUrl: loc.logoUrl || 'not set'
      }))
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ error: error.message || "Failed to fetch locations" });
  }
});

// Update location cancellation policy (manager only)
app.put("/api/manager/locations/:locationId/cancellation-policy", async (req, res) => {
  console.log('[PUT] /api/manager/locations/:locationId/cancellation-policy hit', {
    locationId: req.params.locationId,
    body: req.body
  });
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const { locationId } = req.params;
    const locationIdNum = parseInt(locationId);
    
    if (isNaN(locationIdNum) || locationIdNum <= 0) {
      console.error('[PUT] Invalid locationId:', locationId);
      return res.status(400).json({ error: "Invalid location ID" });
    }
    
    const { cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, minimumBookingWindowHours, notificationEmail, logoUrl, timezone } = req.body;
    
    console.log('[PUT] Request body:', {
      cancellationPolicyHours,
      cancellationPolicyMessage,
      defaultDailyBookingLimit,
      minimumBookingWindowHours,
      notificationEmail,
      timezone,
      logoUrl,
      locationId: locationIdNum
    });

    if (cancellationPolicyHours !== undefined && (typeof cancellationPolicyHours !== 'number' || cancellationPolicyHours < 0)) {
      return res.status(400).json({ error: "Cancellation policy hours must be a non-negative number" });
    }

    if (defaultDailyBookingLimit !== undefined && (typeof defaultDailyBookingLimit !== 'number' || defaultDailyBookingLimit < 1 || defaultDailyBookingLimit > 24)) {
      return res.status(400).json({ error: "Daily booking limit must be between 1 and 24 hours" });
    }

    if (minimumBookingWindowHours !== undefined && (typeof minimumBookingWindowHours !== 'number' || minimumBookingWindowHours < 0 || minimumBookingWindowHours > 168)) {
      return res.status(400).json({ error: "Minimum booking window hours must be between 0 and 168 hours" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify manager owns this location
    const locationResult = await pool.query(`
      SELECT id, name, manager_id, notification_email
      FROM locations
      WHERE id = $1 AND manager_id = $2
    `, [locationIdNum, user.id]);
    
    const location = locationResult.rows[0];

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
      managerId: location.manager_id
    });

    // Get old notification email before updating
    const oldNotificationEmail = location.notification_email || null;

    // Update location settings
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (cancellationPolicyHours !== undefined) {
      updates.push(`cancellation_policy_hours = $${paramCount++}`);
      values.push(cancellationPolicyHours);
    }
    if (cancellationPolicyMessage !== undefined) {
      updates.push(`cancellation_policy_message = $${paramCount++}`);
      values.push(cancellationPolicyMessage);
    }
    if (defaultDailyBookingLimit !== undefined) {
      updates.push(`default_daily_booking_limit = $${paramCount++}`);
      values.push(defaultDailyBookingLimit);
    }
    if (minimumBookingWindowHours !== undefined) {
      updates.push(`minimum_booking_window_hours = $${paramCount++}`);
      values.push(minimumBookingWindowHours);
    }
    if (logoUrl !== undefined) {
      // Set to null if empty string, otherwise use the value
      const processedLogoUrl = logoUrl && logoUrl.trim() !== '' ? logoUrl.trim() : null;
      updates.push(`logo_url = $${paramCount++}`);
      values.push(processedLogoUrl);
      console.log('[PUT] Setting logoUrl:', {
        raw: logoUrl,
        processed: processedLogoUrl
      });
    }
    if (notificationEmail !== undefined) {
      // Validate email format if provided and not empty
      if (notificationEmail && notificationEmail.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
        return res.status(400).json({ error: "Invalid email format" });
      }
      updates.push(`notification_email = $${paramCount++}`);
      // Set to null if empty string, otherwise use the value
      values.push(notificationEmail && notificationEmail.trim() !== '' ? notificationEmail.trim() : null);
      console.log('[PUT] Setting notificationEmail:', { 
        raw: notificationEmail, 
        processed: notificationEmail && notificationEmail.trim() !== '' ? notificationEmail.trim() : null
      });
    }
    if (timezone !== undefined) {
      // Validate timezone format (basic validation - should be a valid IANA timezone)
      if (timezone && typeof timezone === 'string' && timezone.trim() !== '') {
        updates.push(`timezone = $${paramCount++}`);
        values.push(timezone.trim());
      } else if (timezone === null || timezone === '') {
        // Use default if empty
        updates.push(`timezone = $${paramCount++}`);
        values.push(DEFAULT_TIMEZONE);
      }
      console.log('[PUT] Setting timezone:', {
        raw: timezone,
        processed: timezone && timezone.trim() !== '' ? timezone.trim() : DEFAULT_TIMEZONE
      });
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    updates.push(`updated_at = NOW()`);
    values.push(locationIdNum);

    const updateQuery = `
      UPDATE locations
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, name, address, manager_id as "managerId",
                cancellation_policy_hours as "cancellationPolicyHours",
                cancellation_policy_message as "cancellationPolicyMessage",
                default_daily_booking_limit as "defaultDailyBookingLimit",
                minimum_booking_window_hours as "minimumBookingWindowHours",
                notification_email as "notificationEmail",
                logo_url as "logoUrl",
                timezone,
                created_at, updated_at
    `;

    const updatedResult = await pool.query(updateQuery, values);

    if (!updatedResult.rows || updatedResult.rows.length === 0) {
      console.error('[PUT] Cancellation policy update failed: No location returned from DB', {
        locationId: locationIdNum,
        updates
      });
      return res.status(500).json({ error: "Failed to update location settings - no rows updated" });
    }

    const updated = updatedResult.rows[0];
    console.log('[PUT] Location settings updated successfully:', {
      locationId: updated.id,
      cancellationPolicyHours: updated.cancellationPolicyHours,
      defaultDailyBookingLimit: updated.defaultDailyBookingLimit,
      minimumBookingWindowHours: updated.minimumBookingWindowHours,
      notificationEmail: updated.notificationEmail || 'not set',
      logoUrl: updated.logoUrl || 'not set',
      timezone: updated.timezone || DEFAULT_TIMEZONE
    });
    
    // Return timezone in response
    const response = {
      ...updated,
      timezone: updated.timezone || DEFAULT_TIMEZONE
    };
    
    // Send email to new notification email if it was changed
    if (notificationEmail !== undefined && response.notificationEmail && response.notificationEmail !== oldNotificationEmail) {
      try {
        // Import email functions
        const { sendEmail, generateLocationEmailChangedEmail } = await import('../server/email.js');
        
        const emailContent = generateLocationEmailChangedEmail({
          email: updated.notificationEmail,
          locationName: location.name,
          locationId: location.id
        });
        await sendEmail(emailContent);
        console.log(`✅ Location notification email change notification sent to: ${updated.notificationEmail}`);
      } catch (emailError) {
        console.error("Error sending location email change notification:", emailError);
        // Don't fail the update if email fails
      }
    }
    
    console.log('[PUT] Sending response with notificationEmail:', updated.notificationEmail);
    res.status(200).json(response);
  } catch (error) {
    console.error("Error updating cancellation policy:", error);
    res.status(500).json({ error: error.message || "Failed to update cancellation policy" });
  }
});

// Get kitchens for a location (manager)
app.get("/api/manager/kitchens/:locationId", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const locationId = parseInt(req.params.locationId);
    if (isNaN(locationId) || locationId <= 0) {
      return res.status(400).json({ error: "Invalid location ID" });
    }

    // Verify the manager has access to this location
    if (!pool) {
      return res.json([]);
    }
    const locationResult = await pool.query(`
      SELECT id FROM locations WHERE manager_id = $1 AND id = $2
    `, [user.id, locationId]);
    
    if (locationResult.rows.length === 0) {
      return res.status(403).json({ error: "Access denied to this location" });
    }

    const kitchens = await getKitchensByLocation(locationId);
    res.json(kitchens);
  } catch (error) {
    console.error("Error fetching kitchens:", error);
    res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
  }
});

// Update kitchen image (manager)
app.put("/api/manager/kitchens/:kitchenId/image", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get the kitchen to verify manager has access to its location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    // Verify the manager has access to this kitchen's location
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    const { imageUrl } = req.body;
    
    // Update the kitchen image
    const updateResult = await pool.query(`
      UPDATE kitchens 
      SET image_url = $1, updated_at = NOW() 
      WHERE id = $2 
      RETURNING *
    `, [imageUrl || null, kitchenId]);
    
    console.log(`✅ Kitchen ${kitchenId} image updated by manager ${user.id}`);
    
    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error("Error updating kitchen image:", error);
    res.status(500).json({ error: error.message || "Failed to update kitchen image" });
  }
});

// Update kitchen details (manager) - name, description, etc.
app.put("/api/manager/kitchens/:kitchenId", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get the kitchen to verify manager has access to its location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    // Verify the manager has access to this kitchen's location
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    const { name, description } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push(`updated_at = NOW()`);
    values.push(kitchenId);

    const updateQuery = `
      UPDATE kitchens 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const updateResult = await pool.query(updateQuery, values);
    
    console.log(`✅ Kitchen ${kitchenId} details updated by manager ${user.id}`);
    
    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error("Error updating kitchen details:", error);
    res.status(500).json({ error: error.message || "Failed to update kitchen details" });
  }
});

// Get kitchen pricing
app.get("/api/manager/kitchens/:kitchenId/pricing", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get the kitchen to verify manager has access to its location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    // Verify the manager has access to this kitchen's location
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Convert hourlyRate from cents to dollars for API response
    const hourlyRateCents = kitchen.hourly_rate ? parseFloat(kitchen.hourly_rate.toString()) : null;
    const hourlyRateDollars = hourlyRateCents !== null ? hourlyRateCents / 100 : null;

    const pricing = {
      hourlyRate: hourlyRateDollars,
      currency: kitchen.currency || 'CAD',
      minimumBookingHours: kitchen.minimum_booking_hours || 1,
      pricingModel: kitchen.pricing_model || 'hourly',
    };

    res.json(pricing);
  } catch (error) {
    console.error("Error getting kitchen pricing:", error);
    res.status(500).json({ error: error.message || "Failed to get kitchen pricing" });
  }
});

// Update kitchen pricing
app.put("/api/manager/kitchens/:kitchenId/pricing", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get the kitchen to verify manager has access to its location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    // Verify the manager has access to this kitchen's location
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    const { hourlyRate, currency, minimumBookingHours, pricingModel } = req.body;

    // Validate input
    if (hourlyRate !== undefined && hourlyRate !== null && (typeof hourlyRate !== 'number' || hourlyRate < 0)) {
      return res.status(400).json({ error: "Hourly rate must be a positive number or null" });
    }

    if (currency !== undefined && typeof currency !== 'string') {
      return res.status(400).json({ error: "Currency must be a string" });
    }

    if (minimumBookingHours !== undefined && (typeof minimumBookingHours !== 'number' || minimumBookingHours < 1)) {
      return res.status(400).json({ error: "Minimum booking hours must be at least 1" });
    }

    if (pricingModel !== undefined && !['hourly', 'daily', 'weekly'].includes(pricingModel)) {
      return res.status(400).json({ error: "Pricing model must be 'hourly', 'daily', or 'weekly'" });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (hourlyRate !== undefined) {
      // Convert dollars to cents for storage
      const hourlyRateCents = hourlyRate === null ? null : Math.round(hourlyRate * 100);
      updates.push(`hourly_rate = $${paramCount++}`);
      values.push(hourlyRateCents);
    }

    if (currency !== undefined) {
      updates.push(`currency = $${paramCount++}`);
      values.push(currency);
    }

    if (minimumBookingHours !== undefined) {
      updates.push(`minimum_booking_hours = $${paramCount++}`);
      values.push(minimumBookingHours);
    }

    if (pricingModel !== undefined) {
      updates.push(`pricing_model = $${paramCount++}`);
      values.push(pricingModel);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push(`updated_at = NOW()`);
    values.push(kitchenId);

    const updateQuery = `
      UPDATE kitchens 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const updateResult = await pool.query(updateQuery, values);
    const updated = updateResult.rows[0];
    
    console.log(`✅ Kitchen ${kitchenId} pricing updated by manager ${user.id}`);
    
    // Convert hourlyRate from cents to dollars for response
    const hourlyRateCents = updated.hourly_rate ? parseFloat(updated.hourly_rate.toString()) : null;
    const hourlyRateDollars = hourlyRateCents !== null ? hourlyRateCents / 100 : null;

    const response = {
      hourlyRate: hourlyRateDollars,
      currency: updated.currency || 'CAD',
      minimumBookingHours: updated.minimum_booking_hours || 1,
      pricingModel: updated.pricing_model || 'hourly',
    };

    res.json(response);
  } catch (error) {
    console.error("Error updating kitchen pricing:", error);
    res.status(500).json({ error: error.message || "Failed to update kitchen pricing" });
  }
});

// ===== STORAGE LISTINGS API =====

// Get storage listings for a kitchen
app.get("/api/manager/kitchens/:kitchenId/storage-listings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this kitchen's location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    // Verify the manager has access to this kitchen's location
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Query storage listings with direct SQL for numeric fields
    // Use COALESCE to handle NULL values for new columns (backward compatibility)
    const listingsResult = await pool.query(
      `SELECT 
        id, kitchen_id, storage_type, name, description,
        base_price::text as base_price,
        price_per_cubic_foot::text as price_per_cubic_foot,
        pricing_model, 
        COALESCE(minimum_booking_duration, 1) as minimum_booking_duration,
        COALESCE(booking_duration_unit, 'monthly') as booking_duration_unit,
        currency,
        status, is_active, created_at, updated_at
      FROM storage_listings
      WHERE kitchen_id = $1
      ORDER BY created_at DESC`,
      [kitchenId]
    );

    const listings = listingsResult.rows.map(row => ({
      id: row.id,
      kitchenId: row.kitchen_id,
      storageType: row.storage_type,
      name: row.name,
      description: row.description,
      basePrice: row.base_price ? parseFloat(String(row.base_price)) / 100 : null,
      pricePerCubicFoot: row.price_per_cubic_foot ? parseFloat(String(row.price_per_cubic_foot)) / 100 : null,
      pricingModel: row.pricing_model,
      minimumBookingDuration: row.minimum_booking_duration ?? 1,
      bookingDurationUnit: row.booking_duration_unit ?? 'monthly',
      currency: row.currency || 'CAD',
      status: row.status,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json(listings);
  } catch (error) {
    console.error("Error getting storage listings:", error);
    res.status(500).json({ error: error.message || "Failed to get storage listings" });
  }
});

// Get equipment listings by kitchen ID
app.get("/api/manager/kitchens/:kitchenId/equipment-listings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this kitchen's location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Get equipment listings with proper numeric conversion
    // Match localhost implementation - must include session_rate (primary pricing field)
    // Note: delivery_available, delivery_fee, setup_fee, pickup_required columns don't exist in DB
    const result = await pool.query(`
      SELECT 
        id, kitchen_id, category, equipment_type, brand, model, description,
        condition, availability_type, pricing_model,
        session_rate::text as session_rate,
        hourly_rate::text as hourly_rate,
        daily_rate::text as daily_rate,
        weekly_rate::text as weekly_rate,
        monthly_rate::text as monthly_rate,
        damage_deposit::text as damage_deposit,
        minimum_rental_hours, minimum_rental_days, currency,
        training_required, cleaning_responsibility,
        status, is_active, created_at, updated_at
      FROM equipment_listings 
      WHERE kitchen_id = $1
      ORDER BY created_at DESC
    `, [kitchenId]);
    
    const listings = result.rows.map(row => ({
      id: row.id,
      kitchenId: row.kitchen_id,
      category: row.category,
      equipmentType: row.equipment_type,
      brand: row.brand,
      model: row.model,
      description: row.description,
      condition: row.condition,
      availabilityType: row.availability_type || 'rental',
      pricingModel: row.pricing_model,
      // PRIMARY: Flat session rate (convert cents to dollars)
      sessionRate: row.session_rate ? parseFloat(String(row.session_rate)) / 100 : 0,
      // Legacy rates (kept for backwards compatibility)
      hourlyRate: row.hourly_rate ? parseFloat(String(row.hourly_rate)) / 100 : null,
      dailyRate: row.daily_rate ? parseFloat(String(row.daily_rate)) / 100 : null,
      weeklyRate: row.weekly_rate ? parseFloat(String(row.weekly_rate)) / 100 : null,
      monthlyRate: row.monthly_rate ? parseFloat(String(row.monthly_rate)) / 100 : null,
      damageDeposit: row.damage_deposit ? parseFloat(String(row.damage_deposit)) / 100 : 0,
      minimumRentalHours: row.minimum_rental_hours ?? 4,
      minimumRentalDays: row.minimum_rental_days,
      trainingRequired: row.training_required ?? false,
      cleaningResponsibility: row.cleaning_responsibility,
      currency: row.currency || 'CAD',
      status: row.status,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json(listings);
  } catch (error) {
    console.error("Error getting equipment listings:", error);
    res.status(500).json({ error: error.message || "Failed to get equipment listings" });
  }
});

// Get single storage listing
app.get("/api/manager/storage-listings/:listingId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const listingId = parseInt(req.params.listingId);
    if (isNaN(listingId) || listingId <= 0) {
      return res.status(400).json({ error: "Invalid listing ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Query listing with direct SQL for numeric fields
    const listingResult = await pool.query(
      `SELECT 
        id, kitchen_id, storage_type, name, description,
        dimensions_length::text as dimensions_length,
        dimensions_width::text as dimensions_width,
        dimensions_height::text as dimensions_height,
        total_volume::text as total_volume,
        shelf_count, shelf_material, access_type,
        features, security_features, climate_control,
        temperature_range, humidity_control, power_outlets,
        pricing_model,
        base_price::text as base_price,
        price_per_cubic_foot::text as price_per_cubic_foot,
        minimum_booking_duration, booking_duration_unit, currency,
        status, approved_by, approved_at, rejection_reason,
        is_active, availability_calendar,
        certifications, photos, documents,
        house_rules, prohibited_items, insurance_required,
        created_at, updated_at
      FROM storage_listings 
      WHERE id = $1`,
      [listingId]
    );

    if (listingResult.rows.length === 0) {
      return res.status(404).json({ error: "Storage listing not found" });
    }

    const row = listingResult.rows[0];

    // Verify the manager has access to this listing's kitchen
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [row.kitchen_id]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this listing" });
    }

    // Convert numeric fields from cents to dollars
    const listing = {
      id: row.id,
      kitchenId: row.kitchen_id,
      storageType: row.storage_type,
      name: row.name,
      description: row.description,
      basePrice: row.base_price ? parseFloat(String(row.base_price)) / 100 : null,
      pricePerCubicFoot: row.price_per_cubic_foot ? parseFloat(String(row.price_per_cubic_foot)) / 100 : null,
      dimensionsLength: row.dimensions_length ? parseFloat(String(row.dimensions_length)) : null,
      dimensionsWidth: row.dimensions_width ? parseFloat(String(row.dimensions_width)) : null,
      dimensionsHeight: row.dimensions_height ? parseFloat(String(row.dimensions_height)) : null,
      totalVolume: row.total_volume ? parseFloat(String(row.total_volume)) : null,
      shelfCount: row.shelf_count,
      shelfMaterial: row.shelf_material,
      accessType: row.access_type,
      temperatureRange: row.temperature_range,
      climateControl: row.climate_control,
      humidityControl: row.humidity_control,
      powerOutlets: row.power_outlets,
      pricingModel: row.pricing_model,
      minimumBookingDuration: row.minimum_booking_duration || 1,
      bookingDurationUnit: row.booking_duration_unit || 'monthly',
      currency: row.currency,
      status: row.status,
      isActive: row.is_active,
      insuranceRequired: row.insurance_required,
      features: row.features || [],
      securityFeatures: row.security_features || [],
      certifications: row.certifications || [],
      photos: row.photos || [],
      documents: row.documents || [],
      houseRules: row.house_rules || [],
      prohibitedItems: row.prohibited_items || [],
      minimumBookingDuration: row.minimum_booking_duration || 1,
      bookingDurationUnit: row.booking_duration_unit || 'monthly',
      availabilityCalendar: row.availability_calendar || {},
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json(listing);
  } catch (error) {
    console.error("Error getting storage listing:", error);
    res.status(500).json({ error: error.message || "Failed to get storage listing" });
  }
});

// Create storage listing
app.post("/api/manager/storage-listings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const { kitchenId, ...listingData } = req.body;

    if (!kitchenId || isNaN(parseInt(kitchenId))) {
      return res.status(400).json({ error: "Valid kitchen ID is required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this kitchen's location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [parseInt(kitchenId)]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Validate required fields
    if (!listingData.name || !listingData.storageType || !listingData.pricingModel || !listingData.basePrice) {
      return res.status(400).json({ error: "Name, storage type, pricing model, and base price are required" });
    }

    // Convert prices from dollars to cents
    const basePriceCents = Math.round(listingData.basePrice * 100);
    const pricePerCubicFootCents = listingData.pricePerCubicFoot ? Math.round(listingData.pricePerCubicFoot * 100) : null;
    
    // Booking duration (defaults if not provided)
    const minimumBookingDuration = listingData.minimumBookingDuration || 1;
    const bookingDurationUnit = listingData.bookingDurationUnit || 'monthly';

    // Build insert query
    // Note: created_at and updated_at have DEFAULT now() in the schema, so we omit them
    const insertQuery = `
      INSERT INTO storage_listings (
        kitchen_id, storage_type, name, description,
        base_price, price_per_cubic_foot, pricing_model,
        minimum_booking_duration, booking_duration_unit, currency,
        dimensions_length, dimensions_width, dimensions_height, total_volume,
        shelf_count, shelf_material, access_type,
        temperature_range, climate_control, humidity_control, power_outlets,
        features, security_features, certifications, photos, documents,
        house_rules, prohibited_items, insurance_required,
        availability_calendar,
        status, is_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
      ) RETURNING id
    `;

    const insertValues = [
      parseInt(kitchenId),
      listingData.storageType,
      listingData.name,
      listingData.description || null,
      basePriceCents,
      pricePerCubicFootCents,
      listingData.pricingModel,
      minimumBookingDuration,
      bookingDurationUnit,
      'CAD', // Always CAD
      listingData.dimensionsLength || null,
      listingData.dimensionsWidth || null,
      listingData.dimensionsHeight || null,
      listingData.totalVolume || null,
      listingData.shelfCount || null,
      listingData.shelfMaterial || null,
      listingData.accessType || null,
      listingData.temperatureRange || null,
      listingData.climateControl || false,
      listingData.humidityControl || false,
      listingData.powerOutlets || 0,
      JSON.stringify(listingData.features || []),
      JSON.stringify(listingData.securityFeatures || []),
      JSON.stringify(listingData.certifications || []),
      JSON.stringify(listingData.photos || []),
      JSON.stringify(listingData.documents || []),
      JSON.stringify(listingData.houseRules || []),
      JSON.stringify(listingData.prohibitedItems || []),
      listingData.insuranceRequired || false,
      JSON.stringify(listingData.availabilityCalendar || {}),
      'active', // Set to active immediately (no admin moderation)
      true,
    ];

    const insertResult = await pool.query(insertQuery, insertValues);
    const newListingId = insertResult.rows[0].id;

    // Fetch the created listing with proper conversion
    const fetchResult = await pool.query(
      `SELECT 
        id, kitchen_id, storage_type, name, description,
        base_price::text as base_price,
        price_per_cubic_foot::text as price_per_cubic_foot,
        pricing_model, minimum_booking_duration, booking_duration_unit, currency,
        status, is_active, created_at, updated_at
      FROM storage_listings
      WHERE id = $1`,
      [newListingId]
    );

    const row = fetchResult.rows[0];
    const created = {
      id: row.id,
      kitchenId: row.kitchen_id,
      storageType: row.storage_type,
      name: row.name,
      description: row.description,
      basePrice: row.base_price ? parseFloat(String(row.base_price)) / 100 : null,
      pricePerCubicFoot: row.price_per_cubic_foot ? parseFloat(String(row.price_per_cubic_foot)) / 100 : null,
      pricingModel: row.pricing_model,
      minimumBookingDuration: row.minimum_booking_duration || 1,
      bookingDurationUnit: row.booking_duration_unit || 'monthly',
      currency: row.currency,
      status: row.status,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    console.log(`✅ Storage listing created by manager ${user.id}`);
    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating storage listing:", error);
    res.status(500).json({ error: error.message || "Failed to create storage listing" });
  }
});

// Update storage listing
app.put("/api/manager/storage-listings/:listingId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const listingId = parseInt(req.params.listingId);
    if (isNaN(listingId) || listingId <= 0) {
      return res.status(400).json({ error: "Invalid listing ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this listing
    const existingResult = await pool.query(
      `SELECT kitchen_id FROM storage_listings WHERE id = $1`,
      [listingId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Storage listing not found" });
    }

    const kitchenId = existingResult.rows[0].kitchen_id;

    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this listing" });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    // Build update query dynamically
    if (req.body.name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(req.body.name);
    }
    if (req.body.description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(req.body.description || null);
    }
    if (req.body.storageType !== undefined) {
      updates.push(`storage_type = $${paramCount++}`);
      values.push(req.body.storageType);
    }
    if (req.body.pricingModel !== undefined) {
      updates.push(`pricing_model = $${paramCount++}`);
      values.push(req.body.pricingModel);
    }
    if (req.body.basePrice !== undefined) {
      updates.push(`base_price = $${paramCount++}`);
      values.push(Math.round(req.body.basePrice * 100)); // Convert to cents
    }
    if (req.body.pricePerCubicFoot !== undefined) {
      updates.push(`price_per_cubic_foot = $${paramCount++}`);
      values.push(req.body.pricePerCubicFoot ? Math.round(req.body.pricePerCubicFoot * 100) : null);
    }
    if (req.body.minimumBookingDuration !== undefined) {
      updates.push(`minimum_booking_duration = $${paramCount++}`);
      values.push(req.body.minimumBookingDuration);
    }
    if (req.body.bookingDurationUnit !== undefined) {
      updates.push(`booking_duration_unit = $${paramCount++}`);
      values.push(req.body.bookingDurationUnit);
    }
    // Currency is always CAD, no need to update
    if (req.body.dimensionsLength !== undefined) {
      updates.push(`dimensions_length = $${paramCount++}`);
      values.push(req.body.dimensionsLength || null);
    }
    if (req.body.dimensionsWidth !== undefined) {
      updates.push(`dimensions_width = $${paramCount++}`);
      values.push(req.body.dimensionsWidth || null);
    }
    if (req.body.dimensionsHeight !== undefined) {
      updates.push(`dimensions_height = $${paramCount++}`);
      values.push(req.body.dimensionsHeight || null);
    }
    if (req.body.totalVolume !== undefined) {
      updates.push(`total_volume = $${paramCount++}`);
      values.push(req.body.totalVolume || null);
    }
    if (req.body.shelfCount !== undefined) {
      updates.push(`shelf_count = $${paramCount++}`);
      values.push(req.body.shelfCount || null);
    }
    if (req.body.shelfMaterial !== undefined) {
      updates.push(`shelf_material = $${paramCount++}`);
      values.push(req.body.shelfMaterial || null);
    }
    if (req.body.accessType !== undefined) {
      updates.push(`access_type = $${paramCount++}`);
      values.push(req.body.accessType || null);
    }
    if (req.body.temperatureRange !== undefined) {
      updates.push(`temperature_range = $${paramCount++}`);
      values.push(req.body.temperatureRange || null);
    }
    if (req.body.climateControl !== undefined) {
      updates.push(`climate_control = $${paramCount++}`);
      values.push(req.body.climateControl);
    }
    if (req.body.humidityControl !== undefined) {
      updates.push(`humidity_control = $${paramCount++}`);
      values.push(req.body.humidityControl);
    }
    if (req.body.powerOutlets !== undefined) {
      updates.push(`power_outlets = $${paramCount++}`);
      values.push(req.body.powerOutlets);
    }
    if (req.body.isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(req.body.isActive);
    }
    if (req.body.insuranceRequired !== undefined) {
      updates.push(`insurance_required = $${paramCount++}`);
      values.push(req.body.insuranceRequired);
    }
    if (req.body.features !== undefined) {
      updates.push(`features = $${paramCount++}`);
      values.push(JSON.stringify(req.body.features));
    }
    if (req.body.securityFeatures !== undefined) {
      updates.push(`security_features = $${paramCount++}`);
      values.push(JSON.stringify(req.body.securityFeatures));
    }
    if (req.body.certifications !== undefined) {
      updates.push(`certifications = $${paramCount++}`);
      values.push(JSON.stringify(req.body.certifications));
    }
    if (req.body.photos !== undefined) {
      updates.push(`photos = $${paramCount++}`);
      values.push(JSON.stringify(req.body.photos));
    }
    if (req.body.documents !== undefined) {
      updates.push(`documents = $${paramCount++}`);
      values.push(JSON.stringify(req.body.documents));
    }
    if (req.body.houseRules !== undefined) {
      updates.push(`house_rules = $${paramCount++}`);
      values.push(JSON.stringify(req.body.houseRules));
    }
    if (req.body.prohibitedItems !== undefined) {
      updates.push(`prohibited_items = $${paramCount++}`);
      values.push(JSON.stringify(req.body.prohibitedItems));
    }
    // Tiered pricing removed - no longer supported
    if (req.body.availabilityCalendar !== undefined) {
      updates.push(`availability_calendar = $${paramCount++}`);
      values.push(JSON.stringify(req.body.availabilityCalendar));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push(`updated_at = NOW()`);
    values.push(listingId);

    const updateQuery = `
      UPDATE storage_listings 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING id
    `;

    await pool.query(updateQuery, values);

    // Fetch the updated listing with proper conversion
    const fetchResult = await pool.query(
      `SELECT 
        id, kitchen_id, storage_type, name, description,
        base_price::text as base_price,
        price_per_cubic_foot::text as price_per_cubic_foot,
        pricing_model, minimum_booking_duration, booking_duration_unit, currency,
        status, is_active, created_at, updated_at
      FROM storage_listings
      WHERE id = $1`,
      [listingId]
    );

    const row = fetchResult.rows[0];
    const updated = {
      id: row.id,
      kitchenId: row.kitchen_id,
      storageType: row.storage_type,
      name: row.name,
      description: row.description,
      basePrice: row.base_price ? parseFloat(String(row.base_price)) / 100 : null,
      pricePerCubicFoot: row.price_per_cubic_foot ? parseFloat(String(row.price_per_cubic_foot)) / 100 : null,
      pricingModel: row.pricing_model,
      minimumBookingDuration: row.minimum_booking_duration || 1,
      bookingDurationUnit: row.booking_duration_unit || 'monthly',
      currency: row.currency,
      status: row.status,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    console.log(`✅ Storage listing ${listingId} updated by manager ${user.id}`);
    res.json(updated);
  } catch (error) {
    console.error("Error updating storage listing:", error);
    res.status(500).json({ error: error.message || "Failed to update storage listing" });
  }
});

// Delete storage listing
app.delete("/api/manager/storage-listings/:listingId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const listingId = parseInt(req.params.listingId);
    if (isNaN(listingId) || listingId <= 0) {
      return res.status(400).json({ error: "Invalid listing ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this listing
    const existingResult = await pool.query(
      `SELECT kitchen_id FROM storage_listings WHERE id = $1`,
      [listingId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Storage listing not found" });
    }

    const kitchenId = existingResult.rows[0].kitchen_id;

    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [kitchenId]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this listing" });
    }

    const deleteResult = await pool.query('DELETE FROM storage_listings WHERE id = $1 RETURNING id', [listingId]);

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: "Storage listing not found or already deleted" });
    }

    console.log(`✅ Storage listing ${listingId} deleted by manager ${user.id}`);
    res.json({ success: true, message: "Storage listing deleted successfully" });
  } catch (error) {
    console.error("Error deleting storage listing:", error);
    res.status(500).json({ error: error.message || "Failed to delete storage listing" });
  }
});

// ===== EQUIPMENT LISTINGS ENDPOINTS =====

// Get equipment listing by ID
app.get("/api/manager/equipment-listings/:listingId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const listingId = parseInt(req.params.listingId);
    if (isNaN(listingId) || listingId <= 0) {
      return res.status(400).json({ error: "Invalid listing ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get equipment listing with proper numeric conversion
    // Note: Must include availability_type and session_rate to match localhost implementation
    // Note: delivery_available, delivery_fee, setup_fee, pickup_required columns don't exist in actual DB schema
    const result = await pool.query(`
      SELECT 
        id, kitchen_id, category, equipment_type, brand, model, description,
        condition, age, service_history,
        dimensions::text as dimensions,
        power_requirements,
        specifications::text as specifications,
        certifications, safety_features,
        pricing_model,
        availability_type,
        session_rate::text as session_rate,
        hourly_rate::text as hourly_rate,
        daily_rate::text as daily_rate,
        weekly_rate::text as weekly_rate,
        monthly_rate::text as monthly_rate,
        minimum_rental_hours, minimum_rental_days, currency,
        usage_restrictions, training_required, cleaning_responsibility,
        status, approved_by, approved_at, rejection_reason,
        is_active, availability_calendar, prep_time_hours,
        photos, manuals, maintenance_log,
        damage_deposit::text as damage_deposit,
        insurance_required,
        created_at, updated_at
      FROM equipment_listings 
      WHERE id = $1
    `, [listingId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Equipment listing not found" });
    }

    const row = result.rows[0];

    // Verify manager access
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [row.kitchen_id]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this listing" });
    }

    // Convert numeric fields from cents to dollars
    // Match localhost implementation exactly with safe JSON parsing
    let dimensions = {};
    let specifications = {};
    
    try {
      if (row.dimensions) {
        // Handle both string (from ::text cast) and object (if already parsed)
        if (typeof row.dimensions === 'string') {
          const trimmed = row.dimensions.trim();
          if (trimmed && trimmed !== 'null' && trimmed !== '') {
            dimensions = JSON.parse(trimmed);
          }
        } else if (typeof row.dimensions === 'object' && row.dimensions !== null) {
          dimensions = row.dimensions;
        }
      }
    } catch (e) {
      console.warn('Error parsing dimensions for equipment listing:', listingId, e);
      dimensions = {};
    }
    
    try {
      if (row.specifications) {
        // Handle both string (from ::text cast) and object (if already parsed)
        if (typeof row.specifications === 'string') {
          const trimmed = row.specifications.trim();
          if (trimmed && trimmed !== 'null' && trimmed !== '') {
            specifications = JSON.parse(trimmed);
          }
        } else if (typeof row.specifications === 'object' && row.specifications !== null) {
          specifications = row.specifications;
        }
      }
    } catch (e) {
      console.warn('Error parsing specifications for equipment listing:', listingId, e);
      specifications = {};
    }
    
    try {
      const listing = {
        id: row.id,
        kitchenId: row.kitchen_id,
        category: row.category,
        equipmentType: row.equipment_type,
        brand: row.brand,
        model: row.model,
        description: row.description,
        condition: row.condition,
        age: row.age,
        serviceHistory: row.service_history,
        dimensions: dimensions,
        powerRequirements: row.power_requirements,
        specifications: specifications,
        certifications: row.certifications || [],
        safetyFeatures: row.safety_features || [],
        pricingModel: row.pricing_model,
        availabilityType: row.availability_type || 'rental',
        // Convert session_rate from cents to dollars (primary pricing field for rental equipment)
        sessionRate: row.session_rate ? parseFloat(String(row.session_rate)) / 100 : null,
        // Legacy rate fields (for backwards compatibility)
        hourlyRate: row.hourly_rate ? parseFloat(String(row.hourly_rate)) / 100 : null,
        dailyRate: row.daily_rate ? parseFloat(String(row.daily_rate)) / 100 : null,
      weeklyRate: row.weekly_rate ? parseFloat(String(row.weekly_rate)) / 100 : null,
      monthlyRate: row.monthly_rate ? parseFloat(String(row.monthly_rate)) / 100 : null,
      minimumRentalHours: row.minimum_rental_hours || 4,
      minimumRentalDays: row.minimum_rental_days,
      currency: row.currency || 'CAD',
      usageRestrictions: row.usage_restrictions || [],
      trainingRequired: row.training_required,
      cleaningResponsibility: row.cleaning_responsibility,
      status: row.status,
      isActive: row.is_active,
      availabilityCalendar: row.availability_calendar || {},
      prepTimeHours: row.prep_time_hours || 4,
      photos: row.photos || [],
      manuals: row.manuals || [],
      maintenanceLog: row.maintenance_log || [],
      damageDeposit: row.damage_deposit ? parseFloat(String(row.damage_deposit)) / 100 : null,
      insuranceRequired: row.insurance_required,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

      res.json(listing);
    } catch (buildError) {
      console.error('Error building equipment listing response:', buildError);
      console.error('Row data:', JSON.stringify(row, null, 2));
      throw buildError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    console.error("Error getting equipment listing:", error);
    res.status(500).json({ error: error.message || "Failed to get equipment listing" });
  }
});

// Create equipment listing
app.post("/api/manager/equipment-listings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const { kitchenId, ...listingData } = req.body;

    if (!kitchenId || isNaN(parseInt(kitchenId))) {
      return res.status(400).json({ error: "Valid kitchen ID is required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this kitchen's location
    const kitchenResult = await pool.query(`
      SELECT k.*, l.manager_id 
      FROM kitchens k 
      JOIN locations l ON k.location_id = l.id 
      WHERE k.id = $1
    `, [parseInt(kitchenId)]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const kitchen = kitchenResult.rows[0];
    if (kitchen.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Validate required fields
    if (!listingData.equipmentType || !listingData.category || !listingData.condition) {
      return res.status(400).json({ error: "Equipment type, category, and condition are required" });
    }

    // Validate availability type
    if (!listingData.availabilityType || !['included', 'rental'].includes(listingData.availabilityType)) {
      return res.status(400).json({ error: "Availability type must be 'included' or 'rental'" });
    }

    // For rental equipment, validate session rate (flat per-session pricing)
    let sessionRateCents = 0;
    let damageDepositCents = 0;

    if (listingData.availabilityType === 'rental') {
      // Validate that session rate is provided for rental equipment
      if (!listingData.sessionRate || listingData.sessionRate <= 0) {
        return res.status(400).json({ error: "Session rate is required for rental equipment" });
      }

      // Convert prices from dollars to cents
      sessionRateCents = Math.round(listingData.sessionRate * 100);
      damageDepositCents = listingData.damageDeposit ? Math.round(listingData.damageDeposit * 100) : 0;
    }

    // Insert equipment listing with simplified session_rate pricing
    // Note: created_at and updated_at have DEFAULT now() in the schema, so we omit them
    const insertResult = await pool.query(`
      INSERT INTO equipment_listings (
        kitchen_id, category, equipment_type, brand, model, description,
        condition, age, service_history, dimensions, power_requirements,
        specifications, certifications, safety_features,
        availability_type,
        session_rate, pricing_model, currency,
        usage_restrictions, training_required, cleaning_responsibility,
        prep_time_hours, photos, manuals, maintenance_log,
        damage_deposit, insurance_required, availability_calendar,
        status, is_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
        $27, $28, $29, $30
      ) RETURNING id
    `, [
      parseInt(kitchenId),
      listingData.category,
      listingData.equipmentType,
      listingData.brand || null,
      listingData.model || null,
      listingData.description || null,
      listingData.condition,
      listingData.age || null,
      listingData.serviceHistory || null,
      JSON.stringify(listingData.dimensions || {}),
      listingData.powerRequirements || null,
      JSON.stringify(listingData.specifications || {}),
      JSON.stringify(listingData.certifications || []),
      JSON.stringify(listingData.safetyFeatures || []),
      listingData.availabilityType || 'rental',
      listingData.availabilityType === 'rental' ? sessionRateCents.toString() : '0', // session_rate in cents
      listingData.availabilityType === 'rental' ? 'hourly' : null, // Keep pricing_model for backwards compatibility
      'CAD',
      JSON.stringify(listingData.usageRestrictions || []),
      listingData.trainingRequired || false,
      listingData.cleaningResponsibility || null,
      listingData.prepTimeHours || 4,
      JSON.stringify(listingData.photos || []),
      JSON.stringify(listingData.manuals || []),
      JSON.stringify(listingData.maintenanceLog || []),
      listingData.availabilityType === 'rental' ? (damageDepositCents.toString()) : '0',
      listingData.insuranceRequired || false,
      JSON.stringify(listingData.availabilityCalendar || {}),
      'active', // Set to active immediately (no admin moderation)
      true,
    ]);

    const createdId = insertResult.rows[0].id;

    // Fetch the created listing
    // Only select columns that actually exist in the database schema
    const getResult = await pool.query(`
      SELECT 
        id, kitchen_id, category, equipment_type, brand, model, description,
        condition, age, service_history,
        dimensions::text as dimensions,
        power_requirements,
        specifications::text as specifications,
        certifications, safety_features,
        pricing_model,
        availability_type,
        session_rate::text as session_rate,
        hourly_rate::text as hourly_rate,
        daily_rate::text as daily_rate,
        weekly_rate::text as weekly_rate,
        monthly_rate::text as monthly_rate,
        minimum_rental_hours, minimum_rental_days, currency,
        usage_restrictions, training_required, cleaning_responsibility,
        status, is_active, availability_calendar, prep_time_hours,
        photos, manuals, maintenance_log,
        damage_deposit::text as damage_deposit,
        insurance_required,
        created_at, updated_at
      FROM equipment_listings 
      WHERE id = $1
    `, [createdId]);

    const row = getResult.rows[0];
    
    // Safe JSON parsing
    let dimensions = {};
    let specifications = {};
    
    try {
      if (row.dimensions && typeof row.dimensions === 'string') {
        const trimmed = row.dimensions.trim();
        if (trimmed && trimmed !== 'null' && trimmed !== '') {
          dimensions = JSON.parse(trimmed);
        }
      } else if (row.dimensions && typeof row.dimensions === 'object' && row.dimensions !== null) {
        dimensions = row.dimensions;
      }
    } catch (e) {
      console.warn('Error parsing dimensions in create response:', createdId, e);
      dimensions = {};
    }
    
    try {
      if (row.specifications && typeof row.specifications === 'string') {
        const trimmed = row.specifications.trim();
        if (trimmed && trimmed !== 'null' && trimmed !== '') {
          specifications = JSON.parse(trimmed);
        }
      } else if (row.specifications && typeof row.specifications === 'object' && row.specifications !== null) {
        specifications = row.specifications;
      }
    } catch (e) {
      console.warn('Error parsing specifications in create response:', createdId, e);
      specifications = {};
    }
    
    const created = {
      id: row.id,
      kitchenId: row.kitchen_id,
      category: row.category,
      equipmentType: row.equipment_type,
      brand: row.brand,
      model: row.model,
      description: row.description,
      condition: row.condition,
      age: row.age,
      serviceHistory: row.service_history,
      dimensions: dimensions,
      powerRequirements: row.power_requirements,
      specifications: specifications,
      certifications: row.certifications || [],
      safetyFeatures: row.safety_features || [],
      pricingModel: row.pricing_model,
      availabilityType: row.availability_type || 'rental',
      sessionRate: row.session_rate ? parseFloat(String(row.session_rate)) / 100 : null,
      hourlyRate: row.hourly_rate ? parseFloat(String(row.hourly_rate)) / 100 : null,
      dailyRate: row.daily_rate ? parseFloat(String(row.daily_rate)) / 100 : null,
      weeklyRate: row.weekly_rate ? parseFloat(String(row.weekly_rate)) / 100 : null,
      monthlyRate: row.monthly_rate ? parseFloat(String(row.monthly_rate)) / 100 : null,
      minimumRentalHours: row.minimum_rental_hours || 4,
      minimumRentalDays: row.minimum_rental_days,
      currency: row.currency || 'CAD',
      usageRestrictions: row.usage_restrictions || [],
      trainingRequired: row.training_required,
      cleaningResponsibility: row.cleaning_responsibility,
      status: row.status,
      isActive: row.is_active,
      availabilityCalendar: row.availability_calendar || {},
      prepTimeHours: row.prep_time_hours || 4,
      photos: row.photos || [],
      manuals: row.manuals || [],
      maintenanceLog: row.maintenance_log || [],
      damageDeposit: row.damage_deposit ? parseFloat(String(row.damage_deposit)) / 100 : null,
      insuranceRequired: row.insurance_required,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    console.log(`✅ Equipment listing created by manager ${user.id}`);
    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating equipment listing:", error);
    res.status(500).json({ error: error.message || "Failed to create equipment listing" });
  }
});

// Update equipment listing
app.put("/api/manager/equipment-listings/:listingId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const listingId = parseInt(req.params.listingId);
    if (isNaN(listingId) || listingId <= 0) {
      return res.status(400).json({ error: "Invalid listing ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this listing
    const existingResult = await pool.query(`
      SELECT e.*, k.location_id, l.manager_id
      FROM equipment_listings e
      JOIN kitchens k ON e.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE e.id = $1
    `, [listingId]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Equipment listing not found" });
    }

    const existing = existingResult.rows[0];
    if (existing.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this listing" });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (req.body.category !== undefined) {
      updates.push(`category = $${paramCount++}`);
      values.push(req.body.category);
    }
    if (req.body.equipmentType !== undefined) {
      updates.push(`equipment_type = $${paramCount++}`);
      values.push(req.body.equipmentType);
    }
    if (req.body.brand !== undefined) {
      updates.push(`brand = $${paramCount++}`);
      values.push(req.body.brand);
    }
    if (req.body.model !== undefined) {
      updates.push(`model = $${paramCount++}`);
      values.push(req.body.model);
    }
    if (req.body.description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(req.body.description);
    }
    if (req.body.condition !== undefined) {
      updates.push(`condition = $${paramCount++}`);
      values.push(req.body.condition);
    }
    if (req.body.age !== undefined) {
      updates.push(`age = $${paramCount++}`);
      values.push(req.body.age);
    }
    if (req.body.serviceHistory !== undefined) {
      updates.push(`service_history = $${paramCount++}`);
      values.push(req.body.serviceHistory);
    }
    if (req.body.dimensions !== undefined) {
      updates.push(`dimensions = $${paramCount++}`);
      values.push(JSON.stringify(req.body.dimensions));
    }
    if (req.body.powerRequirements !== undefined) {
      updates.push(`power_requirements = $${paramCount++}`);
      values.push(req.body.powerRequirements);
    }
    if (req.body.specifications !== undefined) {
      updates.push(`specifications = $${paramCount++}`);
      values.push(JSON.stringify(req.body.specifications));
    }
    if (req.body.pricingModel !== undefined) {
      updates.push(`pricing_model = $${paramCount++}`);
      values.push(req.body.pricingModel);
    }
    if (req.body.hourlyRate !== undefined) {
      updates.push(`hourly_rate = $${paramCount++}`);
      values.push(req.body.hourlyRate ? Math.round(req.body.hourlyRate * 100) : null);
    }
    if (req.body.dailyRate !== undefined) {
      updates.push(`daily_rate = $${paramCount++}`);
      values.push(req.body.dailyRate ? Math.round(req.body.dailyRate * 100) : null);
    }
    if (req.body.weeklyRate !== undefined) {
      updates.push(`weekly_rate = $${paramCount++}`);
      values.push(req.body.weeklyRate ? Math.round(req.body.weeklyRate * 100) : null);
    }
    if (req.body.monthlyRate !== undefined) {
      updates.push(`monthly_rate = $${paramCount++}`);
      values.push(req.body.monthlyRate ? Math.round(req.body.monthlyRate * 100) : null);
    }
    if (req.body.minimumRentalHours !== undefined) {
      updates.push(`minimum_rental_hours = $${paramCount++}`);
      values.push(req.body.minimumRentalHours);
    }
    if (req.body.minimumRentalDays !== undefined) {
      updates.push(`minimum_rental_days = $${paramCount++}`);
      values.push(req.body.minimumRentalDays);
    }
    // Note: delivery_available, delivery_fee, setup_fee, pickup_required columns don't exist in DB
    // These fields are ignored if sent in the request
    if (req.body.usageRestrictions !== undefined) {
      updates.push(`usage_restrictions = $${paramCount++}`);
      values.push(JSON.stringify(req.body.usageRestrictions));
    }
    if (req.body.trainingRequired !== undefined) {
      updates.push(`training_required = $${paramCount++}`);
      values.push(req.body.trainingRequired);
    }
    if (req.body.cleaningResponsibility !== undefined) {
      updates.push(`cleaning_responsibility = $${paramCount++}`);
      values.push(req.body.cleaningResponsibility);
    }
    if (req.body.isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(req.body.isActive);
    }
    if (req.body.prepTimeHours !== undefined) {
      updates.push(`prep_time_hours = $${paramCount++}`);
      values.push(req.body.prepTimeHours);
    }
    if (req.body.damageDeposit !== undefined) {
      updates.push(`damage_deposit = $${paramCount++}`);
      values.push(req.body.damageDeposit ? Math.round(req.body.damageDeposit * 100) : null);
    }
    if (req.body.insuranceRequired !== undefined) {
      updates.push(`insurance_required = $${paramCount++}`);
      values.push(req.body.insuranceRequired);
    }
    if (req.body.certifications !== undefined) {
      updates.push(`certifications = $${paramCount++}`);
      values.push(JSON.stringify(req.body.certifications));
    }
    if (req.body.safetyFeatures !== undefined) {
      updates.push(`safety_features = $${paramCount++}`);
      values.push(JSON.stringify(req.body.safetyFeatures));
    }
    if (req.body.photos !== undefined) {
      updates.push(`photos = $${paramCount++}`);
      values.push(JSON.stringify(req.body.photos));
    }
    if (req.body.manuals !== undefined) {
      updates.push(`manuals = $${paramCount++}`);
      values.push(JSON.stringify(req.body.manuals));
    }
    if (req.body.maintenanceLog !== undefined) {
      updates.push(`maintenance_log = $${paramCount++}`);
      values.push(JSON.stringify(req.body.maintenanceLog));
    }
    if (req.body.availabilityCalendar !== undefined) {
      updates.push(`availability_calendar = $${paramCount++}`);
      values.push(JSON.stringify(req.body.availabilityCalendar));
    }

    updates.push(`updated_at = now()`);
    values.push(listingId);

    if (updates.length === 1) {
      // Only updated_at, nothing to update
      return res.json(existing);
    }

    const updateQuery = `
      UPDATE equipment_listings 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id
    `;

    await pool.query(updateQuery, values);

    // Fetch updated listing
    // Note: delivery_available, delivery_fee, setup_fee, pickup_required columns don't exist in DB
    const getResult = await pool.query(`
      SELECT 
        id, kitchen_id, category, equipment_type, brand, model, description,
        condition, age, service_history,
        dimensions::text as dimensions,
        power_requirements,
        specifications::text as specifications,
        certifications, safety_features,
        pricing_model,
        availability_type,
        session_rate::text as session_rate,
        hourly_rate::text as hourly_rate,
        daily_rate::text as daily_rate,
        weekly_rate::text as weekly_rate,
        monthly_rate::text as monthly_rate,
        minimum_rental_hours, minimum_rental_days, currency,
        usage_restrictions, training_required, cleaning_responsibility,
        status, is_active, availability_calendar, prep_time_hours,
        photos, manuals, maintenance_log,
        damage_deposit::text as damage_deposit,
        insurance_required,
        created_at, updated_at
      FROM equipment_listings 
      WHERE id = $1
    `, [listingId]);

    const row = getResult.rows[0];
    
    // Safe JSON parsing for dimensions and specifications
    let dimensions = {};
    let specifications = {};
    
    try {
      if (row.dimensions && typeof row.dimensions === 'string') {
        const trimmed = row.dimensions.trim();
        if (trimmed && trimmed !== 'null' && trimmed !== '') {
          dimensions = JSON.parse(trimmed);
        }
      } else if (row.dimensions && typeof row.dimensions === 'object' && row.dimensions !== null) {
        dimensions = row.dimensions;
      }
    } catch (e) {
      console.warn('Error parsing dimensions in update response:', listingId, e);
      dimensions = {};
    }
    
    try {
      if (row.specifications && typeof row.specifications === 'string') {
        const trimmed = row.specifications.trim();
        if (trimmed && trimmed !== 'null' && trimmed !== '') {
          specifications = JSON.parse(trimmed);
        }
      } else if (row.specifications && typeof row.specifications === 'object' && row.specifications !== null) {
        specifications = row.specifications;
      }
    } catch (e) {
      console.warn('Error parsing specifications in update response:', listingId, e);
      specifications = {};
    }
    
    const updated = {
      id: row.id,
      kitchenId: row.kitchen_id,
      category: row.category,
      equipmentType: row.equipment_type,
      brand: row.brand,
      model: row.model,
      description: row.description,
      condition: row.condition,
      age: row.age,
      serviceHistory: row.service_history,
      dimensions: dimensions,
      powerRequirements: row.power_requirements,
      specifications: specifications,
      certifications: row.certifications || [],
      safetyFeatures: row.safety_features || [],
      pricingModel: row.pricing_model,
      availabilityType: row.availability_type || 'rental',
      sessionRate: row.session_rate ? parseFloat(String(row.session_rate)) / 100 : null,
      hourlyRate: row.hourly_rate ? parseFloat(String(row.hourly_rate)) / 100 : null,
      dailyRate: row.daily_rate ? parseFloat(String(row.daily_rate)) / 100 : null,
      weeklyRate: row.weekly_rate ? parseFloat(String(row.weekly_rate)) / 100 : null,
      monthlyRate: row.monthly_rate ? parseFloat(String(row.monthly_rate)) / 100 : null,
      minimumRentalHours: row.minimum_rental_hours || 4,
      minimumRentalDays: row.minimum_rental_days,
      currency: row.currency || 'CAD',
      usageRestrictions: row.usage_restrictions || [],
      trainingRequired: row.training_required,
      cleaningResponsibility: row.cleaning_responsibility,
      status: row.status,
      isActive: row.is_active,
      availabilityCalendar: row.availability_calendar || {},
      prepTimeHours: row.prep_time_hours || 4,
      photos: row.photos || [],
      manuals: row.manuals || [],
      maintenanceLog: row.maintenance_log || [],
      damageDeposit: row.damage_deposit ? parseFloat(String(row.damage_deposit)) / 100 : null,
      insuranceRequired: row.insurance_required,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    console.log(`✅ Equipment listing ${listingId} updated by manager ${user.id}`);
    res.json(updated);
  } catch (error) {
    console.error("Error updating equipment listing:", error);
    res.status(500).json({ error: error.message || "Failed to update equipment listing" });
  }
});

// Delete equipment listing
app.delete("/api/manager/equipment-listings/:listingId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    if (user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const listingId = parseInt(req.params.listingId);
    if (isNaN(listingId) || listingId <= 0) {
      return res.status(400).json({ error: "Invalid listing ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify the manager has access to this listing
    const existingResult = await pool.query(`
      SELECT e.*, k.location_id, l.manager_id
      FROM equipment_listings e
      JOIN kitchens k ON e.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE e.id = $1
    `, [listingId]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Equipment listing not found" });
    }

    const existing = existingResult.rows[0];
    if (existing.manager_id !== user.id) {
      return res.status(403).json({ error: "Access denied to this listing" });
    }

    const deleteResult = await pool.query('DELETE FROM equipment_listings WHERE id = $1 RETURNING id', [listingId]);

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: "Equipment listing not found or already deleted" });
    }

    console.log(`✅ Equipment listing ${listingId} deleted by manager ${user.id}`);
    res.json({ success: true, message: "Equipment listing deleted successfully" });
  } catch (error) {
    console.error("Error deleting equipment listing:", error);
    res.status(500).json({ error: error.message || "Failed to delete equipment listing" });
  }
});

// Get all bookings for manager
// Manager: Get chef profiles for locations managed by this manager
app.get("/api/manager/chef-profiles", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get all locations managed by this manager
    const locationsResult = await pool.query(`
      SELECT id FROM locations WHERE manager_id = $1
    `, [user.id]);
    
    if (locationsResult.rows.length === 0) {
      return res.json([]);
    }
    
    const locationIds = locationsResult.rows.map(row => row.id);

    // Get all chef profiles for these locations (NEW - location-based)
    let profilesResult;
    try {
      profilesResult = await pool.query(`
        SELECT * FROM chef_location_profiles 
        WHERE location_id = ANY($1::int[])
        ORDER BY shared_at DESC
      `, [locationIds]);
    } catch (error) {
      // If table doesn't exist, return empty array
      if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
        console.log(`[Manager Chef Profiles] chef_location_profiles table doesn't exist yet`);
        return res.json([]);
      }
      throw error;
    }

    // Enrich with chef, location, and application details
    const enrichedProfiles = await Promise.all(
      profilesResult.rows.map(async (profile) => {
        // Get chef details
        const chefResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [profile.chef_id]);
        const chef = chefResult.rows[0] || null;

        // Get location details
        const locationResult = await pool.query('SELECT id, name, address FROM locations WHERE id = $1', [profile.location_id]);
        const location = locationResult.rows[0] || null;

        // Get chef's latest approved application
        const appResult = await pool.query(`
          SELECT id, full_name, email, phone, food_safety_license_url, food_establishment_cert_url
          FROM applications
          WHERE user_id = $1 AND status = 'approved'
          ORDER BY created_at DESC
          LIMIT 1
        `, [profile.chef_id]);
        const latestApp = appResult.rows[0] || null;

        return {
          id: profile.id,
          chefId: profile.chef_id,
          locationId: profile.location_id,
          status: profile.status,
          sharedAt: profile.shared_at,
          reviewedBy: profile.reviewed_by,
          reviewedAt: profile.reviewed_at,
          reviewFeedback: profile.review_feedback,
          chef: chef ? {
            id: chef.id,
            username: chef.username,
          } : null,
          location: location ? {
            id: location.id,
            name: location.name,
            address: location.address,
          } : null,
          application: latestApp ? {
            id: latestApp.id,
            fullName: latestApp.full_name,
            email: latestApp.email,
            phone: latestApp.phone,
            foodSafetyLicenseUrl: latestApp.food_safety_license_url,
            foodEstablishmentCertUrl: latestApp.food_establishment_cert_url,
          } : null,
        };
      })
    );

    res.json(enrichedProfiles);
  } catch (error) {
    console.error("Error getting chef profiles for manager:", error);
    res.status(500).json({ error: error.message || "Failed to get profiles" });
  }
});

// Manager: Complete onboarding
app.post("/api/manager/complete-onboarding", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const { skipped } = req.body;

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Update user onboarding status
    await pool.query(
      `UPDATE users 
       SET manager_onboarding_completed = $1, 
           manager_onboarding_skipped = $2 
       WHERE id = $3`,
      [!skipped, !!skipped, user.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error completing onboarding:", error);
    res.status(500).json({ error: error.message || "Failed to complete onboarding" });
  }
});

// Manager: Update location (for onboarding)
app.put("/api/manager/locations/:id", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const locationId = parseInt(req.params.id);
    if (isNaN(locationId)) {
      return res.status(400).json({ error: "Invalid location ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify this location is managed by this manager
    const locationCheck = await pool.query(
      'SELECT id FROM locations WHERE id = $1 AND manager_id = $2',
      [locationId, user.id]
    );

    if (locationCheck.rows.length === 0) {
      return res.status(403).json({ error: "You don't have permission to manage this location" });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;

    const allowedFields = [
      'name', 'address', 'notificationEmail', 'notificationPhone',
      'kitchenLicenseUrl', 'kitchenLicenseStatus'
    ];

    Object.keys(req.body).forEach((key) => {
      if (allowedFields.includes(key)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${dbKey} = $${paramIndex}`);
        values.push(req.body[key]);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    updates.push(`updated_at = NOW()`);
    values.push(locationId);

    const query = `UPDATE locations SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, values);

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({ error: error.message || "Failed to update location" });
  }
});

// Manager: Revoke chef location access
app.delete("/api/manager/chef-location-access", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const { chefId, locationId } = req.body;
    
    if (!chefId || !locationId) {
      return res.status(400).json({ error: "chefId and locationId are required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify this location is managed by this manager
    const locationCheck = await pool.query(
      'SELECT id FROM locations WHERE id = $1 AND manager_id = $2',
      [locationId, user.id]
    );

    if (locationCheck.rows.length === 0) {
      return res.status(403).json({ error: "You don't have permission to manage this location" });
    }

    // Revoke access
    const result = await pool.query(
      'DELETE FROM chef_location_access WHERE chef_id = $1 AND location_id = $2 RETURNING id',
      [chefId, locationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Access record not found" });
    }

    // Also update the chef profile status to rejected if it exists
    try {
      await pool.query(
        'UPDATE chef_location_profiles SET status = $1, reviewed_by = $2, reviewed_at = now(), review_feedback = $3 WHERE chef_id = $4 AND location_id = $5',
        ['rejected', user.id, 'Access revoked by manager', chefId, locationId]
      );
    } catch (error) {
      // Ignore if table doesn't exist or update fails
      console.log('Note: Could not update chef profile status:', error.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error revoking chef location access:", error);
    res.status(500).json({ error: error.message || "Failed to revoke access" });
  }
});

// Manager: Approve or reject chef profile
app.put("/api/manager/chef-profiles/:id/status", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const profileId = parseInt(req.params.id);
    const { status, reviewFeedback } = req.body;
    
    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify this profile belongs to a location managed by this manager
    let profileCheck;
    try {
      profileCheck = await pool.query(`
        SELECT clp.*, l.manager_id
        FROM chef_location_profiles clp
        INNER JOIN locations l ON l.id = clp.location_id
        WHERE clp.id = $1
      `, [profileId]);
    } catch (error) {
      if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
        return res.status(404).json({ error: "Profile not found or table doesn't exist" });
      }
      throw error;
    }

    if (profileCheck.rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const profile = profileCheck.rows[0];
    if (profile.manager_id !== user.id) {
      return res.status(403).json({ error: "You don't have permission to manage this profile" });
    }

    // Update the profile status
    const updateResult = await pool.query(`
      UPDATE chef_location_profiles
      SET status = $1,
          reviewed_by = $2,
          reviewed_at = NOW(),
          review_feedback = $3
      WHERE id = $4
      RETURNING *
    `, [status, user.id, reviewFeedback || null, profileId]);

    const updated = updateResult.rows[0];
    
    // Send email notification to chef when access is approved
    if (status === 'approved') {
      try {
        // Get location details
        const locationData = await pool.query(`
          SELECT l.id, l.name
          FROM locations l
          WHERE l.id = $1
        `, [updated.location_id]);
        
        if (locationData.rows.length > 0) {
          const location = locationData.rows[0];
          
          // Get chef details
          const chefData = await pool.query(`
            SELECT id, username
            FROM users
            WHERE id = $1
          `, [updated.chef_id]);
          
          if (chefData.rows.length > 0) {
            const chef = chefData.rows[0];
            
            // Import email functions
            const { sendEmail, generateChefLocationAccessApprovedEmail } = await import('../server/email.js');
            
            try {
              const chefEmail = generateChefLocationAccessApprovedEmail({
                chefEmail: chef.username,
                chefName: chef.username,
                locationName: location.name,
                locationId: location.id
              });
              await sendEmail(chefEmail);
              console.log(`✅ Chef location access approved email sent to chef: ${chef.username}`);
            } catch (emailError) {
              console.error("Error sending chef approval email:", emailError);
              console.error("Chef email error details:", emailError instanceof Error ? emailError.message : emailError);
            }
          }
        }
      } catch (emailError) {
        console.error("Error sending chef approval emails:", emailError);
        // Don't fail the status update if emails fail
      }
    }
    
    res.json({
      id: updated.id,
      chefId: updated.chef_id,
      locationId: updated.location_id,
      status: updated.status,
      sharedAt: updated.shared_at,
      reviewedBy: updated.reviewed_by,
      reviewedAt: updated.reviewed_at,
      reviewFeedback: updated.review_feedback,
    });
  } catch (error) {
    console.error("Error updating chef profile status:", error);
    res.status(500).json({ error: error.message || "Failed to update profile status" });
  }
});

// Manager: Get portal user applications for review
app.get("/api/manager/portal-applications", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    console.log(`[Manager Portal Applications] Fetching for manager ID: ${user.id}`);

    if (!pool) {
      return res.json([]);
    }

    // Check if tables exist
    const tableCheck = await pool.query(`
      SELECT to_regclass('public.portal_user_applications') as applications_exists,
             to_regclass('public.locations') as locations_exists;
    `);

    if (!tableCheck.rows[0].applications_exists || !tableCheck.rows[0].locations_exists) {
      console.log(`[Manager Portal Applications] Tables don't exist yet`);
      return res.json([]);
    }

    // Get all locations managed by this manager
    const locationsResult = await pool.query(`
      SELECT id, name, address 
      FROM locations 
      WHERE manager_id = $1
    `, [user.id]);

    console.log(`[Manager Portal Applications] Found ${locationsResult.rows.length} managed locations`);

    if (locationsResult.rows.length === 0) {
      console.log(`[Manager Portal Applications] No locations found for manager ${user.id}`);
      return res.json([]);
    }

    const locationIds = locationsResult.rows.map(loc => loc.id);
    console.log(`[Manager Portal Applications] Location IDs: ${locationIds.join(', ')}`);

    // Get ALL portal user applications for these locations (not just inReview)
    const applicationsResult = await pool.query(`
      SELECT 
        pua.id,
        pua.user_id as "userId",
        pua.location_id as "locationId",
        pua.full_name as "fullName",
        pua.email,
        pua.phone,
        pua.company,
        pua.status,
        pua.feedback,
        pua.reviewed_by as "reviewedBy",
        pua.reviewed_at as "reviewedAt",
        pua.created_at as "createdAt",
        l.id as location_id,
        l.name as location_name,
        l.address as location_address,
        u.id as user_id,
        u.username as user_username
      FROM portal_user_applications pua
      INNER JOIN locations l ON l.id = pua.location_id
      INNER JOIN users u ON u.id = pua.user_id
      WHERE pua.location_id = ANY($1::int[])
      ORDER BY pua.created_at DESC
    `, [locationIds]);

    console.log(`[Manager Portal Applications] Found ${applicationsResult.rows.length} total applications`);

    // Format response
    const formatted = applicationsResult.rows.map(app => ({
      id: app.id,
      userId: app.userId,
      locationId: app.locationId,
      fullName: app.fullName,
      email: app.email,
      phone: app.phone,
      company: app.company,
      status: app.status,
      feedback: app.feedback,
      reviewedBy: app.reviewedBy,
      reviewedAt: app.reviewedAt,
      createdAt: app.createdAt,
      location: {
        id: app.location_id,
        name: app.location_name,
        address: app.location_address,
      },
      user: {
        id: app.user_id,
        username: app.user_username,
      },
    }));

    console.log(`[Manager Portal Applications] Returning ${formatted.length} applications (statuses: ${formatted.map(a => a.status).join(', ')})`);

    res.json(formatted);
  } catch (error) {
    console.error("Error getting portal applications for manager:", error);
    res.status(500).json({ error: error.message || "Failed to get applications" });
  }
});

// Manager: Approve or reject portal user application
app.put("/api/manager/portal-applications/:id/status", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const applicationId = parseInt(req.params.id);
    const { status, feedback } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Check if tables exist
    const tableCheck = await pool.query(`
      SELECT to_regclass('public.portal_user_applications') as applications_exists,
             to_regclass('public.portal_user_location_access') as access_exists;
    `);

    if (!tableCheck.rows[0].applications_exists) {
      return res.status(404).json({ 
        error: "Database migration required",
        details: "Run: migrations/0005_add_portal_user_tables.sql"
      });
    }

    // Verify this application belongs to a location managed by this manager
    const applicationCheck = await pool.query(`
      SELECT pua.*, l.manager_id, l.name as location_name, l.notification_email
      FROM portal_user_applications pua
      INNER JOIN locations l ON l.id = pua.location_id
      WHERE pua.id = $1
    `, [applicationId]);

    if (applicationCheck.rows.length === 0) {
      return res.status(404).json({ error: "Application not found" });
    }

    const application = applicationCheck.rows[0];
    if (application.manager_id !== user.id) {
      return res.status(403).json({ error: "You don't have permission to manage this application" });
    }

    // Update application status
    const updateResult = await pool.query(`
      UPDATE portal_user_applications
      SET status = $1,
          reviewed_by = $2,
          reviewed_at = NOW(),
          feedback = $3
      WHERE id = $4
      RETURNING *
    `, [status, user.id, feedback || null, applicationId]);

    const updated = updateResult.rows[0];

    // If approved, create access record
    if (status === 'approved') {
      // Check if access record already exists
      const existingAccess = await pool.query(`
        SELECT * FROM portal_user_location_access
        WHERE portal_user_id = $1 AND location_id = $2
      `, [application.user_id, application.location_id]);

      if (existingAccess.rows.length === 0) {
        // Create access record
        if (tableCheck.rows[0].access_exists) {
          await pool.query(`
            INSERT INTO portal_user_location_access (portal_user_id, location_id, granted_by, application_id)
            VALUES ($1, $2, $3, $4)
          `, [application.user_id, application.location_id, user.id, applicationId]);
        }
      }
    }

    // Get user details for email
    const userResult = await pool.query(`
      SELECT username FROM users WHERE id = $1
    `, [application.user_id]);

    const portalUser = userResult.rows[0];

    // Send email notification
    try {
      const { sendEmail } = await import('../server/email.js');
      
      const managerEmail = application.notification_email || application.manager_id;
      const portalUserEmail = application.email || portalUser.username;

      if (status === 'approved') {
        const approvalEmail = {
          to: portalUserEmail,
          subject: `Portal Access Approved - ${application.location_name}`,
          text: `Your portal user application for ${application.location_name} has been approved!\n\n` +
                `You can now access the location and book kitchens.\n\n` +
                (feedback ? `Manager Feedback: ${feedback}\n\n` : '') +
                `Login at: ${process.env.BASE_URL || 'http://localhost:5000'}/portal/login`,
          html: `<h2>Portal Access Approved</h2>` +
                `<p>Your portal user application for <strong>${application.location_name}</strong> has been approved!</p>` +
                `<p>You can now access the location and book kitchens.</p>` +
                (feedback ? `<p><strong>Manager Feedback:</strong> ${feedback}</p>` : '') +
                `<p><a href="${process.env.NODE_ENV === 'production' ? `https://kitchen.${process.env.BASE_DOMAIN || 'localcooks.ca'}` : (process.env.BASE_URL || 'http://localhost:5000')}/portal/login">Login to Portal</a></p>`
        };
        await sendEmail(approvalEmail);
        console.log(`✅ Portal access approval email sent to: ${portalUserEmail}`);
      } else {
        const rejectionEmail = {
          to: portalUserEmail,
          subject: `Portal Access Application - ${application.location_name}`,
          text: `Your portal user application for ${application.location_name} has been reviewed.\n\n` +
                `Unfortunately, your application was not approved at this time.\n\n` +
                (feedback ? `Manager Feedback: ${feedback}\n\n` : '') +
                `If you have questions, please contact the location manager.`,
          html: `<h2>Portal Access Application</h2>` +
                `<p>Your portal user application for <strong>${application.location_name}</strong> has been reviewed.</p>` +
                `<p>Unfortunately, your application was not approved at this time.</p>` +
                (feedback ? `<p><strong>Manager Feedback:</strong> ${feedback}</p>` : '') +
                `<p>If you have questions, please contact the location manager.</p>`
        };
        await sendEmail(rejectionEmail);
        console.log(`✅ Portal access rejection email sent to: ${portalUserEmail}`);
      }
    } catch (emailError) {
      console.error("Error sending portal application status email:", emailError);
      // Don't fail the status update if emails fail
    }

    res.json({
      id: updated.id,
      userId: updated.user_id,
      locationId: updated.location_id,
      status: updated.status,
      feedback: updated.feedback,
      reviewedBy: updated.reviewed_by,
      reviewedAt: updated.reviewed_at,
    });
  } catch (error) {
    console.error("Error updating portal application status:", error);
    res.status(500).json({ error: error.message || "Failed to update application status" });
  }
});

app.get("/api/manager/bookings", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    // Get all locations for this manager
    if (!pool) {
      return res.json([]);
    }
    const locationsResult = await pool.query(`
      SELECT id FROM locations WHERE manager_id = $1
    `, [user.id]);
    
    const locationIds = locationsResult.rows.map(row => row.id);
    if (locationIds.length === 0) {
      return res.json([]);
    }

    // Get all kitchens for these locations
    const kitchensResult = await pool.query(`
      SELECT id FROM kitchens WHERE location_id = ANY($1)
    `, [locationIds]);
    
    const kitchenIds = kitchensResult.rows.map(row => row.id);
    if (kitchenIds.length === 0) {
      return res.json([]);
    }

    // Get all bookings for these kitchens (fetch bookings first, then enrich like chef profiles)
    const bookingsResult = await pool.query(`
      SELECT id, chef_id, kitchen_id, booking_date, start_time, end_time, 
             status, special_notes, created_at, updated_at
      FROM kitchen_bookings 
      WHERE kitchen_id = ANY($1::int[])
      ORDER BY booking_date DESC, start_time ASC
    `, [kitchenIds]);
    
    // Enrich each booking with chef, kitchen, and location details (exactly like chef profiles)
    const enrichedBookings = await Promise.all(
      bookingsResult.rows.map(async (booking) => {
        // Get chef details
        let chefName = null;
        if (booking.chef_id) {
          try {
            const chefResult = await pool.query(
              'SELECT id, username FROM users WHERE id = $1',
              [booking.chef_id]
            );
            const chef = chefResult.rows[0];
            
            if (chef) {
              chefName = chef.username;
              
              // Try to get chef's full name from their application
              const appResult = await pool.query(
                'SELECT full_name FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                [booking.chef_id]
              );
              if (appResult.rows.length > 0 && appResult.rows[0].full_name) {
                chefName = appResult.rows[0].full_name;
              }
            }
          } catch (error) {
            // Silently handle errors
          }
        }
        
        // Get kitchen details
        let kitchenName = 'Kitchen';
        let locationId = null;
        if (booking.kitchen_id) {
          try {
            const kitchenResult = await pool.query(
              'SELECT id, name, location_id FROM kitchens WHERE id = $1',
              [booking.kitchen_id]
            );
            const kitchen = kitchenResult.rows[0];
            if (kitchen) {
              kitchenName = kitchen.name || 'Kitchen';
              locationId = kitchen.location_id;
            }
          } catch (error) {
            // Silently handle errors
          }
        }
        
        // Get location details including timezone
        let locationName = null;
        let locationTimezone = DEFAULT_TIMEZONE;
        if (locationId) {
          try {
            const locationResult = await pool.query(
              'SELECT id, name, timezone FROM locations WHERE id = $1',
              [locationId]
            );
            const location = locationResult.rows[0];
            if (location) {
              locationName = location.name;
              locationTimezone = location.timezone || DEFAULT_TIMEZONE;
            }
          } catch (error) {
            // Silently handle errors
          }
        }
        
        return {
          id: booking.id,
          chefId: booking.chef_id,
          kitchenId: booking.kitchen_id,
          bookingDate: booking.booking_date,
          startTime: booking.start_time,
          endTime: booking.end_time,
          status: booking.status,
          specialNotes: booking.special_notes,
          createdAt: booking.created_at,
          updatedAt: booking.updated_at,
          chefName: chefName,
          kitchenName: kitchenName,
          locationName: locationName,
          locationTimezone: locationTimezone,
        };
      })
    );
    
    res.json(enrichedBookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: error.message || "Failed to fetch bookings" });
  }
});

// Set kitchen availability (manager)
app.post("/api/manager/availability", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const { kitchenId, dayOfWeek, startTime, endTime, isAvailable } = req.body;
    if (!kitchenId || dayOfWeek === undefined || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Verify the manager has access to this kitchen
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }
    const kitchenResult = await pool.query(`
      SELECT k.id 
      FROM kitchens k
      INNER JOIN locations l ON k.location_id = l.id
      WHERE k.id = $1 AND l.manager_id = $2
    `, [kitchenId, user.id]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Check if availability exists for this kitchen and day
    const existingResult = await pool.query(`
      SELECT id FROM kitchen_availability 
      WHERE kitchen_id = $1 AND day_of_week = $2
    `, [kitchenId, dayOfWeek]);

    const isAvailableValue = isAvailable !== undefined ? isAvailable : true;

    if (existingResult.rows.length > 0) {
      // Update existing
      await pool.query(`
        UPDATE kitchen_availability 
        SET start_time = $1, end_time = $2, is_available = $3
        WHERE kitchen_id = $4 AND day_of_week = $5
      `, [startTime, endTime, isAvailableValue, kitchenId, dayOfWeek]);
    } else {
      // Create new
      await pool.query(`
        INSERT INTO kitchen_availability (kitchen_id, day_of_week, start_time, end_time, is_available)
        VALUES ($1, $2, $3, $4, $5)
      `, [kitchenId, dayOfWeek, startTime, endTime, isAvailableValue]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error setting availability:", error);
    res.status(500).json({ error: error.message || "Failed to set availability" });
  }
});

// Get kitchen availability (manager)
app.get("/api/manager/availability/:kitchenId", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    // Verify the manager has access to this kitchen by checking if the kitchen belongs to one of their locations
    if (!pool) {
      return res.json([]);
    }
    const kitchenResult = await pool.query(`
      SELECT k.id, k.location_id 
      FROM kitchens k
      INNER JOIN locations l ON k.location_id = l.id
      WHERE k.id = $1 AND l.manager_id = $2
    `, [kitchenId, user.id]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Get availability
    const availabilityResult = await pool.query(`
      SELECT id, kitchen_id as "kitchenId", day_of_week as "dayOfWeek", 
             start_time as "startTime", end_time as "endTime", is_available as "isAvailable"
      FROM kitchen_availability 
      WHERE kitchen_id = $1
      ORDER BY day_of_week ASC
    `, [kitchenId]);
    
    res.json(availabilityResult.rows);
  } catch (error) {
    console.error("Error fetching availability:", error);
    res.status(500).json({ error: error.message || "Failed to fetch availability" });
  }
});

// Set kitchen availability (manager)
app.post("/api/manager/availability", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }

    const { kitchenId, dayOfWeek, startTime, endTime, isAvailable } = req.body;

    if (!kitchenId || dayOfWeek === undefined || !startTime || !endTime) {
      return res.status(400).json({ error: "kitchenId, dayOfWeek, startTime, and endTime are required" });
    }

    const kitchenIdNum = parseInt(kitchenId.toString());
    if (isNaN(kitchenIdNum) || kitchenIdNum <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID format" });
    }

    // Verify the manager has access to this kitchen
    if (!pool) {
      return res.status(500).json({ error: "Database connection not available" });
    }
    const kitchenResult = await pool.query(`
      SELECT k.id, k.location_id 
      FROM kitchens k
      INNER JOIN locations l ON k.location_id = l.id
      WHERE k.id = $1 AND l.manager_id = $2
    `, [kitchenIdNum, user.id]);
    
    if (kitchenResult.rows.length === 0) {
      return res.status(403).json({ error: "Access denied to this kitchen" });
    }

    // Check if availability already exists for this kitchen and day
    const existingResult = await pool.query(`
      SELECT id FROM kitchen_availability 
      WHERE kitchen_id = $1 AND day_of_week = $2
    `, [kitchenIdNum, dayOfWeek]);

    const isAvailableValue = isAvailable !== undefined ? isAvailable : true;

    if (existingResult.rows.length > 0) {
      // Update existing
      await pool.query(`
        UPDATE kitchen_availability 
        SET start_time = $1, end_time = $2, is_available = $3
        WHERE kitchen_id = $4 AND day_of_week = $5
      `, [startTime, endTime, isAvailableValue, kitchenIdNum, dayOfWeek]);
    } else {
      // Create new
      await pool.query(`
        INSERT INTO kitchen_availability (kitchen_id, day_of_week, start_time, end_time, is_available)
        VALUES ($1, $2, $3, $4, $5)
      `, [kitchenIdNum, dayOfWeek, startTime, endTime, isAvailableValue]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error setting availability:", error);
    res.status(500).json({ error: error.message || "Failed to set availability" });
  }
});

// Manager change password endpoint
app.post("/api/manager/change-password", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "manager") {
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

    // Verify current password
    const passwordMatches = await comparePasswords(currentPassword, user.password);
    if (!passwordMatches) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    // Update password
    const hashedNewPassword = await hashPassword(newPassword);
    if (pool) {
      await pool.query(
        'UPDATE users SET password = $1 WHERE id = $2',
        [hashedNewPassword, user.id]
      );
    } else {
      // Fallback for in-memory storage
      user.password = hashedNewPassword;
    }

    // Mark that manager has changed password (set has_seen_welcome to true)
    if (pool) {
      await pool.query(
        'UPDATE users SET has_seen_welcome = true WHERE id = $1',
        [user.id]
      );
    } else {
      user.has_seen_welcome = true;
    }

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ error: error.message || "Failed to change password" });
  }
});

// Admin change password endpoint
app.post("/api/admin/change-password", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
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

    // Verify current password
    const passwordMatches = await comparePasswords(currentPassword, user.password);
    if (!passwordMatches) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    // Update password
    const hashedNewPassword = await hashPassword(newPassword);
    if (pool) {
      await pool.query(
        'UPDATE users SET password = $1 WHERE id = $2',
        [hashedNewPassword, user.id]
      );
    } else {
      // Fallback for in-memory storage
      user.password = hashedNewPassword;
    }

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing admin password:", error);
    res.status(500).json({ error: error.message || "Failed to change password" });
  }
});

// Get all locations (admin)
app.get("/api/admin/locations", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const locations = await getAllLocations();
    res.json(locations);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

// Create location (admin)
app.post("/api/admin/locations", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { name, address, managerId } = req.body;
    
    // Validate managerId if provided
    let managerIdNum = null;
    if (managerId !== undefined && managerId !== null && managerId !== '') {
      managerIdNum = parseInt(managerId.toString());
      if (isNaN(managerIdNum) || managerIdNum <= 0) {
        return res.status(400).json({ error: "Invalid manager ID format" });
      }
      
      // Validate that the manager exists and has manager role
      const manager = await getUser(managerIdNum);
      if (!manager) {
        return res.status(400).json({ error: `Manager with ID ${managerIdNum} does not exist` });
      }
      if (manager.role !== 'manager') {
        return res.status(400).json({ error: `User with ID ${managerIdNum} is not a manager` });
      }
    }
    
    const location = await createLocation({ name, address, managerId: managerIdNum !== null ? managerIdNum : undefined });
    res.status(201).json(location);
  } catch (error) {
    console.error("Error creating location:", error);
    // Provide better error messages
    if (error.code === '23503') { // Foreign key constraint violation
      return res.status(400).json({ error: 'The selected manager does not exist or is invalid.' });
    }
    res.status(500).json({ error: error.message || "Failed to create location" });
  }
});

// Delete location (admin)
app.delete("/api/admin/locations/:id", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const locationId = parseInt(req.params.id);
    if (isNaN(locationId) || locationId <= 0) {
      return res.status(400).json({ error: "Invalid location ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Check if location has kitchens first (foreign key constraint requires this)
    const kitchensResult = await pool.query(
      'SELECT id FROM kitchens WHERE location_id = $1',
      [locationId]
    );
    
    if (kitchensResult.rows.length > 0) {
      return res.status(400).json({ 
        error: `Cannot delete location: It has ${kitchensResult.rows.length} kitchen(s). Please delete or reassign kitchens first.` 
      });
    }

    // Delete the location
    const result = await pool.query(
      'DELETE FROM locations WHERE id = $1 RETURNING id',
      [locationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }

    res.json({ success: true, message: "Location deleted successfully" });
  } catch (error) {
    console.error("Error deleting location:", error);
    res.status(500).json({ error: error.message || "Failed to delete location" });
  }
});

// Get kitchens for a location (admin)
app.get("/api/admin/kitchens/:locationId", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const locationId = parseInt(req.params.locationId);
    if (isNaN(locationId) || locationId <= 0) {
      return res.status(400).json({ error: "Invalid location ID" });
    }

    const kitchens = await getKitchensByLocation(locationId);
    res.json(kitchens);
  } catch (error) {
    console.error("Error fetching kitchens:", error);
    res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
  }
});

// Create kitchen (admin)
app.post("/api/admin/kitchens", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
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
    const locations = await getAllLocations();
    const location = locations.find(loc => loc.id === locationIdNum);
    if (!location) {
      return res.status(400).json({ error: `Location with ID ${locationIdNum} does not exist` });
    }
    
    const kitchen = await createKitchen({ locationId: locationIdNum, name, description, isActive: true });
    res.status(201).json(kitchen);
  } catch (error) {
    console.error("Error creating kitchen:", error);
    // Provide better error messages
    if (error.code === '23503') { // Foreign key constraint violation
      return res.status(400).json({ error: 'The selected location does not exist or is invalid.' });
    }
    res.status(500).json({ error: error.message || "Failed to create kitchen" });
  }
});

// Delete kitchen (admin)
app.delete("/api/admin/kitchens/:id", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const kitchenId = parseInt(req.params.id);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Check if kitchen has bookings first (foreign key constraint requires this)
    const bookingsResult = await pool.query(
      'SELECT id FROM kitchen_bookings WHERE kitchen_id = $1',
      [kitchenId]
    );
    
    if (bookingsResult.rows.length > 0) {
      return res.status(400).json({ 
        error: `Cannot delete kitchen: It has ${bookingsResult.rows.length} booking(s). Please cancel or reassign bookings first.` 
      });
    }

    // Delete the kitchen
    const result = await pool.query(
      'DELETE FROM kitchens WHERE id = $1 RETURNING id',
      [kitchenId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    res.json({ success: true, message: "Kitchen deleted successfully" });
  } catch (error) {
    console.error("Error deleting kitchen:", error);
    res.status(500).json({ error: error.message || "Failed to delete kitchen" });
  }
});

// ===================================
// KITCHEN BOOKING SYSTEM - CHEF ROUTES
// ===================================
// Middleware to require chef authentication
// Supports BOTH Firebase auth (for approved chefs) AND session auth (for admin/managers)
async function requireChef(req, res, next) {
  try {
    // First, try Firebase authentication
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decodedToken = await verifyFirebaseToken(token);
      
      if (decodedToken) {
        // Load user from Firebase UID
        if (!pool) {
          return res.status(500).json({ error: "Database not available" });
        }
        
        const result = await pool.query(
          'SELECT * FROM users WHERE firebase_uid = $1',
          [decodedToken.uid]
        );
        const neonUser = result.rows[0];
        
        if (neonUser && neonUser.is_chef) {
          // Set both Firebase and user info on request
          req.firebaseUser = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            email_verified: decodedToken.email_verified,
          };
          req.user = {
            id: neonUser.id,
            username: neonUser.username,
            role: neonUser.role,
            isChef: neonUser.is_chef,
          };
          console.log(`✅ Chef authenticated via Firebase: ${neonUser.username} (ID: ${neonUser.id})`);
          return next();
        } else if (neonUser && !neonUser.is_chef) {
          return res.status(403).json({ error: "Chef access required" });
        }
      }
    }
    
    // Fall back to session authentication
    const rawUserId = req.session?.userId || req.headers['x-user-id'];
    if (rawUserId) {
      const user = await getUser(rawUserId);
      if (user && user.is_chef) {
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          isChef: user.is_chef,
        };
        console.log(`✅ Chef authenticated via session: ${user.username} (ID: ${user.id})`);
        return next();
      }
    }
    
    // Neither authentication method worked
    return res.status(401).json({ error: "Authentication required. Please sign in as a chef." });
  } catch (error) {
    console.error('Error in requireChef middleware:', error);
    return res.status(401).json({ error: "Authentication failed" });
  }
}
// Get all kitchens
app.get("/api/chef/kitchens", requireChef, async (req, res) => {
  try {
    console.log('📍 Chef requesting all kitchens, user:', req.user?.username || 'Unknown', 'ID:', req.user?.id);
    console.log('📍 Firebase user:', req.firebaseUser?.uid || 'N/A');
    
    const allKitchens = await getAllKitchens();
    console.log(`✅ Found ${allKitchens.length} total kitchens in database`);
    
    if (allKitchens.length > 0) {
      console.log('📦 Sample kitchen data:', JSON.stringify(allKitchens[0], null, 2));
      console.log('📦 isActive field type check:', allKitchens.map(k => ({
        id: k.id,
        name: k.name,
        isActive: k.isActive,
        isActiveType: typeof k.isActive,
        isActiveValue: k.isActive,
        locationId: k.locationId
      })));
    }
    
    // Filter to only return active kitchens
    const activeKitchens = allKitchens.filter(k => {
      const isActive = k.isActive !== undefined ? k.isActive : k.is_active;
      return isActive !== false && isActive !== null;
    });
    
    console.log(`✅ Returning ${activeKitchens.length} active kitchens (filtered from ${allKitchens.length} total)`);
    console.log('📦 Active kitchens:', activeKitchens.map(k => ({ id: k.id, name: k.name, isActive: k.isActive || k.is_active })));
    
    res.json(activeKitchens);
  } catch (error) {
    console.error("❌ Error fetching kitchens:", error);
    console.error("❌ Error stack:", error.stack);
    res.status(500).json({ error: "Failed to fetch kitchens", details: error.message });
  }
});

// Get all locations (chef)
app.get("/api/chef/locations", requireChef, async (req, res) => {
  try {
    const locations = await getAllLocations();
    res.json(locations);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

// Get ALL time slots with booking info (capacity aware)
app.get("/api/chef/kitchens/:kitchenId/slots", requireChef, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const kitchenId = parseInt(req.params.kitchenId);
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }
    
    const bookingDate = new Date(date);
    if (isNaN(bookingDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    let startHour;
    let endHour;

    // 1) Fetch ALL overrides for this date (both available and blocked)
    let overridesResult;
    try {
      overridesResult = await pool.query(`
        SELECT start_time, end_time, is_available
        FROM kitchen_date_overrides
        WHERE kitchen_id = $1
          AND DATE(specific_date) = $2::date
        ORDER BY created_at ASC
      `, [kitchenId, bookingDate.toISOString()]);
    } catch (_e) {
      overridesResult = { rows: [] };
    }

    if (overridesResult.rows.length > 0) {
      // Find the base available override
      const baseOverride = overridesResult.rows.find(o => o.is_available === true);
      if (!baseOverride || !baseOverride.start_time || !baseOverride.end_time) {
        // No valid base availability
        return res.json([]);
      }

      [startHour] = baseOverride.start_time.split(":").map(Number);
      [endHour] = baseOverride.end_time.split(":").map(Number);

      // Collect blocked ranges
      const blockedRanges = overridesResult.rows
        .filter(o => o.is_available === false && o.start_time && o.end_time)
        .map(o => {
          const [sh] = o.start_time.split(":").map(Number);
          const [eh] = o.end_time.split(":").map(Number);
          return { startHour: sh, endHour: eh };
        });

      // Generate all 1-hour slots in the base range, excluding blocked ranges
      const allSlots = [];
      for (let hour = startHour; hour < endHour; hour++) {
        // Check if this hour overlaps any blocked range
        const isBlocked = blockedRanges.some(range => {
          return hour >= range.startHour && hour < range.endHour;
        });
        if (!isBlocked) {
          allSlots.push(`${hour.toString().padStart(2, '0')}:00`);
        }
      }

      // Fetch only confirmed bookings to block capacity
      const bookingsResult = await pool.query(`
        SELECT start_time, end_time 
        FROM kitchen_bookings
        WHERE kitchen_id = $1 
          AND DATE(booking_date) = $2::date
          AND status = 'confirmed'
      `, [kitchenId, bookingDate.toISOString()]);

      const capacity = 1;
      const slotBookingCounts = new Map();
      allSlots.forEach(s => slotBookingCounts.set(s, 0));

      for (const booking of bookingsResult.rows) {
        const [startH, startM] = booking.start_time.split(':').map(Number);
        const [endH, endM] = booking.end_time.split(':').map(Number);
        const startTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;

        for (const slot of allSlots) {
          const [slotH] = slot.split(':').map(Number);
          const slotStart = slotH * 60;
          const slotEnd = slotStart + 60;
          if (slotStart < endTotal && slotEnd > startTotal) {
            slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
          }
        }
      }

      const result = allSlots.map(time => {
        const booked = slotBookingCounts.get(time) || 0;
        return {
          time,
          available: Math.max(0, capacity - booked),
          capacity,
          isFullyBooked: booked >= capacity,
        };
      });

      return res.json(result);
    } else {
      // 2) No overrides, fall back to weekly availability
      const dayOfWeek = bookingDate.getDay();
      let availabilityResult;
      try {
        availabilityResult = await pool.query(`
          SELECT start_time, end_time, is_available
          FROM kitchen_availability 
          WHERE kitchen_id = $1 AND day_of_week = $2
        `, [kitchenId, dayOfWeek]);
      } catch (_e) {
        availabilityResult = { rows: [] };
      }

      if (availabilityResult.rows.length === 0 || availabilityResult.rows[0].is_available === false) {
        return res.json([]);
      }

      const availability = availabilityResult.rows[0];
      [startHour] = availability.start_time.split(":").map(Number);
      [endHour] = availability.end_time.split(":").map(Number);

      // Generate 1-hour slots
      const allSlots = [];
      for (let hour = startHour; hour < endHour; hour++) {
        allSlots.push(`${hour.toString().padStart(2, '0')}:00`);
      }

      // Fetch confirmed bookings
      const bookingsResult = await pool.query(`
        SELECT start_time, end_time 
        FROM kitchen_bookings
        WHERE kitchen_id = $1 
          AND DATE(booking_date) = $2::date
          AND status = 'confirmed'
      `, [kitchenId, bookingDate.toISOString()]);

      const capacity = 1;
      const slotBookingCounts = new Map();
      allSlots.forEach(s => slotBookingCounts.set(s, 0));

      for (const booking of bookingsResult.rows) {
        const [startH, startM] = booking.start_time.split(':').map(Number);
        const [endH, endM] = booking.end_time.split(':').map(Number);
        const startTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;

        for (const slot of allSlots) {
          const [slotH] = slot.split(':').map(Number);
          const slotStart = slotH * 60;
          const slotEnd = slotStart + 60;
          if (slotStart < endTotal && slotEnd > startTotal) {
            slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
          }
        }
      }

      const result = allSlots.map(time => {
        const booked = slotBookingCounts.get(time) || 0;
        return {
          time,
          available: Math.max(0, capacity - booked),
          capacity,
          isFullyBooked: booked >= capacity,
        };
      });

      return res.json(result);
    }
  } catch (error) {
    console.error("Error fetching time slots:", error);
    res.status(500).json({ error: "Failed to fetch time slots", message: error.message });
  }
});

// Per-kitchen policy: max slots per chef per day
// Get kitchen pricing (for chefs to see pricing during booking)
app.get("/api/chef/kitchens/:kitchenId/pricing", requireChef, async (req, res) => {
  try {
    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get kitchen pricing using direct SQL (following numeric type pattern)
    const result = await pool.query(`
      SELECT 
        hourly_rate::text as hourly_rate,
        currency,
        minimum_booking_hours
      FROM kitchens
      WHERE id = $1
    `, [kitchenId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }

    const row = result.rows[0];
    const hourlyRateCents = row.hourly_rate ? parseFloat(row.hourly_rate) : null;
    
    // Return null if no pricing set, otherwise convert cents to dollars
    if (hourlyRateCents === null || hourlyRateCents === 0) {
      return res.status(404).json({ error: "Pricing not found" });
    }
    
    const hourlyRateDollars = hourlyRateCents / 100;

    console.log(`[API] Kitchen ${kitchenId} pricing: ${hourlyRateCents} cents = $${hourlyRateDollars}/hour`);

    res.json({
      hourlyRate: hourlyRateDollars,
      currency: row.currency || 'CAD',
      minimumBookingHours: row.minimum_booking_hours || 1,
    });
  } catch (error) {
    console.error("Error getting kitchen pricing:", error);
    res.status(500).json({ error: error.message || "Failed to get kitchen pricing" });
  }
});

// Get storage listings for a kitchen (chef view - only active/approved listings)
app.get("/api/chef/kitchens/:kitchenId/storage-listings", requireChef, async (req, res) => {
  try {
    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get all storage listings for this kitchen
    const result = await pool.query(`
      SELECT 
        id, kitchen_id, storage_type, name, description,
        base_price::text as base_price,
        price_per_cubic_foot::text as price_per_cubic_foot,
        pricing_model, 
        COALESCE(minimum_booking_duration, 1) as minimum_booking_duration,
        COALESCE(booking_duration_unit, 'monthly') as booking_duration_unit,
        currency,
        dimensions_length::text as dimensions_length,
        dimensions_width::text as dimensions_width,
        dimensions_height::text as dimensions_height,
        total_volume::text as total_volume,
        climate_control, temperature_range,
        status, is_active, created_at, updated_at
      FROM storage_listings 
      WHERE kitchen_id = $1
      ORDER BY created_at DESC
    `, [kitchenId]);

    // Filter to only show approved/active listings to chefs
    const visibleListings = result.rows
      .filter(row => (row.status === 'approved' || row.status === 'active') && row.is_active === true)
      .map(row => ({
        id: row.id,
        kitchenId: row.kitchen_id,
        storageType: row.storage_type,
        name: row.name,
        description: row.description,
        // Convert cents to dollars for frontend display
        basePrice: row.base_price ? parseFloat(row.base_price) / 100 : null,
        pricePerCubicFoot: row.price_per_cubic_foot ? parseFloat(row.price_per_cubic_foot) / 100 : null,
        pricingModel: row.pricing_model,
        minimumBookingDuration: row.minimum_booking_duration ?? 1,
        bookingDurationUnit: row.booking_duration_unit ?? 'monthly',
        currency: row.currency || 'CAD',
        dimensionsLength: row.dimensions_length ? parseFloat(row.dimensions_length) : null,
        dimensionsWidth: row.dimensions_width ? parseFloat(row.dimensions_width) : null,
        dimensionsHeight: row.dimensions_height ? parseFloat(row.dimensions_height) : null,
        totalVolume: row.total_volume ? parseFloat(row.total_volume) : null,
        climateControl: row.climate_control ?? false,
        temperatureRange: row.temperature_range,
        status: row.status,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

    console.log(`[API] /api/chef/kitchens/${kitchenId}/storage-listings - Returning ${visibleListings.length} visible listings`);
    
    res.json(visibleListings);
  } catch (error) {
    console.error("Error getting storage listings for chef:", error);
    res.status(500).json({ error: error.message || "Failed to get storage listings" });
  }
});

// Get equipment listings for a kitchen (chef view - only active/approved listings)
// Distinguishes between 'included' (free with kitchen) and 'rental' (paid addon) equipment
app.get("/api/chef/kitchens/:kitchenId/equipment-listings", requireChef, async (req, res) => {
  try {
    const kitchenId = parseInt(req.params.kitchenId);
    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get all equipment listings for this kitchen
    const result = await pool.query(`
      SELECT
        id, kitchen_id, category, equipment_type, brand, model, description,
        condition, availability_type, pricing_model,
        session_rate::text as session_rate,
        hourly_rate::text as hourly_rate,
        daily_rate::text as daily_rate,
        weekly_rate::text as weekly_rate,
        monthly_rate::text as monthly_rate,
        minimum_rental_hours, minimum_rental_days, currency,
        damage_deposit::text as damage_deposit,
        insurance_required, training_required, cleaning_responsibility,
        prep_time_hours, photos, manuals, maintenance_log,
        status, is_active, created_at, updated_at
      FROM equipment_listings
      WHERE kitchen_id = $1
      ORDER BY created_at DESC
    `, [kitchenId]);

    // Filter to only show approved/active listings to chefs
    const visibleListings = result.rows
      .filter(row => (row.status === 'approved' || row.status === 'active') && row.is_active === true)
      .map(row => ({
        id: row.id,
        kitchenId: row.kitchen_id,
        category: row.category,
        equipmentType: row.equipment_type,
        brand: row.brand,
        model: row.model,
        description: row.description,
        condition: row.condition,
        availabilityType: row.availability_type,
        pricingModel: row.pricing_model,
        // PRIMARY: Flat session rate (convert cents to dollars)
        sessionRate: row.session_rate ? parseFloat(row.session_rate) / 100 : 0,
        // Legacy rates (kept for backwards compatibility)
        hourlyRate: row.hourly_rate ? parseFloat(row.hourly_rate) / 100 : null,
        dailyRate: row.daily_rate ? parseFloat(row.daily_rate) / 100 : null,
        weeklyRate: row.weekly_rate ? parseFloat(row.weekly_rate) / 100 : null,
        monthlyRate: row.monthly_rate ? parseFloat(row.monthly_rate) / 100 : null,
        minimumRentalHours: row.minimum_rental_hours,
        minimumRentalDays: row.minimum_rental_days,
        currency: row.currency || 'CAD',
        damageDeposit: row.damage_deposit ? parseFloat(row.damage_deposit) / 100 : 0,
        insuranceRequired: row.insurance_required,
        trainingRequired: row.training_required,
        cleaningResponsibility: row.cleaning_responsibility,
        prepTimeHours: row.prep_time_hours,
        photos: row.photos || [],
        manuals: row.manuals || [],
        maintenanceLog: row.maintenance_log || [],
        status: row.status,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

    // Separate into included (free) and rental (paid) for clearer frontend display
    const includedEquipment = visibleListings.filter(l => l.availabilityType === 'included');
    const rentalEquipment = visibleListings.filter(l => l.availabilityType === 'rental');

    console.log(`[API] /api/chef/kitchens/${kitchenId}/equipment-listings - Returning ${visibleListings.length} visible listings (${includedEquipment.length} included, ${rentalEquipment.length} rental)`);
    
    // Return both the full list and categorized lists for convenience
    res.json({
      all: visibleListings,
      included: includedEquipment,
      rental: rentalEquipment
    });
  } catch (error) {
    console.error("Error getting equipment listings for chef:", error);
    res.status(500).json({ error: error.message || "Failed to get equipment listings" });
  }
});

app.get("/api/chef/kitchens/:kitchenId/policy", requireChef, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const kitchenId = parseInt(req.params.kitchenId);
    const { date } = req.query;
    const bookingDate = date ? new Date(String(date)) : new Date();

    if (!pool) return res.json({ maxSlotsPerChef: 2 });

    // Priority order: 1) Date override, 2) Weekly schedule, 3) Location default, 4) Hardcoded 2
    let maxSlotsPerChef = 2;
    try {
      // 1. Try date-specific override first
      const over = await pool.query(`
        SELECT max_slots_per_chef
        FROM kitchen_date_overrides
        WHERE kitchen_id = $1 AND DATE(specific_date) = $2::date
        ORDER BY updated_at DESC
        LIMIT 1
      `, [kitchenId, bookingDate.toISOString()]);
      if (over.rows.length > 0) {
        const val = Number(over.rows[0].max_slots_per_chef);
        if (Number.isFinite(val) && val > 0) maxSlotsPerChef = val;
      } else {
        // 2. Try weekly schedule for this day of week
        const avail = await pool.query(`
          SELECT max_slots_per_chef
          FROM kitchen_availability
          WHERE kitchen_id = $1 AND day_of_week = $2
        `, [kitchenId, bookingDate.getDay()]);
        if (avail.rows.length > 0) {
          const v = Number(avail.rows[0].max_slots_per_chef);
          if (Number.isFinite(v) && v > 0) maxSlotsPerChef = v;
        } else {
          // 3. Fall back to location default
          const loc = await pool.query(`
            SELECT l.default_daily_booking_limit
            FROM locations l
            INNER JOIN kitchens k ON k.location_id = l.id
            WHERE k.id = $1
          `, [kitchenId]);
          if (loc.rows.length > 0) {
            const locVal = Number(loc.rows[0].default_daily_booking_limit);
            if (Number.isFinite(locVal) && locVal > 0) maxSlotsPerChef = locVal;
          }
        }
      }
    } catch (_e) {
      // Columns might not exist yet; fallback
      maxSlotsPerChef = 2;
    }

    res.json({ maxSlotsPerChef });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch policy" });
  }
});

// Create a booking (enforce per-chef daily slot limit)
app.post("/api/chef/bookings", requireChef, async (req, res) => {
  try {
    const { kitchenId, bookingDate, startTime, endTime, specialNotes, selectedStorage, selectedEquipmentIds } = req.body;
    
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get the kitchen's location
    const kitchenResult = await pool.query(
      'SELECT location_id FROM kitchens WHERE id = $1',
      [kitchenId]
    );
    
    if (kitchenResult.rows.length === 0) {
      return res.status(400).json({ error: "Kitchen not found" });
    }
    
    const kitchenLocationId = kitchenResult.rows[0].location_id;

    // Check if chef has admin-granted access to this location
    const accessCheck = await pool.query(
      'SELECT id FROM chef_location_access WHERE chef_id = $1 AND location_id = $2',
      [req.user.id, kitchenLocationId]
    );
    
    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: "You don't have access to book kitchens in this location. Please contact an administrator." });
    }

    // Check if location's kitchen license is approved (required for bookings)
    const locationResult = await pool.query(
      'SELECT kitchen_license_status FROM locations WHERE id = $1',
      [kitchenLocationId]
    );
    
    if (locationResult.rows.length > 0) {
      const licenseStatus = locationResult.rows[0].kitchen_license_status;
      if (licenseStatus !== 'approved') {
        return res.status(403).json({ 
          error: licenseStatus === 'pending'
            ? "This location's kitchen license is pending admin approval. Bookings are temporarily disabled."
            : licenseStatus === 'rejected'
            ? "This location's kitchen license has been rejected. Bookings are disabled. Please contact the location manager."
            : "This location's kitchen license has not been uploaded or approved. Bookings are disabled."
        });
      }
    }

    // Check if chef has shared their profile with the location and it's been approved
    let profileResult;
    try {
      profileResult = await pool.query(
        'SELECT * FROM chef_location_profiles WHERE chef_id = $1 AND location_id = $2',
        [req.user.id, kitchenLocationId]
      );
    } catch (error) {
      // If table doesn't exist, treat as if no profile
      if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
        profileResult = { rows: [] };
      } else {
        throw error;
      }
    }
    
    if (profileResult.rows.length === 0) {
      return res.status(403).json({ error: "You must share your profile with this location before booking. Please share your profile first." });
    }
    
    const profile = profileResult.rows[0];
    if (profile.status !== 'approved') {
      return res.status(403).json({ 
        error: profile.status === 'pending' 
          ? "Your profile is pending manager approval. Please wait for approval before booking."
          : "Your profile was rejected. Please contact the location manager for more information."
      });
    }

    // Determine slots requested (1-hour slots)
    const [sH, sM] = String(startTime).split(':').map(Number);
    const [eH, eM] = String(endTime).split(':').map(Number);
    const requestedSlots = Math.max(1, Math.ceil(((eH * 60 + eM) - (sH * 60 + sM)) / 60));
    
    // Store time components for later use in pricing calculation
    const startTotalMinutes = sH * 60 + sM;
    const endTotalMinutes = eH * 60 + eM;

    // Find maxSlotsPerChef for this kitchen/date
    let maxSlotsPerChef = 2;
    try {
      const over = await pool.query(`
        SELECT max_slots_per_chef
        FROM kitchen_date_overrides
        WHERE kitchen_id = $1 AND DATE(specific_date) = $2::date
        ORDER BY updated_at DESC
        LIMIT 1
      `, [kitchenId, bookingDate]);
      if (over.rows.length > 0) {
        const val = Number(over.rows[0].max_slots_per_chef);
        if (Number.isFinite(val) && val > 0) maxSlotsPerChef = val;
      } else {
        // 2. Try weekly schedule for this day of week
        const avail = await pool.query(`
          SELECT max_slots_per_chef
          FROM kitchen_availability
          WHERE kitchen_id = $1 AND day_of_week = EXTRACT(DOW FROM $2::date)
        `, [kitchenId, bookingDate]);
        if (avail.rows.length > 0) {
          const v = Number(avail.rows[0].max_slots_per_chef);
          if (Number.isFinite(v) && v > 0) maxSlotsPerChef = v;
        } else {
          // 3. Fall back to location default
          const loc = await pool.query(`
            SELECT l.default_daily_booking_limit
            FROM locations l
            INNER JOIN kitchens k ON k.location_id = l.id
            WHERE k.id = $1
          `, [kitchenId]);
          if (loc.rows.length > 0) {
            const locVal = Number(loc.rows[0].default_daily_booking_limit);
            if (Number.isFinite(locVal) && locVal > 0) maxSlotsPerChef = locVal;
          }
        }
      }
    } catch (_e) {
      maxSlotsPerChef = 2;
    }

    // Count already booked slots for this chef on this date (confirmed + pending)
    const existing = await pool.query(`
      SELECT start_time, end_time
      FROM kitchen_bookings
      WHERE chef_id = $1
        AND kitchen_id = $2
        AND DATE(booking_date) = $3::date
        AND status IN ('pending','confirmed')
    `, [req.user.id, kitchenId, bookingDate]);

    let existingSlots = 0;
    for (const b of existing.rows) {
      const [bsH, bsM] = b.start_time.split(':').map(Number);
      const [beH, beM] = b.end_time.split(':').map(Number);
      const span = Math.max(1, Math.ceil(((beH * 60 + beM) - (bsH * 60 + bsM)) / 60));
      existingSlots += span;
    }

    if (existingSlots + requestedSlots > maxSlotsPerChef) {
      return res.status(400).json({ error: `Booking exceeds daily limit. Allowed: ${maxSlotsPerChef} hour(s).` });
    }

    // Get location to get timezone and minimum booking window
    const locationData = await pool.query(`
      SELECT l.id, l.timezone, l.minimum_booking_window_hours
      FROM locations l
      INNER JOIN kitchens k ON k.location_id = l.id
      WHERE k.id = $1
    `, [kitchenId]);
    
    let timezone = DEFAULT_TIMEZONE;
    let minimumBookingWindowHours = 1;
    
    if (locationData.rows.length > 0) {
      const location = locationData.rows[0];
      timezone = location.timezone || DEFAULT_TIMEZONE;
      minimumBookingWindowHours = location.minimum_booking_window_hours || 1;
    }
    
    // Convert booking date to string format (YYYY-MM-DD)
    const bookingDateStr = bookingDate.split('T')[0];
    
    // Validate booking time using timezone-aware functions (lazy-loaded)
    if (await isBookingTimePast(bookingDateStr, startTime, timezone)) {
      return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
    }
    
    // Check if booking is within minimum booking window (timezone-aware)
    const hoursUntilBooking = await getHoursUntilBooking(bookingDateStr, startTime, timezone);
    if (hoursUntilBooking < minimumBookingWindowHours) {
      return res.status(400).json({ 
        error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance` 
      });
    }

    // Check for conflicts (exclusive per slot)
    const conflictCheck = await pool.query(`
      SELECT id FROM kitchen_bookings
      WHERE kitchen_id = $1 AND DATE(booking_date) = $2::date
      AND start_time < $4 AND end_time > $3
      AND status != 'cancelled'
    `, [kitchenId, bookingDate, startTime, endTime]);
    
    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({ error: "Time slot is not available" });
    }
    
    // Calculate pricing (reuse time components calculated above)
    const durationMinutes = endTotalMinutes - startTotalMinutes;
    const durationHours = Math.max(0, durationMinutes / 60);
    
    // Get kitchen pricing
    const kitchenPricingResult = await pool.query(`
      SELECT 
        hourly_rate::text as hourly_rate,
        currency,
        minimum_booking_hours
      FROM kitchens
      WHERE id = $1
    `, [kitchenId]);
    
    let totalPriceCents = 0;
    let hourlyRateCents = 0;
    let effectiveDuration = durationHours;
    let currency = 'CAD';
    
    if (kitchenPricingResult.rows.length > 0) {
      const pricing = kitchenPricingResult.rows[0];
      hourlyRateCents = pricing.hourly_rate ? parseFloat(pricing.hourly_rate) : 0;
      currency = pricing.currency || 'CAD';
      const minimumHours = pricing.minimum_booking_hours || 1;
      effectiveDuration = Math.max(durationHours, minimumHours);
      
      if (hourlyRateCents > 0) {
        totalPriceCents = Math.round(hourlyRateCents * effectiveDuration);
      }
    }
    
    // Calculate service fee (5% commission)
    const serviceFeeCents = Math.round(totalPriceCents * 0.05);
    const totalWithFeesCents = totalPriceCents + serviceFeeCents;
    
    // Create booking (pending) with pricing
    const result = await pool.query(`
      INSERT INTO kitchen_bookings (
        chef_id, kitchen_id, booking_date, start_time, end_time, special_notes, status,
        total_price, hourly_rate, duration_hours, service_fee, currency, payment_status,
        storage_items, equipment_items
      )
      VALUES ($1, $2, $3::timestamp, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, 'pending', '[]'::jsonb, '[]'::jsonb)
      RETURNING *
    `, [
      req.user.id, 
      kitchenId, 
      bookingDate, 
      startTime, 
      endTime, 
      specialNotes || null,
      totalWithFeesCents.toString(),
      hourlyRateCents.toString(),
      effectiveDuration.toString(),
      serviceFeeCents.toString(),
      currency
    ]);
    
    const booking = result.rows[0];
    
    // Create storage and equipment bookings (add-ons)
    const storageBookingsCreated = [];
    const equipmentBookingsCreated = [];
    
    // Parse booking dates for equipment (reuse variables already declared above)
    // sH, sM, eH, eM are already declared at line 15875-15876
    const bookingStartDateTime = new Date(bookingDate);
    bookingStartDateTime.setHours(sH, sM, 0, 0);
    const bookingEndDateTime = new Date(bookingDate);
    bookingEndDateTime.setHours(eH, eM, 0, 0);
    
    // Create storage bookings with custom date ranges (NEW FORMAT)
    if (selectedStorage && Array.isArray(selectedStorage) && selectedStorage.length > 0) {
      console.log(`📦 Processing ${selectedStorage.length} storage add-ons for booking ${booking.id}`);
      
      for (const storage of selectedStorage) {
        try {
          const storageListingId = storage.storageListingId;
          const startDate = new Date(storage.startDate);
          const endDate = new Date(storage.endDate);
          
          // Validate dates
          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            console.error(`   ⚠️ Invalid dates for storage booking ${storageListingId}`);
            continue;
          }
          
          if (startDate >= endDate) {
            console.error(`   ⚠️ Storage booking ${storageListingId}: End date must be after start date`);
            continue;
          }
          
          // Get storage listing details to get pricing info
          const storageResult = await pool.query(
            `SELECT id, pricing_model, base_price, minimum_booking_duration, currency FROM storage_listings WHERE id = $1`,
            [storageListingId]
          );
          
          if (storageResult.rows.length > 0) {
            const storageListing = storageResult.rows[0];
            const basePriceCents = storageListing.base_price ? parseInt(storageListing.base_price) : 0;
            const minDays = storageListing.minimum_booking_duration || 1;
            
            // Calculate number of days
            const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            const effectiveDays = Math.max(days, minDays);
            
            // Validate minimum duration
            if (days < minDays) {
              console.error(`   ⚠️ Storage booking ${storageListingId}: Requires minimum ${minDays} days, got ${days}`);
              continue;
            }
            
            // Calculate price based on daily pricing model
            // For daily pricing, multiply base price by number of days
            let totalPrice = basePriceCents * effectiveDays;
            
            // For other pricing models (legacy support)
            if (storageListing.pricing_model === 'hourly') {
              const durationHours = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)));
              totalPrice = basePriceCents * durationHours;
            } else if (storageListing.pricing_model === 'monthly-flat') {
              // For monthly-flat, use base price directly (pro-rated not implemented)
              totalPrice = basePriceCents;
            }
            
            // Calculate service fee (5%)
            const serviceFee = Math.round(totalPrice * 0.05);
            
            const insertResult = await pool.query(
              `INSERT INTO storage_bookings 
                (storage_listing_id, kitchen_booking_id, chef_id, start_date, end_date, status, total_price, pricing_model, payment_status, service_fee, currency)
               VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, 'pending', $8, $9)
               RETURNING id`,
              [
                storageListingId,
                booking.id,
                req.user.id,
                startDate,
                endDate,
                totalPrice.toString(),
                storageListing.pricing_model,
                serviceFee.toString(),
                storageListing.currency || 'CAD'
              ]
            );
            
            storageBookingsCreated.push({
              id: insertResult.rows[0].id,
              storageListingId,
              totalPrice: totalPrice / 100 // Return in dollars
            });
            console.log(`   ✅ Storage booking created: listing ${storageListingId}, ${effectiveDays} days, price: $${(totalPrice / 100).toFixed(2)}`);
          }
        } catch (storageError) {
          console.error(`   ⚠️ Failed to create storage booking:`, storageError);
        }
      }
    }
    
    // Create equipment bookings (add-ons)
    if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0) {
      console.log(`📦 Processing ${selectedEquipmentIds.length} equipment add-ons for booking ${booking.id}`);
      
      for (const equipmentListingId of selectedEquipmentIds) {
        try {
          // Get equipment listing details
          const equipmentResult = await pool.query(
            `SELECT id, availability_type, session_rate, damage_deposit, currency 
             FROM equipment_listings WHERE id = $1`,
            [equipmentListingId]
          );
          
          if (equipmentResult.rows.length > 0) {
            const equipmentListing = equipmentResult.rows[0];
            
            // Skip if it's included equipment (free with kitchen)
            if (equipmentListing.availability_type === 'included') {
              console.log(`   ℹ️ Skipping equipment ${equipmentListingId} - it's included with kitchen`);
              continue;
            }
            
            // Use sessionRate - flat fee per session (not hourly/duration-based)
            const sessionRateCents = equipmentListing.session_rate ? parseInt(equipmentListing.session_rate) : 0;
            const totalPrice = sessionRateCents;
            const damageDepositCents = equipmentListing.damage_deposit ? parseInt(equipmentListing.damage_deposit) : 0;
            
            // Calculate service fee (5%)
            const serviceFee = Math.round(totalPrice * 0.05);
            
            const insertResult = await pool.query(
              `INSERT INTO equipment_bookings 
                (equipment_listing_id, kitchen_booking_id, chef_id, start_date, end_date, status, total_price, pricing_model, damage_deposit, payment_status, service_fee, currency)
               VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'hourly', $7, 'pending', $8, $9)
               RETURNING id`,
              [
                equipmentListingId,
                booking.id,
                req.user.id,
                bookingStartDateTime,
                bookingEndDateTime,
                totalPrice.toString(),
                damageDepositCents.toString(),
                serviceFee.toString(),
                equipmentListing.currency || 'CAD'
              ]
            );
            
            equipmentBookingsCreated.push({
              id: insertResult.rows[0].id,
              equipmentListingId,
              totalPrice: totalPrice / 100, // Return in dollars for frontend
              damageDeposit: damageDepositCents / 100,
              serviceFee: serviceFee / 100
            });
            
            console.log(`   ✅ Equipment booking created: listing ${equipmentListingId}, price: $${(totalPrice / 100).toFixed(2)}/session`);
          }
        } catch (equipmentError) {
          console.error(`   ⚠️ Failed to create equipment booking for listing ${equipmentListingId}:`, equipmentError);
        }
      }
    }
    
    // Send email notifications to chef and manager
    try {
      // Get kitchen details
      const kitchenData = await pool.query(`
        SELECT k.id, k.name, k.location_id
        FROM kitchens k
        WHERE k.id = $1
      `, [kitchenId]);
      
      if (kitchenData.rows.length > 0) {
        const kitchen = kitchenData.rows[0];
        
        // Get location details with notification email
        const locationData = await pool.query(`
          SELECT l.id, l.name, l.manager_id, l.notification_email
          FROM locations l
          WHERE l.id = $1
        `, [kitchen.location_id]);
        
        if (locationData.rows.length > 0) {
          const location = locationData.rows[0];
          
          // Get chef details
          const chefData = await pool.query(`
            SELECT id, username
            FROM users
            WHERE id = $1
          `, [req.user.id]);
          
          const chef = chefData.rows[0];
          
          // Get manager details if manager_id is set
          let manager = null;
          if (location.manager_id) {
            const managerData = await pool.query(`
              SELECT id, username
              FROM users
              WHERE id = $1
            `, [location.manager_id]);
            
            if (managerData.rows.length > 0) {
              manager = managerData.rows[0];
            }
          }
          
          // Import email functions
          const { sendEmail, generateBookingRequestEmail, generateBookingNotificationEmail } = await import('../server/email.js');
          
          // Send email to chef
          if (chef) {
            try {
              const chefEmail = generateBookingRequestEmail({
                chefEmail: chef.username,
                chefName: chef.username,
                kitchenName: kitchen.name,
                bookingDate: bookingDate,
                startTime,
                endTime,
                specialNotes: specialNotes || ''
              });
              await sendEmail(chefEmail);
              console.log(`✅ Booking request email sent to chef: ${chef.username}`);
            } catch (emailError) {
              console.error("Error sending chef email:", emailError);
            }
          }
          
          // Send email to manager
          // Use notification email if set, otherwise fallback to manager's username (email)
          const notificationEmailAddress = location.notification_email || (manager ? manager.username : null);
          
          if (notificationEmailAddress) {
            try {
              const managerEmail = generateBookingNotificationEmail({
                managerEmail: notificationEmailAddress,
                chefName: chef ? chef.username : 'Chef',
                kitchenName: kitchen.name,
                bookingDate: bookingDate,
                startTime,
                endTime,
                specialNotes: specialNotes || ''
              });
              await sendEmail(managerEmail);
              console.log(`✅ Booking notification email sent to manager: ${notificationEmailAddress}`);
            } catch (emailError) {
              console.error("Error sending manager email:", emailError);
              console.error("Manager email error details:", emailError instanceof Error ? emailError.message : emailError);
            }
          } else {
            console.warn(`⚠️ No notification email found for location ${location.id} - location.notification_email: ${location.notification_email || 'NOT SET'}, manager: ${manager ? manager.username : 'NOT FOUND'}`);
          }
        }
      }
    } catch (emailError) {
      console.error("Error sending booking emails:", emailError);
      // Don't fail the booking if emails fail
    }
    
    res.status(201).json({
      id: booking.id,
      chefId: booking.chef_id,
      kitchenId: booking.kitchen_id,
      bookingDate: booking.booking_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      status: booking.status,
      specialNotes: booking.special_notes,
      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
      // Storage and equipment add-ons
      storageBookings: storageBookingsCreated,
      equipmentBookings: equipmentBookingsCreated,
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ error: "Failed to create booking", details: error.message });
  }
});

// Get chef's bookings
app.get("/api/chef/bookings", requireChef, async (req, res) => {
  try {
    if (!pool) {
      return res.json([]);
    }
    
    // Get bookings with kitchen and location information
    const result = await pool.query(`
      SELECT 
        kb.id, kb.chef_id as "chefId", kb.kitchen_id as "kitchenId", 
        kb.booking_date as "bookingDate", kb.start_time as "startTime", 
        kb.end_time as "endTime", kb.status, kb.special_notes as "specialNotes",
        kb.created_at as "createdAt", kb.updated_at as "updatedAt",
        k.name as "kitchenName", k.location_id as "locationId",
        l.name as "locationName", l.timezone as "locationTimezone"
      FROM kitchen_bookings kb
      LEFT JOIN kitchens k ON kb.kitchen_id = k.id
      LEFT JOIN locations l ON k.location_id = l.id
      WHERE kb.chef_id = $1
      ORDER BY kb.booking_date DESC, kb.start_time DESC
    `, [req.user.id]);
    
    // Map the results to include locationTimezone with default fallback
    const enrichedBookings = result.rows.map(booking => ({
      ...booking,
      locationTimezone: booking.locationTimezone || DEFAULT_TIMEZONE,
      locationName: booking.locationName || null,
      kitchenName: booking.kitchenName || null,
    }));
    
    res.json(enrichedBookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// Cancel a booking
app.put("/api/chef/bookings/:bookingId/cancel", requireChef, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }
    
    // Get booking details before updating
    const bookingResult = await pool.query(`
      SELECT * FROM kitchen_bookings 
      WHERE id = $1 AND chef_id = $2
    `, [bookingId, req.user.id]);
    
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }
    
    const booking = bookingResult.rows[0];
    
    // Update booking status
    await pool.query(`
      UPDATE kitchen_bookings 
      SET status = 'cancelled' 
      WHERE id = $1
    `, [bookingId]);
    
    // Send email notifications to chef and manager
    try {
      // Get kitchen details
      const kitchenData = await pool.query(`
        SELECT k.id, k.name, k.location_id
        FROM kitchens k
        WHERE k.id = $1
      `, [booking.kitchen_id]);
      
      if (kitchenData.rows.length > 0) {
        const kitchen = kitchenData.rows[0];
        
        // Get location details with notification email
        const locationData = await pool.query(`
          SELECT l.id, l.name, l.manager_id, l.notification_email
          FROM locations l
          WHERE l.id = $1
        `, [kitchen.location_id]);
        
        if (locationData.rows.length > 0) {
          const location = locationData.rows[0];
          
          // Get chef details
          const chefData = await pool.query(`
            SELECT id, username
            FROM users
            WHERE id = $1
          `, [req.user.id]);
          
          const chef = chefData.rows[0];
          
          // Get manager details if manager_id is set
          let manager = null;
          if (location.manager_id) {
            const managerData = await pool.query(`
              SELECT id, username
              FROM users
              WHERE id = $1
            `, [location.manager_id]);
            
            if (managerData.rows.length > 0) {
              manager = managerData.rows[0];
            }
          }
          
          // Import email functions
          const { sendEmail, generateBookingCancellationEmail, generateBookingCancellationNotificationEmail } = await import('../server/email.js');
          
          // Send email to chef
          if (chef) {
            try {
              const chefEmail = generateBookingCancellationEmail({
                chefEmail: chef.username,
                chefName: chef.username,
                kitchenName: kitchen.name,
                bookingDate: booking.booking_date,
                startTime: booking.start_time,
                endTime: booking.end_time,
                cancellationReason: 'You cancelled this booking'
              });
              await sendEmail(chefEmail);
              console.log(`✅ Booking cancellation email sent to chef: ${chef.username}`);
            } catch (emailError) {
              console.error("Error sending chef cancellation email:", emailError);
            }
          }
          
          // Send email to manager
          const notificationEmailAddress = location.notification_email || (manager ? manager.username : null);
          
          if (notificationEmailAddress && chef) {
            try {
              const managerEmail = generateBookingCancellationNotificationEmail({
                managerEmail: notificationEmailAddress,
                chefName: chef.username,
                kitchenName: kitchen.name,
                bookingDate: booking.booking_date,
                startTime: booking.start_time,
                endTime: booking.end_time,
                cancellationReason: 'Cancelled by chef'
              });
              await sendEmail(managerEmail);
              console.log(`✅ Booking cancellation notification email sent to manager: ${notificationEmailAddress}`);
            } catch (emailError) {
              console.error("Error sending manager cancellation email:", emailError);
              console.error("Manager email error details:", emailError instanceof Error ? emailError.message : emailError);
            }
          } else {
            console.warn(`⚠️ No notification email found for location ${location.id} - location.notification_email: ${location.notification_email || 'NOT SET'}, manager: ${manager ? manager.username : 'NOT FOUND'}`);
          }
        }
      }
    } catch (emailError) {
      console.error("Error sending booking cancellation emails:", emailError);
      // Don't fail the cancellation if emails fail
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
});

// Chef: Share profile with location (NEW - location-based)
app.post("/api/chef/share-profile", requireChef, async (req, res) => {
  try {
    const { locationId } = req.body;
    const chefId = req.user.id;
    
    if (!locationId) {
      return res.status(400).json({ error: "locationId is required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }
    
    // Check if chef has admin-granted access to this location
    const accessCheck = await pool.query(
      'SELECT id FROM chef_location_access WHERE chef_id = $1 AND location_id = $2',
      [chefId, locationId]
    );
    
    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: "You don't have access to this location. Please contact an administrator." });
    }

    // Check if profile already exists (handle case if table doesn't exist yet)
    let existingProfile;
    try {
      existingProfile = await pool.query(
        'SELECT id, status FROM chef_location_profiles WHERE chef_id = $1 AND location_id = $2',
        [chefId, locationId]
      );
    } catch (error) {
      // If table doesn't exist, treat as if no profile exists and will create one
      if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
        console.log(`[Share Profile] chef_location_profiles table doesn't exist yet`);
        existingProfile = { rows: [] };
      } else {
        throw error;
      }
    }
    
    if (existingProfile.rows.length > 0) {
      const existing = existingProfile.rows[0];
      
      // If profile was rejected, update it back to pending (allow re-sharing)
      if (existing.status === 'rejected') {
        const updateResult = await pool.query(
          `UPDATE chef_location_profiles
           SET status = 'pending', 
               shared_at = NOW(),
               reviewed_by = NULL,
               reviewed_at = NULL,
               review_feedback = NULL
           WHERE id = $1
           RETURNING *`,
          [existing.id]
        );
        
        const profile = updateResult.rows[0];
        
        // Send email to manager when chef re-shares rejected profile
        if (profile && profile.status === 'pending') {
          try {
            // Get location details with notification email
            const locationResult = await pool.query(
              `SELECT id, name, notification_email, manager_id
               FROM locations
               WHERE id = $1`,
              [locationId]
            );
            
            if (locationResult.rows.length > 0) {
              const location = locationResult.rows[0];
              const managerEmail = location.notification_email;
              
              if (managerEmail) {
                // Get chef details
                const chefResult = await pool.query(
                  `SELECT id, username FROM users WHERE id = $1`,
                  [chefId]
                );
                
                const chef = chefResult.rows[0];
                if (chef) {
                  // Get chef's application details for email
                  const appResult = await pool.query(
                    `SELECT id, full_name, email
                     FROM applications
                     WHERE user_id = $1 AND status = 'approved'
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [chefId]
                  );
                  
                  const chefApp = appResult.rows[0];
                  const chefName = chefApp && chefApp.full_name 
                    ? chefApp.full_name 
                    : chef.username || 'Chef';
                  const chefEmail = chefApp && chefApp.email 
                    ? chefApp.email 
                    : chef.username || 'chef@example.com';
                  
                  // Import email functions
                  const { sendEmail, generateChefProfileRequestEmail } = await import('../server/email.js');
                  
                  const emailContent = generateChefProfileRequestEmail({
                    managerEmail: managerEmail,
                    chefName: chefName,
                    chefEmail: chefEmail,
                    locationName: location.name || 'Location',
                    locationId: locationId
                  });
                  
                  await sendEmail(emailContent);
                  console.log(`✅ Chef profile re-share notification sent to manager: ${managerEmail}`);
                }
              }
            }
          } catch (emailError) {
            console.error("Error sending chef profile re-share notification:", emailError);
            // Don't fail the profile re-share if email fails
          }
        }
        
        return res.json({
          id: profile.id,
          chefId: profile.chef_id,
          locationId: profile.location_id,
          status: profile.status,
          sharedAt: profile.shared_at,
          reviewedBy: profile.reviewed_by,
          reviewedAt: profile.reviewed_at,
          reviewFeedback: profile.review_feedback,
        });
      }
      
      // Profile already shared (and not rejected), return existing profile
      const profileResult = await pool.query(
        'SELECT * FROM chef_location_profiles WHERE id = $1',
        [existing.id]
      );
      const profile = profileResult.rows[0];
      return res.json({
        id: profile.id,
        chefId: profile.chef_id,
        locationId: profile.location_id,
        status: profile.status,
        sharedAt: profile.shared_at,
        reviewedBy: profile.reviewed_by,
        reviewedAt: profile.reviewed_at,
        reviewFeedback: profile.review_feedback,
      });
    }

    // Create new profile (status: 'pending')
    const insertResult = await pool.query(
      `INSERT INTO chef_location_profiles (chef_id, location_id, status, shared_at)
       VALUES ($1, $2, 'pending', NOW())
       RETURNING *`,
      [chefId, locationId]
    );
    
    const profile = insertResult.rows[0];
    
    // Send email to manager when chef shares profile for kitchen access
    if (profile && profile.status === 'pending') {
      try {
        // Get location details with notification email
        const locationResult = await pool.query(
          `SELECT id, name, notification_email, manager_id
           FROM locations
           WHERE id = $1`,
          [locationId]
        );
        
        if (locationResult.rows.length > 0) {
          const location = locationResult.rows[0];
          const managerEmail = location.notification_email;
          
          if (managerEmail) {
            // Get chef details
            const chefResult = await pool.query(
              `SELECT id, username FROM users WHERE id = $1`,
              [chefId]
            );
            
            const chef = chefResult.rows[0];
            if (chef) {
              // Get chef's application details for email
              const appResult = await pool.query(
                `SELECT id, full_name, email
                 FROM applications
                 WHERE user_id = $1 AND status = 'approved'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [chefId]
              );
              
              const chefApp = appResult.rows[0];
              const chefName = chefApp && chefApp.full_name 
                ? chefApp.full_name 
                : chef.username || 'Chef';
              const chefEmail = chefApp && chefApp.email 
                ? chefApp.email 
                : chef.username || 'chef@example.com';
              
              // Import email functions
              const { sendEmail, generateChefProfileRequestEmail } = await import('../server/email.js');
              
              const emailContent = generateChefProfileRequestEmail({
                managerEmail: managerEmail,
                chefName: chefName,
                chefEmail: chefEmail,
                locationName: location.name || 'Location',
                locationId: locationId
              });
              
              await sendEmail(emailContent);
              console.log(`✅ Chef profile request notification sent to manager: ${managerEmail}`);
            }
          }
        }
      } catch (emailError) {
        console.error("Error sending chef profile request notification:", emailError);
        // Don't fail the profile share if email fails
      }
    }
    
    res.status(201).json({
      id: profile.id,
      chefId: profile.chef_id,
      locationId: profile.location_id,
      status: profile.status,
      sharedAt: profile.shared_at,
      reviewedBy: profile.reviewed_by,
      reviewedAt: profile.reviewed_at,
      reviewFeedback: profile.review_feedback,
    });
  } catch (error) {
    console.error("Error sharing chef profile:", error);
    res.status(500).json({ error: error.message || "Failed to share profile" });
  }
});

// Chef: Get profile status for kitchens (using location-based access)
app.get("/api/chef/profiles", requireChef, async (req, res) => {
  try {
    const chefId = req.user.id;
    
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get all locations chef has access to (handle case if table doesn't exist yet)
    let locationAccessResult;
    try {
      locationAccessResult = await pool.query(
        'SELECT location_id FROM chef_location_access WHERE chef_id = $1',
        [chefId]
      );
    } catch (error) {
      // If table doesn't exist, return empty array
      if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
        console.log(`[Chef Profiles] chef_location_access table doesn't exist yet, returning empty`);
        return res.json([]);
      }
      throw error;
    }
    
    if (locationAccessResult.rows.length === 0) {
      return res.json([]); // Chef has no access to any locations
    }
    
    const locationIds = locationAccessResult.rows.map(row => row.location_id);
    
    // Get all locations with details
    const locationsResult = await pool.query(
      `SELECT id, name, address FROM locations WHERE id = ANY($1::int[]) ORDER BY name`,
      [locationIds]
    );
    
    if (locationsResult.rows.length === 0) {
      return res.json([]);
    }
    
    // Get profiles for all accessible locations (handle case if table doesn't exist yet)
    let profilesResult;
    try {
      profilesResult = await pool.query(
        `SELECT * FROM chef_location_profiles 
         WHERE chef_id = $1 AND location_id = ANY($2::int[])
         ORDER BY location_id`,
        [chefId, locationIds]
      );
    } catch (error) {
      // If table doesn't exist, return profiles with null status
      if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
        console.log(`[Chef Profiles] chef_location_profiles table doesn't exist yet, returning null profiles`);
        profilesResult = { rows: [] };
      } else {
        throw error;
      }
    }
    
    // Build response with location info and profile status
    const response = locationIds.map(locationId => {
      const profile = profilesResult.rows.find(p => p.location_id === locationId);
      const location = locationsResult.rows.find(l => l.id === locationId);
      return {
        locationId,
        location: location ? {
          id: location.id,
          name: location.name,
          address: location.address,
        } : null,
        profile: profile ? {
          id: profile.id,
          chefId: profile.chef_id,
          locationId: profile.location_id,
          status: profile.status,
          sharedAt: profile.shared_at,
          reviewedBy: profile.reviewed_by,
          reviewedAt: profile.reviewed_at,
          reviewFeedback: profile.review_feedback,
        } : null,
      };
    });
    
    res.json(response);
  } catch (error) {
    console.error("Error getting chef profiles:", error);
    res.status(500).json({ error: error.message || "Failed to get profiles" });
  }
});

// ===================================================================
// MANAGER ENDPOINTS - Kitchen Booking Management
// ===================================================================

// Get date overrides for a kitchen
app.get("/api/manager/kitchens/:kitchenId/date-overrides", async (req, res) => {
  try {
    // Authentication check
    const sessionUserId = req.session?.userId;
    if (!sessionUserId && !req.headers.authorization) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let user;
    if (req.headers.authorization) {
      // Firebase auth
      const token = req.headers.authorization.replace('Bearer ', '');
      // Simplified - assume valid for now
      user = { role: 'manager' };
    } else {
      // Session auth
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "User not found" });
      }
      user = result.rows[0];
    }

    if (user.role !== 'manager') {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    const result = await pool.query(`
      SELECT * FROM kitchen_date_overrides
      WHERE kitchen_id = $1
      ORDER BY specific_date ASC
    `, [kitchenId]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching date overrides:", error);
    res.status(500).json({ error: "Failed to fetch date overrides" });
  }
});

// Create date override
app.post("/api/manager/kitchens/:kitchenId/date-overrides", async (req, res) => {
  try {
    // Authentication check
    const sessionUserId = req.session?.userId;
    if (!sessionUserId && !req.headers.authorization) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let user;
    if (req.headers.authorization) {
      user = { role: 'manager' };
    } else {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "User not found" });
      }
      user = result.rows[0];
    }

    if (user.role !== 'manager') {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    const { specificDate, startTime, endTime, isAvailable, reason, maxSlotsPerChef } = req.body;

    // Validate
    if (!specificDate) {
      return res.status(400).json({ error: "Date is required" });
    }

    // Insert into database - ensure date is properly formatted
    const dateObj = new Date(specificDate);
    const formattedDate = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    console.log('📝 Creating date override:', { kitchenId, formattedDate, startTime, endTime, isAvailable, reason, maxSlotsPerChef });
    
    // Check if override already exists
    const existingCheck = await pool.query(`
      SELECT id FROM kitchen_date_overrides
      WHERE kitchen_id = $1 AND DATE(specific_date) = $2::date
      AND start_time = $3 AND end_time = $4
    `, [kitchenId, formattedDate, startTime, endTime]);
    
    if (existingCheck.rows.length > 0) {
      console.log('⚠️ Override already exists, updating instead');
      const updateResult = await pool.query(`
        UPDATE kitchen_date_overrides
        SET is_available = $1, reason = $2, max_slots_per_chef = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `, [isAvailable, reason, maxSlotsPerChef || 2, existingCheck.rows[0].id]);
      return res.json(updateResult.rows[0]);
    }
    
    const result = await pool.query(`
      INSERT INTO kitchen_date_overrides (kitchen_id, specific_date, start_time, end_time, is_available, reason, max_slots_per_chef)
      VALUES ($1, $2::date, $3, $4, $5, $6, $7)
      RETURNING *
    `, [kitchenId, formattedDate, startTime, endTime, isAvailable, reason, maxSlotsPerChef || 2]);

    console.log('✅ Date override created:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error creating date override:", error);
    console.error("Error details:", error.message, error.stack);
    res.status(500).json({ error: error.message || "Failed to create date override" });
  }
});
// Update date override
app.put("/api/manager/date-overrides/:id", async (req, res) => {
  try {
    // Authentication check
    const sessionUserId = req.session?.userId;
    if (!sessionUserId && !req.headers.authorization) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let user;
    if (req.headers.authorization) {
      user = { role: 'manager' };
    } else {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "User not found" });
      }
      user = result.rows[0];
    }

    if (user.role !== 'manager') {
      return res.status(403).json({ error: "Manager access required" });
    }

    const id = parseInt(req.params.id);
    const { startTime, endTime, isAvailable, reason, maxSlotsPerChef } = req.body;

    console.log('📝 Updating date override:', { id, startTime, endTime, isAvailable, reason, maxSlotsPerChef });

    const result = await pool.query(`
      UPDATE kitchen_date_overrides
      SET start_time = $1, end_time = $2, is_available = $3, reason = $4, max_slots_per_chef = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [startTime, endTime, isAvailable, reason, maxSlotsPerChef || 2, id]);

    if (result.rows.length === 0) {
      console.log('⚠️ Date override not found:', id);
      return res.status(404).json({ error: "Date override not found" });
    }

    console.log('✅ Date override updated:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating date override:", error);
    console.error("Error details:", error.message, error.stack);
    res.status(500).json({ error: error.message || "Failed to update date override" });
  }
});

// Delete date override
app.delete("/api/manager/date-overrides/:id", async (req, res) => {
  try {
    // Authentication check
    const sessionUserId = req.session?.userId;
    if (!sessionUserId && !req.headers.authorization) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let user;
    if (req.headers.authorization) {
      user = { role: 'manager' };
    } else {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "User not found" });
      }
      user = result.rows[0];
    }

    if (user.role !== 'manager') {
      return res.status(403).json({ error: "Manager access required" });
    }

    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM kitchen_date_overrides WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting date override:", error);
    res.status(500).json({ error: "Failed to delete date override" });
  }
});

// Get bookings for a kitchen
app.get("/api/manager/kitchens/:kitchenId/bookings", async (req, res) => {
  try {
    // Authentication check
    const sessionUserId = req.session?.userId;
    if (!sessionUserId && !req.headers.authorization) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let user;
    if (req.headers.authorization) {
      user = { role: 'manager' };
    } else {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "User not found" });
      }
      user = result.rows[0];
    }

    if (user.role !== 'manager') {
      return res.status(403).json({ error: "Manager access required" });
    }

    const kitchenId = parseInt(req.params.kitchenId);
    const result = await pool.query(`
      SELECT * FROM kitchen_bookings
      WHERE kitchen_id = $1
      ORDER BY booking_date DESC, start_time ASC
    `, [kitchenId]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching kitchen bookings:", error);
    res.status(500).json({ error: "Failed to fetch kitchen bookings" });
  }
});

// Get all bookings for manager
app.get("/api/manager/bookings", async (req, res) => {
  try {
    // Authentication check
    const sessionUserId = req.session?.userId;
    if (!sessionUserId && !req.headers.authorization) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let userId;
    if (req.headers.authorization) {
      // For now, return empty for Firebase auth (would need to decode token)
      return res.json([]);
    } else {
      const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
      if (userResult.rows.length === 0) {
        return res.status(401).json({ error: "User not found" });
      }
      const user = userResult.rows[0];
      if (user.role !== 'manager') {
        return res.status(403).json({ error: "Manager access required" });
      }
      userId = user.id;
    }

    // Get all locations for this manager
    const locationsResult = await pool.query(
      'SELECT id FROM locations WHERE manager_id = $1',
      [userId]
    );
    
    const locationIds = locationsResult.rows.map(row => row.id);
    
    if (locationIds.length === 0) {
      return res.json([]);
    }

    // Get all kitchens for these locations
    const kitchensResult = await pool.query(
      'SELECT id FROM kitchens WHERE location_id = ANY($1::int[])',
      [locationIds]
    );
    
    const kitchenIds = kitchensResult.rows.map(row => row.id);
    
    if (kitchenIds.length === 0) {
      return res.json([]);
    }

    // Get all bookings for these kitchens (fetch bookings first, then enrich like chef profiles)
    const bookingsResult = await pool.query(`
      SELECT id, chef_id, kitchen_id, booking_date, start_time, end_time, 
             status, special_notes, created_at, updated_at
      FROM kitchen_bookings 
      WHERE kitchen_id = ANY($1::int[])
      ORDER BY booking_date DESC, start_time ASC
    `, [kitchenIds]);
    
    // Enrich each booking with chef, kitchen, and location details (exactly like chef profiles)
    const enrichedBookings = await Promise.all(
      bookingsResult.rows.map(async (booking) => {
        // Get chef details
        let chefName = null;
        if (booking.chef_id) {
          try {
            const chefResult = await pool.query(
              'SELECT id, username FROM users WHERE id = $1',
              [booking.chef_id]
            );
            const chef = chefResult.rows[0];
            
            if (chef) {
              chefName = chef.username;
              
              // Try to get chef's full name from their application
              const appResult = await pool.query(
                'SELECT full_name FROM applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                [booking.chef_id]
              );
              if (appResult.rows.length > 0 && appResult.rows[0].full_name) {
                chefName = appResult.rows[0].full_name;
              }
            }
          } catch (error) {
            // Silently handle errors
          }
        }
        
        // Get kitchen details
        let kitchenName = 'Kitchen';
        let locationId = null;
        if (booking.kitchen_id) {
          try {
            const kitchenResult = await pool.query(
              'SELECT id, name, location_id FROM kitchens WHERE id = $1',
              [booking.kitchen_id]
            );
            const kitchen = kitchenResult.rows[0];
            if (kitchen) {
              kitchenName = kitchen.name || 'Kitchen';
              locationId = kitchen.location_id;
            }
          } catch (error) {
            // Silently handle errors
          }
        }
        
        // Get location details including timezone
        let locationName = null;
        let locationTimezone = DEFAULT_TIMEZONE;
        if (locationId) {
          try {
            const locationResult = await pool.query(
              'SELECT id, name, timezone FROM locations WHERE id = $1',
              [locationId]
            );
            const location = locationResult.rows[0];
            if (location) {
              locationName = location.name;
              locationTimezone = location.timezone || DEFAULT_TIMEZONE;
            }
          } catch (error) {
            // Silently handle errors
          }
        }
        
        return {
          id: booking.id,
          chefId: booking.chef_id,
          kitchenId: booking.kitchen_id,
          bookingDate: booking.booking_date,
          startTime: booking.start_time,
          endTime: booking.end_time,
          status: booking.status,
          specialNotes: booking.special_notes,
          createdAt: booking.created_at,
          updatedAt: booking.updated_at,
          chefName: chefName,
          kitchenName: kitchenName,
          locationName: locationName,
          locationTimezone: locationTimezone,
        };
      })
    );
    
    res.json(enrichedBookings);
  } catch (error) {
    console.error("Error fetching manager bookings:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// Update booking status
app.put("/api/manager/bookings/:id/status", async (req, res) => {
  try {
    // Authentication check
    const sessionUserId = req.session?.userId;
    if (!sessionUserId && !req.headers.authorization) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let user;
    if (req.headers.authorization) {
      user = { role: 'manager' };
    } else {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "User not found" });
      }
      user = result.rows[0];
    }

    if (user.role !== 'manager') {
      return res.status(403).json({ error: "Manager access required" });
    }

    const id = parseInt(req.params.id);
    const { status } = req.body;

    // Get booking details before updating
    const bookingResult = await pool.query(`
      SELECT * FROM kitchen_bookings WHERE id = $1
    `, [id]);
    
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }
    
    const booking = bookingResult.rows[0];

    // If confirming a booking, check if location's kitchen license is approved
    if (status === 'confirmed') {
      // Get the kitchen's location
      const kitchenResult = await pool.query(
        'SELECT location_id FROM kitchens WHERE id = $1',
        [booking.kitchen_id]
      );
      
      if (kitchenResult.rows.length > 0) {
        const locationId = kitchenResult.rows[0].location_id;
        
        // Check license status
        const locationResult = await pool.query(
          'SELECT kitchen_license_status FROM locations WHERE id = $1',
          [locationId]
        );
        
        if (locationResult.rows.length > 0) {
          const licenseStatus = locationResult.rows[0].kitchen_license_status;
          
          if (licenseStatus !== 'approved') {
            return res.status(403).json({ 
              error: "Cannot confirm booking",
              message: licenseStatus === 'pending'
                ? "Your kitchen license is pending admin approval. Bookings cannot be confirmed until your license is approved."
                : licenseStatus === 'rejected'
                ? "Your kitchen license has been rejected. Please upload a new license and get it approved before confirming bookings."
                : "Your kitchen license has not been uploaded or approved. Please complete onboarding and get your license approved before confirming bookings."
            });
          }
        }
      }
    }

    const result = await pool.query(`
      UPDATE kitchen_bookings
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Send email notifications to chef and manager based on status change
    if (booking) {
      try {
        const kitchenResult = await pool.query('SELECT * FROM kitchens WHERE id = $1', [booking.kitchen_id]);
        const chefResult = await pool.query('SELECT * FROM users WHERE id = $1', [booking.chef_id]);
        
        const kitchen = kitchenResult.rows[0];
        const chef = chefResult.rows[0];
        
        if (chef && kitchen) {
          // Get location details with notification email
          const locationResult = await pool.query(`
            SELECT l.id, l.name, l.manager_id, l.notification_email
            FROM locations l
            WHERE l.id = $1
          `, [kitchen.location_id]);
          
          const location = locationResult.rows[0];
          
          // Get manager details if manager_id is set
          let manager = null;
          if (location && location.manager_id) {
            const managerResult = await pool.query('SELECT * FROM users WHERE id = $1', [location.manager_id]);
            if (managerResult.rows.length > 0) {
              manager = managerResult.rows[0];
            }
          }
          
          const { sendEmail, generateBookingConfirmationEmail, generateBookingCancellationEmail, generateBookingStatusChangeNotificationEmail } = await import('../server/email.js');
          
          if (status === 'confirmed') {
            // Send confirmation email to chef
            try {
              const confirmationEmail = generateBookingConfirmationEmail({
                chefEmail: chef.username,
                chefName: chef.username,
                kitchenName: kitchen.name,
                bookingDate: booking.booking_date,
                startTime: booking.start_time,
                endTime: booking.end_time,
                specialNotes: booking.special_notes
              });
              await sendEmail(confirmationEmail);
              console.log(`✅ Booking confirmation email sent to chef: ${chef.username}`);
            } catch (emailError) {
              console.error("Error sending chef confirmation email:", emailError);
            }
            
            // Send notification email to manager
            const notificationEmailAddress = location ? (location.notification_email || (manager ? manager.username : null)) : null;
            if (notificationEmailAddress) {
              try {
                const managerEmail = generateBookingStatusChangeNotificationEmail({
                  managerEmail: notificationEmailAddress,
                  chefName: chef.username,
                  kitchenName: kitchen.name,
                  bookingDate: booking.booking_date,
                  startTime: booking.start_time,
                  endTime: booking.end_time,
                  status: 'confirmed'
                });
                await sendEmail(managerEmail);
                console.log(`✅ Booking confirmation notification email sent to manager: ${notificationEmailAddress}`);
              } catch (emailError) {
                console.error("Error sending manager confirmation email:", emailError);
              }
            }
          } else if (status === 'cancelled') {
            // Send cancellation email to chef
            try {
              const cancellationEmail = generateBookingCancellationEmail({
                chefEmail: chef.username,
                chefName: chef.username,
                kitchenName: kitchen.name,
                bookingDate: booking.booking_date,
                startTime: booking.start_time,
                endTime: booking.end_time,
                cancellationReason: 'The manager has cancelled this booking'
              });
              await sendEmail(cancellationEmail);
              console.log(`✅ Booking cancellation email sent to chef: ${chef.username}`);
            } catch (emailError) {
              console.error("Error sending chef cancellation email:", emailError);
            }
            
            // Send notification email to manager
            const notificationEmailAddress = location ? (location.notification_email || (manager ? manager.username : null)) : null;
            if (notificationEmailAddress) {
              try {
                const managerEmail = generateBookingStatusChangeNotificationEmail({
                  managerEmail: notificationEmailAddress,
                  chefName: chef.username,
                  kitchenName: kitchen.name,
                  bookingDate: booking.booking_date,
                  startTime: booking.start_time,
                  endTime: booking.end_time,
                  status: 'cancelled'
                });
                await sendEmail(managerEmail);
                console.log(`✅ Booking cancellation notification email sent to manager: ${notificationEmailAddress}`);
              } catch (emailError) {
                console.error("Error sending manager cancellation email:", emailError);
              }
            }
          }
        }
      } catch (emailError) {
        console.error("Error sending booking status email:", emailError);
        // Don't fail the status update if email fails
      }
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating booking status:", error);
    res.status(500).json({ error: "Failed to update booking status" });
  }
});

// ===================================
// KITCHEN BOOKING SYSTEM - ADMIN CHEF KITCHEN ACCESS ROUTES
// ===================================

// Admin: Grant chef access to a kitchen
app.post("/api/admin/chef-kitchen-access", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { chefId, kitchenId } = req.body;
    
    if (!chefId || !kitchenId) {
      return res.status(400).json({ error: "chefId and kitchenId are required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Check if access already exists
    const existingResult = await pool.query(
      'SELECT id FROM chef_kitchen_access WHERE chef_id = $1 AND kitchen_id = $2',
      [chefId, kitchenId]
    );

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: "Access already granted" });
    }

    // Grant access
    const result = await pool.query(
      `INSERT INTO chef_kitchen_access (chef_id, kitchen_id, granted_by, granted_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [chefId, kitchenId, user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error granting chef kitchen access:", error);
    res.status(500).json({ error: error.message || "Failed to grant access" });
  }
});

// Admin: Revoke chef access to a kitchen
app.delete("/api/admin/chef-kitchen-access", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { chefId, kitchenId } = req.body;
    
    if (!chefId || !kitchenId) {
      return res.status(400).json({ error: "chefId and kitchenId are required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    const result = await pool.query(
      'DELETE FROM chef_kitchen_access WHERE chef_id = $1 AND kitchen_id = $2 RETURNING id',
      [chefId, kitchenId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Access record not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error revoking chef kitchen access:", error);
    res.status(500).json({ error: error.message || "Failed to revoke access" });
  }
});

// Admin: Get all chefs with their kitchen access
app.get("/api/admin/chef-kitchen-access", async (req, res) => {
  try {
    console.log("[Admin Chef Access] GET request received");
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    
    console.log("[Admin Chef Access] Auth check:", { hasSession: !!req.session.userId, hasHeader: !!req.headers['x-user-id'] });
    
    if (!rawUserId) {
      console.log("[Admin Chef Access] Not authenticated");
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    console.log("[Admin Chef Access] User:", user ? { id: user.id, role: user.role } : null);
    
    if (!user || user.role !== "admin") {
      console.log("[Admin Chef Access] Not admin");
      return res.status(403).json({ error: "Admin access required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get all chefs from database (role = 'chef' OR is_chef = true)
    const chefsResult = await pool.query(
      `SELECT id, username, role, is_chef 
       FROM users 
       WHERE role = 'chef' OR is_chef = true
       ORDER BY username`
    );
    const chefs = chefsResult.rows;
    
    console.log(`[Admin Chef Access] Total users checked, Found ${chefs.length} chefs in database`);
    console.log(`[Admin Chef Access] Chefs:`, chefs.map(c => ({ id: c.id, username: c.username, role: c.role, is_chef: c.is_chef })));
    
    // Get all kitchens with location info
    const kitchensResult = await pool.query(`
      SELECT k.id, k.name, k.location_id, l.name as location_name
      FROM kitchens k
      LEFT JOIN locations l ON k.location_id = l.id
      WHERE k.is_active != false
      ORDER BY l.name, k.name
    `);
    const allKitchens = kitchensResult.rows.map(k => ({
      id: k.id,
      name: k.name,
      locationName: k.location_name,
      locationId: k.location_id
    }));
    console.log(`[Admin Chef Access] Found ${allKitchens.length} kitchens`);
    
    // Get all access records
    const accessResult = await pool.query(
      'SELECT * FROM chef_kitchen_access ORDER BY granted_at DESC'
    );
    const allAccess = accessResult.rows;
    console.log(`[Admin Chef Access] Found ${allAccess.length} access records`);
    
    // Build response with chef access info
    const response = chefs.map(chef => {
      const chefAccess = allAccess.filter(a => a.chef_id === chef.id);
      const accessibleKitchens = chefAccess.map(access => {
        const kitchen = allKitchens.find(k => k.id === access.kitchen_id);
        
        if (kitchen) {
          return {
            id: kitchen.id,
            name: kitchen.name,
            locationName: kitchen.locationName,
            accessGrantedAt: access.granted_at ? new Date(access.granted_at).toISOString() : undefined,
          };
        }
        return null;
      }).filter(k => k !== null);
      
      return {
        chef: {
          id: chef.id,
          username: chef.username,
        },
        accessibleKitchens,
      };
    });
    
    console.log(`[Admin Chef Access] Returning ${response.length} chefs with access info`);
    res.json(response);
  } catch (error) {
    console.error("[Admin Chef Access] Error:", error);
    console.error("[Admin Chef Access] Error stack:", error.stack);
    res.status(500).json({ error: error.message || "Failed to get access" });
  }
});

// ===================================
// KITCHEN BOOKING SYSTEM - ADMIN CHEF LOCATION ACCESS ROUTES (NEW)
// ===================================

// Admin: Grant chef access to a location
app.post("/api/admin/chef-location-access", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { chefId, locationId } = req.body;
    
    if (!chefId || !locationId) {
      return res.status(400).json({ error: "chefId and locationId are required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Check if access already exists
    const existingResult = await pool.query(
      'SELECT id FROM chef_location_access WHERE chef_id = $1 AND location_id = $2',
      [chefId, locationId]
    );

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: "Access already granted" });
    }

    // Grant access
    const result = await pool.query(
      `INSERT INTO chef_location_access (chef_id, location_id, granted_by, granted_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [chefId, locationId, user.id]
    );

    const access = result.rows[0];
    
    // Send email notification to chef when access is granted
    try {
      // Get location details
      const locationData = await pool.query(`
        SELECT l.id, l.name
        FROM locations l
        WHERE l.id = $1
      `, [locationId]);
      
      if (locationData.rows.length > 0) {
        const location = locationData.rows[0];
        
        // Get chef details
        const chefData = await pool.query(`
          SELECT id, username
          FROM users
          WHERE id = $1
        `, [chefId]);
        
        if (chefData.rows.length > 0) {
          const chef = chefData.rows[0];
          
          // Import email functions
          const { sendEmail, generateChefLocationAccessApprovedEmail } = await import('../server/email.js');
          
          try {
            const chefEmail = generateChefLocationAccessApprovedEmail({
              chefEmail: chef.username,
              chefName: chef.username,
              locationName: location.name,
              locationId: location.id
            });
            await sendEmail(chefEmail);
            console.log(`✅ Chef location access granted email sent to chef: ${chef.username}`);
          } catch (emailError) {
            console.error("Error sending chef access email:", emailError);
            console.error("Chef email error details:", emailError instanceof Error ? emailError.message : emailError);
          }
        }
      }
    } catch (emailError) {
      console.error("Error sending chef access emails:", emailError);
      // Don't fail the access grant if emails fail
    }
    
    res.status(201).json(access);
  } catch (error) {
    console.error("Error granting chef location access:", error);
    res.status(500).json({ error: error.message || "Failed to grant access" });
  }
});

// Admin: Revoke chef access to a location
app.delete("/api/admin/chef-location-access", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { chefId, locationId } = req.body;
    
    if (!chefId || !locationId) {
      return res.status(400).json({ error: "chefId and locationId are required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    const result = await pool.query(
      'DELETE FROM chef_location_access WHERE chef_id = $1 AND location_id = $2 RETURNING id',
      [chefId, locationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Access record not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error revoking chef location access:", error);
    res.status(500).json({ error: error.message || "Failed to revoke access" });
  }
});

// Admin: Approve or reject kitchen license
app.put("/api/admin/locations/:locationId/kitchen-license", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const locationId = parseInt(req.params.locationId);
    if (isNaN(locationId)) {
      return res.status(400).json({ error: "Invalid location ID" });
    }

    const { status, feedback } = req.body;
    
    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Verify location exists
    const locationCheck = await pool.query(
      'SELECT id, name, kitchen_license_url FROM locations WHERE id = $1',
      [locationId]
    );

    if (locationCheck.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }

    const location = locationCheck.rows[0];

    if (!location.kitchen_license_url) {
      return res.status(400).json({ error: "Location does not have a license uploaded" });
    }

    // Update license status
    await pool.query(
      `UPDATE locations 
       SET kitchen_license_status = $1,
           kitchen_license_approved_by = $2,
           kitchen_license_approved_at = NOW(),
           kitchen_license_feedback = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [status, user.id, feedback || null, locationId]
    );

    res.json({ 
      success: true, 
      message: `License ${status} successfully`,
      location: {
        id: locationId,
        name: location.name,
        kitchenLicenseStatus: status
      }
    });
  } catch (error) {
    console.error("Error updating kitchen license status:", error);
    res.status(500).json({ error: error.message || "Failed to update license status" });
  }
});

// Admin: Get all locations with pending licenses
app.get("/api/admin/locations/pending-licenses", async (req, res) => {
  try {
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    if (!rawUserId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    const result = await pool.query(`
      SELECT 
        l.id,
        l.name,
        l.address,
        l.kitchen_license_url as "kitchenLicenseUrl",
        l.kitchen_license_status as "kitchenLicenseStatus",
        l.kitchen_license_feedback as "kitchenLicenseFeedback",
        l.kitchen_license_approved_at as "kitchenLicenseApprovedAt",
        u.username as "managerUsername",
        u.id as "managerId"
      FROM locations l
      LEFT JOIN users u ON l.manager_id = u.id
      WHERE l.kitchen_license_url IS NOT NULL
        AND (l.kitchen_license_status = 'pending' OR l.kitchen_license_status IS NULL)
      ORDER BY l.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching pending licenses:", error);
    res.status(500).json({ error: error.message || "Failed to fetch pending licenses" });
  }
});

// Admin: Get all chefs with their location access
app.get("/api/admin/chef-location-access", async (req, res) => {
  try {
    console.log("[Admin Chef Access] GET request received");
    const rawUserId = req.session.userId || req.headers['x-user-id'];
    
    console.log("[Admin Chef Access] Auth check:", { hasSession: !!req.session.userId, hasHeader: !!req.headers['x-user-id'] });
    
    if (!rawUserId) {
      console.log("[Admin Chef Access] Not authenticated");
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await getUser(rawUserId);
    console.log("[Admin Chef Access] User:", user ? { id: user.id, role: user.role } : null);
    
    if (!user || user.role !== "admin") {
      console.log("[Admin Chef Access] Not admin");
      return res.status(403).json({ error: "Admin access required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get all chefs from database (role = 'chef' OR is_chef = true)
    const chefsResult = await pool.query(
      `SELECT id, username, role, is_chef 
       FROM users 
       WHERE role = 'chef' OR is_chef = true
       ORDER BY username`
    );
    const chefs = chefsResult.rows;
    
    console.log(`[Admin Chef Access] Total users checked, Found ${chefs.length} chefs in database`);
    console.log(`[Admin Chef Access] Chefs:`, chefs.map(c => ({ id: c.id, username: c.username, role: c.role, is_chef: c.is_chef })));
    
    // Get all locations
    const locationsResult = await pool.query(
      'SELECT id, name, address FROM locations ORDER BY name'
    );
    const allLocations = locationsResult.rows;
    console.log(`[Admin Chef Access] Found ${allLocations.length} locations`);
    
    // Get all location access records (handle case if table doesn't exist yet)
    let allAccess = [];
    try {
      const accessResult = await pool.query(
        'SELECT * FROM chef_location_access ORDER BY granted_at DESC'
      );
      allAccess = accessResult.rows;
      console.log(`[Admin Chef Access] Found ${allAccess.length} location access records`);
    } catch (error) {
      console.error(`[Admin Chef Access] Error querying chef_location_access table:`, error.message);
      // If table doesn't exist, return empty array (table will be created via migration)
      if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
        console.log(`[Admin Chef Access] Table doesn't exist yet, returning empty access`);
        allAccess = [];
      } else {
        throw error; // Re-throw if it's a different error
      }
    }
    
    // Build response with chef location access info
    const response = chefs.map(chef => {
      const chefAccess = allAccess.filter(a => a.chef_id === chef.id);
      const accessibleLocations = chefAccess.map(access => {
        const location = allLocations.find(l => l.id === access.location_id);
        
        if (location) {
          return {
            id: location.id,
            name: location.name,
            address: location.address,
            accessGrantedAt: access.granted_at ? new Date(access.granted_at).toISOString() : undefined,
          };
        }
        return null;
      }).filter(l => l !== null);
      
      return {
        chef: {
          id: chef.id,
          username: chef.username,
        },
        accessibleLocations,
      };
    });
    
    console.log(`[Admin Chef Access] Returning ${response.length} chefs with location access info`);
    res.json(response);
  } catch (error) {
    console.error("[Admin Chef Access] Error:", error);
    console.error("[Admin Chef Access] Error stack:", error.stack);
    res.status(500).json({ error: error.message || "Failed to get access" });
  }
});

// ===============================
// PUBLIC MANAGER BOOKING PORTAL ROUTES (No auth required)
// ===============================

// Get all public locations for portal landing page
// Helper function to normalize image URLs (convert relative paths to absolute URLs)
function normalizeImageUrl(url, req) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  
  // If already an absolute URL (http:// or https://), return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // If it's a relative path, convert to absolute URL
  if (url.startsWith('/')) {
    const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
    
    let protocol;
    let host;
    
    if (isProduction) {
      // Vercel sets these headers when behind a proxy
      protocol = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
      host = req.get('x-forwarded-host') || req.get('host') || req.headers.host || '';
    } else {
      protocol = req.protocol || 'http';
      host = req.get('host') || req.headers.host || 'localhost:3000';
    }
    
    // Ensure protocol is https in production
    if (isProduction && protocol !== 'https') {
      protocol = 'https';
    }
    
    if (!host) {
      console.warn(`[normalizeImageUrl] Could not determine host for URL: ${url}`);
      return url; // Return as-is if we can't determine host
    }
    
    return `${protocol}://${host}${url}`;
  }
  
  // Return as-is if it doesn't match any pattern (might be a data URL or other format)
  return url;
}

app.get("/api/public/locations", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get all locations with brand image
    const locationsResult = await pool.query(`
      SELECT id, name, address, 
             logo_url as "logoUrl",
             brand_image_url as "brandImageUrl"
      FROM locations 
      ORDER BY name
    `);
    
    const allLocations = locationsResult.rows;

    // Get all active kitchens with images
    const kitchensResult = await pool.query(`
      SELECT k.id, k.name, k.location_id as "locationId",
             k.image_url as "imageUrl",
             k.gallery_images as "galleryImages",
             k.is_active as "isActive"
      FROM kitchens k
      WHERE k.is_active != false
      ORDER BY k.location_id, k.name
    `);
    
    const allKitchens = kitchensResult.rows;
    
    // Return only public info (no sensitive data)
    const publicLocations = allLocations.map((loc) => {
      const slug = loc.name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      // Get kitchens for this location
      const locationKitchens = allKitchens.filter((kitchen) => 
        kitchen.locationId === loc.id
      );
      
      // Count active kitchens
      const kitchenCount = locationKitchens.length;
      
      // Find the first kitchen image to use as featured image
      let featuredKitchenImage = null;
      for (const kitchen of locationKitchens) {
        // Check if kitchen has imageUrl
        if (kitchen.imageUrl && typeof kitchen.imageUrl === 'string' && kitchen.imageUrl.trim() !== '') {
          featuredKitchenImage = normalizeImageUrl(kitchen.imageUrl, req);
          break;
        }
        
        // Fall back to galleryImages if no imageUrl
        const galleryImages = kitchen.galleryImages;
        if (Array.isArray(galleryImages) && galleryImages.length > 0) {
          const firstGalleryImage = galleryImages[0];
          if (firstGalleryImage && typeof firstGalleryImage === 'string' && firstGalleryImage.trim() !== '') {
            featuredKitchenImage = normalizeImageUrl(firstGalleryImage, req);
            break;
          }
        }
      }
      
      // Normalize location image URLs
      const normalizedLogoUrl = normalizeImageUrl(loc.logoUrl, req);
      const normalizedBrandImageUrl = normalizeImageUrl(loc.brandImageUrl, req);
      
      return {
        id: loc.id,
        name: loc.name,
        address: loc.address,
        logoUrl: normalizedLogoUrl,
        brandImageUrl: normalizedBrandImageUrl,
        featuredKitchenImage: featuredKitchenImage,
        kitchenCount: kitchenCount,
        slug: slug,
      };
    });
    
    // Filter to only locations that have at least one active kitchen
    const locationsWithKitchens = publicLocations.filter((loc) => loc.kitchenCount > 0);
    
    console.log(`[API] /api/public/locations - Returning ${locationsWithKitchens.length} locations with active kitchens`);
    
    res.json(locationsWithKitchens);
  } catch (error) {
    console.error("Error fetching public locations:", error);
    res.status(500).json({ error: error.message || "Failed to fetch locations" });
  }
});

// Get public location info for booking portal (by name slug)
app.get("/api/public/locations/:locationSlug", async (req, res) => {
  try {
    const locationSlug = req.params.locationSlug;
    
    // Try to find location by name (slugified)
    const allLocations = await getAllLocations();
    const location = allLocations.find((loc) => {
      const slug = loc.name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return slug === locationSlug;
    });

    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    // Return public location info (no sensitive data)
    res.json({
      id: location.id,
      name: location.name,
      address: location.address,
      logoUrl: location.logoUrl || location.logo_url || null,
    });
  } catch (error) {
    console.error("Error fetching public location:", error);
    res.status(500).json({ error: error.message || "Failed to fetch location" });
  }
});

// Get public kitchens for a location (by name slug)
app.get("/api/public/locations/:locationSlug/kitchens", async (req, res) => {
  try {
    const locationSlug = req.params.locationSlug;
    
    // Find location by name (slugified)
    const allLocations = await getAllLocations();
    const location = allLocations.find((loc) => {
      const slug = loc.name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return slug === locationSlug;
    });

    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    const kitchens = await getKitchensByLocation(location.id);
    
    // Filter only active kitchens and return public info
    const publicKitchens = kitchens
      .filter((kitchen) => kitchen.isActive !== false)
      .map((kitchen) => ({
        id: kitchen.id,
        name: kitchen.name,
        description: kitchen.description,
        locationId: kitchen.locationId || kitchen.location_id,
      }));

    res.json(publicKitchens);
  } catch (error) {
    console.error("Error fetching public kitchens:", error);
    res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
  }
});

// Get public location details with kitchens (for kitchen preview page - no auth required)
app.get("/api/public/locations/:locationId/details", async (req, res) => {
  try {
    const locationId = parseInt(req.params.locationId);
    
    if (isNaN(locationId)) {
      return res.status(400).json({ error: "Invalid location ID" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get location
    const locationResult = await pool.query(`
      SELECT id, name, address, 
             logo_url as "logoUrl",
             brand_image_url as "brandImageUrl"
      FROM locations 
      WHERE id = $1
    `, [locationId]);
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }

    const location = locationResult.rows[0];

    // Get kitchens for this location with all details
    const kitchensResult = await pool.query(`
      SELECT k.id, k.name, k.description, 
             k.image_url as "imageUrl",
             k.gallery_images as "galleryImages",
             k.amenities,
             k.location_id as "locationId",
             l.name as "locationName",
             l.address as "locationAddress",
             l.brand_image_url as "locationBrandImageUrl",
             l.logo_url as "locationLogoUrl"
      FROM kitchens k
      JOIN locations l ON k.location_id = l.id
      WHERE k.location_id = $1 AND k.is_active != false
      ORDER BY k.name
    `, [locationId]);

    const locationKitchens = kitchensResult.rows.map((kitchen) => ({
      id: kitchen.id,
      name: kitchen.name,
      description: kitchen.description,
      imageUrl: kitchen.imageUrl || null,
      galleryImages: (kitchen.galleryImages && Array.isArray(kitchen.galleryImages)) ? kitchen.galleryImages : [],
      amenities: (kitchen.amenities && Array.isArray(kitchen.amenities)) ? kitchen.amenities : [],
      locationId: kitchen.locationId,
      locationName: kitchen.locationName || location.name,
      locationAddress: kitchen.locationAddress || location.address,
      locationBrandImageUrl: kitchen.locationBrandImageUrl || null,
      locationLogoUrl: kitchen.locationLogoUrl || null,
    }));

    console.log(`[API] /api/public/locations/${locationId}/details - Found location with ${locationKitchens.length} kitchens`);

    res.json({
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
        logoUrl: location.logoUrl || null,
        brandImageUrl: location.brandImageUrl || null,
      },
      kitchens: locationKitchens,
    });
  } catch (error) {
    console.error("Error fetching public location details:", error);
    res.status(500).json({ error: "Failed to fetch location details", details: error.message });
  }
});

// Get public kitchen listings for landing pages (all active kitchens for marketing)
app.get("/api/public/kitchens", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }
    
    // Get all kitchens with location info
    const result = await pool.query(`
      SELECT 
        k.id,
        k.name,
        k.description,
        k.location_id as "locationId",
        k.is_active as "isActive",
        l.name as "locationName",
        l.address as "locationAddress"
      FROM kitchens k
      LEFT JOIN locations l ON k.location_id = l.id
      WHERE k.is_active != false
      ORDER BY l.name, k.name
    `);
    
    const kitchens = result.rows;
    console.log(`[API] /api/public/kitchens - Found ${kitchens.length} total kitchens`);
    
    // Filter only active kitchens (handle both camelCase and snake_case)
    const activeKitchens = kitchens.filter((kitchen) => {
      const isActive = kitchen.isActive !== undefined ? kitchen.isActive : kitchen.is_active;
      return isActive !== false && isActive !== null;
    });
    
    console.log(`[API] /api/public/kitchens - ${activeKitchens.length} active kitchens after filtering`);
    
    // Return public-safe info with location data
    const publicKitchens = activeKitchens.map((kitchen) => {
      const locationId = kitchen.locationId || kitchen.location_id;
      const locationName = kitchen.locationName || kitchen.location_name;
      const locationAddress = kitchen.locationAddress || kitchen.location_address;
      
      // Log for debugging
      if (locationId && !locationName) {
        console.warn(`[API] Kitchen ${kitchen.id} has locationId ${locationId} but no locationName`);
      }
      
      return {
        id: kitchen.id,
        name: kitchen.name,
        description: kitchen.description,
        locationId: locationId || null,
        locationName: locationName || null,
        locationAddress: locationAddress || null,
      };
    });
    
    console.log(`[API] /api/public/kitchens - Returning ${publicKitchens.length} kitchens`);
    console.log(`[API] Sample kitchen data:`, publicKitchens[0] || "No kitchens");
    
    res.json(publicKitchens);
  } catch (error) {
    console.error("Error fetching public kitchens:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ error: "Failed to fetch kitchens", details: error.message });
  }
});

// Get available slots for a kitchen (public)
app.get("/api/public/kitchens/:kitchenId/availability", async (req, res) => {
  try {
    const kitchenId = parseInt(req.params.kitchenId);
    const date = req.query.date;

    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    const dateStr = dateObj.toISOString().split('T')[0];
    const dayOfWeek = dateObj.getDay(); // 0-6, Sunday is 0

    // Check for date-specific override first
    const dateOverrideResult = await pool.query(`
      SELECT is_available, start_time, end_time, reason
      FROM kitchen_date_overrides
      WHERE kitchen_id = $1
        AND DATE(specific_date) = $2
    `, [kitchenId, dateStr]);

    let startHour, endHour;

    if (dateOverrideResult.rows.length > 0) {
      const override = dateOverrideResult.rows[0];
      if (!override.is_available) {
        return res.json({ slots: [] });
      }
      if (!override.start_time || !override.end_time) {
        return res.json({ slots: [] });
      }
      startHour = parseInt(override.start_time.split(':')[0]);
      endHour = parseInt(override.end_time.split(':')[0]);
    } else {
      // No override, use weekly schedule
      const availabilityResult = await pool.query(`
        SELECT day_of_week, start_time, end_time, is_available
        FROM kitchen_availability
        WHERE kitchen_id = $1 AND day_of_week = $2
      `, [kitchenId, dayOfWeek]);

      if (availabilityResult.rows.length === 0) {
        return res.json({ slots: [] });
      }

      const dayAvailability = availabilityResult.rows[0];
      if (!dayAvailability.is_available || !dayAvailability.start_time || !dayAvailability.end_time) {
        return res.json({ slots: [] });
      }

      startHour = parseInt(dayAvailability.start_time.split(':')[0]);
      endHour = parseInt(dayAvailability.end_time.split(':')[0]);
    }

    if (isNaN(startHour) || isNaN(endHour) || startHour >= endHour) {
      return res.json({ slots: [] });
    }

    // Generate 30-minute interval slots
    const slots = [];
    for (let hour = startHour; hour < endHour; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }

    // Filter out booked slots
    const bookingsResult = await pool.query(`
      SELECT start_time, end_time
      FROM kitchen_bookings
      WHERE kitchen_id = $1
        AND DATE(booking_date) = $2
        AND status != 'cancelled'
    `, [kitchenId, dateStr]);

    const bookedSlots = new Set();
    bookingsResult.rows.forEach(booking => {
      if (!booking.start_time || !booking.end_time) return;
      
      const [startHours, startMins] = booking.start_time.split(':').map(Number);
      const [endHours, endMins] = booking.end_time.split(':').map(Number);
      
      if (isNaN(startHours) || isNaN(startMins) || isNaN(endHours) || isNaN(endMins)) return;
      
      const startTotalMins = startHours * 60 + startMins;
      const endTotalMins = endHours * 60 + endMins;
      
      slots.forEach(slot => {
        const [slotHours, slotMins] = slot.split(':').map(Number);
        const slotTotalMins = slotHours * 60 + slotMins;
        if (slotTotalMins >= startTotalMins && slotTotalMins < endTotalMins) {
          bookedSlots.add(slot);
        }
      });
    });

    const availableSlots = slots
      .filter(slot => !bookedSlots.has(slot))
      .map(time => ({ time, available: true }));
    
    res.json({ slots: availableSlots });
  } catch (error) {
    console.error("Error fetching public availability:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ error: error.message || "Failed to fetch availability" });
  }
});

// Submit public booking (third-party booking)
app.post("/api/public/bookings", async (req, res) => {
  try {
    const {
      locationId,
      kitchenId,
      bookingDate,
      startTime,
      endTime,
      bookingName,
      bookingEmail,
      bookingPhone,
      bookingCompany,
      specialNotes,
    } = req.body;

    if (!locationId || !kitchenId || !bookingDate || !startTime || !endTime || !bookingName || !bookingEmail) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Validate booking date format
    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ error: "Invalid booking date format" });
    }

    // Get location to get timezone and minimum booking window
    const locationResult = await pool.query(`
      SELECT id, name, address, timezone, minimum_booking_window_hours, notification_email
      FROM locations
      WHERE id = $1
    `, [locationId]);

    if (locationResult.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }

    const location = locationResult.rows[0];
    const timezone = location.timezone || DEFAULT_TIMEZONE;
    const minimumBookingWindowHours = location.minimum_booking_window_hours || 1;

    // Convert booking date to string format (YYYY-MM-DD)
    const bookingDateStr = bookingDate.split('T')[0];
    
    // Validate booking time using timezone-aware functions (lazy-loaded)
    if (await isBookingTimePast(bookingDateStr, startTime, timezone)) {
      return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
    }
    
    // Check if booking is within minimum booking window (timezone-aware)
    const hoursUntilBooking = await getHoursUntilBooking(bookingDateStr, startTime, timezone);
    if (hoursUntilBooking < minimumBookingWindowHours) {
      return res.status(400).json({ 
        error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance` 
      });
    }

    // Check availability
    const availabilityResult = await pool.query(`
      SELECT day_of_week, start_time, end_time, is_available
      FROM kitchen_availability
      WHERE kitchen_id = $1
    `, [kitchenId]);

    const dayOfWeek = bookingDateObj.getDay();
    const dayAvailability = availabilityResult.rows.find(a => a.day_of_week === dayOfWeek);

    if (!dayAvailability || !dayAvailability.is_available) {
      return res.status(400).json({ error: "Kitchen is not available on this day" });
    }

    if (startTime < dayAvailability.start_time || endTime > dayAvailability.end_time) {
      return res.status(400).json({ error: "Booking time must be within manager-set available hours" });
    }

    // Check for conflicts
    const conflictCheck = await pool.query(`
      SELECT id
      FROM kitchen_bookings
      WHERE kitchen_id = $1
        AND DATE(booking_date) = $2
        AND status != 'cancelled'
        AND (
          (start_time < $3 AND end_time > $4) OR
          (start_time >= $4 AND start_time < $3)
        )
    `, [kitchenId, bookingDate, endTime, startTime]);

    if (conflictCheck.rows.length > 0) {
      return res.status(400).json({ error: "Time slot is already booked" });
    }

    // Calculate pricing
    const [sH, sM] = String(startTime).split(':').map(Number);
    const [eH, eM] = String(endTime).split(':').map(Number);
    const startTotalMinutes = sH * 60 + sM;
    const endTotalMinutes = eH * 60 + eM;
    const durationMinutes = endTotalMinutes - startTotalMinutes;
    const durationHours = Math.max(0, durationMinutes / 60);
    
    // Get kitchen pricing
    const kitchenPricingResult = await pool.query(`
      SELECT 
        hourly_rate::text as hourly_rate,
        currency,
        minimum_booking_hours
      FROM kitchens
      WHERE id = $1
    `, [kitchenId]);
    
    let totalPriceCents = 0;
    let hourlyRateCents = 0;
    let effectiveDuration = durationHours;
    let currency = 'CAD';
    
    if (kitchenPricingResult.rows.length > 0) {
      const pricing = kitchenPricingResult.rows[0];
      hourlyRateCents = pricing.hourly_rate ? parseFloat(pricing.hourly_rate) : 0;
      currency = pricing.currency || 'CAD';
      const minimumHours = pricing.minimum_booking_hours || 1;
      effectiveDuration = Math.max(durationHours, minimumHours);
      
      if (hourlyRateCents > 0) {
        totalPriceCents = Math.round(hourlyRateCents * effectiveDuration);
      }
    }
    
    // Calculate service fee (5% commission)
    const serviceFeeCents = Math.round(totalPriceCents * 0.05);
    const totalWithFeesCents = totalPriceCents + serviceFeeCents;

    // Create booking
    const bookingNotes = specialNotes || `Third-party booking from ${bookingName}${bookingCompany ? ` (${bookingCompany})` : ''}. Email: ${bookingEmail}${bookingPhone ? `, Phone: ${bookingPhone}` : ''}`;

    const insertResult = await pool.query(`
      INSERT INTO kitchen_bookings (
        kitchen_id, booking_date, start_time, end_time,
        special_notes, booking_type, status,
        external_contact_name, external_contact_email, external_contact_phone, external_contact_company,
        total_price, hourly_rate, duration_hours, service_fee, currency, payment_status,
        storage_items, equipment_items
      )
      VALUES ($1, $2, $3, $4, $5, 'external', 'pending', $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', '[]'::jsonb, '[]'::jsonb)
      RETURNING *
    `, [
      kitchenId,
      bookingDateObj,
      startTime,
      endTime,
      bookingNotes,
      bookingName,
      bookingEmail,
      bookingPhone || null,
      bookingCompany || null,
      totalWithFeesCents.toString(),
      hourlyRateCents.toString(),
      effectiveDuration.toString(),
      serviceFeeCents.toString(),
      currency
    ]);

    const booking = insertResult.rows[0];

    // Get kitchen name for email
    const kitchenResult = await pool.query(`
      SELECT name FROM kitchens WHERE id = $1
    `, [kitchenId]);
    const kitchenName = kitchenResult.rows[0]?.name || 'Kitchen';

    // Send notification to manager
    try {
      const { sendEmail } = await import('../server/email.js');
      if (location.notification_email) {
        const emailContent = {
          to: location.notification_email,
          subject: `New Third-Party Booking Request - ${location.name}`,
          text: `A new booking request has been submitted:\n\n` +
                `Kitchen: ${kitchenName}\n` +
                `Date: ${bookingDate}\n` +
                `Time: ${startTime} - ${endTime}\n\n` +
                `Contact Information:\n` +
                `Name: ${bookingName}\n` +
                `Email: ${bookingEmail}\n` +
                `${bookingPhone ? `Phone: ${bookingPhone}\n` : ''}` +
                `${bookingCompany ? `Company: ${bookingCompany}\n` : ''}` +
                `${specialNotes ? `\nNotes: ${specialNotes}` : ''}\n\n` +
                `Please log in to your manager dashboard to confirm or manage this booking.`,
          html: `<h2>New Third-Party Booking Request</h2>` +
                `<p><strong>Location:</strong> ${location.name}</p>` +
                `<p><strong>Kitchen:</strong> ${kitchenName}</p>` +
                `<p><strong>Date:</strong> ${bookingDate}</p>` +
                `<p><strong>Time:</strong> ${startTime} - ${endTime}</p>` +
                `<h3>Contact Information:</h3>` +
                `<ul>` +
                `<li><strong>Name:</strong> ${bookingName}</li>` +
                `<li><strong>Email:</strong> ${bookingEmail}</li>` +
                `${bookingPhone ? `<li><strong>Phone:</strong> ${bookingPhone}</li>` : ''}` +
                `${bookingCompany ? `<li><strong>Company:</strong> ${bookingCompany}</li>` : ''}` +
                `</ul>` +
                `${specialNotes ? `<p><strong>Notes:</strong> ${specialNotes}</p>` : ''}` +
                `<p>Please log in to your manager dashboard to confirm or manage this booking.</p>`,
        };
        await sendEmail(emailContent);
      }
    } catch (emailError) {
      console.error("Error sending booking notification email:", emailError);
      // Don't fail the booking if email fails
    }

    res.status(201).json({
      success: true,
      booking: {
        id: booking.id,
        bookingDate,
        startTime,
        endTime,
        status: 'pending',
      },
      message: "Booking request submitted successfully. The kitchen manager will contact you shortly.",
    });
  } catch (error) {
    console.error("Error creating public booking:", error);
    res.status(500).json({ error: error.message || "Failed to create booking" });
  }
});

// ===============================
// PORTAL USER LOGIN ROUTE
app.post("/api/portal-login", async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    const portalUser = userResult.rows[0];
    const isPortalUser = portalUser.is_portal_user || portalUser.isPortalUser;
    
    if (!isPortalUser) {
      return res.status(403).json({ error: 'Not authorized - portal user access required' });
    }

    if (!portalUser.password) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    let passwordMatches = false;
    try {
      passwordMatches = await comparePasswords(password, portalUser.password);
    } catch (error) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    if (req.session) {
      req.session.userId = portalUser.id;
      req.session.user = { ...portalUser, password: undefined };
      try {
        await new Promise((resolve, reject) => {
          req.session.save((err) => err ? reject(err) : resolve());
        });
      } catch (sessionError) {
        // Session save failed, but continue with login
      }
    }

    let locationId = null;
    try {
      const locationResult = await pool.query(
        'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
        [portalUser.id]
      );
      if (locationResult.rows.length > 0) {
        locationId = locationResult.rows[0].location_id;
      }
    } catch (error) {
      // Ignore location fetch errors
    }

    res.json({
      id: portalUser.id,
      username: portalUser.username,
      role: portalUser.role,
      isPortalUser: true,
      locationId: locationId,
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Portal login failed" });
    }
  }
});

// PORTAL USER REGISTRATION ROUTE
// ===============================

// Portal user registration endpoint - creates application instead of direct access
app.post("/api/portal-register", async (req, res) => {
  console.log("[Routes] /api/portal-register called");
  try {
    const { username, password, locationId, fullName, email, phone, company } = req.body;

    if (!username || !password || !locationId || !fullName || !email || !phone) {
      return res.status(400).json({ error: 'Username, password, locationId, fullName, email, and phone are required' });
    }

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not available' });
    }

    // Validate location exists (include notification_email)
    const locationResult = await pool.query(
      `SELECT id, name, address, manager_id, notification_email 
       FROM locations WHERE id = $1`, 
      [parseInt(locationId)]
    );
    if (locationResult.rows.length === 0) {
      return res.status(400).json({ error: "Location not found" });
    }
    const location = locationResult.rows[0];

    // Check if user already exists
    let user = await getUserByUsername(username);
    let isNewUser = false;
    
    if (!user) {
      // Hash password and create user
      const hashedPassword = await hashPassword(password);

      // Create user with is_portal_user flag
      const createUserResult = await pool.query(
        `INSERT INTO users (username, password, role, is_chef, is_delivery_partner, is_manager, is_portal_user) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [username, hashedPassword, 'chef', false, false, false, true]
      );
      user = createUserResult.rows[0];
      isNewUser = true;
    } else {
      // Check if user is already a portal user
      const isPortalUser = user.is_portal_user || user.isPortalUser;
      if (!isPortalUser) {
        return res.status(400).json({ error: "Username already exists with different account type" });
      }
    }

    // Check if user already has an application for this location
    let existingApplications = [];
    try {
      const existingResult = await pool.query(
        `SELECT * FROM portal_user_applications 
         WHERE user_id = $1 AND location_id = $2`,
        [user.id, parseInt(locationId)]
      );
      existingApplications = existingResult.rows;
    } catch (dbError) {
      console.error("Error checking existing applications:", dbError);
      // If table doesn't exist, provide helpful error message
      if (dbError.message && dbError.message.includes('does not exist')) {
        return res.status(500).json({ 
          error: "Database migration required. Please run the migration to create portal_user_applications table.",
          details: "Run: migrations/0005_add_portal_user_tables.sql"
        });
      }
      throw dbError;
    }
    
    if (existingApplications.length > 0) {
      const existingApp = existingApplications[0];
      if (existingApp.status === 'inReview' || existingApp.status === 'approved') {
        return res.status(400).json({ 
          error: "You already have an application for this location",
          applicationId: existingApp.id,
          status: existingApp.status
        });
      }
    }

    // Create application
    let application;
    try {
      const applicationResult = await pool.query(
        `INSERT INTO portal_user_applications (user_id, location_id, full_name, email, phone, company, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [user.id, parseInt(locationId), fullName, email, phone, company || null, 'inReview']
      );
      application = applicationResult.rows[0];
    } catch (dbError) {
      console.error("Error creating application:", dbError);
      // If table doesn't exist, provide helpful error message
      if (dbError.message && dbError.message.includes('does not exist')) {
        return res.status(500).json({ 
          error: "Database migration required. Please run the migration to create portal_user_applications table.",
          details: "Run: migrations/0005_add_portal_user_tables.sql"
        });
      }
      throw dbError;
    }

    // Log the user in immediately after registration (for both new and existing users)
    req.session.userId = user.id;
    req.session.user = { ...user, password: undefined };
    
    // Wait for session to be saved before continuing
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Send notification to manager
    try {
      // First, try to get notification_email from location (preferred)
      let managerEmail = location.notification_email || location.notificationEmail;
      
      // If no notification_email, get manager's email from manager_id
      if (!managerEmail) {
        const managerId = location.manager_id || location.managerId;
        if (managerId) {
          const managerResult = await pool.query('SELECT * FROM users WHERE id = $1', [managerId]);
          if (managerResult.rows.length > 0) {
            const manager = managerResult.rows[0];
            managerEmail = manager.username;
          }
        }
      }
      
      // Send email if we have a manager email
      if (managerEmail) {
        try {
          const { sendEmail } = await import('../server/email.js');
          const emailContent = {
            to: managerEmail,
            subject: `New Portal User Application - ${location.name}`,
            text: `A new portal user has applied for access to your location:\n\n` +
                  `Location: ${location.name}\n` +
                  `Applicant Name: ${fullName}\n` +
                  `Email: ${email}\n` +
                  `Phone: ${phone}\n` +
                  `${company ? `Company: ${company}\n` : ''}` +
                  `\nPlease log in to your manager dashboard to review and approve this application.`,
            html: `<h2>New Portal User Application</h2>` +
                  `<p><strong>Location:</strong> ${location.name}</p>` +
                  `<p><strong>Applicant Name:</strong> ${fullName}</p>` +
                  `<p><strong>Email:</strong> ${email}</p>` +
                  `<p><strong>Phone:</strong> ${phone}</p>` +
                  `${company ? `<p><strong>Company:</strong> ${company}</p>` : ''}` +
                  `<p>Please log in to your manager dashboard to review and approve this application.</p>`,
          };
          await sendEmail(emailContent);
          console.log(`✅ Portal user application notification sent to manager: ${managerEmail}`);
        } catch (emailImportError) {
          console.error("Error importing email module:", emailImportError);
          // Don't fail registration if email fails
        }
      } else {
        console.log("⚠️ No manager email found for location - skipping email notification");
      }
    } catch (emailError) {
      console.error("Error sending application notification email:", emailError);
      // Don't fail registration if email fails
    }

      return res.status(201).json({
        id: user.id,
        username: user.username,
        role: user.role,
        isPortalUser: true,
        application: {
          id: application.id,
          status: application.status,
          message: "Your application has been submitted. You are now logged in. The location manager will review it shortly."
        }
      });
  } catch (error) {
    console.error("Portal registration error:", error);
    res.status(500).json({ error: error.message || "Portal registration failed" });
  }
});

// Get portal user application status (for authenticated portal users without approved access)
app.get("/api/portal/application-status", async (req, res) => {
  try {
    const sessionUserId = req.session?.userId;
    
    if (!sessionUserId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not available' });
    }

    // Get user from session
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }
    
    const user = userResult.rows[0];
    const isPortalUser = user.is_portal_user || user.isPortalUser;
    
    if (!isPortalUser) {
      return res.status(403).json({ error: "Portal user access required" });
    }

    // Check for approved access first
    const accessResult = await pool.query(
      'SELECT * FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [user.id]
    );
    
    if (accessResult.rows.length > 0) {
      return res.json({ 
        hasAccess: true,
        status: 'approved'
      });
    }

    // Check application status
    const applicationResult = await pool.query(
      `SELECT * FROM portal_user_applications 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [user.id]
    );
    
    if (applicationResult.rows.length > 0) {
      const app = applicationResult.rows[0];
      return res.json({
        hasAccess: false,
        status: app.status,
        applicationId: app.id,
        locationId: app.location_id,
        awaitingApproval: app.status === 'inReview'
      });
    }

    return res.json({
      hasAccess: false,
      status: 'no_application',
      awaitingApproval: false
    });
  } catch (error) {
    console.error("Error getting portal application status:", error);
    
    // If table doesn't exist, return awaiting approval status
    if (error.message && error.message.includes('does not exist')) {
      return res.json({
        hasAccess: false,
        status: 'no_application',
        awaitingApproval: false
      });
    }
    
    res.status(500).json({ error: error.message || "Failed to get application status" });
  }
});

// Helper function to check portal user authentication and approved access
async function requirePortalUser(req, res, next) {
  try {
    const sessionUserId = req.session?.userId;
    
    if (!sessionUserId) {
      return res.status(401).json({ error: "Authentication required. Please sign in." });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get user from session
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [sessionUserId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }
    
    const user = userResult.rows[0];
    const isPortalUser = user.is_portal_user || user.isPortalUser;
    
    if (!isPortalUser) {
      return res.status(403).json({ error: "Portal user access required" });
    }

    // Verify user has approved location access
    const accessResult = await pool.query(
      'SELECT * FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [user.id]
    );
    
    if (accessResult.rows.length === 0) {
      // Check if user has a pending application
      const applicationResult = await pool.query(
        'SELECT * FROM portal_user_applications WHERE user_id = $1 LIMIT 1',
        [user.id]
      );
      
      if (applicationResult.rows.length > 0) {
        const app = applicationResult.rows[0];
        return res.status(403).json({ 
          error: "Access denied. Your application is pending approval by the location manager.",
          applicationStatus: app.status,
          awaitingApproval: true
        });
      }
      
      return res.status(403).json({ 
        error: "Access denied. Your application is pending approval by the location manager.",
        awaitingApproval: true
      });
    }
    
    // Attach user to request
    req.user = user;
    console.log(`✅ Portal user authenticated: ${user.username} (ID: ${user.id})`);
    return next();
  } catch (error) {
    console.error('Error in requirePortalUser middleware:', error);
    return res.status(401).json({ error: "Authentication failed" });
  }
}

// Get portal user's assigned location
app.get("/api/portal/locations", requirePortalUser, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get user's location access
    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const locationId = accessResult.rows[0].location_id;
    
    // Get location details
    const locationResult = await pool.query(
      'SELECT id, name, address, logo_url FROM locations WHERE id = $1 LIMIT 1',
      [locationId]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }
    
    const location = locationResult.rows[0];
    const slug = location.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    res.json([{
      id: location.id,
      name: location.name,
      address: location.address,
      logoUrl: location.logo_url || null,
      slug: slug,
    }]);
  } catch (error) {
    console.error("Error fetching portal user location:", error);
    res.status(500).json({ error: error.message || "Failed to fetch location" });
  }
});

// Get portal user's location info (by name slug)
app.get("/api/portal/locations/:locationSlug", requirePortalUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const locationSlug = req.params.locationSlug;

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get user's assigned location
    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const userLocationId = accessResult.rows[0].location_id;
    
    // Get location details
    const locationResult = await pool.query(
      'SELECT id, name, address, logo_url FROM locations WHERE id = $1 LIMIT 1',
      [userLocationId]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }

    const location = locationResult.rows[0];
    const slug = location.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    // Verify the slug matches the user's location
    if (slug !== locationSlug) {
      return res.status(403).json({ error: "Access denied. You can only access your assigned location." });
    }

    // Return location info
    res.json({
      id: location.id,
      name: location.name,
      address: location.address,
      logoUrl: location.logo_url || null,
    });
  } catch (error) {
    console.error("Error fetching portal location:", error);
    res.status(500).json({ error: error.message || "Failed to fetch location" });
  }
});

// Get kitchens for portal user's location (by name slug)
app.get("/api/portal/locations/:locationSlug/kitchens", requirePortalUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const locationSlug = req.params.locationSlug;

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get user's assigned location
    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const userLocationId = accessResult.rows[0].location_id;
    
    // Get location details
    const locationResult = await pool.query(
      'SELECT id, name FROM locations WHERE id = $1 LIMIT 1',
      [userLocationId]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }
    
    const location = locationResult.rows[0];
    const slug = location.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Verify the slug matches the user's location
    if (slug !== locationSlug) {
      return res.status(403).json({ error: "Access denied. You can only access kitchens at your assigned location." });
    }

    // Get kitchens for this location
    const kitchensResult = await pool.query(
      'SELECT id, name, description, location_id FROM kitchens WHERE location_id = $1 AND is_active != false',
      [userLocationId]
    );

    const publicKitchens = kitchensResult.rows.map((kitchen) => ({
      id: kitchen.id,
      name: kitchen.name,
      description: kitchen.description,
      locationId: kitchen.location_id,
    }));

    res.json(publicKitchens);
  } catch (error) {
    console.error("Error fetching portal kitchens:", error);
    res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
  }
});

// Get ALL time slots with booking info (capacity aware) - portal version matching chef endpoint
app.get("/api/portal/kitchens/:kitchenId/slots", requirePortalUser, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const userId = req.user.id;
    const kitchenId = parseInt(req.params.kitchenId);
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }
    
    const bookingDate = new Date(date);
    if (isNaN(bookingDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    
    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get user's assigned location and verify kitchen access
    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const userLocationId = accessResult.rows[0].location_id;
    
    const kitchenResult = await pool.query(
      'SELECT id, location_id FROM kitchens WHERE id = $1 LIMIT 1',
      [kitchenId]
    );
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }
    
    if (kitchenResult.rows[0].location_id !== userLocationId) {
      return res.status(403).json({ error: "Access denied. You can only view slots for kitchens at your assigned location." });
    }

    let startHour;
    let endHour;

    // 1) Fetch ALL overrides for this date (both available and blocked)
    let overridesResult;
    try {
      overridesResult = await pool.query(`
        SELECT start_time, end_time, is_available
        FROM kitchen_date_overrides
        WHERE kitchen_id = $1
          AND DATE(specific_date) = $2::date
        ORDER BY created_at ASC
      `, [kitchenId, bookingDate.toISOString()]);
    } catch (_e) {
      overridesResult = { rows: [] };
    }

    if (overridesResult.rows.length > 0) {
      // Find the base available override
      const baseOverride = overridesResult.rows.find(o => o.is_available === true);
      if (!baseOverride || !baseOverride.start_time || !baseOverride.end_time) {
        // No valid base availability
        return res.json([]);
      }

      [startHour] = baseOverride.start_time.split(":").map(Number);
      [endHour] = baseOverride.end_time.split(":").map(Number);

      // Collect blocked ranges
      const blockedRanges = overridesResult.rows
        .filter(o => o.is_available === false && o.start_time && o.end_time)
        .map(o => {
          const [sh] = o.start_time.split(":").map(Number);
          const [eh] = o.end_time.split(":").map(Number);
          return { startHour: sh, endHour: eh };
        });

      // Generate all 1-hour slots in the base range, excluding blocked ranges
      const allSlots = [];
      for (let hour = startHour; hour < endHour; hour++) {
        // Check if this hour overlaps any blocked range
        const isBlocked = blockedRanges.some(range => {
          return hour >= range.startHour && hour < range.endHour;
        });
        if (!isBlocked) {
          allSlots.push(`${hour.toString().padStart(2, '0')}:00`);
        }
      }

      // Fetch only confirmed bookings to block capacity
      const bookingsResult = await pool.query(`
        SELECT start_time, end_time 
        FROM kitchen_bookings
        WHERE kitchen_id = $1 
          AND DATE(booking_date) = $2::date
          AND status = 'confirmed'
      `, [kitchenId, bookingDate.toISOString()]);

      const capacity = 1;
      const slotBookingCounts = new Map();
      allSlots.forEach(s => slotBookingCounts.set(s, 0));

      for (const booking of bookingsResult.rows) {
        const [startH, startM] = booking.start_time.split(':').map(Number);
        const [endH, endM] = booking.end_time.split(':').map(Number);
        const startTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;

        for (const slot of allSlots) {
          const [slotH] = slot.split(':').map(Number);
          const slotStart = slotH * 60;
          const slotEnd = slotStart + 60;
          if (slotStart < endTotal && slotEnd > startTotal) {
            slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
          }
        }
      }

      const result = allSlots.map(time => {
        const booked = slotBookingCounts.get(time) || 0;
        return {
          time,
          available: Math.max(0, capacity - booked),
          capacity,
          isFullyBooked: booked >= capacity,
        };
      });

      return res.json(result);
    } else {
      // 2) No overrides, fall back to weekly availability
      const dayOfWeek = bookingDate.getDay();
      let availabilityResult;
      try {
        availabilityResult = await pool.query(`
          SELECT start_time, end_time, is_available
          FROM kitchen_availability 
          WHERE kitchen_id = $1 AND day_of_week = $2
        `, [kitchenId, dayOfWeek]);
      } catch (_e) {
        availabilityResult = { rows: [] };
      }

      if (availabilityResult.rows.length === 0 || availabilityResult.rows[0].is_available === false) {
        return res.json([]);
      }

      const availability = availabilityResult.rows[0];
      [startHour] = availability.start_time.split(":").map(Number);
      [endHour] = availability.end_time.split(":").map(Number);

      // Generate 1-hour slots
      const allSlots = [];
      for (let hour = startHour; hour < endHour; hour++) {
        allSlots.push(`${hour.toString().padStart(2, '0')}:00`);
      }

      // Fetch confirmed bookings
      const bookingsResult = await pool.query(`
        SELECT start_time, end_time 
        FROM kitchen_bookings
        WHERE kitchen_id = $1 
          AND DATE(booking_date) = $2::date
          AND status = 'confirmed'
      `, [kitchenId, bookingDate.toISOString()]);

      const capacity = 1;
      const slotBookingCounts = new Map();
      allSlots.forEach(s => slotBookingCounts.set(s, 0));

      for (const booking of bookingsResult.rows) {
        const [startH, startM] = booking.start_time.split(':').map(Number);
        const [endH, endM] = booking.end_time.split(':').map(Number);
        const startTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;

        for (const slot of allSlots) {
          const [slotH] = slot.split(':').map(Number);
          const slotStart = slotH * 60;
          const slotEnd = slotStart + 60;
          if (slotStart < endTotal && slotEnd > startTotal) {
            slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1);
          }
        }
      }

      const result = allSlots.map(time => {
        const booked = slotBookingCounts.get(time) || 0;
        return {
          time,
          available: Math.max(0, capacity - booked),
          capacity,
          isFullyBooked: booked >= capacity,
        };
      });

      return res.json(result);
    }
  } catch (error) {
    console.error("Error fetching portal time slots:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch time slots", message: error.message });
    }
  }
});

// Per-kitchen policy: max slots per portal user per day
app.get("/api/portal/kitchens/:kitchenId/policy", requirePortalUser, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const userId = req.user.id;
    const kitchenId = parseInt(req.params.kitchenId);
    const { date } = req.query;
    const bookingDate = date ? new Date(String(date)) : new Date();

    // Verify kitchen access
    if (!pool) return res.json({ maxSlotsPerChef: 2 });

    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const userLocationId = accessResult.rows[0].location_id;
    
    const kitchenResult = await pool.query(
      'SELECT id, location_id FROM kitchens WHERE id = $1 LIMIT 1',
      [kitchenId]
    );
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }
    
    if (kitchenResult.rows[0].location_id !== userLocationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Priority order: 1) Date override, 2) Weekly schedule, 3) Location default, 4) Hardcoded 2
    let maxSlotsPerChef = 2;
    try {
      // 1. Try date-specific override first
      const over = await pool.query(`
        SELECT max_slots_per_chef
        FROM kitchen_date_overrides
        WHERE kitchen_id = $1 AND DATE(specific_date) = $2::date
        ORDER BY updated_at DESC
        LIMIT 1
      `, [kitchenId, bookingDate.toISOString()]);
      if (over.rows.length > 0) {
        const val = Number(over.rows[0].max_slots_per_chef);
        if (Number.isFinite(val) && val > 0) maxSlotsPerChef = val;
      } else {
        // 2. Try weekly schedule for this day of week
        const avail = await pool.query(`
          SELECT max_slots_per_chef
          FROM kitchen_availability
          WHERE kitchen_id = $1 AND day_of_week = $2
        `, [kitchenId, bookingDate.getDay()]);
        if (avail.rows.length > 0) {
          const v = Number(avail.rows[0].max_slots_per_chef);
          if (Number.isFinite(v) && v > 0) maxSlotsPerChef = v;
        } else {
          // 3. Fall back to location default
          const loc = await pool.query(`
            SELECT l.default_daily_booking_limit
            FROM locations l
            INNER JOIN kitchens k ON k.location_id = l.id
            WHERE k.id = $1
          `, [kitchenId]);
          if (loc.rows.length > 0) {
            const locVal = Number(loc.rows[0].default_daily_booking_limit);
            if (Number.isFinite(locVal) && locVal > 0) maxSlotsPerChef = locVal;
          }
        }
      }
    } catch (_e) {
      // Columns might not exist yet; fallback
      maxSlotsPerChef = 2;
    }

    res.json({ maxSlotsPerChef });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch policy" });
    }
  }
});

// Get available slots for a kitchen - requires auth and verifies kitchen belongs to user's location
app.get("/api/portal/kitchens/:kitchenId/availability", requirePortalUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const kitchenId = parseInt(req.params.kitchenId);
    const date = req.query.date;

    if (isNaN(kitchenId) || kitchenId <= 0) {
      return res.status(400).json({ error: "Invalid kitchen ID" });
    }

    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get user's assigned location
    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const userLocationId = accessResult.rows[0].location_id;
    
    // Verify kitchen belongs to user's location
    const kitchenResult = await pool.query(
      'SELECT id, location_id FROM kitchens WHERE id = $1 LIMIT 1',
      [kitchenId]
    );
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }
    
    const kitchen = kitchenResult.rows[0];
    
    if (kitchen.location_id !== userLocationId) {
      return res.status(403).json({ error: "Access denied. You can only view availability for kitchens at your assigned location." });
    }

    // Get availability for this date (similar to existing availability endpoint)
    // Parse date string directly (YYYY-MM-DD) to avoid timezone issues
    const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
    }
    
    const [, year, month, day] = dateMatch;
    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }

    const dateStr = `${year}-${month}-${day}`;
    const dayOfWeek = dateObj.getDay(); // 0-6, Sunday is 0
    
    console.log(`[Portal Availability] Parsed date: ${dateStr}, day of week: ${dayOfWeek} (0=Sunday, 1=Monday, etc.)`);

    // Check for date-specific override first (same logic as public endpoint)
    let startHour, endHour;
    
    try {
      console.log(`[Portal Availability] Checking for date override for kitchen ${kitchenId}, date ${dateStr}`);
      
      const dateOverrideResult = await pool.query(`
        SELECT is_available, start_time, end_time, reason
        FROM kitchen_date_overrides
        WHERE kitchen_id = $1
          AND DATE(specific_date) = $2
      `, [kitchenId, dateStr]);

      console.log(`[Portal Availability] Found ${dateOverrideResult.rows.length} date override(s) for kitchen ${kitchenId}, date ${dateStr}`);

      if (dateOverrideResult.rows.length > 0) {
        const override = dateOverrideResult.rows[0];
        console.log(`[Portal Availability] Date override found:`, {
          is_available: override.is_available,
          start_time: override.start_time,
          end_time: override.end_time,
          reason: override.reason
        });
        
        if (!override.is_available) {
          console.log(`[Portal Availability] Kitchen is closed on this date (override)`);
          return res.json({ slots: [] });
        }
        if (!override.start_time || !override.end_time) {
          console.log(`[Portal Availability] Override has no start/end time`);
          return res.json({ slots: [] });
        }
        startHour = parseInt(override.start_time.split(':')[0]);
        endHour = parseInt(override.end_time.split(':')[0]);
        console.log(`[Portal Availability] Using override hours: startHour=${startHour}, endHour=${endHour}`);
      } else {
        // No override, use weekly schedule (same as public endpoint)
        console.log(`[Portal Availability] No date override found, checking weekly schedule for day ${dayOfWeek}`);
        
        const availabilityResult = await pool.query(`
          SELECT day_of_week, start_time, end_time, is_available
          FROM kitchen_availability
          WHERE kitchen_id = $1 AND day_of_week = $2
        `, [kitchenId, dayOfWeek]);

        if (availabilityResult.rows.length === 0) {
          console.log(`[Portal Availability] No weekly schedule found for day ${dayOfWeek}`);
          return res.json({ slots: [] });
        }

        const dayAvailability = availabilityResult.rows[0];
        if (!dayAvailability.is_available || !dayAvailability.start_time || !dayAvailability.end_time) {
          console.log(`[Portal Availability] Kitchen not available on day ${dayOfWeek} (weekly schedule)`);
          return res.json({ slots: [] });
        }

        startHour = parseInt(dayAvailability.start_time.split(':')[0]);
        endHour = parseInt(dayAvailability.end_time.split(':')[0]);
        console.log(`[Portal Availability] Using weekly schedule hours: startHour=${startHour}, endHour=${endHour}`);
      }
      
      // Validate hours
      if (isNaN(startHour) || isNaN(endHour) || startHour >= endHour) {
        console.error(`Invalid hours for kitchen ${kitchenId}: startHour=${startHour}, endHour=${endHour}`);
        return res.json({ slots: [] });
      }
    } catch (queryError) {
      console.error("Error querying kitchen availability:", queryError);
      console.error("Query error stack:", queryError.stack);
      console.error("Kitchen ID:", kitchenId, "Date:", dateStr, "Day of week:", dayOfWeek);
      // If tables don't exist or query fails, return empty slots
      return res.json({ slots: [] });
    }

    // Generate 30-minute interval slots (matching public endpoint format)
    const slots = [];
    for (let hour = startHour; hour < endHour; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }

    // Filter out booked slots
    let bookingsResult;
    try {
      bookingsResult = await pool.query(`
        SELECT start_time, end_time
        FROM kitchen_bookings
        WHERE kitchen_id = $1
          AND DATE(booking_date) = $2
          AND status != 'cancelled'
      `, [kitchenId, dateStr]);
    } catch (bookingsError) {
      // If kitchen_bookings table doesn't exist, try bookings table
      console.error("Error fetching bookings from kitchen_bookings:", bookingsError);
      try {
        bookingsResult = await pool.query(`
          SELECT start_time, end_time
          FROM bookings
          WHERE kitchen_id = $1
            AND DATE(booking_date) = $2
            AND status != 'cancelled'
        `, [kitchenId, dateStr]);
        console.log("Successfully fetched from bookings table");
      } catch (error) {
        console.error("Error fetching bookings from bookings table:", error);
        bookingsResult = { rows: [] };
      }
    }

    const bookedSlots = new Set();
    if (bookingsResult && bookingsResult.rows) {
      bookingsResult.rows.forEach(booking => {
        if (!booking.start_time || !booking.end_time) return;
        
        const [startHours, startMins] = booking.start_time.split(':').map(Number);
        const [endHours, endMins] = booking.end_time.split(':').map(Number);
        
        if (isNaN(startHours) || isNaN(startMins) || isNaN(endHours) || isNaN(endMins)) return;
        
        const startTotalMins = startHours * 60 + startMins;
        const endTotalMins = endHours * 60 + endMins;
        
        slots.forEach(slot => {
          const [slotHours, slotMins] = slot.split(':').map(Number);
          const slotTotalMins = slotHours * 60 + slotMins;
          if (slotTotalMins >= startTotalMins && slotTotalMins < endTotalMins) {
            bookedSlots.add(slot);
          }
        });
      });
    }

    const availableSlots = slots
      .filter(slot => !bookedSlots.has(slot))
      .map(time => ({ 
        time, 
        available: true 
      }));
    
    res.json({ slots: availableSlots });
  } catch (error) {
    console.error("Error fetching portal kitchen availability:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ error: error.message || "Failed to fetch availability" });
  }
});

// Create booking for portal user
app.post("/api/portal/bookings", requirePortalUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      kitchenId,
      bookingDate,
      startTime,
      endTime,
      specialNotes,
    } = req.body;

    if (!kitchenId || !bookingDate || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!pool) {
      return res.status(500).json({ error: "Database not available" });
    }

    // Get user's assigned location
    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const userLocationId = accessResult.rows[0].location_id;
    
    // Verify kitchen belongs to user's location
    const kitchenResult = await pool.query(
      'SELECT id, location_id, name FROM kitchens WHERE id = $1 LIMIT 1',
      [kitchenId]
    );
    
    if (kitchenResult.rows.length === 0) {
      return res.status(404).json({ error: "Kitchen not found" });
    }
    
    const kitchen = kitchenResult.rows[0];
    
    if (kitchen.location_id !== userLocationId) {
      return res.status(403).json({ error: "Access denied. You can only book kitchens at your assigned location." });
    }

    // Validate booking date format
    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ error: "Invalid booking date format" });
    }

    // Get location to get timezone and minimum booking window
    const locationResult = await pool.query(
      'SELECT timezone, minimum_booking_window_hours FROM locations WHERE id = $1',
      [userLocationId]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }
    
    const location = locationResult.rows[0];
    const timezone = location.timezone || DEFAULT_TIMEZONE;
    const minimumBookingWindowHours = location.minimum_booking_window_hours || 1;

    // Convert booking date to string format (YYYY-MM-DD)
    const bookingDateStr = bookingDate.split('T')[0];
    
    // Validate booking time using timezone-aware functions (lazy-loaded)
    if (await isBookingTimePast(bookingDateStr, startTime, timezone)) {
      return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
    }
    
    // Check if booking is within minimum booking window (timezone-aware)
    const hoursUntilBooking = await getHoursUntilBooking(bookingDateStr, startTime, timezone);
    if (hoursUntilBooking < minimumBookingWindowHours) {
      return res.status(400).json({ 
        error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance` 
      });
    }

    // Determine slots requested (1-hour slots)
    const [sH, sM] = String(startTime).split(':').map(Number);
    const [eH, eM] = String(endTime).split(':').map(Number);
    const requestedSlots = Math.max(1, Math.ceil(((eH * 60 + eM) - (sH * 60 + sM)) / 60));
    
    // Store time components for later use in pricing calculation
    const startTotalMinutes = sH * 60 + sM;
    const endTotalMinutes = eH * 60 + eM;

    const dateStr = bookingDateObj.toISOString().split('T')[0];

    // Find maxSlotsPerChef for this kitchen/date (same logic as chef bookings)
    let maxSlotsPerChef = 2;
    try {
      // 1. Try date-specific override first
      const overrideResult = await pool.query(`
        SELECT max_slots_per_chef
        FROM kitchen_date_overrides
        WHERE kitchen_id = $1 AND DATE(specific_date) = $2::date
        ORDER BY updated_at DESC
        LIMIT 1
      `, [kitchenId, dateStr]);
      
      if (overrideResult.rows.length > 0) {
        const val = Number(overrideResult.rows[0].max_slots_per_chef);
        if (Number.isFinite(val) && val > 0) maxSlotsPerChef = val;
      } else {
        // 2. Try weekly schedule for this day of week
        const availabilityResult = await pool.query(`
          SELECT max_slots_per_chef
          FROM kitchen_availability
          WHERE kitchen_id = $1 AND day_of_week = $2
        `, [kitchenId, bookingDateObj.getDay()]);
        
        if (availabilityResult.rows.length > 0) {
          const v = Number(availabilityResult.rows[0].max_slots_per_chef);
          if (Number.isFinite(v) && v > 0) maxSlotsPerChef = v;
        } else {
          // 3. Fall back to location default
          const locationLimitResult = await pool.query(`
            SELECT l.default_daily_booking_limit
            FROM locations l
            INNER JOIN kitchens k ON k.location_id = l.id
            WHERE k.id = $1
          `, [kitchenId]);
          
          if (locationLimitResult.rows.length > 0) {
            const locVal = Number(locationLimitResult.rows[0].default_daily_booking_limit);
            if (Number.isFinite(locVal) && locVal > 0) maxSlotsPerChef = locVal;
          }
        }
      }
    } catch (error) {
      // Columns might not exist yet; use default
      maxSlotsPerChef = 2;
    }

    // Check existing bookings for this portal user on this date
    const existingBookingsResult = await pool.query(`
      SELECT start_time, end_time
      FROM kitchen_bookings
      WHERE chef_id = $1
        AND DATE(booking_date) = $2
        AND status IN ('pending','confirmed')
    `, [userId, dateStr]);

    let existingSlots = 0;
    existingBookingsResult.rows.forEach(booking => {
      const [bSH, bSM] = String(booking.start_time).split(':').map(Number);
      const [bEH, bEM] = String(booking.end_time).split(':').map(Number);
      const slots = Math.max(1, Math.ceil(((bEH * 60 + bEM) - (bSH * 60 + bSM)) / 60));
      existingSlots += slots;
    });

    // Check if booking would exceed daily limit
    if (existingSlots + requestedSlots > maxSlotsPerChef) {
      return res.status(400).json({ 
        error: `Booking exceeds daily limit. Allowed: ${maxSlotsPerChef} hour(s).` 
      });
    }

    // Check for conflicts (exclusive per slot)
    const conflictCheck = await pool.query(`
      SELECT id FROM kitchen_bookings
      WHERE kitchen_id = $1 AND DATE(booking_date) = $2::date
      AND start_time < $4 AND end_time > $3
      AND status != 'cancelled'
    `, [kitchenId, dateStr, startTime, endTime]);
    
    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({ error: "Time slot is not available" });
    }

    // Get user details for booking
    const userResult = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [userId]
    );
    
    const portalUser = userResult.rows[0];
    const username = portalUser?.username || `User ${userId}`;

    // Calculate pricing (reuse time components calculated above)
    const durationMinutesP = endTotalMinutes - startTotalMinutes;
    const durationHoursP = Math.max(0, durationMinutesP / 60);
    
    // Get kitchen pricing
    const kitchenPricingResultP = await pool.query(`
      SELECT 
        hourly_rate::text as hourly_rate,
        currency,
        minimum_booking_hours
      FROM kitchens
      WHERE id = $1
    `, [kitchenId]);
    
    let totalPriceCentsP = 0;
    let hourlyRateCentsP = 0;
    let effectiveDurationP = durationHoursP;
    let currencyP = 'CAD';
    
    if (kitchenPricingResultP.rows.length > 0) {
      const pricing = kitchenPricingResultP.rows[0];
      hourlyRateCentsP = pricing.hourly_rate ? parseFloat(pricing.hourly_rate) : 0;
      currencyP = pricing.currency || 'CAD';
      const minimumHours = pricing.minimum_booking_hours || 1;
      effectiveDurationP = Math.max(durationHoursP, minimumHours);
      
      if (hourlyRateCentsP > 0) {
        totalPriceCentsP = Math.round(hourlyRateCentsP * effectiveDurationP);
      }
    }
    
    // Calculate service fee (5% commission)
    const serviceFeeCentsP = Math.round(totalPriceCentsP * 0.05);
    const totalWithFeesCentsP = totalPriceCentsP + serviceFeeCentsP;

    // Create booking (same table as chef bookings) with pricing
    const bookingResult = await pool.query(`
      INSERT INTO kitchen_bookings (
        chef_id, kitchen_id, booking_date, start_time, end_time, special_notes, status,
        total_price, hourly_rate, duration_hours, service_fee, currency, payment_status,
        storage_items, equipment_items
      )
      VALUES ($1, $2, $3::timestamp, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, 'pending', '[]'::jsonb, '[]'::jsonb)
      RETURNING id, kitchen_id, booking_date, start_time, end_time, status
    `, [
      userId,
      kitchenId,
      bookingDate,
      startTime,
      endTime,
      specialNotes || `Portal user booking from ${username}`,
      totalWithFeesCentsP.toString(),
      hourlyRateCentsP.toString(),
      effectiveDurationP.toString(),
      serviceFeeCentsP.toString(),
      currencyP
    ]);

    const booking = bookingResult.rows[0];

    // Send notification to manager
    try {
      const { sendEmail } = await import('../server/email.js');
      
      const locationDetailsResult = await pool.query(
        'SELECT name, notification_email FROM locations WHERE id = $1',
        [userLocationId]
      );
      
      if (locationDetailsResult.rows.length > 0) {
        const locationDetails = locationDetailsResult.rows[0];
        const managerEmail = locationDetails.notification_email;
        
        if (managerEmail) {
          const emailContent = {
            to: managerEmail,
            subject: `New Portal User Booking - ${locationDetails.name}`,
            text: `A new booking request has been submitted by a portal user:\n\n` +
                  `Kitchen: ${kitchen.name}\n` +
                  `Date: ${bookingDate}\n` +
                  `Time: ${startTime} - ${endTime}\n` +
                  `Portal User: ${username}\n` +
                  `${specialNotes ? `\nNotes: ${specialNotes}` : ''}\n\n` +
                  `Please log in to your manager dashboard to confirm or manage this booking.`,
            html: `<h2>New Portal User Booking</h2>` +
                  `<p><strong>Location:</strong> ${locationDetails.name}</p>` +
                  `<p><strong>Kitchen:</strong> ${kitchen.name}</p>` +
                  `<p><strong>Date:</strong> ${bookingDate}</p>` +
                  `<p><strong>Time:</strong> ${startTime} - ${endTime}</p>` +
                  `<p><strong>Portal User:</strong> ${username}</p>` +
                  `${specialNotes ? `<p><strong>Notes:</strong> ${specialNotes}</p>` : ''}` +
                  `<p>Please log in to your manager dashboard to confirm or manage this booking.</p>`,
          };
          await sendEmail(emailContent);
          console.log(`✅ Portal booking notification sent to manager: ${managerEmail}`);
        }
      }
    } catch (emailError) {
      console.error("Error sending booking notification email:", emailError);
      // Don't fail the booking if email fails
    }

    res.status(201).json({
      success: true,
      booking: {
        id: booking.id,
        kitchenId: booking.kitchen_id,
        bookingDate: booking.booking_date,
        startTime: booking.start_time,
        endTime: booking.end_time,
        status: booking.status,
      },
      message: "Booking request submitted successfully. The kitchen manager will contact you shortly.",
    });
  } catch (error) {
    console.error("Error creating portal booking:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Failed to create booking" });
    }
  }
});

// Get portal user's bookings
app.get("/api/portal/bookings", requirePortalUser, async (req, res) => {
  try {
    if (!pool) {
      return res.json([]);
    }
    
    const userId = req.user.id;
    
    // Get user's assigned location
    const accessResult = await pool.query(
      'SELECT location_id FROM portal_user_location_access WHERE portal_user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: "No location assigned to this portal user" });
    }
    
    const userLocationId = accessResult.rows[0].location_id;
    
    // Get bookings for this portal user with kitchen and location details including timezone
    const result = await pool.query(`
      SELECT 
        kb.id,
        kb.chef_id as "chefId",
        kb.kitchen_id as "kitchenId",
        kb.booking_date as "bookingDate",
        kb.start_time as "startTime",
        kb.end_time as "endTime",
        kb.status,
        kb.special_notes as "specialNotes",
        kb.created_at as "createdAt",
        kb.updated_at as "updatedAt",
        k.name as "kitchenName",
        l.name as "locationName",
        l.timezone as "locationTimezone"
      FROM kitchen_bookings kb
      INNER JOIN kitchens k ON k.id = kb.kitchen_id
      INNER JOIN locations l ON l.id = k.location_id
      WHERE kb.chef_id = $1
        AND k.location_id = $2
      ORDER BY kb.booking_date DESC, kb.start_time DESC
    `, [userId, userLocationId]);
    
    // Map the results to include locationTimezone with default fallback
    const enrichedBookings = result.rows.map(booking => ({
      ...booking,
      locationTimezone: booking.locationTimezone || DEFAULT_TIMEZONE,
    }));
    
    res.json(enrichedBookings);
  } catch (error) {
    console.error("Error fetching portal bookings:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  }
});

// Process-level error handlers to catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  if (reason instanceof Error) {
    console.error('Error stack:', reason.stack);
  }
  // Don't crash - log and continue (Vercel will handle it)
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Error stack:', error.stack);
  // Don't exit in serverless - let Vercel handle it
  // In serverless, we want to log but not crash the process
});

// Global error handler to ensure JSON responses
// This must be after all routes but before 404 handler
app.use((err, req, res, next) => {
  console.error('Global error handler caught error:', err);
  console.error('Error stack:', err?.stack);
  console.error('Error details:', {
    message: err?.message,
    name: err?.name,
    code: err?.code,
    path: req.path,
    method: req.method
  });
  
  // Ensure we always send JSON responses
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json');
    
    // Determine status code
    const statusCode = err.statusCode || err.status || 500;
    
    res.status(statusCode).json({
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { 
        stack: err?.stack,
        details: err 
      })
    });
  } else {
    console.error('⚠️ Response already sent, cannot send error response');
  }
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(404).json({ error: 'API endpoint not found', path: req.path });
});

export default app;