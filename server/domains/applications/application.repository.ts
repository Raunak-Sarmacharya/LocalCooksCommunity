
import { db } from "../../db";
import { applications, Application, InsertApplication, UpdateApplicationStatus, UpdateApplicationDocuments, UpdateDocumentVerification } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { CreateApplicationDTO, VerifyDocumentsDTO } from "./application.types";

export class ApplicationRepository {
  async getAll(): Promise<Application[]> {
    return db.select().from(applications).orderBy(desc(applications.createdAt));
  }

  async findById(id: number): Promise<Application | null> {
    const [application] = await db.select().from(applications).where(eq(applications.id, id));
    return application || null;
  }

  async findByUserId(userId: number): Promise<Application[]> {
    return db.select().from(applications).where(eq(applications.userId, userId)).orderBy(desc(applications.createdAt));
  }

  async create(data: CreateApplicationDTO): Promise<Application> {
    const now = new Date();
    const [application] = await db
      .insert(applications)
      .values({
        ...data,
        status: "inReview",
        createdAt: now,
        foodSafetyLicenseStatus: data.foodSafetyLicenseUrl ? "pending" : "pending", // Default
        foodEstablishmentCertStatus: data.foodEstablishmentCertUrl ? "pending" : "pending", // Default
      } as any) // Type cast needed because InsertApplication might not match DTO perfectly
      .returning();
    return application;
  }

  async updateStatus(id: number, status: string): Promise<Application | null> {
    const [updated] = await db
      .update(applications)
      .set({ status } as any)
      .where(eq(applications.id, id))
      .returning();
    return updated || null;
  }

  async updateDocuments(id: number, updates: Partial<UpdateApplicationDocuments>): Promise<Application | null> {
    const resetStatus: any = {};
    if (updates.foodSafetyLicenseUrl) resetStatus.foodSafetyLicenseStatus = "pending";
    if (updates.foodEstablishmentCertUrl) resetStatus.foodEstablishmentCertStatus = "pending";

    const [updated] = await db
      .update(applications)
      .set({
        ...updates,
        ...resetStatus
      } as any)
      .where(eq(applications.id, id))
      .returning();
    return updated || null;
  }

  async verifyDocuments(data: VerifyDocumentsDTO): Promise<Application | null> {
    const [updated] = await db
      .update(applications)
      .set({
        foodSafetyLicenseStatus: data.foodSafetyLicenseStatus,
        foodEstablishmentCertStatus: data.foodEstablishmentCertStatus,
        documentsAdminFeedback: data.documentsAdminFeedback,
        documentsReviewedBy: data.documentsReviewedBy,
        documentsReviewedAt: new Date(),
      } as any)
      .where(eq(applications.id, data.id))
      .returning();
    return updated || null;
  }
}
