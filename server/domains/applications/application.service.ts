
import { ApplicationRepository } from "./application.repository";
import { CreateApplicationDTO, ApplicationDTO, VerifyDocumentsDTO } from "./application.types";
import { DomainError, ApplicationErrorCodes } from "../../shared/errors/domain-error";

export class ApplicationService {
  private repo: ApplicationRepository;

  constructor(repo?: ApplicationRepository) {
    this.repo = repo || new ApplicationRepository();
  }

  async getAllApplications(): Promise<ApplicationDTO[]> {
    return this.repo.getAll();
  }

  async getApplicationById(id: number): Promise<ApplicationDTO> {
    const app = await this.repo.findById(id);
    if (!app) {
      throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
    }
    return app;
  }

  async getApplicationsByUserId(userId: number): Promise<ApplicationDTO[]> {
    return this.repo.findByUserId(userId);
  }

  async submitApplication(data: CreateApplicationDTO): Promise<ApplicationDTO> {
    if (!data.userId) {
      throw new DomainError(ApplicationErrorCodes.VALIDATION_ERROR, "User ID is required", 400);
    }
    const hasPending = await this.repo.hasPendingApplication(data.userId);
    if (hasPending) {
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        "You already have a pending application. Please wait for it to be processed.",
        409
      );
    }
    return this.repo.create(data);
  }

  async approveApplication(id: number, adminId: number): Promise<ApplicationDTO> {
    const app = await this.repo.findById(id);
    if (!app) {
      throw new DomainError(ApplicationErrorCodes.APPLICATION_NOT_FOUND, `Application ${id} not found`, 404);
    }
    if (app.status !== "inReview") {
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        `Application is already processed (Status: ${app.status})`,
        400
      );
    }

    const updated = await this.repo.updateStatus(id, "approved");
    if (!updated) throw new Error("Failed to approve application");
    return updated;
  }

  async updateStatus(id: number, status: string): Promise<ApplicationDTO> {
    const app = await this.repo.updateStatus(id, status);
    if (!app) {
      throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
    }
    return app;
  }

  async updateDocuments(id: number, updates: any): Promise<ApplicationDTO> {
    const app = await this.repo.updateDocuments(id, updates);
    if (!app) {
      throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
    }
    return app;
  }

  async cancelApplication(id: number, userId: number): Promise<ApplicationDTO> {
    const app = await this.repo.findById(id);
    if (!app) {
      throw new DomainError("APPLICATION_NOT_FOUND", `Application ${id} not found`, 404);
    }
    if (app.userId !== userId) {
      throw new DomainError("FORBIDDEN", "You can only cancel your own applications", 403);
    }

    // Actually update status to 'cancelled'
    const updated = await this.repo.updateStatus(id, 'cancelled');
    if (!updated) throw new Error("Failed to cancel application");
    return updated;
  }

  async verifyDocuments(data: VerifyDocumentsDTO): Promise<ApplicationDTO> {
    const app = await this.repo.verifyDocuments(data);
    if (!app) {
      throw new DomainError("APPLICATION_NOT_FOUND", `Application ${data.id} not found`, 404);
    }
    return app;
  }
}

export const applicationService = new ApplicationService();
