/** Client-safe visit-code contract. No crypto and no code derivation lives here. */
export const VISIT_CODE_LENGTH = 6;
export const VISIT_CODE_MAX_ATTEMPTS = 5;
export const VISIT_CODE_MODES = ['staffed', 'self'] as const;
export const VISIT_CODE_METHODS = ['code', 'self', 'assisted'] as const;
export type VisitCodeMode = (typeof VISIT_CODE_MODES)[number];
export type VisitCodeMethod = (typeof VISIT_CODE_METHODS)[number];

/** `visit:<visitId>` for a split-visit row, else `booking:<bookingId>`. */
export type VisitCodeTargetKey = `visit:${number}` | `booking:${number}`;
export const visitCodeTargetKey = (target: { bookingId: number; visitId?: number | null }): VisitCodeTargetKey =>
  target.visitId ? `visit:${target.visitId}` : `booking:${target.bookingId}`;
export const isVisitCodeFormat = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]{6}$/.test(value) && value.length === VISIT_CODE_LENGTH;

/** Stable error codes returned as `code` next to `error` on arrival failures. */
export const VISIT_CODE_ERROR_CODES = ['VISIT_CODE_REQUIRED', 'VISIT_CODE_WRONG', 'VISIT_CODE_LOCKED',
  'VISIT_CODE_ALREADY_RECORDED', 'VISIT_CODE_REVOKED'] as const;
export type VisitCodeErrorCode = (typeof VISIT_CODE_ERROR_CODES)[number];

/** Chef-facing state per target. Never contains the code. */
export type ChefVisitCodeState = {
  targetKey: VisitCodeTargetKey;
  visitId: number | null;
  mode: VisitCodeMode;
  codeRequired: boolean;
  locked: boolean;
  attemptsLeft: number;
  consumed: boolean;
  consumedMethod: VisitCodeMethod | null;
  consumedAt: string | null;
  revoked: boolean;
};

/** Manager-facing state. `code` is present only while unconsumed, unrevoked and in staffed mode. */
export type ManagerVisitCodeState = {
  targetKey: VisitCodeTargetKey;
  visitId: number | null;
  mode: VisitCodeMode;
  revision: number;
  code: string | null;
  /** True when a code should exist but the server signing key is unavailable. */
  codeUnavailable: boolean;
  locked: boolean;
  failedAttempts: number;
  attemptsLeft: number;
  issuedAt: string;
  modeChangedAt: string | null;
  modeReason: string | null;
  consumed: boolean;
  consumedMethod: VisitCodeMethod | null;
  consumedAt: string | null;
  revoked: boolean;
};

export type ManagerVisitCodeResponse = { bookingId: number; targets: ManagerVisitCodeState[] };
