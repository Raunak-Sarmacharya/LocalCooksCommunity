export type ApprovalDocumentField = 'foodSafetyLicenseStatus' | 'foodEstablishmentCertStatus';

export function approvalDocumentUpdates(application: {
    foodSafetyLicenseUrl?: string | null;
    foodSafetyLicenseExpiry?: string | null;
    foodSafetyLicenseStatus?: string | null;
    foodEstablishmentCertUrl?: string | null;
    foodEstablishmentCertExpiry?: string | null;
    foodEstablishmentCertStatus?: string | null;
}, fields: unknown): Partial<Record<ApprovalDocumentField, 'approved'>> {
    if (fields === undefined) return {};
    const allowed: ApprovalDocumentField[] = ['foodSafetyLicenseStatus', 'foodEstablishmentCertStatus'];
    if (!Array.isArray(fields) || !fields.length || fields.some(field => !allowed.includes(field)) || new Set(fields).size !== fields.length) {
        throw new Error('Choose valid documents to verify before approval.');
    }
    const updates: Partial<Record<ApprovalDocumentField, 'approved'>> = {};
    for (const field of fields as ApprovalDocumentField[]) {
        const safety = field === 'foodSafetyLicenseStatus';
        const url = safety ? application.foodSafetyLicenseUrl : application.foodEstablishmentCertUrl;
        const expiry = safety ? application.foodSafetyLicenseExpiry : application.foodEstablishmentCertExpiry;
        const status = safety ? application.foodSafetyLicenseStatus : application.foodEstablishmentCertStatus;
        const label = safety ? 'Food Safety Certificate' : 'Food Establishment Licence';
        if (!url) throw new Error(`${label} is not on file.`);
        if (status === 'rejected') throw new Error(`${label} needs a replacement before approval.`);
        if (safety && (!expiry || !Number.isFinite(Date.parse(expiry)))) throw new Error(`${label} needs a valid expiry date.`);
        if (expiry && Date.parse(expiry) < Date.now() - 86400000) throw new Error(`${label} has expired.`);
        updates[field] = 'approved';
    }
    return updates;
}
