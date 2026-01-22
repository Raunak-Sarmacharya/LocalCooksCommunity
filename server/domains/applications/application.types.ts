
import { Application, InsertApplication, UpdateApplicationStatus, UpdateApplicationDocuments, UpdateDocumentVerification } from "@shared/schema";

export interface CreateApplicationDTO extends Omit<InsertApplication, "id" | "status" | "createdAt" | "documentsReviewedAt" | "documentsReviewedBy" | "documentsAdminFeedback" | "foodSafetyLicenseStatus" | "foodEstablishmentCertStatus"> {
  foodSafetyLicenseUrl?: string;
  foodEstablishmentCertUrl?: string;
}

export interface UpdateApplicationStatusDTO {
  status: string;
}

export type ApplicationDTO = Application;

export interface VerifyDocumentsDTO {
  id: number;
  foodSafetyLicenseStatus?: string;
  foodEstablishmentCertStatus?: string;
  documentsAdminFeedback?: string | null;
  documentsReviewedBy: number;
}
