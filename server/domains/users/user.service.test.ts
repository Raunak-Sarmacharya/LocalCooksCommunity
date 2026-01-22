/**
 * User Service Tests
 * 
 * Unit tests for UserService and UserRepository.
 */

import { UserService } from '../user.service';
import { UserRepository } from '../user.repository';
import type { CreateUserDTO, UpdateUserDTO } from '../user.types';

describe('UserService', () => {
  let userService: UserService;
  let userRepo: UserRepository;

  beforeEach(() => {
    userRepo = new UserRepository();
    userService = new UserService(userRepo);
  });

  describe('createUser', () => {
    it('should create a user with valid data', async () => {
      const dto: CreateUserDTO = {
        username: 'testuser',
        password: 'password123',
        role: 'chef',
        firebaseUid: 'firebase-uid-123',
      };

      const user = await userService.createUser(dto);
      
      expect(user).toBeDefined();
      expect(user.username).toBe('testuser');
      expect(user.is_chef).toBe(false);
      expect(user.is_manager).toBe(false);
    });

    it('should throw error if username is too short', async () => {
      const dto: CreateUserDTO = {
        username: 'ab',
        password: 'password123',
      };

      await expect(userService.createUser(dto)).rejects.toThrow();
    });

    it('should throw error if username already exists', async () => {
      const existingDto: CreateUserDTO = {
        username: 'existinguser',
        password: 'password123',
      };

      await userService.createUser(existingDto);

      const duplicateDto: CreateUserDTO = {
        username: 'existinguser',
        password: 'password456',
      };

      await expect(userService.createUser(duplicateDto)).rejects.toThrow();
    });

    it('should throw error if Firebase UID already exists', async () => {
      const existingDto: CreateUserDTO = {
        username: 'user1',
        password: 'password123',
        firebaseUid: 'firebase-uid-existing',
      };

      await userService.createUser(existingDto);

      const duplicateDto: CreateUserDTO = {
        username: 'user2',
        password: 'password456',
        firebaseUid: 'firebase-uid-existing',
      };

      await expect(userService.createUser(duplicateDto)).rejects.toThrow();
    });
  });

  describe('updateUser', () => {
    it('should update user with valid data', async () => {
      const updateDto: UpdateUserDTO = {
        id: 1,
        username: 'updateduser',
        isChef: true,
      };

      const user = await userService.updateUser(updateDto);
      
      expect(user).toBeDefined();
      expect(user.username).toBe('updateduser');
      expect(user.is_chef).toBe(true);
    });

    it('should throw error if user does not exist', async () => {
      const updateDto: UpdateUserDTO = {
        id: 999,
        username: 'nonexistent',
      };

      await expect(userService.updateUser(updateDto)).rejects.toThrow();
    });

    it('should throw error if username is taken by another user', async () => {
      const existingDto: CreateUserDTO = {
        username: 'takenuser',
        password: 'password123',
      };

      await userService.createUser(existingDto);

      const updateDto: UpdateUserDTO = {
        id: 1,
        username: 'takenuser',
      };

      await expect(userService.updateUser(updateDto)).rejects.toThrow();
    });
  });

  describe('getCompleteProfile', () => {
    it('should return complete profile with user data', async () => {
      const profile = await userService.getCompleteProfile(1);
      
      expect(profile).toBeDefined();
      expect(profile.id).toBe(1);
      expect(profile.username).toBeDefined();
    });

    it('should throw error if user does not exist', async () => {
      await expect(userService.getCompleteProfile(999)).rejects.toThrow();
    });
  });

  describe('getAllManagers', () => {
    it('should return all managers', async () => {
      const managers = await userService.getAllManagers();
      
      expect(Array.isArray(managers)).toBe(true);
    });
  });

  describe('getAllChefs', () => {
    it('should return all chefs', async () => {
      const chefs = await userService.getAllChefs();
      
      expect(Array.isArray(chefs)).toBe(true);
    });
  });
});
