// Simple, standalone API implementation for Vercel 
import { Pool } from '@neondatabase/serverless';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import express from 'express';
import session from 'express-session';
import { promisify } from 'util';

// Setup
const app = express();
const scryptAsync = promisify(scrypt);

// Database connection
let pool;
try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      max: 1
    });
    console.log('Connected to database');
  } else {
    console.log('DATABASE_URL not provided, using in-memory storage');
  }
} catch (error) {
  console.error('Database connection error:', error);
}

// In-memory fallback
const users = new Map();
const sessions = new Map();

// Middleware
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

// Session setup
const sessionSecret = process.env.SESSION_SECRET || 'local-cooks-dev-secret';
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Helper functions
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(password, salt, 64);
  return `${buf.toString('hex')}.${salt}`;
}

async function comparePasswords(supplied, stored) {
  const [hashed, salt] = stored.split('.');
  const hashedBuf = Buffer.from(hashed, 'hex');
  const suppliedBuf = await scryptAsync(supplied, salt, 64);
  return timingSafeEqual(hashedBuf, suppliedBuf);
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
  return users.get(id);
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
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const passwordMatch = await comparePasswords(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = user;
    
    // Log in the user
    req.session.userId = user.id;
    res.status(200).json(userWithoutPassword);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
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
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const user = await getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Remove password before sending to client
    const { password: _, ...userWithoutPassword } = user;
    res.status(200).json(userWithoutPassword);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  
  if (pool) {
    try {
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch (error) {
      dbStatus = `error: ${error.message}`;
    }
  }
  
  res.status(200).json({ 
    status: 'ok', 
    dbStatus,
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'not set',
      SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'not set',
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Export for serverless use
export default app;