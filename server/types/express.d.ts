import { Request } from "express";

declare global {
  namespace Express {
    interface Request {
      firebaseUser?: {
        uid: string;
        email?: string;
        email_verified?: boolean;
      };
      neonUser?: {
        id: number;
        username: string;
        role: "admin" | "chef" | "manager" | null;
        firebaseUid?: string;
        isChef?: boolean;
        isManager?: boolean;
        isVerified?: boolean;
        has_seen_welcome?: boolean;
      };
    }
  }
}

export {};
