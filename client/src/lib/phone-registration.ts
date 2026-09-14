import { auth } from "@/lib/firebase";
import type { PublicRegistrationRole } from "@/hooks/use-auth";

const PHONE_REGISTRATION_KEY = "localcooks:pending-phone-registration";
const PHONE_AUTH_IN_PROGRESS_KEY = "localcooks:phone-auth-in-progress";
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

interface PhoneAuthProgress {
  startedAt: number;
  createdNewIdentity: boolean;
}

export interface PendingPhoneRegistration {
  uid: string;
  phoneNumber: string;
  email: string;
  displayName: string;
  accountType: PublicRegistrationRole;
  termsAccepted: boolean;
  createdAt: number;
}

function getPhoneAuthProgress(): PhoneAuthProgress | null {
  const raw = window.localStorage.getItem(PHONE_AUTH_IN_PROGRESS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PhoneAuthProgress>;
    if (typeof parsed.startedAt === "number") {
      return {
        startedAt: parsed.startedAt,
        createdNewIdentity: parsed.createdNewIdentity === true,
      };
    }
  } catch {
    // Backward compatibility for the original timestamp-only marker.
  }
  const startedAt = Number(raw);
  return Number.isFinite(startedAt) ? { startedAt, createdNewIdentity: false } : null;
}

export function markPhoneAuthInProgress(active: boolean, createdNewIdentity = false): void {
  if (active) {
    window.localStorage.setItem(PHONE_AUTH_IN_PROGRESS_KEY, JSON.stringify({
      startedAt: Date.now(),
      createdNewIdentity,
    } satisfies PhoneAuthProgress));
  }
  else window.localStorage.removeItem(PHONE_AUTH_IN_PROGRESS_KEY);
}

export function isPhoneAuthInProgress(): boolean {
  const progress = getPhoneAuthProgress();
  if (!progress || Date.now() - progress.startedAt > MAX_DRAFT_AGE_MS) {
    window.localStorage.removeItem(PHONE_AUTH_IN_PROGRESS_KEY);
    return false;
  }
  return true;
}

export function didPhoneAuthCreateNewIdentity(): boolean {
  return isPhoneAuthInProgress() && getPhoneAuthProgress()?.createdNewIdentity === true;
}

export function savePendingPhoneRegistration(draft: PendingPhoneRegistration): void {
  window.localStorage.setItem(PHONE_REGISTRATION_KEY, JSON.stringify(draft));
  markPhoneAuthInProgress(true, didPhoneAuthCreateNewIdentity());
}

export function getPendingPhoneRegistration(): PendingPhoneRegistration | null {
  try {
    const raw = window.localStorage.getItem(PHONE_REGISTRATION_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as PendingPhoneRegistration;
    if (!draft.uid || !draft.email || !draft.phoneNumber || Date.now() - draft.createdAt > MAX_DRAFT_AGE_MS) {
      clearPendingPhoneRegistration();
      return null;
    }
    return draft;
  } catch {
    clearPendingPhoneRegistration();
    return null;
  }
}

export function clearPendingPhoneRegistration(): void {
  window.localStorage.removeItem(PHONE_REGISTRATION_KEY);
  markPhoneAuthInProgress(false);
}

export async function provisionPendingPhoneRegistration(): Promise<{ completed: boolean; role?: PublicRegistrationRole }> {
  const firebaseUser = auth.currentUser;
  const draft = getPendingPhoneRegistration();
  if (!firebaseUser || !draft || firebaseUser.uid !== draft.uid) return { completed: false };

  await firebaseUser.reload();
  const normalizedEmail = firebaseUser.email?.trim().toLowerCase();
  if (!firebaseUser.emailVerified || normalizedEmail !== draft.email.trim().toLowerCase() || !firebaseUser.phoneNumber) {
    return { completed: false };
  }

  const token = await firebaseUser.getIdToken(true);
  const response = await fetch("/api/firebase-register-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      uid: firebaseUser.uid,
      displayName: draft.displayName,
      accountType: draft.accountType,
      termsAccepted: draft.termsAccepted,
      phoneNumber: firebaseUser.phoneNumber,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || payload.error || "Could not finish phone registration") as Error & { code?: string };
    error.code = payload.code;
    throw error;
  }

  clearPendingPhoneRegistration();
  return { completed: true, role: draft.accountType };
}
