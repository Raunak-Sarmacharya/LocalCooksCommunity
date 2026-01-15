/**
 * @deprecated This file is deprecated and will be removed in a future version.
 * The get-users functionality has been moved to server/routes.ts as part of the unified entry point.
 * All API requests now route through api/index.js (bundled from server/index.ts).
 * 
 * This file is kept temporarily for backward compatibility but should not be used.
 * The route is now available at: GET /api/get-users (handled by server/routes.ts)
 */
import { Pool } from '@neondatabase/serverless';

// Create database connection
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1, // Limit connections for serverless
  });
}

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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
}