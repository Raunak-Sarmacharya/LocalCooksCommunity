import { describe, expect, it } from 'vitest';
import { accessDocumentDaysLeft, accessDocuments, accessDocumentStage, bookingRefusalBody, locationBookingEligibility, requiredAccessDocuments, usesRenewalSlot } from './location-booking-eligibility';

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
  // Owner, Oct 23: per document Not needed / Track it / Required; insurance is a dated document; the kitchen can waive.
  it('a tracked document never pauses booking, a required one does', () => {
    const expired = { foodEstablishmentCertUrl: '/licence.pdf', foodEstablishmentCertStatus: 'approved', foodEstablishmentCertExpiry: '2020-01-01' };
    expect(eligible(expired, true, { food_establishment_cert_tracked: true }).canBook).toBe(true);
    expect(eligible(expired, true, { tier2_food_establishment_cert_required: true }).canBook).toBe(false);
    expect(accessDocuments({ ...app, ...expired }, { food_establishment_cert_tracked: true }).map(doc => [doc.key, doc.mode]))
      .toEqual([['foodSafetyLicense', 'required'], ['foodEstablishmentCert', 'track']]);
  });
  it('says why a document blocks booking, so the chef gets the right next step', () => {
    const house = { tier2_custom_fields: [{ id: 'rules', label: 'Signed house rules', type: 'file', document: true, required: true }] };
    const rules = (data: object) => ({ tier_data: { tier2_custom_fields_data: { rules: '/rules.pdf' }, ...data } });
    expect(eligible({}, true, house).document).toMatchObject({ label: 'Signed house rules', reason: 'missing' });
    expect(eligible(rules({}), true, house).document).toMatchObject({ reason: 'pending' });
    expect(eligible(rules({ customDocumentStatus: { rules: 'rejected' } }), true, house).document).toMatchObject({ reason: 'rejected' });
    expect(eligible({ foodSafetyLicenseExpiry: null }).document).toMatchObject({ key: 'foodSafetyLicense', reason: 'needs_expiry' });
  });
  it('required insurance needs an approved, unexpired document', () => {
    const requirements = { tier2_insurance_document_required: true };
    expect(eligible({}, true, requirements)).toMatchObject({ canBook: false, status: 'document_review_required', document: { key: 'insurance' } });
    expect(eligible({ insuranceUrl: '/ins.pdf', insuranceStatus: 'approved', insuranceExpiry: '2027-01-01' }, true, requirements).canBook).toBe(true);
    expect(eligible({ insuranceUrl: '/ins.pdf', insuranceStatus: 'approved', insuranceExpiry: '2026-10-14' }, true, requirements)).toMatchObject({ canBook: false, status: 'document_expired' });
    expect(usesRenewalSlot({ ...app, insuranceUrl: '/ins.pdf', insuranceStatus: 'approved' }, 'insurance')).toBe(true);
  });
  it('a kitchen waiver lets the customer book with documents missing or expired; ending it pauses again', () => {
    const requirements = { tier2_insurance_document_required: true, tier2_food_establishment_cert_required: true };
    const missing = { foodSafetyLicenseUrl: null, foodSafetyLicenseExpiry: null };
    expect(eligible({ ...missing, documentsWaivedAt: '2026-10-13T10:00:00Z' }, true, requirements).canBook).toBe(true);
    expect(eligible({ ...missing, documentsWaivedAt: null }, true, requirements).canBook).toBe(false);
    expect(requiredAccessDocuments({ ...app, documentsWaivedAt: new Date() }, requirements)).toEqual([]);
    // Still tracked and shown (and reminded once uploaded) while waived.
    expect(accessDocuments({ ...app, documentsWaivedAt: new Date() }, requirements).map(doc => doc.key)).toEqual(['foodSafetyLicense', 'foodEstablishmentCert', 'insurance']);
  });
  it.each(['2026-02-30', 'not-a-date', '', '2026-99-99'])('fails closed for invalid expiry %s', foodSafetyLicenseExpiry => { expect(eligible({ foodSafetyLicenseExpiry }).canBook).toBe(false); });
  it('uses the location calendar at a UTC date boundary', () => {
    expect(accessDocumentDaysLeft('2026-10-14', 'America/St_Johns', new Date('2026-10-14T01:00:00Z'))).toBe(1);
  });
  // Food Corridor's schedule (owner, Oct 23): 45, 14 and 3 days before, and on the day.
  it.each([['2026-11-29', null], ['2026-11-28', '45_day'], ['2026-10-29', '45_day'], ['2026-10-28', '14_day'], ['2026-10-18', '14_day'], ['2026-10-17', '3_day'], ['2026-10-14', 'expired'], ['2026-10-13', 'expired']] as const)('cadence for %s is %s', (expiry, stage) => {
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

// Owner, Oct 24: the documents a kitchen adds are tracked like the built-in three; expiry is optional.
describe('custom documents', () => {
  const fields = [
    { id: 'lic', label: 'Business licence', type: 'file', required: true, document: true, expires: true },
    { id: 'menu', label: 'Signed house rules', type: 'file', required: true, document: true, expires: false },
    { id: 'q', label: 'What will you cook?', type: 'text', required: true },
  ];
  const withDocs = (data: Record<string, unknown>, status: Record<string, string> = {}) =>
    ({ ...app, tier_data: { tier2_custom_fields_data: data, customDocumentStatus: status } });
  const check = (data: Record<string, unknown>, status: Record<string, string> = {}) =>
    locationBookingEligibility(withDocs(data, status), true, { tier2_custom_fields: fields }, 47, 'America/St_Johns', now);
  it('lists only documents, with their expiry choice, and never questions', () => {
    expect(accessDocuments(withDocs({}), { tier2_custom_fields: fields }).map(doc => [doc.key, doc.mode, doc.hasExpiry]))
      .toEqual([['foodSafetyLicense', 'required', true], ['custom:lic', 'required', true], ['custom:menu', 'required', false]]);
  });
  it('a missing required document pauses new bookings and says which one', () => {
    expect(check({ menu: '/rules.pdf' }, { menu: 'approved' })).toMatchObject({ canBook: false, document: { key: 'custom:lic', label: 'Business licence' } });
  });
  it('a dated one needs approval and a future date; an undated one needs approval only', () => {
    const files = { lic: '/lic.pdf', lic__expiry: '2027-03-01', menu: '/rules.pdf' };
    expect(check(files).canBook).toBe(false);
    expect(check(files, { lic: 'approved', menu: 'approved' }).canBook).toBe(true);
    expect(check({ ...files, lic__expiry: '2026-10-14' }, { lic: 'approved', menu: 'approved' })).toMatchObject({ canBook: false, status: 'document_expired' });
    expect(check(files, { lic: 'approved', menu: 'rejected' }).message).toMatch(/new copy of your Signed house rules/);
  });
  it('an undated document never uses a renewal slot', () => {
    expect(usesRenewalSlot(withDocs({ menu: '/rules.pdf' }, { menu: 'approved' }), 'custom:menu', false)).toBe(false);
    expect(usesRenewalSlot(withDocs({ lic: '/lic.pdf', lic__expiry: '2027-03-01' }, { lic: 'approved' }), 'custom:lic')).toBe(true);
  });
});
