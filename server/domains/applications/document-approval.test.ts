import { describe, expect, it } from 'vitest';
import { approvalDocumentUpdates } from './document-approval';

describe('combined document verification and approval', () => {
    const submitted = {
        foodSafetyLicenseUrl: '/safety.pdf',
        foodSafetyLicenseExpiry: '2099-12-31',
        foodSafetyLicenseStatus: 'pending',
        foodEstablishmentCertUrl: '/establishment.pdf',
        foodEstablishmentCertStatus: 'pending',
    };

    it('prepares only explicitly reviewed uploaded documents', () => {
        expect(approvalDocumentUpdates(submitted, ['foodSafetyLicenseStatus'])).toEqual({ foodSafetyLicenseStatus: 'approved' });
    });

    it('refuses expired, rejected, and missing documents', () => {
        expect(() => approvalDocumentUpdates({ ...submitted, foodSafetyLicenseExpiry: '2020-01-01' }, ['foodSafetyLicenseStatus'])).toThrow('expired');
        expect(() => approvalDocumentUpdates({ ...submitted, foodSafetyLicenseStatus: 'rejected' }, ['foodSafetyLicenseStatus'])).toThrow('replacement');
        expect(() => approvalDocumentUpdates({ ...submitted, foodEstablishmentCertUrl: null }, ['foodEstablishmentCertStatus'])).toThrow('not on file');
    });

    it('refuses duplicate or unknown fields', () => {
        expect(() => approvalDocumentUpdates(submitted, ['foodSafetyLicenseStatus', 'foodSafetyLicenseStatus'])).toThrow('valid documents');
        expect(() => approvalDocumentUpdates(submitted, ['insuranceStatus'])).toThrow('valid documents');
    });
});
