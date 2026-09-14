export type AuthMethod = "email-link" | "password" | "phone" | "google";

export type AuthAccountState = "new" | "existing" | "profile-incomplete" | "identity-conflict" | "unavailable";

export interface AuthAccountResolution {
  state: AuthAccountState;
  methods: AuthMethod[];
  maskedEmail: string | null;
  maskedPhone: string | null;
  /** Internal challenge targets. Never render these values; use the masked fields. */
  linkedEmail: string | null;
  linkedPhone: string | null;
}

export const EMPTY_AUTH_RESOLUTION: AuthAccountResolution = {
  state: "unavailable",
  methods: [],
  maskedEmail: null,
  maskedPhone: null,
  linkedEmail: null,
  linkedPhone: null,
};

export function isAuthMethod(value: unknown): value is AuthMethod {
  return value === "email-link" || value === "password" || value === "phone" || value === "google";
}
