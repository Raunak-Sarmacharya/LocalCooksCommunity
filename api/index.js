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
  resave: true,
  saveUninitialized: true,
  store: sessionStore,
  cookie: {
    secure: isProduction, // true in production, false in development
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    sameSite: 'lax'
  }
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
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (result.rows.length > 0) return result.rows[0];
    } catch (error) {
      console.error('Database query error:', error);
    }
  }

  // Fall back to in-memory
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
      const result = await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING *',
        [userData.username, hashedPassword, userData.role || 'applicant']
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
            CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');
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
          status application_status NOT NULL DEFAULT 'new',
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
              CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');
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
            status application_status NOT NULL DEFAULT 'new',
            
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

    // Set session
    req.session.userId = admin.id;
    req.session.user = { id: admin.id, username: admin.username, role: admin.role };

    // Ensure session is saved before responding
    await new Promise(resolve => req.session.save(err => {
      if (err) {
        console.error('Error saving session:', err);
      } else {
        console.log('Session saved successfully with userId:', admin.id);
      }
      resolve();
    }));

    // Remove sensitive info
    const { password: _, ...adminWithoutPassword } = admin;

    // Return user and save in localStorage for header auth
    return res.status(200).json(adminWithoutPassword);
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Admin login failed', message: error.message });
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

    const user = await getUserByUsername(username);
    if (!user) {
      console.log('Login failed: User not found');
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

app.get('/api/user', async (req, res) => {
  // Debug session info
  console.log('GET /api/user - Session data:', {
    sessionId: req.session.id,
    userId: req.session.userId || null,
    headers: {
      'x-user-id': req.headers['x-user-id'] || null
    }
  });

  // Get user ID from session or header
  const userId = req.session.userId || req.headers['x-user-id'];

  if (!userId) {
    console.log('No userId in session or header, returning 401');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Store user ID in session if it's not there
  if (!req.session.userId && userId) {
    console.log('Storing userId in session from header:', userId);
    req.session.userId = userId;
    await new Promise(resolve => req.session.save(resolve));
  }

  try {
    console.log('Fetching user with ID:', userId);

    // If we have the user cached in session, use that
    if (req.session.user) {
      console.log('Using cached user from session');
      return res.status(200).json(req.session.user);
    }

    const user = await getUser(userId);
    if (!user) {
      console.log('User not found in database, destroying session');
      req.session.destroy(() => { });
      return res.status(401).json({ error: 'User not found' });
    }

    console.log('User found in database, returning user data');

    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = user;

    // Cache user in session for future requests
    req.session.user = userWithoutPassword;

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
  const userId = req.session.userId || req.headers['x-user-id'];

  if (!userId) {
    console.log('No userId in session or header, returning 401');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Store user ID in session as a backup
  if (!req.session.userId && userId) {
    console.log('Storing userId in session from header:', userId);
    req.session.userId = userId;
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
          (user_id, full_name, email, phone, food_safety_license, food_establishment_cert, kitchen_preference, feedback, 
           food_safety_license_url, food_establishment_cert_url, food_safety_license_status, food_establishment_cert_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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

        // Send email notification about new application
        try {
          // Import the email functions
          const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

          if (createdApplication.email) {
            const emailContent = generateStatusChangeEmail({
              fullName: createdApplication.full_name || "Applicant",
              email: createdApplication.email,
              status: 'new'
            });

            await sendEmail(emailContent, {
              trackingId: `new_${createdApplication.id}_${Date.now()}`
            });
            console.log(`New application email sent to ${createdApplication.email} for application ${createdApplication.id}`);
          } else {
            console.warn(`Cannot send new application email: Missing email address`);
          }
        } catch (emailError) {
          // Log the error but don't fail the request
          console.error("Error sending new application email:", emailError);
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
      status: 'new',
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

    // Send email notification about new application (for memory storage case)
    try {
      // Import the email functions
      const { sendEmail, generateStatusChangeEmail } = await import('../server/email.js');

      if (application.email) {
        const emailContent = generateStatusChangeEmail({
          fullName: application.fullName || "Applicant",
          email: application.email,
          status: 'new'
        });

        await sendEmail(emailContent, {
          trackingId: `new_${application.id}_${Date.now()}`
        });
        console.log(`New application email sent to ${application.email} for application ${application.id}`);
      } else {
        console.warn(`Cannot send new application email: Missing email address`);
      }
    } catch (emailError) {
      // Log the error but don't fail the request
      console.error("Error sending new application email:", emailError);
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
  const userId = req.session.userId || req.headers['x-user-id'];

  if (!userId) {
    console.log('No userId in session or header');
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // First check if the user is an admin
    const user = await getUser(userId);
    console.log('User from DB:', user ? { id: user.id, username: user.username, role: user.role } : null);

    if (!user || user.role !== 'admin') {
      console.log('User is not an admin:', user ? user.role : 'user not found');
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can access this endpoint'
      });
    }

    // Store user ID in session if it's not there
    if (!req.session.userId && userId) {
      console.log('Storing userId in session from header:', userId);
      req.session.userId = userId;
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
      'x-user-id': req.headers['x-user-id'] || null
    }
  });

  // Get user ID from session or header
  const userId = req.session.userId || req.headers['x-user-id'];

  if (!userId) {
    console.log('No userId in session or header');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Store user ID in session if it's not there
  if (!req.session.userId && userId) {
    console.log('Storing userId in session from header:', userId);
    req.session.userId = userId;
    await new Promise(resolve => req.session.save(resolve));
  }

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
      `, [req.session.userId]);

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
  const userId = req.session.userId || req.headers['x-user-id'];

  if (!userId) {
    console.log('No userId in session or header');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Store user ID in session if it's not there
  if (!req.session.userId && userId) {
    console.log('Storing userId in session from header:', userId);
    req.session.userId = userId;
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
  const userId = req.session.userId || (req.headers['x-user-id'] ? parseInt(req.headers['x-user-id']) : null);

  console.log('Status update request - Auth info:', {
    sessionUserId: req.session.userId,
    headerUserId: req.headers['x-user-id'],
    resolvedUserId: userId
  });

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // First check if the user is an admin
    const user = await getUser(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can update application status'
      });
    }

    // Store user ID in session if it's not there
    if (!req.session.userId && userId) {
      console.log('Storing userId in session from header:', userId);
      req.session.userId = userId;
      await new Promise(resolve => req.session.save(resolve));
    }

    const { id } = req.params;
    const { status } = req.body;

    // Validate the status
    const validStatuses = ['new', 'inReview', 'approved', 'rejected', 'cancelled'];
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
    const userId = req.session.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
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
    const userId = req.session.userId || req.headers['x-user-id'];
    if (!userId) {
      console.log("❌ Authentication failed - no userId found");
      return res.status(401).json({ message: "Not authenticated" });
    }

    console.log("✅ User authenticated with ID:", userId);

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

    // Get user to check if admin
    const user = await getUser(userId);
    console.log("👤 User details:", {
      found: !!user,
      role: user?.role,
      isAdmin: user?.role === "admin"
    });
    
    // Check if user owns the application or is admin
    if (application.user_id !== parseInt(userId) && user?.role !== "admin") {
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
    const userId = req.session.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

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
      documents_reviewed_by: parseInt(userId),
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
      const userId = req.session.userId || req.headers['x-user-id'];
      if (!userId) {
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

      console.log('✅ Upload: User authenticated:', userId);

      // Store user ID in session as a backup (for Vercel session persistence)
      if (!req.session.userId && userId) {
        console.log('🔄 Upload: Storing userId in session from header:', userId);
        req.session.userId = userId;
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
    const userId = req.session.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

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
    const userId = req.session.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(userId);
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
    const userId = req.session.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(userId);
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
    const userId = req.session.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUser(userId);
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
      hasPending: applications.some(app => app.status === 'new' || app.status === 'inReview'),
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

    const userId = parseInt(req.params.userId);
    
    // Verify user can access this data (either their own or admin)
    const sessionUser = await getUser(sessionUserId);
    if (parseInt(sessionUserId) !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const progress = await getMicrolearningProgress(userId);
    const completionStatus = await getMicrolearningCompletion(userId);
    const applicationStatus = await getApplicationStatus(userId);

    // Determine access level and provide detailed application info
    const accessLevel = applicationStatus.hasApproved ? 'full' : 'limited';
    
    res.json({
      success: true,
      progress: progress || [],
      completionConfirmed: completionStatus?.confirmed || false,
      completedAt: completionStatus?.completedAt,
      hasApprovedApplication: applicationStatus.hasApproved,
      accessLevel: accessLevel,
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

    const { userId, videoId, progress, completed, completedAt, watchedPercentage } = req.body;
    
    // Verify user can update this data (either their own or admin)
    const sessionUser = await getUser(sessionUserId);
    if (parseInt(sessionUserId) !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if user has approved application for videos beyond the first one
    const applicationStatus = await getApplicationStatus(userId);
    const firstVideoId = 'basics-cross-contamination'; // First video that everyone can access
    
    if (!applicationStatus.hasApproved && sessionUser?.role !== 'admin' && videoId !== firstVideoId) {
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

    const { userId, completionDate, videoProgress } = req.body;
    
    // Verify user can complete this (either their own or admin)
    const sessionUser = await getUser(sessionUserId);
    if (parseInt(sessionUserId) !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if user has approved application to complete full training
    const applicationStatus = await getApplicationStatus(userId);
    if (!applicationStatus.hasApproved && sessionUser?.role !== 'admin') {
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

    // Verify all required videos are completed (2 comprehensive modules)
    const requiredVideos = [
      // Food Safety Basics Module (14 videos)
      'basics-personal-hygiene', 'basics-temperature-danger', 'basics-cross-contamination',
      'basics-allergen-awareness', 'basics-food-storage', 'basics-cooking-temps',
      'basics-cooling-reheating', 'basics-thawing', 'basics-receiving', 'basics-fifo',
      'basics-illness-reporting', 'basics-pest-control', 'basics-chemical-safety', 'basics-food-safety-plan',
      // Safety and Hygiene How-To's Module (8 videos)
      'howto-handwashing', 'howto-sanitizing', 'howto-thermometer', 'howto-cleaning-schedule',
      'howto-equipment-cleaning', 'howto-uniform-care', 'howto-wound-care', 'howto-inspection-prep'
    ];
    const completedVideos = videoProgress.filter(v => v.completed).map(v => v.videoId);
    const allRequired = requiredVideos.every(videoId => completedVideos.includes(videoId));

    if (!allRequired) {
      return res.status(400).json({ 
        message: 'All required videos must be completed before certification',
        missingVideos: requiredVideos.filter(id => !completedVideos.includes(id))
      });
    }

    // Get user details for certificate generation
    const user = await getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Create completion record
    const completionData = {
      userId,
      completedAt: new Date(completionDate),
      videoProgress,
      confirmed: true,
      certificateGenerated: false
    };

    await createMicrolearningCompletion(completionData);

    res.json({
      success: true,
      message: 'Microlearning completed successfully',
      completionConfirmed: true,
      alwaysFoodSafeIntegration: 'not_configured'
    });
  } catch (error) {
    console.error('Error completing microlearning:', error);
    res.status(500).json({ message: 'Failed to complete microlearning' });
  }
});

// Generate and download certificate
app.get("/api/microlearning/certificate/:userId", async (req, res) => {
  try {
    // Check if user is authenticated
    const sessionUserId = req.session.userId || req.headers['x-user-id'];
    if (!sessionUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userId = parseInt(req.params.userId);
    
    // Verify user can access this certificate (either their own or admin)
    const sessionUser = await getUser(sessionUserId);
    if (parseInt(sessionUserId) !== userId && sessionUser?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const completion = await getMicrolearningCompletion(userId);
    if (!completion || !completion.confirmed) {
      return res.status(404).json({ message: 'No confirmed completion found' });
    }

    const user = await getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // For now, return a placeholder certificate URL
    const certificateUrl = `/api/certificates/microlearning-${userId}-${Date.now()}.pdf`;

    res.json({
      success: true,
      certificateUrl,
      completionDate: completion.completedAt,
      message: 'Certificate for skillpass.nl food safety training preparation - Complete your official certification at skillpass.nl'
    });
  } catch (error) {
    console.error('Error generating certificate:', error);
    res.status(500).json({ message: 'Failed to generate certificate' });
  }
});

export default app;