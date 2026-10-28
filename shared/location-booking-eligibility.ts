import { daysUntilExpiry } from './kitchen-license';
import { DEFAULT_TIMEZONE, formatInTimezone } from './timezone-utils';

export type BuiltInDocumentKey = 'foodSafetyLicense' | 'foodEstablishmentCert' | 'insurance';
/** A built-in document, or one the kitchen added to its booking requirements ("custom:<field id>"). */
export type DocumentKey = BuiltInDocumentKey | `custom:${string}`;
/** Why a document blocks booking, so the chef is told the right next step (upload it, re-upload it, or wait). */
export type DocumentBlockReason = 'missing' | 'rejected' | 'pending' | 'needs_expiry';
export const DOCUMENT_KEYS: BuiltInDocumentKey[] = ['foodSafetyLicense', 'foodEstablishmentCert', 'insurance'];
export const DOCUMENT_LABELS: Record<BuiltInDocumentKey, string> = { foodSafetyLicense: 'Food Safety Certificate', foodEstablishmentCert: 'Food Establishment Licence', insurance: 'Insurance' };

/** A booking-requirements field: a question, or a document the kitchen asks for. */
export type RequirementField = { id: string; label: string; type?: string; required?: boolean; document?: boolean; expires?: boolean };
/** A document the kitchen added (Oct 24 builder). Older ones were saved with only `expires: true`. */
export const isKitchenDocument = (field: Partial<RequirementField> | null | undefined) => !!field && !!(field.document || field.expires);
export const customDocumentKey = (fieldId: string): DocumentKey => `custom:${fieldId}`;
export const isCustomDocumentKey = (key: string): key is `custom:${string}` => key.startsWith('custom:');
export const customDocumentId = (key: string) => key.slice('custom:'.length);
export const kitchenDocumentFields = (requirements: AccessRequirements): RequirementField[] =>
  Array.isArray(requirements.tier2_custom_fields) ? (requirements.tier2_custom_fields as RequirementField[]).filter(field => isKitchenDocument(field) && typeof field.id === 'string') : [];

export type AccessApplication = {
  id?: number; status: string; current_tier?: number | null; currentTier?: number | null;
  foodSafetyLicenseUrl?: string | null; foodSafetyLicenseStatus?: string | null; foodSafetyLicenseExpiry?: string | null;
  foodEstablishmentCertUrl?: string | null; foodEstablishmentCertStatus?: string | null; foodEstablishmentCertExpiry?: string | null;
  insuranceUrl?: string | null; insuranceStatus?: string | null; insuranceExpiry?: string | null;
  /** The kitchen approved this customer for booking without its documents (owner, Oct 23). */
  documentsWaivedAt?: string | Date | null;
  /** Custom documents: tier2_custom_fields_data[id] (file), [id__expiry], customDocumentStatus[id]. */
  tier_data?: unknown;
};
export type AccessRequirements = {
  requireFoodHandlerCert?: boolean; tier2_food_establishment_cert_required?: boolean; tier2_insurance_document_required?: boolean;
  food_handler_cert_tracked?: boolean; food_establishment_cert_tracked?: boolean; insurance_tracked?: boolean;
  /** jsonb: checked to be a list of fields before use. */
  tier2_custom_fields?: unknown;
};
/** A renewed upload waiting in its own slot; the current document stays in force until it expires. */
export type AccessRenewal = { key: DocumentKey; status: 'pending' | 'approved' | 'rejected' | string; url?: string | null; expiry?: string | null; rejectionReason?: string | null };
/**
 * When the current copy of each document was sent and last checked, and the kitchen's note when it asked for a new copy
 * (owner, Oct 27). Kept in tier_data.documentLog[key] so built-in and kitchen documents share it without a schema change.
 */
export type DocumentLogEntry = { sentAt?: string; checkedAt?: string; note?: string; noteAt?: string };
export function documentLogEntry(tierData: unknown, key: string): DocumentLogEntry {
  const log = (tierData && typeof tierData === 'object' ? (tierData as Record<string, any>).documentLog : null) || {};
  return log[key] && typeof log[key] === 'object' ? log[key] : {};
}
/** A new tier_data with this document's entry updated; `fresh` starts the entry over (a new copy was sent). */
export function logDocument(tierData: unknown, key: string, entry: DocumentLogEntry, fresh = false): Record<string, any> {
  const data = (tierData && typeof tierData === 'object' ? tierData : {}) as Record<string, any>;
  const next = { ...(fresh ? {} : documentLogEntry(data, key)), ...entry };
  for (const field of Object.keys(next) as (keyof DocumentLogEntry)[]) if (next[field] === undefined) delete next[field];
  return { ...data, documentLog: { ...(data.documentLog || {}), [key]: next } };
}
/** Per document the kitchen chooses: not needed, track it (date and reminders, never pauses booking), or required. */
export type DocumentMode = 'none' | 'track' | 'required';
export type RequiredDocument = { key: DocumentKey; label: string; mode: Exclude<DocumentMode, 'none'>; url?: string | null; status?: string | null; expiry?: string | null;
  /** False for a kitchen document saved without an expiry date: verified once, no reminders or renewals. */
  hasExpiry: boolean };

