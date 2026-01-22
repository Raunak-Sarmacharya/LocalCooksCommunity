/**
 * Application Domain Types
 * 
 * Data Transfer Objects for clean separation between layers.
 */

/**
 * Application DTO for creating a new application
 */
export interface CreateApplicationDTO {
  userId: number;
  fullName: string;
  email: string;
  phone: string;
  foodSafetyLicense: 'yes' | 'no' | 'notSure';
  foodEstablishmentCert: 'yes' | 'no' | 'notSure';
  kitchenPreference: 'commercial' | 'home' | 'notSure';
  foodSafetyLicenseUrl?: string;
  foodEstablishmentCertUrl?: string;
  feedback?: string;
}

/**
 * Application DTO for updating an existing application
 */
export interface UpdateApplicationDTO {
  id: number;
  fullName?: string;
  email?: string;
  phone?: string;
  foodSafetyLicense?: 'yes' | 'no' | 'notSure';
  foodEstablishmentCert?: 'yes' | 'no' | 'notSure';
  kitchenPreference?: 'commercial' | 'home' | 'notSure';
  feedback?: string;
}

/**
 * Application DTO for document verification updates
 */
export interface VerifyDocumentsDTO {
  id: number;
  foodSafetyLicenseStatus: 'pending' | 'approved' | 'rejected' | 'expired';
  foodEstablishmentCertStatus: 'pending' | 'approved' | 'rejected' | 'expired';
  documentsAdminFeedback?: string;
  documentsReviewedBy: number;
}

/**
 * Application DTO for reading application data
 */
export interface ApplicationDTO {
  id: number;
  userId: number;
  fullName: string;
  email: string;
  phone: string;
  foodSafetyLicense: 'yes' | 'no' | 'notSure';
  foodEstablishmentCert: 'yes' | 'no' | 'notSure';
  kitchenPreference: 'commercial' | 'home' | 'notSure';
  status: 'inReview' | 'approved' | 'rejected' | 'cancelled';
  feedback?: string;
  foodSafetyLicenseUrl?: string;
  foodEstablishmentCertUrl?: string;
  foodSafetyLicenseStatus: 'pending' | 'approved' | 'rejected' | 'expired';
  foodEstablishmentCertStatus: 'pending' | 'approved' | 'rejected' | 'expired';
  documentsAdminFeedback?: string;
  documentsReviewedBy?: number;
  documentsReviewedAt?: Date;
  createdAt: Date;
}

/**
 * Application DTO with user data included
 */
export interface ApplicationWithUserDTO extends ApplicationDTO {
  user?: {
    id: number;
    username: string;
    email?: string;
    role?: 'admin' | 'chef' | 'manager' | null;
    isVerified: boolean;
    isChef: boolean;
    isManager: boolean;
    stripeConnectAccountId?: string;
  };
}
