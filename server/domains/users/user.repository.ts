import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/schema";
import { User, CreateUserDTO, UpdateUserDTO } from "./user.types";

export class UserRepository {
  async findById(id: number): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const normalizedUsername = username.trim().toLowerCase();
    const [user] = await db.select().from(users).where(sql`lower(${users.username}) = ${normalizedUsername}`);
    return user || null;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
    return user || null;
  }

  /**
   * Resolves the account that owns an in-flight email confirmation token.
   * The raw token never reaches the database — only its SHA-256 digest does.
   */
  async findByPendingEmailTokenHash(tokenHash: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.pendingEmailTokenHash, tokenHash))
      .limit(1);
    return user || null;
  }

  async usernameExists(username: string): Promise<boolean> {
    const normalizedUsername = username.trim().toLowerCase();
    const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${normalizedUsername}`).limit(1);
    return !!user;
  }



  async create(data: CreateUserDTO): Promise<User> {
    // Security: Provide a secure placeholder password for Firebase Auth users
    // who don't have a Neon password (satisfies DB NOT NULL constraint)
    const valuesToInsert = {
      ...data,
      password: data.password || `firebase_auth_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };
    const [user] = await db.insert(users).values(valuesToInsert).returning();
    return user;
  }

  async update(id: number, data: UpdateUserDTO): Promise<User | null> {
    const [updated] = await db
      .update(users)
      .set(data as any)
      .where(eq(users.id, id))
      .returning();
    return updated || null;
  }

  /**
   * Atomically consumes an email confirmation token: the row is only updated
   * while the digest still matches, so a double-click on a link (or a replayed
   * request) cannot run the email change twice. Returns null when another
   * request already claimed it.
   */
  async consumePendingEmailToken(
    userId: number,
    tokenHash: string,
    data: UpdateUserDTO
  ): Promise<User | null> {
    const [updated] = await db
      .update(users)
      .set(data as any)
      .where(and(eq(users.id, userId), eq(users.pendingEmailTokenHash, tokenHash)))
      .returning();
    return updated || null;
  }

  async delete(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}