export function documentModes(requirements: AccessRequirements): Record<DocumentKey, DocumentMode> {
  const mode = (required: boolean, tracked?: boolean): DocumentMode => required ? 'required' : tracked ? 'track' : 'none';
  return {
    foodSafetyLicense: mode(requirements.requireFoodHandlerCert !== false, requirements.food_handler_cert_tracked),
    foodEstablishmentCert: mode(!!requirements.tier2_food_establishment_cert_required, requirements.food_establishment_cert_tracked),
    insurance: mode(!!requirements.tier2_insurance_document_required, requirements.insurance_tracked),
  };
}

/** A custom document's file, expiry and review status, read from the application's tier data. */
export function customDocumentFields(app: AccessApplication, fieldId: string) {
  const tierData = (app.tier_data && typeof app.tier_data === 'object' ? app.tier_data : {}) as Record<string, any>;
  const answers = (tierData.tier2_custom_fields_data || {}) as Record<string, unknown>;
  const answer = answers[fieldId];
  const url = typeof answer === 'string' && answer ? answer : typeof tierData.tierFiles?.[fieldId] === 'string' ? tierData.tierFiles[fieldId] as string : null;
  const expiry = typeof answers[`${fieldId}__expiry`] === 'string' && answers[`${fieldId}__expiry`] ? answers[`${fieldId}__expiry`] as string : null;
  // A file with no decision yet is waiting for the kitchen.
  const status = url ? ((tierData.customDocumentStatus || {})[fieldId] as string | undefined) ?? 'pending' : null;
  return { url, status, expiry };
}

export function documentFields(app: AccessApplication, key: DocumentKey) {
  if (isCustomDocumentKey(key)) return customDocumentFields(app, customDocumentId(key));
  return key === 'foodSafetyLicense' ? { url: app.foodSafetyLicenseUrl, status: app.foodSafetyLicenseStatus, expiry: app.foodSafetyLicenseExpiry }
    : key === 'foodEstablishmentCert' ? { url: app.foodEstablishmentCertUrl, status: app.foodEstablishmentCertStatus, expiry: app.foodEstablishmentCertExpiry }
    : { url: app.insuranceUrl, status: app.insuranceStatus, expiry: app.insuranceExpiry };
}

/**
 * Every document to show for this customer at this location: the built-in ones the kitchen tracks or requires (or that
 * are on file anyway, as mode 'none'), then the documents the kitchen added, in its order.
 */
export function locationDocuments(app: AccessApplication, requirements: AccessRequirements): (Omit<RequiredDocument, 'mode'> & { mode: DocumentMode })[] {
  const modes = documentModes(requirements);
  const builtIn = DOCUMENT_KEYS.map(key => ({ key: key as DocumentKey, label: DOCUMENT_LABELS[key], mode: modes[key], hasExpiry: true, ...documentFields(app, key) }))
    .filter(doc => doc.mode !== 'none' || doc.url);
  const own = kitchenDocumentFields(requirements).map(field => ({ key: customDocumentKey(field.id), label: field.label,
    mode: (field.required ? 'required' : 'track') as DocumentMode, hasExpiry: !!field.expires, ...customDocumentFields(app, field.id) }));
  return [...builtIn, ...own];
}

/** Every document this location tracks or requires: shown to both sides and reminded before it expires. */
export function accessDocuments(app: AccessApplication, requirements: AccessRequirements): RequiredDocument[] {
  return locationDocuments(app, requirements).filter((doc): doc is RequiredDocument => doc.mode !== 'none');
}

/** The label for a document key at this location (a custom one by the kitchen's own name). */
export function documentLabel(key: string, requirements: AccessRequirements) {
  if (!isCustomDocumentKey(key)) return DOCUMENT_LABELS[key as BuiltInDocumentKey] ?? 'Document';
  return kitchenDocumentFields(requirements).find(field => field.id === customDocumentId(key))?.label ?? 'Document';
}

/** The documents that pause new bookings when missing or expired; none while the kitchen has waived them. */
export function requiredAccessDocuments(app: AccessApplication, requirements: AccessRequirements): RequiredDocument[] {
  if (app.documentsWaivedAt) return [];
  return accessDocuments(app, requirements).filter(doc => doc.mode === 'required');
}

// Date columns are evaluated on the location's calendar, including on the expiry date.
export function accessDocumentDaysLeft(expiry: string | null | undefined, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(`${expiry}T00:00:00Z`)) || new Date(`${expiry}T00:00:00Z`).toISOString().slice(0, 10) !== expiry) return null;
  return daysUntilExpiry(expiry, new Date(`${formatInTimezone(now, 'yyyy-MM-dd', timezone)}T12:00:00`));
}

