import { pool } from './index.js';

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
      // Search by username or email from both users table and applications table
      query = `
        SELECT DISTINCT 
          u.id,
          u.username,
          COALESCE(a.email, u.username) as email,
          COALESCE(a.full_name, u.username) as full_name,
          u.role
        FROM users u
        LEFT JOIN applications a ON u.id = a.user_id
        WHERE 
          LOWER(u.username) LIKE LOWER($1) OR 
          LOWER(COALESCE(a.email, '')) LIKE LOWER($1) OR
          LOWER(COALESCE(a.full_name, '')) LIKE LOWER($1)
        ORDER BY u.username
        LIMIT 20
      `;
      params = [`%${search.trim()}%`];
    } else {
      // Return all users with their email info
      query = `
        SELECT DISTINCT 
          u.id,
          u.username,
          COALESCE(a.email, u.username) as email,
          COALESCE(a.full_name, u.username) as full_name,
          u.role
        FROM users u
        LEFT JOIN applications a ON u.id = a.user_id
        ORDER BY u.username
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