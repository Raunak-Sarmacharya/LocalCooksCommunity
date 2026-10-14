import { describe, expect, it } from 'vitest';
import { accessDocumentDaysLeft, accessDocumentStage, bookingRefusalBody, locationBookingEligibility, usesRenewalSlot } from './location-booking-eligibility';

const now = new Date('2026-10-14T12:00:00Z');
const app = { status: 'approved', current_tier: 3, foodSafetyLicenseUrl: '/certificate.pdf', foodSafetyLicenseStatus: 'approved', foodSafetyLicenseExpiry: '2027-10-14' };
const eligible = (changes = {}, access = true, requirements = {}) => locationBookingEligibility({ ...app, ...changes }, access, requirements, 47, 'America/St_Johns', now);
describe('location booking eligibility', () => {
  it('requires an access row even after final approval', () => { expect(eligible({}, false)).toMatchObject({ canBook: false, status: 'access_ended' }); });
  it.each(['rejected', 'cancelled', 'inReview'])('denies %s despite an access row', status => { expect(eligible({ status }).canBook).toBe(false); });
  it('does not accept tier 2, even with an access row', () => { expect(eligible({ current_tier: 2 })).toMatchObject({ canBook: false, status: 'awaiting_final_approval' }); });
  it('accepts final approval with access and valid reviewed documents', () => { expect(eligible().canBook).toBe(true); });
  it('blocks on expiry day and after expiry with a renewal link', () => {
    for (const expiry of ['2026-10-14', '2026-10-13']) expect(eligible({ foodSafetyLicenseExpiry: expiry })).toMatchObject({ canBook: false, status: 'document_expired', actionUrl: '/dashboard?view=kitchen-requests&renewLocation=47' });
  });
  it('keeps a renewed document blocked until it is reviewed', () => {
    expect(eligible({ foodSafetyLicenseStatus: 'pending' }).canBook).toBe(false);
    expect(eligible({ foodSafetyLicenseStatus: 'approved' }).canBook).toBe(true);
  });
  it('only gates documents required at this location', () => {
    expect(eligible({ foodSafetyLicenseExpiry: '2020-01-01' }, true, { requireFoodHandlerCert: false }).canBook).toBe(true);
    expect(eligible({ foodEstablishmentCertUrl: '/licence.pdf', foodEstablishmentCertStatus: 'approved', foodEstablishmentCertExpiry: '2020-01-01' }, true, { tier2_food_establishment_cert_required: true }).canBook).toBe(false);
  });
  it.each(['2026-02-30', 'not-a-date', '', '2026-99-99'])('fails closed for invalid expiry %s', foodSafetyLicenseExpiry => { expect(eligible({ foodSafetyLicenseExpiry }).canBook).toBe(false); });
  it('uses the location calendar at a UTC date boundary', () => {
    expect(accessDocumentDaysLeft('2026-10-14', 'America/St_Johns', new Date('2026-10-14T01:00:00Z'))).toBe(1);
  });
  it.each([['2026-11-14', null], ['2026-11-13', '30_day'], ['2026-10-21', '7_day'], ['2026-10-14', 'expired'], ['2026-10-13', 'expired']] as const)('cadence for %s is %s', (expiry, stage) => {
    expect(accessDocumentStage(expiry, 'America/St_Johns', now)).toBe(stage);
  });

  describe('renewal slot', () => {
    const withRenewals = (changes: object, renewals: any[]) => locationBookingEligibility({ ...app, ...changes }, true, {}, 47, 'America/St_Johns', now, renewals);
    it('keeps the current approved document valid while a renewal waits for review', () => {
      expect(withRenewals({ foodSafetyLicenseExpiry: '2026-11-03' }, [{ key: 'foodSafetyLicense', status: 'pending' }])).toMatchObject({ canBook: true, status: 'approved' });
    });
    it('blocks with "Your renewal is under review" only once the current document has expired', () => {
      const result = withRenewals({ foodSafetyLicenseExpiry: '2026-10-13' }, [{ key: 'foodSafetyLicense', status: 'pending' }]);
      expect(result).toMatchObject({ canBook: false, status: 'renewal_under_review', actionUrl: '/dashboard?view=kitchen-requests&renewLocation=47', document: { key: 'foodSafetyLicense', label: 'Food Safety Certificate' } });
      expect(result.message).toContain('Your renewal is under review');
    });
    it('names the expiry date and the last rejection reason when nothing is pending', () => {
      const result = withRenewals({ foodSafetyLicenseExpiry: '2026-10-13' }, [{ key: 'foodSafetyLicense', status: 'rejected', rejectionReason: 'The photo is blurry.' }]);
      expect(result).toMatchObject({ canBook: false, status: 'document_expired' });
      expect(result.message).toContain('expired on October 13, 2026');
      expect(result.message).toContain('The photo is blurry.');
    });
    it('treats a renewal for another document, or no renewals at all, as no renewal', () => {
      expect(withRenewals({ foodSafetyLicenseExpiry: '2026-10-13' }, [{ key: 'foodEstablishmentCert', status: 'pending' }]).status).toBe('document_expired');
      expect(withRenewals({ foodSafetyLicenseExpiry: '2026-10-13' }, []).status).toBe('document_expired');
    });
    it('does not let a renewal rescue a document that was never approved', () => {
      expect(withRenewals({ foodSafetyLicenseStatus: 'pending' }, [{ key: 'foodSafetyLicense', status: 'pending' }])).toMatchObject({ canBook: false, status: 'document_review_required' });
    });
    it('uses the renewal slot only when an approved document is already on file for a finally-approved application', () => {
      expect(usesRenewalSlot(app, 'foodSafetyLicense')).toBe(true);
      expect(usesRenewalSlot({ ...app, foodSafetyLicenseStatus: 'pending' }, 'foodSafetyLicense')).toBe(false);
      expect(usesRenewalSlot({ ...app, current_tier: 2 }, 'foodSafetyLicense')).toBe(false);
      expect(usesRenewalSlot({ ...app, foodSafetyLicenseUrl: null }, 'foodSafetyLicense')).toBe(false);
      expect(usesRenewalSlot(app, 'foodEstablishmentCert')).toBe(false);
    });
  });

  it('carries the eligibility status, message and action in every 403 body', () => {
    const body = bookingRefusalBody(eligible({ foodSafetyLicenseExpiry: '2026-10-13' }));
    expect(body).toMatchObject({ error: expect.stringContaining('expired'), applicationStatus: 'document_expired', hasApplication: true, actionUrl: '/dashboard?view=kitchen-requests&renewLocation=47',
      eligibility: { status: 'document_expired', actionUrl: '/dashboard?view=kitchen-requests&renewLocation=47', document: { key: 'foodSafetyLicense' } } });
  });
});