/** Reminder stages, as Food Corridor: 45, 14 and 3 days before, and on the day it expires (owner, Oct 23). */
export type DocumentStage = 'expired' | '3_day' | '14_day' | '45_day';
export function accessDocumentStage(expiry: string | null | undefined, timezone = DEFAULT_TIMEZONE, now = new Date()): DocumentStage | null {
  const days = accessDocumentDaysLeft(expiry, timezone, now);
  return days === null ? null : days <= 0 ? 'expired' : days <= 3 ? '3_day' : days <= 14 ? '14_day' : days <= 45 ? '45_day' : null;
}

const friendlyExpiry = (expiry: string | null | undefined) => expiry ? new Date(`${expiry}T00:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }) : 'an earlier date';

export const documentRenewalHref = (locationId: number) => `/dashboard?view=kitchen-requests&renewLocation=${locationId}`;

export function locationBookingEligibility(app: AccessApplication | null | undefined, hasAccess: boolean, requirements: AccessRequirements, locationId: number, timezone = DEFAULT_TIMEZONE, now = new Date(), renewals: AccessRenewal[] = []) {
  const result = (status: string, message: string, canBook = false, actionUrl?: string, document?: { key: RequiredDocument['key']; label: string; expiry: string | null; reason?: DocumentBlockReason; alsoMissing?: string[] }) =>
    ({ hasApplication: !!app, status, message, canBook, actionUrl, document });
  if (!app) return result('application_required', 'Please apply to this location and wait for final approval before booking.');
  if (app.status === 'rejected' || app.status === 'cancelled') return result(app.status, 'Your application is not approved. Please contact the kitchen or Local Cooks about your next step.');
  if (app.status !== 'approved' || (app.current_tier ?? app.currentTier ?? 1) < 3)
    return result('awaiting_final_approval', 'Your application and documents need the kitchen’s final approval before you can book. Please check your application for the next step.');
  if (!hasAccess) return result('access_ended', 'Your access to this location has ended. Please contact the kitchen or Local Cooks to request access again.');
  const required = requiredAccessDocuments(app, requirements);
  for (const doc of required) {
    const days = accessDocumentDaysLeft(doc.expiry, timezone, now);
    const detail = { key: doc.key, label: doc.label, expiry: doc.expiry ?? null };
    // The approved document stays valid until it actually expires; a renewal never blocks booking while it waits.
    if (doc.url && doc.status === 'approved' && days !== null && days > 0) continue;
    // A document without an expiry date is good once the kitchen approves it.
    if (!doc.hasExpiry && doc.url && doc.status === 'approved') continue;
    if (!doc.url) return result('document_review_required', `This kitchen needs your ${doc.label} before new bookings. Upload it and wait for the kitchen to approve it. Existing bookings are unaffected.`, false, documentRenewalHref(locationId),
      // Every other required document still to upload, so the chef learns them all at once.
      { ...detail, reason: 'missing', alsoMissing: required.filter(other => other.key !== doc.key && !other.url).map(other => other.label) });
    if (days !== null && days <= 0) {
      if (renewals.some(renewal => renewal.key === doc.key && renewal.status === 'pending'))
        return result('renewal_under_review', `Your renewal is under review. You can make new bookings once the kitchen approves your renewed ${doc.label}. Existing bookings are unaffected.`, false, documentRenewalHref(locationId), detail);
      const rejected = renewals.find(renewal => renewal.key === doc.key && renewal.status === 'rejected' && renewal.rejectionReason);
      return result('document_expired', `Your ${doc.label} expired on ${friendlyExpiry(doc.expiry)}. Upload a renewed one to book again.${rejected ? ` Your last renewal was not accepted: ${rejected.rejectionReason}` : ''} Existing bookings are unaffected.`, false, documentRenewalHref(locationId), detail);
    }
    if (!doc.hasExpiry) return result('document_review_required', doc.status === 'rejected'
      ? `The kitchen asked for a new copy of your ${doc.label}. Upload it to book again. Existing bookings are unaffected.`
      : `Your ${doc.label} is waiting for the kitchen's approval. You can make new bookings once it's approved. Existing bookings are unaffected.`, false, documentRenewalHref(locationId), { ...detail, reason: doc.status === 'rejected' ? 'rejected' : 'pending' });
    return result('document_review_required', `Your ${doc.label} needs a valid expiry date and approval. Please upload a renewed document and wait for review before making new bookings. Existing bookings are unaffected.`, false, documentRenewalHref(locationId), { ...detail, reason: 'needs_expiry' });
  }
  return result('approved', 'Your access is approved. You can book kitchens at this location.', true);
}

/**
 * A renewal waits in its own slot only when an approved document is already on file for a finally-approved application.
 * A custom document without an expiry date has no renewal; a new upload replaces it and is checked again.
 */
export function usesRenewalSlot(app: AccessApplication, key: DocumentKey, hasExpiry = true) {
  if (!hasExpiry) return false;
  const { url, status } = documentFields(app, key);
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
