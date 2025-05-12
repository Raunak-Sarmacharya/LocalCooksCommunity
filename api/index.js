// This file is used as the serverless entry point for Vercel
import express from 'express';
import session from 'express-session';
import { createServer } from 'http';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

// Create a simplified version for the serverless function
const scryptAsync = promisify(scrypt);

// Simple in-memory storage
const users = new Map();
const sessions = new Map();

// Create a storage instance directly here for the serverless function
const storage = {
  sessionStore: {
    get: (sid, cb) => cb(null, sessions.get(sid)),
    set: (sid, sess, cb) => { sessions.set(sid, sess); cb(); },
    destroy: (sid, cb) => { sessions.delete(sid); cb(); },
  },
  
  getUser: async (id) => users.get(id),
  
  getUserByUsername: async (username) => {
    for (const user of users.values()) {
      if (user.username === username) return user;
    }
    return undefined;
  },
  
  createUser: async (userData) => {
    const id = Date.now();
    const user = { id, ...userData };
    users.set(id, user);
    return user;
  },
  
  // Other methods will be added as needed
};

// Initialize Express app
const app = express();

// Simple auth setup for serverless
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

// Add needed methods for auth to storage
storage.getUserByOAuthId = async () => undefined; // No OAuth in serverless version
storage.createOAuthUser = async () => undefined;  // No OAuth in serverless version
storage.getAllApplications = async () => [];
storage.getApplicationById = async () => undefined;
storage.getApplicationsByUserId = async () => [];
storage.createApplication = async (data) => ({...data, id: Date.now(), status: 'new', createdAt: new Date()});
storage.updateApplicationStatus = async () => undefined;

// Body parser middleware
app.use(express.json());

// Session configuration
const sessionSecret = process.env.SESSION_SECRET || 'local-cooks-secret-key';
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: storage.sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  }
}));

// Simple implementation of auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check if user exists
    const existingUser = await storage.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Create user with hashed password
    const hashedPassword = await hashPassword(password);
    const user = await storage.createUser({
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
    
    const user = await storage.getUserByUsername(username);
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
    const user = await storage.getUser(req.session.userId);
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

// Add application routes
app.post('/api/applications', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const application = await storage.createApplication({
      ...req.body,
      userId: req.session.userId
    });
    res.status(201).json(application);
  } catch (error) {
    console.error('Create application error:', error);
    res.status(500).json({ error: 'Failed to create application' });
  }
});

app.get('/api/applications/my-applications', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const applications = await storage.getApplicationsByUserId(req.session.userId);
    res.status(200).json(applications);
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

// Export for serverless use
export default app;