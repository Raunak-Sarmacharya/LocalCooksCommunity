import { isValidNorthAmericanPhone, normalizePhoneNumber } from "@shared/phone-validation";

const STORAGE_KEY = "localcooks.pending-seller-journey.v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SellerJourneyDraft {
  fullName: string;
  email: string;
  phone: string;
  kitchenPreference: "commercial" | "home" | "notSure";
  termsAccepted: true;
  termsAcceptedAt: number;
  savedAt: number;
}

export function saveSellerJourneyDraft(draft: Omit<SellerJourneyDraft, "savedAt">): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
}

export function getSellerJourneyDraft(): SellerJourneyDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as SellerJourneyDraft;
    if (!draft.fullName || !draft.email || !draft.phone || !draft.kitchenPreference) return null;
    if (draft.termsAccepted !== true || !draft.termsAcceptedAt) return null;
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      clearSellerJourneyDraft();
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearSellerJourneyDraft(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function validateSellerJourneyPhone(phone: string): boolean {
  const normalized = normalizePhoneNumber(phone);
  return !!normalized && isValidNorthAmericanPhone(normalized);
}

export function sellerJourneyPayload(draft: SellerJourneyDraft) {
  return {
    fullName: draft.fullName.trim(),
    email: draft.email.trim().toLowerCase(),
    phone: normalizePhoneNumber(draft.phone) || draft.phone,
    kitchenPreference: draft.kitchenPreference,
    foodSafetyLicense: "no" as const,
    foodEstablishmentCert: "no" as const,
    foodSafetyLicenseUrl: "",
    foodEstablishmentCertUrl: "",
    feedback: "Started from the chef landing page guided journey. Certifications will be provided from the dashboard.",
  };
}
