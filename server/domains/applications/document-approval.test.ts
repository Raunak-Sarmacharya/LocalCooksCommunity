import { describe, expect, it } from 'vitest';
import { approvalCustomDocumentStatus, approvalDocumentUpdates } from './document-approval';

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
        expect(() => approvalDocumentUpdates(submitted, ['businessLicenseStatus'])).toThrow('valid documents');
    });
});

describe('final approval and the kitchen\'s own documents', () => {
    const fields = [
        { id: 'lic', label: 'Business licence', required: true, document: true, expires: true },
        { id: 'rules', label: 'Signed house rules', required: false, document: true, expires: false },
        { id: 'q', label: 'Menu', type: 'text', required: true },
    ];
    const app = (data: Record<string, unknown>, status: Record<string, string> = {}) => ({ status: 'approved', tier_data: { tier2_custom_fields_data: data, customDocumentStatus: status } });
    it('approves each document waiting for review, and skips ones not sent', () => {
        expect(approvalCustomDocumentStatus(app({ lic: '/l.pdf', lic__expiry: '2099-01-01' }), { tier2_custom_fields: fields })).toEqual({ lic: 'approved' });
        expect(approvalCustomDocumentStatus(app({ rules: '/r.pdf' }, { rules: 'approved' }), { tier2_custom_fields: fields })).toEqual({});
    });
    it('blocks approval while one needs a new copy or has expired', () => {
        expect(() => approvalCustomDocumentStatus(app({ rules: '/r.pdf' }, { rules: 'rejected' }), { tier2_custom_fields: fields })).toThrow('needs a new copy');
        expect(() => approvalCustomDocumentStatus(app({ lic: '/l.pdf', lic__expiry: '2020-01-01' }), { tier2_custom_fields: fields })).toThrow('expired');
    });
});

describe('insurance in the final approval', () => {
    it('can be verified with the approval, and needs a current expiry', () => {
        const app = { insuranceUrl: '/ins.pdf', insuranceExpiry: '2099-01-01', insuranceStatus: 'pending' };
        expect(approvalDocumentUpdates(app, ['insuranceStatus'])).toEqual({ insuranceStatus: 'approved' });
        expect(() => approvalDocumentUpdates({ ...app, insuranceExpiry: null }, ['insuranceStatus'])).toThrow('expiry');
    });
});
