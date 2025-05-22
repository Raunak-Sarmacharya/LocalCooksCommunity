// Minimal Express server for Vercel
import express from 'express';
import session from 'express-session';
import { Pool } from '@neondatabase/serverless';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import createMemoryStore from 'memorystore';
import connectPgSimple from 'connect-pg-simple';

// Setup
const app = express();
const scryptAsync = promisify(scrypt);
const MemoryStore = createMemoryStore(session);
const PgStore = connectPgSimple(session);

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
      createTableIfMissing: true
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
app.use(express.json());

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

      // Create role enum if it doesn't exist
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
            CREATE TYPE user_role AS ENUM ('admin', 'applicant');
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
          facebook_id TEXT
        );
      `);

      // Create an admin user
      const hashedPassword = 'fcf0872ea0a0c91f3d8e64dc5005c9b6a36371eddc6c1127a3c0b45c71db5b72f85c5e93b80993ec37c6aff8b08d07b68e9c58f28e3bd20d9d2a4eb38992aad0.ef32a41b7d478668'; // localcooks
      await pool.query(`
        INSERT INTO users (username, password, role)
        VALUES ('admin', $1, 'admin')
        ON CONFLICT (username) DO NOTHING;
      `, [hashedPassword]);

      console.log('Database initialized successfully');
    }
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Initialize DB tables if needed
if (pool) {
  initializeDatabase().catch(console.error);
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
ensureAdminUser().catch(console.error);

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
app.post('/api/applications', async (req, res) => {
  console.log('Application submission attempt');
  console.log('Session ID:', req.session.id);
  console.log('Cookie:', req.headers.cookie);
  console.log('Headers:', req.headers);
  console.log('Session data:', {
    userId: req.session.userId,
    user: req.session.user ? { id: req.session.user.id, username: req.session.user.username } : null
  });
  console.log('Request body (first field):', req.body ? req.body.fullName : 'No data');

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

    // Validate required fields
    const { fullName, email, phone, foodSafetyLicense, foodEstablishmentCert, kitchenPreference } = req.body;

    if (!fullName || !email || !phone || !foodSafetyLicense || !foodEstablishmentCert || !kitchenPreference) {
      console.log('Missing required fields in request');
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide all required application information'
      });
    }

    // Store in database if available
    if (pool) {
      try {
        // Create application table if it doesn't exist
        const tableCheck = await pool.query(`
          SELECT to_regclass('public.applications') as table_exists;
        `);

        if (!tableCheck.rows[0].table_exists) {
          // Create enums if they don't exist
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
              status application_status NOT NULL DEFAULT 'new',
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
          `);
        }

        // Make sure the user exists
        const userCheckQuery = await pool.query(`
          SELECT id FROM users WHERE id = $1
        `, [userId]);

        if (userCheckQuery.rows.length === 0) {
          console.log(`User with ID ${userId} not found in database`);
          return res.status(400).json({ error: 'User not found. Please register or log in again.' });
        }

        console.log(`User with ID ${userId} verified in database, proceeding with application insertion`);

        // Insert application
        const result = await pool.query(`
          INSERT INTO applications
          (user_id, full_name, email, phone, food_safety_license, food_establishment_cert, kitchen_preference, feedback)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *;
        `, [
          userId, // Use the userId from session or header
          fullName,
          email,
          phone,
          foodSafetyLicense,
          foodEstablishmentCert,
          kitchenPreference,
          req.body.feedback || null // Include feedback field, default to null if not provided
        ]);

        const createdApplication = result.rows[0];

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
      createdAt: new Date().toISOString()
    };

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

      const result = await pool.query(`
        SELECT a.*, u.username as applicant_username
        FROM applications a
        JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC;
      `);

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

      const result = await pool.query(`
        SELECT * FROM applications
        WHERE user_id = $1
        ORDER BY created_at DESC;
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

      return res.status(200).json(result.rows[0]);
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

export default app;