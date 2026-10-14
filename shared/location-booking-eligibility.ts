import { daysUntilExpiry } from './kitchen-license';
import { DEFAULT_TIMEZONE, formatInTimezone } from './timezone-utils';

export type AccessApplication = {
  id?: number; status: string; current_tier?: number | null; currentTier?: number | null;
  foodSafetyLicenseUrl?: string | null; foodSafetyLicenseStatus?: string | null; foodSafetyLicenseExpiry?: string | null;
  foodEstablishmentCertUrl?: string | null; foodEstablishmentCertStatus?: string | null; foodEstablishmentCertExpiry?: string | null;
};
export type AccessRequirements = { requireFoodHandlerCert?: boolean; tier2_food_establishment_cert_required?: boolean };
/** A renewed upload waiting in its own slot; the current document stays in force until it expires. */
export type AccessRenewal = { key: 'foodSafetyLicense' | 'foodEstablishmentCert'; status: 'pending' | 'approved' | 'rejected' | string; url?: string | null; expiry?: string | null; rejectionReason?: string | null };
export type RequiredDocument = { key: 'foodSafetyLicense' | 'foodEstablishmentCert'; label: string; url?: string | null; status?: string | null; expiry?: string | null };

export function requiredAccessDocuments(app: AccessApplication, requirements: AccessRequirements): RequiredDocument[] {
  return [
    ...(requirements.requireFoodHandlerCert !== false ? [{ key: 'foodSafetyLicense' as const, label: 'Food Safety Certificate', url: app.foodSafetyLicenseUrl, status: app.foodSafetyLicenseStatus, expiry: app.foodSafetyLicenseExpiry }] : []),
    ...(requirements.tier2_food_establishment_cert_required ? [{ key: 'foodEstablishmentCert' as const, label: 'Food Establishment Licence', url: app.foodEstablishmentCertUrl, status: app.foodEstablishmentCertStatus, expiry: app.foodEstablishmentCertExpiry }] : []),
  ];
}

// Date columns are evaluated on the location's calendar, including on the expiry date.
export function accessDocumentDaysLeft(expiry: string | null | undefined, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(`${expiry}T00:00:00Z`)) || new Date(`${expiry}T00:00:00Z`).toISOString().slice(0, 10) !== expiry) return null;
  return daysUntilExpiry(expiry, new Date(`${formatInTimezone(now, 'yyyy-MM-dd', timezone)}T12:00:00`));
}

export function accessDocumentStage(expiry: string | null | undefined, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  const days = accessDocumentDaysLeft(expiry, timezone, now);
  return days === null ? null : days <= 0 ? 'expired' : days <= 7 ? '7_day' : days <= 30 ? '30_day' : null;
}

const friendlyExpiry = (expiry: string | null | undefined) => expiry ? new Date(`${expiry}T00:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }) : 'an earlier date';

export const documentRenewalHref = (locationId: number) => `/dashboard?view=kitchen-requests&renewLocation=${locationId}`;

export function locationBookingEligibility(app: AccessApplication | null | undefined, hasAccess: boolean, requirements: AccessRequirements, locationId: number, timezone = DEFAULT_TIMEZONE, now = new Date(), renewals: AccessRenewal[] = []) {
  const result = (status: string, message: string, canBook = false, actionUrl?: string, document?: { key: RequiredDocument['key']; label: string; expiry: string | null }) =>
    ({ hasApplication: !!app, status, message, canBook, actionUrl, document });
  if (!app) return result('application_required', 'Please apply to this location and wait for final approval before booking.');
  if (app.status === 'rejected' || app.status === 'cancelled') return result(app.status, 'Your application is not approved. Please contact the kitchen manager or Local Cooks about your next step.');
  if (app.status !== 'approved' || (app.current_tier ?? app.currentTier ?? 1) < 3)
    return result('awaiting_final_approval', 'Your application and documents need final manager approval before you can book. Please check your application for the next step.');
  if (!hasAccess) return result('access_ended', 'Your access to this location has ended. Please contact the kitchen manager or Local Cooks to request access again.');
  for (const doc of requiredAccessDocuments(app, requirements)) {
    const days = accessDocumentDaysLeft(doc.expiry, timezone, now);
    const detail = { key: doc.key, label: doc.label, expiry: doc.expiry ?? null };
    // The approved document stays valid until it actually expires; a renewal never blocks booking while it waits.
    if (doc.url && doc.status === 'approved' && days !== null && days > 0) continue;
    if (days !== null && days <= 0) {
      if (renewals.some(renewal => renewal.key === doc.key && renewal.status === 'pending'))
        return result('renewal_under_review', `Your renewal is under review. You can make new bookings once the kitchen approves your renewed ${doc.label}. Existing bookings are unaffected.`, false, documentRenewalHref(locationId), detail);
      const rejected = renewals.find(renewal => renewal.key === doc.key && renewal.status === 'rejected' && renewal.rejectionReason);
      return result('document_expired', `Your ${doc.label} expired on ${friendlyExpiry(doc.expiry)}. Upload a renewed one to book again.${rejected ? ` Your last renewal was not accepted: ${rejected.rejectionReason}` : ''} Existing bookings are unaffected.`, false, documentRenewalHref(locationId), detail);
    }
    return result('document_review_required', `Your ${doc.label} needs a valid expiry date and approval. Please upload a renewed document and wait for review before making new bookings. Existing bookings are unaffected.`, false, documentRenewalHref(locationId), detail);
  }
  return result('approved', 'Your access is approved. You can book kitchens at this location.', true);
}

/** A renewal waits in its own slot only when an approved document is already on file for a finally-approved application. */
export function usesRenewalSlot(app: AccessApplication, key: RequiredDocument['key']) {
  const [url, status] = key === 'foodSafetyLicense' ? [app.foodSafetyLicenseUrl, app.foodSafetyLicenseStatus] : [app.foodEstablishmentCertUrl, app.foodEstablishmentCertStatus];
  return app.status === 'approved' && (app.current_tier ?? app.currentTier ?? 1) >= 3 && !!url && status === 'approved';
}

type Refusal = { hasApplication?: boolean; status: string; message: string; actionUrl?: string; document?: { key: string; label: string; expiry: string | null } };

/** One body for every "you cannot book here" 403, so the booking page can explain it and offer the next step. */
export function bookingRefusalBody(access: Refusal) {
  return {
    error: access.message,
    message: access.message,
    actionUrl: access.actionUrl,
    hasApplication: access.hasApplication,
    applicationStatus: access.status,
    eligibility: { status: access.status, message: access.message, actionUrl: access.actionUrl, document: access.document },
  };
}
