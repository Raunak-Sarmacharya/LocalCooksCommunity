import { db } from '../server/db';
import { users } from '../shared/schema';
import { eq } from 'drizzle-orm';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { username } = req.query;
  if (!username) {
    res.status(400).json({ error: 'Username required' });
    return;
  }
  try {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    res.status(200).json({ exists: !!user });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
} 