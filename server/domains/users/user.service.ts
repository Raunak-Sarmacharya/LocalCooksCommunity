import { UserRepository } from "./user.repository";
import { CreateUserDTO, UpdateUserDTO, User } from "./user.types";
import { locations, users } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../passwordUtils";
import { DomainError, UserErrorCodes } from "../../shared/errors/domain-error";

export class UserService {
  private repo: UserRepository;

  constructor(repo?: UserRepository) {
    this.repo = repo || new UserRepository();
  }

  async checkUsernameExists(username: string): Promise<boolean> {
    const user = await this.repo.findByUsername(username);
    return !!user;
  }

  async getUser(id: number): Promise<User | null> {
    return this.repo.findById(id);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return this.repo.findByUsername(username);
  }

  async getUserByFirebaseUid(uid: string): Promise<User | null> {
    return this.repo.findByFirebaseUid(uid);
  }



  async createUser(data: CreateUserDTO): Promise<User> {
    if (!data.username) {
      throw new Error("Username is required");
    }

    const exists = await this.repo.usernameExists(data.username);
    if (exists) {
      throw new DomainError(
        UserErrorCodes.USERNAME_TAKEN,
        `Username ${data.username} is already taken`,
        409
      );
    }

    // Ensure default values match legacy behavior
    const userToCreate = {
      ...data,
      password: data.password || '',
      isVerified: data.isVerified ?? false,
      has_seen_welcome: data.has_seen_welcome ?? false,
      isChef: data.isChef ?? false,
      isManager: data.isManager ?? false,
      isPortalUser: (data as any).isPortalUser ?? false,
    };

    return this.repo.create(userToCreate);
  }

  async updateUser(id: number, data: UpdateUserDTO): Promise<User | null> {
    return this.repo.update(id, data);
  }

  async updateUserFirebaseUid(id: number, firebaseUid: string): Promise<User | null> {
    const user = await this.repo.findById(id);
    if (user && user.firebaseUid) {
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        "User already has a linked Firebase account",
        400
      );
    }
    return this.repo.update(id, { firebaseUid });
  }

  async setHasSeenWelcome(id: number): Promise<void> {
    await this.repo.update(id, { has_seen_welcome: true });
  }



  async updateUserRoles(id: number, roles: { isChef: boolean }): Promise<void> {
    const mainRole = roles.isChef ? 'chef' : undefined;

    const updateData: UpdateUserDTO = {
      isChef: roles.isChef
    };

    if (mainRole) {
      updateData.role = mainRole;
    } else {
      // If mainRole is undefined/null logic in legacy code:
      // const mainRole = roles.isChef ? 'chef' : null;
      // set({ ... role: mainRole })
      // So we should set it to null or whatever legacy allowed.
      // But user.types UpdateUserDTO role is string.
      // Let's check logic: if isChef is false, mainRole is null.
      // db.update... role: null.
      // Type error might happen if I pass null to string field?
      // user.types defines role?: string. 
      // I will use `any` cast in Repo if needed, but here let's pass null if DTO allows.
      // UpdateUserDTO role? is string.
      // I'll update DTO to allow null if needed, or just cast here.
      // Actually, let's keep it clean.
      (updateData as any).role = roles.isChef ? 'chef' : null;
    }

    await this.repo.update(id, updateData);
  }

  async getCompleteProfile(id: number): Promise<any> {
    const user = await this.repo.findById(id);
    if (!user) {
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        `User not found: ${id}`,
        404
      );
    }

    return {
      ...user,
      firebaseUser: {
        uid: user.firebaseUid,
        email: user.username, // Assuming username is email
        emailVerified: user.isVerified
      }
    };
  }

  async resetPassword(firebaseUid: string, newPassword: string): Promise<void> {
    const user = await this.repo.findByFirebaseUid(firebaseUid);
    if (!user) {
      throw new Error(`User not found for firebaseUid: ${firebaseUid}`);
    }
    const hashedPassword = await hashPassword(newPassword);
    await this.repo.update(user.id, { password: hashedPassword });
  }

  async verifyUser(id: number, isVerified: boolean): Promise<User | null> {
    return this.repo.update(id, { isVerified });
  }

  async markWelcomeSeen(id: number): Promise<void> {
    await this.repo.update(id, { has_seen_welcome: true });
  }

  async deleteUser(id: number): Promise<void> {
    // Transactional delete ensuring referential integrity with locations
    await db.transaction(async (tx) => {
      // Remove manager assignment from locations
      const managedLocations = await tx.select().from(locations).where(eq(locations.managerId, id));
      if (managedLocations.length > 0) {
        await tx.update(locations).set({ managerId: null }).where(eq(locations.managerId, id));
        console.log(`Removed manager ${id} from ${managedLocations.length} locations`);
      }

      // Delete the user
      await tx.delete(users).where(eq(users.id, id));
      console.log(`Deleted user ${id}`);
    });
  }
}

export const userService = new UserService();
