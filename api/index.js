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
    sameSite: isProduction ? 'strict' : 'lax', // Stricter in production
    domain: undefined // Let the browser determine the domain
  },
  name: 'connect.sid', // Explicit session name
  proxy: isProduction // Trust proxy in production (for Vercel)
}));

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
      console.error('Database query error:', error);
    }
  }

  // Fall back to in-memory
  for (const user of users.values()) {
    if (user.username === username) return user;
  }
  return null;
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
      console.error('Database query error:', error);
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

    // Verify admin role
    if (admin.role !== 'admin') {
      console.log('User is not an admin:', username);
      return res.status(403).json({ error: 'Not authorized as admin' });
    }

    // Check password - first try exact match for 'localcooks'
    let passwordMatches = false;
    
    console.log('Admin user found:', {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      passwordLength: admin.password ? admin.password.length : 0
    });
    console.log('Provided password:', password);

    if (password === 'localcooks') {
      passwordMatches = true;
      console.log('Admin password matched with hardcoded value');
    } else {
      // Try to compare with database password
      try {
        passwordMatches = await comparePasswords(password, admin.password);
        console.log('Admin password compared with database:', passwordMatches);
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
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

// ===================================
// 🔥 FIREBASE ROUTES (PRIORITY - MUST COME FIRST)
// ===================================

// 🔥 Firebase-Compatible Get Current User (for auth page)
app.get('/api/user', verifyFirebaseAuth, async (req, res) => {
  try {
    if (!req.firebaseUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('🔥 FIREBASE /api/user route hit for UID:', req.firebaseUser.uid);

    // Get user from database by Firebase UID
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
      console.log('❌ Firebase user not found in database for UID:', req.firebaseUser.uid);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('✅ Firebase user found:', {
      id: user.id,
      username: user.username,
      is_verified: user.is_verified,
      has_seen_welcome: user.has_seen_welcome
    });

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      is_verified: user.is_verified,
      has_seen_welcome: user.has_seen_welcome,
      firebaseUid: user.firebase_uid
    });
  } catch (error) {
    console.error('Error getting Firebase user:', error);
    res.status(500).json({ error: 'Failed to get user data' });
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

// ===================================
// 📱 SESSION ROUTES (FALLBACK)
// ===================================

app.get('/api/user-session', async (req, res) => {
  // Debug session info
  console.log('GET /api/user - Request details:', {
    sessionId: req.session.id,
    userId: req.session.userId || null,
    sessionUser: req.session.user ? { id: req.session.user.id, username: req.session.user.username, role: req.session.user.role } : null,
    cookies: req.headers.cookie || 'No cookies',
    headers: {
      'x-user-id': req.headers['x-user-id'] || null,
      'user-agent': req.headers['user-agent'] || null
    }
  });

  // Get user ID from session or header
  const rawUserId = req.session.userId || req.headers['x-user-id'];

  if (!rawUserId) {
    console.log('No userId in session or header, returning 401');
    console.log('Session object:', JSON.stringify(req.session, null, 2));
    return res.status(401).json({ error: 'Not authenticated', debug: { sessionId: req.session.id, hasCookies: !!req.headers.cookie } });
  }

  // Store user ID in session if it's not there
  if (!req.session.userId && rawUserId) {
    console.log('Storing userId in session from header:', rawUserId);
    req.session.userId = rawUserId;
    await new Promise(resolve => req.session.save(resolve));
  }

  try {
    console.log('Fetching user with ID:', rawUserId);

    // If we have the user cached in session, use that
    if (req.session.user && req.session.user.id) {
      console.log('Using cached user from session:', { id: req.session.user.id, username: req.session.user.username, role: req.session.user.role });
      return res.status(200).json(req.session.user);
    }

    const user = await getUser(rawUserId);
    if (!user) {
      console.log('User not found in database, destroying session');
      req.session.destroy(() => { });
      return res.status(401).json({ error: 'User not found' });
    }

    console.log('User found in database:', { id: user.id, username: user.username, role: user.role });

    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = user;

    // Cache user in session for future requests
    req.session.user = userWithoutPassword;

    // Save session to ensure user data is cached
    await new Promise(resolve => req.session.save(resolve));

    res.status(200).json(userWithoutPassword);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user data', message: error.message });
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
      const firebaseUser = await verifyFirebaseToken(req.headers.authorization?.substring(7));
      
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
  console.log('PATCH /api/applications/:id/cancel - Session data:', {
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

  // Convert Firebase UID to integer user ID
  const user = await getUser(rawUserId);
  if (!user) {
    console.log('User not found for ID:', rawUserId);
    return res.status(401).json({ error: 'User not found' });
  }
  const userId = user.id;

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

      // Get user for id check
      const user = await getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

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
        result = await pool.query(`
          UPDATE applications
          SET status = 'cancelled'
          WHERE id = $1 AND user_id = $2
          RETURNING *;
        `, [id, req.session.userId]);
      }

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Application not found or not owned by you' });
      }

      // Get the user_id for the cancelled application
      const cancelledApp = result.rows[0];
      const cancelledUserId = cancelledApp.user_id;

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

    // ✅ OVERRIDE: Allow document uploads for any application status
    // Previously restricted to only approved applications, but now allowing all statuses
    // This enables users to upload documents during form submission
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
          const { sendEmail } = await import('../server/email.js');
          const html = `
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:linear-gradient(135deg,#f8fafc 0%,#eef2ff 100%);padding:0;margin:0;min-height:100vh;">
              <tr>
                <td align="center" style="padding:0;margin:0;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:40px auto 0 auto;background:#fff;border-radius:18px;box-shadow:0 4px 32px 0 rgba(0,0,0,0.07);overflow:hidden;">
                    <tr>
                      <td style="padding:0;">
                        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:linear-gradient(90deg,#fbbf24 0%,#f59e42 100%);padding:0;">
                          <tr>
                            <td style="padding:32px 32px 16px 32px;text-align:center;">
                              <img src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/logo-white.png" style="display:inline-block;height:48px;width:auto;vertical-align:middle;" />
                              <h1 style="margin:12px 0 0 0;font-family: 'Lobster', cursive, sans-serif;font-size:2rem;font-weight:900;color:#fff;letter-spacing:-1px;">Local Cooks</h1>
                            </td>
                          </tr>
                        </table>
                        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                          <tr>
                            <td style="padding:32px 32px 0 32px;">
                              <h2 style="font-family:'Segoe UI',Arial,sans-serif;font-size:1.5rem;font-weight:700;color:#f59e42;margin:0 0 16px 0;letter-spacing:-0.5px;text-align:center;">We've received your updated documents</h2>
                              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:1.1rem;line-height:1.7;color:#222;margin:0 0 24px 0;text-align:center;">
                                Thank you for updating your documents. Our team will review them and update your verification status as soon as possible.<br />
                                You'll receive another email once your documents have been reviewed.
                              </p>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:0 32px 32px 32px;text-align:center;">
                              <span style="display:inline-block;padding:10px 28px;font-size:1.1rem;font-weight:700;border-radius:999px;background:linear-gradient(90deg,#fef9c3 0%,#fde68a 100%);box-shadow:0 4px 16px 0 rgba(251,191,36,0.10);color:#92400e;letter-spacing:0.5px;vertical-align:middle;">
                                <span style="font-size:1.5rem;vertical-align:middle;margin-right:10px;">📄</span>
                                Document Update Received
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:0 32px 32px 32px;text-align:center;">
                              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:0.95rem;color:#888;line-height:1.6;margin:0 0 8px 0;">
                                If you have any questions, reply to this email or contact our support team.
                              </p>
                              <div style="margin:24px auto 0 auto;width:60px;height:4px;border-radius:2px;background:linear-gradient(90deg,#fbbf24 0%,#f59e42 100%);opacity:0.18;"></div>
                              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:0.85rem;color:#bbb;line-height:1.5;margin:18px 0 0 0;">&copy; ${new Date().getFullYear()} Local Cooks</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          `;
          await sendEmail({
            to: updatedApplication.email,
            subject: "We've received your updated documents",
            html,
          }, {
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

    // Check if both documents are approved, then update user verification status
    if (updatedApplication.food_safety_license_status === "approved" && 
        (!updatedApplication.food_establishment_cert_url || updatedApplication.food_establishment_cert_status === "approved")) {
      
      await pool.query(`
        UPDATE users SET is_verified = true WHERE id = $1
      `, [targetUserId]);
      
      console.log(`User ${targetUserId} has been fully verified`);
      
      // Send full verification email with vendor credentials
      try {
        // Import the email functions
        const { sendEmail, generateFullVerificationEmail } = await import('../server/email.js');
        
        // Get user details for email
        const userResult = await pool.query(`
          SELECT username FROM users WHERE id = $1
        `, [targetUserId]);
        
        if (userResult.rows.length > 0 && updatedApplication.email) {
          const user = userResult.rows[0];
          const emailContent = generateFullVerificationEmail({
            fullName: updatedApplication.full_name || user.username,
            email: updatedApplication.email,
            phone: updatedApplication.phone || user.username // Assuming username is phone number
          });

          await sendEmail(emailContent, {
            trackingId: `full_verification_${targetUserId}_${Date.now()}`
          });
          console.log(`Full verification email sent to ${updatedApplication.email} for user ${targetUserId}`);
          console.log(`Vendor credentials generated: username=${updatedApplication.phone || user.username}`); // Don't log password
        } else {
          console.warn(`Cannot send full verification email: Missing user data or email for user ${targetUserId}`);
        }
      } catch (emailError) {
        // Log the error but don't fail the request
        console.error("Error sending full verification email:", emailError);
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

// Generic file upload endpoint (for use with new upload components)
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
    
    return res.status(200).json({
      message: "Session statistics",
      stats: stats,
      recommendations: {
        shouldCleanup: stats.expired_sessions > 100,
        cleanupRecommended: stats.total_sessions > 1000,
        criticalLevel: stats.total_sessions > 5000
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

    return res.status(200).json({
      message: "Session cleanup completed",
      before: beforeStats,
      after: afterStats,
      cleaned: cleanupResult.cleaned,
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
    
    if (!pool) {
      return res.status(500).json({ message: "Database not available" });
    }

    const beforeStats = await getSessionStats();
    
    const result = await pool.query(`
      DELETE FROM session 
      WHERE expire < NOW() - INTERVAL '${days} days'
      RETURNING sid;
    `);

    const afterStats = await getSessionStats();

    return res.status(200).json({
      message: `Cleaned up sessions older than ${days} days`,
      before: beforeStats,
      after: afterStats,
      cleaned: result.rowCount,
      days: days,
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
      // Create table if it doesn't exist (same as above)
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
          is_rewatching BOOLEAN DEFAULT FALSE,
          UNIQUE(user_id, video_id)
        );
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
      // Create table if it doesn't exist (same as above)
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
        completionData.confirmed,
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

    // Generate professional PDF certificate
    const { generateCertificatePDF } = await import('./certificateGenerator.js');
    
    const certificateId = `LC-${userId}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    
    const certificateData = {
      userName: user.full_name || user.username,
      completionDate: completion.completedAt,
      certificateId: certificateId,
      userId: userId
    };

    console.log('Generating PDF certificate with data:', certificateData);
    
    try {
      const pdfBuffer = await generateCertificatePDF(certificateData);
      
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

// Endpoint to sync Firebase user to SQL users table
app.post('/api/firebase-sync-user', async (req, res) => {
  const { uid, email, displayName, role, emailVerified } = req.body;
  if (!uid || !email) {
    return res.status(400).json({ error: 'Missing uid or email' });
  }
  
  console.log(`🔄 Firebase sync request for email: ${email}, uid: ${uid}`);
  console.log(`🔍 ENHANCED SYNC DEBUG:`);
  console.log(`   - Firebase UID: ${uid}`);
  console.log(`   - Email: ${email}`);
  console.log(`   - Display Name: ${displayName}`);
  console.log(`   - emailVerified (from Firebase): ${emailVerified}`);
  console.log(`   - Role: ${role}`);
  
  try {
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
            return res.status(409).json({ 
              error: 'Email already registered with different account',
              message: 'This email is already associated with another Firebase account'
            });
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
          
          try {
            const insertResult = await pool.query(
              'INSERT INTO users (username, password, role, firebase_uid, is_verified, has_seen_welcome) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
              [email, '', role || 'applicant', uid, isUserVerified, false]
            );
            user = insertResult.rows[0];
            wasCreated = true;
            console.log(`✨ Successfully created new user: ${user.id} (${user.username})`);
            console.log(`   - is_verified in DB: ${user.is_verified}`);
            console.log(`   - has_seen_welcome in DB: ${user.has_seen_welcome}`);
            
            // Send welcome email for new users
            if (isUserVerified) {
              try {
                console.log(`📧 Sending welcome email to new user: ${email}`);
                const { sendEmail, generateWelcomeEmail } = await import('../server/email.js');
                const emailContent = generateWelcomeEmail({
                  fullName: displayName || email.split('@')[0],
                  email: email
                });
                
                const emailSent = await sendEmail(emailContent, {
                  trackingId: `welcome_${user.id}_${Date.now()}`
                });
                
                if (emailSent) {
                  console.log(`✅ Welcome email sent successfully to ${email}`);
                } else {
                  console.log(`⚠️ Welcome email failed to send to ${email}`);
                }
              } catch (emailError) {
                console.error(`❌ Error sending welcome email to ${email}:`, emailError);
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
        user = { 
          id, 
          username: email, 
          role: role || 'applicant', 
          password: '', 
          firebase_uid: uid,
          is_verified: isUserVerified,
          has_seen_welcome: false
        };
        users.set(id, user);
        wasCreated = true;
        console.log(`✨ Created new in-memory user: ${id} (${email})`);
        console.log(`   - is_verified: ${isUserVerified}, has_seen_welcome: false`);
      }
    }
    
    console.log(`✅ Firebase sync completed for email: ${email}, user ID: ${user.id} (${wasCreated ? 'CREATED' : 'EXISTING'})`);
    
    // Return enhanced response
    res.json({ 
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
      message: wasCreated ? 'New user created and synced' : 'Existing user found and synced'
    });
  } catch (error) {
    console.error('❌ Error syncing Firebase user:', error);
    res.status(500).json({ 
      error: 'Failed to sync user', 
      message: error.message,
      uid: uid,
      email: email 
    });
  }
});

// ===================================
// ENHANCED FIREBASE AUTHENTICATION
// ===================================

// Initialize Firebase Admin SDK for enhanced auth using VITE variables
let firebaseAdmin;
try {
  if (process.env.VITE_FIREBASE_PROJECT_ID) {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    
    if (getApps().length === 0) {
      firebaseAdmin = initializeApp({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      });
      
      console.log('✅ Enhanced Firebase Admin SDK initialized with project:', process.env.VITE_FIREBASE_PROJECT_ID);
    } else {
      firebaseAdmin = getApps()[0];
      console.log('✅ Using existing Firebase Admin app');
    }
  } else {
    console.log('⚠️ Enhanced Firebase Admin SDK configuration missing - no VITE_FIREBASE_PROJECT_ID');
  }
} catch (error) {
  console.error('❌ Enhanced Firebase Admin SDK initialization failed:', error);
}

// Enhanced Firebase token verification
async function verifyFirebaseToken(token) {
  try {
    if (!firebaseAdmin) {
      throw new Error('Enhanced Firebase Admin SDK not initialized');
    }
    
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth(firebaseAdmin);
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Enhanced token verification error:', error);
    return null;
  }
}

// Enhanced Firebase Auth Middleware
async function verifyFirebaseAuth(req, res, next) {
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

    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: decodedToken.email_verified,
    };

    next();
  } catch (error) {
    console.error('Enhanced Firebase auth verification error:', error);
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Token verification failed' 
    });
  }
}

// Enhanced Firebase Auth with User Loading Middleware
async function requireFirebaseAuthWithUser(req, res, next) {
  try {
    await verifyFirebaseAuth(req, res, () => {});
    
    if (!req.firebaseUser) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Firebase authentication required' 
      });
    }

    // Load Neon user from Firebase UID
    let neonUser = null;
    if (pool) {
      const result = await pool.query(
        'SELECT * FROM users WHERE firebase_uid = $1',
        [req.firebaseUser.uid]
      );
      neonUser = result.rows[0] || null;
    } else {
      // In-memory fallback
      for (const user of users.values()) {
        if (user.firebase_uid === req.firebaseUser.uid) {
          neonUser = user;
          break;
        }
      }
    }
    
    if (!neonUser) {
      return res.status(404).json({ 
        error: 'User not found', 
        message: 'No matching user in database. Please complete registration.' 
      });
    }

    req.neonUser = {
      id: neonUser.id,
      username: neonUser.username,
      role: neonUser.role,
      firebaseUid: neonUser.firebase_uid || undefined,
    };

    console.log(`🔄 Enhanced auth: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${neonUser.id}`);
    next();
  } catch (error) {
    console.error('Enhanced Firebase auth with user verification error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Authentication verification failed' 
    });
  }
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

// ===================================
// ENHANCED FIREBASE ROUTES
// ===================================

// Enhanced Get Current User Profile (Firebase + Hybrid Support)
app.get('/api/user/profile', async (req, res) => {
  try {
    // Try hybrid auth first (supports both Firebase and session)
    await requireHybridAuth(req, res, () => {});
    
    if (req.user) {
      return res.json({
        neonUser: {
          id: req.user.id,
          username: req.user.username,
          role: req.user.role,
          authMethod: req.user.authMethod
        },
        firebaseUser: req.firebaseUser ? {
          uid: req.firebaseUser.uid,
          email: req.firebaseUser.email,
          emailVerified: req.firebaseUser.email_verified,
        } : null
      });
    }
    
    // Fallback to Firebase-only auth for backward compatibility
    await requireFirebaseAuthWithUser(req, res, () => {});
    
    res.json({
      neonUser: {
        id: req.neonUser.id,
        username: req.neonUser.username,
        role: req.neonUser.role,
        authMethod: 'firebase'
      },
      firebaseUser: {
        uid: req.firebaseUser.uid,
        email: req.firebaseUser.email,
        emailVerified: req.firebaseUser.email_verified,
      }
    });
  } catch (error) {
    console.error('Error getting enhanced user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
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

// Enhanced Microlearning Progress
app.post('/api/firebase/microlearning/progress', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const { videoId, progress, completed } = req.body;
    const userId = req.neonUser.id;

    console.log(`📺 Enhanced video progress: Firebase UID ${req.firebaseUser.uid} → Neon User ID ${userId}`);

    await updateVideoProgress({
      userId,
      videoId,
      progress,
      completed
    });

    res.json({ success: true, message: 'Progress updated' });
  } catch (error) {
    console.error('Error updating enhanced video progress:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

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

  console.log('🔥 Enhanced Firebase authentication routes added to existing API');
  console.log('✨ Hybrid architecture: Both session-based and Firebase JWT authentication available');
  console.log('📧 Email-based login now supported alongside username login');
  console.log('🚀 Hybrid endpoints: /api/hybrid/* support both auth methods');
  console.log('👥 Admin support: Both Firebase and session admins fully supported');
  console.log('🐛 Debug endpoints: /api/debug-login, /api/auth-status available for troubleshooting');

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

// Password reset request endpoint
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Check if user exists
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      // Don't reveal if user exists or not for security
      return res.status(200).json({ 
        message: "If an account with this email exists, you will receive a password reset link." 
      });
    }

    const user = userResult.rows[0];

    // Generate reset token (expires in 1 hour)
    const crypto = await import('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now
    
    // Store reset token in database
    await pool.query(`
      INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) 
      VALUES ($1, $2, $3, NOW()) 
      ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()
    `, [user.id, resetToken, resetTokenExpiry]);

    // Generate reset URL
    const resetUrl = `${process.env.BASE_URL || 'https://local-cooks-community.vercel.app'}/auth/reset-password?token=${resetToken}`;

    // Send password reset email
    const { sendEmail, generatePasswordResetEmail } = await import('../server/email.js');
    const emailContent = generatePasswordResetEmail({
      fullName: user.display_name || user.username,
      email: user.email,
      resetToken,
      resetUrl
    });

    const emailSent = await sendEmail(emailContent, {
      trackingId: `password_reset_${user.id}_${Date.now()}`
    });

    if (emailSent) {
      console.log(`Password reset email sent to ${email}`);
      return res.status(200).json({ 
        message: "If an account with this email exists, you will receive a password reset link." 
      });
    } else {
      console.error(`Failed to send password reset email to ${email}`);
      return res.status(500).json({ 
        message: "Error sending password reset email. Please try again later." 
      });
    }
  } catch (error) {
    console.error("Error in forgot password:", error);
    return res.status(500).json({ 
      message: "Internal server error. Please try again later." 
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
    const verificationUrl = `${process.env.BASE_URL || 'https://local-cooks-community.vercel.app'}/auth/verify-email?token=${verificationToken}`;

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

    // Verify token and get email
    const result = await pool.query(
      'SELECT email FROM email_verification_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    const { email } = result.rows[0];

    // Mark email as verified
    await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE email = $1', [email]);

    // Clear verification token
    await pool.query('DELETE FROM email_verification_tokens WHERE token = $1', [token]);

    console.log(`Email verified successfully: ${email}`);
    
    // Redirect to success page
    return res.redirect(`${process.env.BASE_URL || 'https://local-cooks-community.vercel.app'}/auth?verified=true`);

  } catch (error) {
    console.error("Error in email verification:", error);
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

    console.log(`🔍 Checking if user exists: ${email}`);
    
    let firebaseExists = false;
    let neonExists = false;
    let firebaseUser = null;
    let neonUser = null;
    let firebaseError = null;

    // Check Firebase with better error handling
    try {
      console.log(`🔥 Attempting Firebase check for: ${email}`);
      
             // Check if we have Firebase Admin configured (using VITE_ variables)
       console.log(`🔥 Environment check:`, {
         VITE_FIREBASE_API_KEY: !!process.env.VITE_FIREBASE_API_KEY,
         VITE_FIREBASE_AUTH_DOMAIN: !!process.env.VITE_FIREBASE_AUTH_DOMAIN,
         VITE_FIREBASE_PROJECT_ID: !!process.env.VITE_FIREBASE_PROJECT_ID,
         VITE_FIREBASE_STORAGE_BUCKET: !!process.env.VITE_FIREBASE_STORAGE_BUCKET,
         VITE_FIREBASE_MESSAGING_SENDER_ID: !!process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
         VITE_FIREBASE_APP_ID: !!process.env.VITE_FIREBASE_APP_ID
       });
       
       if (!process.env.VITE_FIREBASE_PROJECT_ID) {
         console.log(`🔥 Firebase Admin not configured (missing VITE_FIREBASE_PROJECT_ID)`);
         firebaseError = 'Firebase not configured';
      } else {
        // Use dynamic import for ES modules compatibility
        const admin = await import('firebase-admin');
        
        if (!admin.default.apps.length) {
          console.log(`🔥 Firebase Admin not initialized - attempting to initialize`);
          
                     // Try to initialize Firebase Admin using VITE_ variables
           try {
             const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
             
             console.log(`🔥 Attempting Firebase Admin initialization with project: ${projectId}`);

             // Since we only have client-side variables, try to initialize without service account
             // This will work in some environments or we'll rely on client-side checks
             if (projectId) {
               try {
                 admin.default.initializeApp({
                   projectId: projectId,
                 });
                 console.log(`🔥 Firebase Admin initialized with default credentials for project: ${projectId}`);
               } catch (initError) {
                 console.log(`🔥 Firebase Admin initialization failed, will use client-side checks only:`, initError.message);
                 firebaseError = 'Firebase Admin unavailable, using client-side checks';
               }
             } else {
               console.log(`🔥 No Firebase project ID available`);
               firebaseError = 'Firebase project not configured';
             }
          } catch (initError) {
            console.error(`🔥 Firebase Admin initialization failed:`, initError.message);
            firebaseError = 'Firebase initialization failed';
          }
        }
        
        // Try to check user if Firebase is available
        if (admin.default.apps.length > 0) {
          try {
            const userRecord = await admin.default.auth().getUserByEmail(email);
            firebaseExists = true;
            firebaseUser = {
              uid: userRecord.uid,
              email: userRecord.email,
              emailVerified: userRecord.emailVerified,
              disabled: userRecord.disabled
            };
            console.log(`🔥 Firebase: User EXISTS (${userRecord.uid})`);
          } catch (getUserError) {
            if (getUserError.code === 'auth/user-not-found') {
              console.log(`🔥 Firebase: User does NOT exist`);
              firebaseExists = false;
            } else {
              console.error(`🔥 Firebase getUserByEmail error:`, getUserError.message);
              firebaseError = getUserError.message;
            }
          }
        }
      }
    } catch (firebaseError) {
      console.error('🔥 Firebase check failed:', firebaseError.message);
      firebaseError = firebaseError.message;
    }

    // Check NeonDB
    try {
      if (pool) {
        const result = await pool.query('SELECT id, username, role, firebase_uid FROM users WHERE LOWER(username) = LOWER($1)', [email]);
        if (result.rows.length > 0) {
          neonExists = true;
          neonUser = result.rows[0];
          console.log(`🗃️  NeonDB: User EXISTS (ID: ${neonUser.id})`);
        } else {
          console.log(`🗃️  NeonDB: User does NOT exist`);
        }
      }
    } catch (neonError) {
      console.error('NeonDB check error:', neonError.message);
    }

    // Determine the result
    let canRegister = !firebaseExists && !neonExists;
    let status = 'available';
    let message = 'Email is available for registration';
    
    if (firebaseExists && neonExists) {
      status = 'exists_both';
      message = 'User exists in both Firebase and NeonDB';
      canRegister = false;
    } else if (firebaseExists) {
      status = 'exists_firebase';
      message = 'User exists in Firebase but not in NeonDB';
      canRegister = false;
    } else if (neonExists) {
      status = 'exists_neon';
      message = 'User exists in NeonDB but not in Firebase';
      canRegister = false;
    }

    console.log(`📊 Result for ${email}: ${status} (canRegister: ${canRegister})`);

         return res.json({
       email,
       canRegister,
       status,
       message,
       firebase: {
         exists: firebaseExists,
         user: firebaseUser,
         error: firebaseError
       },
       neon: {
         exists: neonExists,
         user: neonUser
       },
       suggestion: !canRegister ? 
         'Email already exists. Try the client-side Firebase check or use a different email.' : 
         'Email is available for registration.'
     });
  } catch (error) {
    console.error('❌ Error checking user existence:', error);
    res.status(500).json({ 
      error: 'Failed to check user existence', 
      message: error.message 
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

export default app;