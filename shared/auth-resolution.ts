export type AuthMethod = "email-link" | "password" | "phone" | "google";

export type AuthAccountState = "new" | "existing" | "profile-incomplete" | "identity-conflict" | "unavailable";

export interface AuthAccountResolution {
  state: AuthAccountState;
  methods: AuthMethod[];
  /**
   * Whether the account's email is confirmed, or `null` when it could not be
   * determined (the `unavailable` state).
   *
   * `null` is not the same as `false`, and the distinction is load-bearing: a
   * resolution that failed must not be read as "this account needs verifying",
   * or a transient server problem would divert every returning user into the
   * verification flow. Only an explicit `false` means unverified.
   *
   * Mirrors `hasVerifiedEmail` — Firebase owns the address, and the database
   * flag confirms the server-side sync has caught up — so the resolution and the
   * platform gate can never disagree about whether an account is usable.
   */
  emailVerified: boolean | null;
  /**
   * Whether the account's phone number has been proved, or `null` when it could
   * not be determined.
   *
   * A phone is a LOGIN identifier here, so it is offered as a sign-in method only
   * once this is explicitly `true`.
   *
   * NOTE the deliberate asymmetry with `emailVerified`: there, an unreadable
   * answer (`null`) falls back to the safe generic email-link path, because that
   * costs nothing. Here `null` must NOT open the method. Sending an SMS is a real
   * message to a real person and it mints a Firebase identity, so an answer we
   * cannot read has to fail closed and point the visitor at their email, which
   * always works.
   */
  phoneVerified: boolean | null;
  /**
   * Whether the identifier's account may use the portal that asked, or `null`
   * when the caller did not say which portal it is (in which case no portal gate
   * applies and the existing post-authentication check still runs).
   *
   * The rule is evaluated server-side so a client change cannot bypass it, and
   * only the verdict crosses the wire — never the raw role.
   */
  portalAllowed: boolean | null;
  maskedEmail: string | null;
  maskedPhone: string | null;
  /** Internal challenge targets. Never render these values; use the masked fields. */
  linkedEmail: string | null;
  linkedPhone: string | null;
}

export const EMPTY_AUTH_RESOLUTION: AuthAccountResolution = {
  state: "unavailable",
  methods: [],
  emailVerified: null,
  phoneVerified: null,
  portalAllowed: null,
  maskedEmail: null,
  maskedPhone: null,
  linkedEmail: null,
  linkedPhone: null,
};

export function isAuthMethod(value: unknown): value is AuthMethod {
  return value === "email-link" || value === "password" || value === "phone" || value === "google";
}
