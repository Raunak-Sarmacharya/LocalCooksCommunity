import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/schema";
import { User, CreateUserDTO, UpdateUserDTO } from "./user.types";

export class UserRepository {
  async findById(id: number): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || null;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
    return user || null;
  }

  async usernameExists(username: string): Promise<boolean> {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    return !!user;
  }



  async create(data: CreateUserDTO): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
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

  async delete(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}
