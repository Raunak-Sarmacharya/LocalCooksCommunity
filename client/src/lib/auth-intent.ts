/**
 * Persists kitchen preview intent across passwordless auth (magic link).
 * Uses localStorage so intent survives cross-tab / email-link opens.
 */

export type AuthIntentType = "tour" | "book";

export interface AuthIntent {
  type: AuthIntentType;
  /** Path + search, e.g. /kitchen-preview/my-kitchen */
  returnPath: string;
  locationId?: string | number;
  kitchenId?: string | number;
  savedAt: number;
}

const STORAGE_KEY = "pendingAuthIntent";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function saveAuthIntent(
  intent: Omit<AuthIntent, "savedAt">
): void {
  try {
    const payload: AuthIntent = {
      ...intent,
      returnPath: intent.returnPath || window.location.pathname + window.location.search,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota errors */
  }
}

export function getAuthIntent(): AuthIntent | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthIntent;
    if (!parsed?.returnPath || !parsed?.type) return null;
    if (Date.now() - (parsed.savedAt || 0) > MAX_AGE_MS) {
      clearAuthIntent();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAuthIntent(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Resolved redirect path after auth — prefers saved intent over dashboard. */
export function resolvePostAuthRedirect(fallbackPath = "/dashboard"): string {
  const intent = getAuthIntent();
  if (intent?.returnPath) {
    return intent.returnPath.startsWith("/")
      ? intent.returnPath
      : `/${intent.returnPath}`;
  }
  return fallbackPath;
}

export function saveAuthIntentFromCurrentPage(
  type: AuthIntentType,
  locationId?: string | number,
  kitchenId?: string | number
): void {
  saveAuthIntent({
    type,
    returnPath: window.location.pathname + window.location.search,
    locationId,
    kitchenId,
  });
}

// ─── Pending kitchen application modal (survives email verification redirect) ───

export type PendingApplicationPhase =
  | "awaiting_verification"
  | "ready_to_submit"
  | "submitted";

export interface PendingApplicationReview {
  fullName?: string;
  email?: string;
  phone?: string;
  shopName?: string;
  shopAddress?: string;
  businessType?: string;
  experience?: string;
  businessDescription?: string;
  kitchenPreference?: string;
  foodSafetyLicense?: string;
  foodEstablishmentCert?: string;
}

export interface PendingApplicationModalState {
  phase: PendingApplicationPhase;
  review: PendingApplicationReview;
  returnPath: string;
  title?: string;
  modalType?: AuthIntentType;
  /** True only if this session created the account in the apply/tour modal. */
  registeredInFlow?: boolean;
  savedAt: number;
}

/**
 * Kitchen apply/tour identity.
 * - guest: no session
 * - registering: created the account in this modal; must verify email
 * - signed_in: existing session (new chef, in-progress applicant, or veteran)
 */
export type KitchenActor = "guest" | "registering" | "signed_in";

export function kitchenActor(isSignedIn: boolean, registeredInFlow: boolean): KitchenActor {
  if (!isSignedIn) return "guest";
  if (registeredInFlow) return "registering";
  return "signed_in";
}

export function skipKitchenVerify(actor: KitchenActor): boolean {
  return actor === "signed_in";
}

export function resolvePendingApplyPhase(
  phase: PendingApplicationPhase,
  actor: KitchenActor,
  emailVerified: boolean
): PendingApplicationPhase {
  if (phase === "submitted") return phase;
  if (phase !== "awaiting_verification") return phase;
  if (actor === "signed_in" || emailVerified) return "ready_to_submit";
  return phase;
}

export function nextTourStepAfterSlot(
  actor: KitchenActor
): "account" | "verify" | "confirm" {
  if (actor === "guest") return "account";
  if (actor === "registering") return "verify";
  return "confirm";
}

export function coerceTourStepForActor(
  step: string,
  actor: KitchenActor,
  hasSlot: boolean
): string {
  if (actor === "signed_in" && (step === "verify" || step === "account") && hasSlot) {
    return "confirm";
  }
  if (actor === "registering" && step === "account" && hasSlot) {
    return "verify";
  }
  if (actor === "guest" && (step === "verify" || step === "confirm")) {
    return hasSlot ? "account" : "date";
  }
  return step;
}

const PENDING_MODAL_KEY = "pendingKitchenApplicationModal";

export function savePendingApplicationModal(
  state: Omit<PendingApplicationModalState, "savedAt">
): void {
  try {
    const intent = getAuthIntent();
    window.sessionStorage.setItem(
      PENDING_MODAL_KEY,
      JSON.stringify({
        ...state,
        returnPath:
          state.returnPath ||
          intent?.returnPath ||
          window.location.pathname + window.location.search,
        savedAt: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }
}

export function getPendingApplicationModal(): PendingApplicationModalState | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_MODAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingApplicationModalState;
    if (!parsed?.review || !parsed?.phase) return null;
    if (Date.now() - (parsed.savedAt || 0) > MAX_AGE_MS) {
      clearPendingApplicationModal();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingApplicationModal(): void {
  try {
    window.sessionStorage.removeItem(PENDING_MODAL_KEY);
  } catch {
    /* ignore */
  }
}

/** Drop in-progress apply/auth resume keys so cancel doesn't reopen the modal. */
export function clearAbandonedApplicationSession(): void {
  clearPendingApplicationModal();
  clearAuthIntent();
  try {
    window.localStorage.removeItem("pendingRegistrationData");
    window.sessionStorage.removeItem("pendingRegistrationKitchenContext");
    window.sessionStorage.removeItem("pending_application_modal");
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.endsWith("_pending_modal")) window.sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export function resolveVerificationReturnPath(): string | null {
  const pending = getPendingApplicationModal();
  if (pending?.returnPath) return pending.returnPath;
  const intent = getAuthIntent();
  if (intent?.returnPath) return intent.returnPath;
  return null;
}
