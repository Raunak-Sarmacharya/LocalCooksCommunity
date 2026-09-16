import type { AuthAccountState, AuthMethod } from "@shared/auth-resolution";

export function resolveAuthAccountState(firebaseUid: string | null, neonFirebaseUid: string | null): AuthAccountState {
  if (!firebaseUid && !neonFirebaseUid) return "new";
  if (firebaseUid && neonFirebaseUid === firebaseUid) return "existing";
  if (firebaseUid && !neonFirebaseUid) return "profile-incomplete";
  return "identity-conflict";
}

export function resolveAuthMethods(input: {
  email?: string | null;
  phoneNumber?: string | null;
  providerIds?: string[];
  /**
   * Neon `password_set_by_user`. Registration still links a Firebase password
   * provider with a generated secret — only offer password sign-in when the
   * account holder actually chose that secret. Required so callers cannot
   * silently omit it and treat placeholder passwords as real.
   */
  passwordSetByUser: boolean | null;
}): AuthMethod[] {
  const providers = new Set(input.providerIds || []);
  const methods: AuthMethod[] = [];
  if (input.email) methods.push("email-link");
  if (providers.has("password") && input.passwordSetByUser === true) methods.push("password");
  if (input.phoneNumber || providers.has("phone")) methods.push("phone");
  if (providers.has("google.com")) methods.push("google");
  return methods;
}

export function maskRecoveryEmail(email?: string | null): string | null {
  if (!email) return null;
  return email.replace(/^(.{1,2}).*(@.*)$/, (_match, start, domain) => `${start}***${domain}`);
}

export function maskRecoveryPhone(phone?: string | null): string | null {
  const digits = phone?.replace(/\D/g, "") || "";
  return digits ? `••• ••• ${digits.slice(-4)}` : null;
}
