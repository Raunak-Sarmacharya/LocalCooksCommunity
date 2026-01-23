export interface LocationData {
    id: number;
    name: string;
    address: string;
    managerId?: number;
    createdAt?: string;
    updatedAt?: string;
    kitchenLicenseUrl?: string;
    kitchenLicenseStatus?: string;
    kitchenLicenseApprovedBy?: number;
    kitchenLicenseApprovedAt?: string;
    kitchenLicenseFeedback?: string;
    logoUrl?: string;
    brandImageUrl?: string;
    notificationEmail?: string;
    notificationPhone?: string;
    timezone?: string;
    cancellationPolicyHours?: number;
    cancellationPolicyMessage?: string;
    defaultDailyBookingLimit?: number;
    minimumBookingWindowHours?: number;
}
