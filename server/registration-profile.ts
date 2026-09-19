import { isValidNorthAmericanPhone, normalizePhoneNumber } from "@shared/phone-validation";

export function resolveRegistrationEmail(input: {
  provider: 'phone' | 'email' | 'google';
  tokenEmail?: string | null;
  submittedEmail?: string | null;
}): string | null {
  const candidate = (input.tokenEmail || (input.provider === 'phone' ? input.submittedEmail : ''))
    ?.trim()
    .toLowerCase();
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

export function validateNewRegistrationProfile(input: {
  displayName: string;
  provider: 'phone' | 'email' | 'google';
  tokenPhone?: string | null;
  submittedPhone?: string | null;
}): { ok: true; displayName: string; phoneNumber: string } | { ok: false; error: string } {
  const displayName = input.displayName.trim();
  if (displayName.length < 2) return { ok: false, error: "Full name is required" };

  // EVERY new account supplies a phone, whichever route it took.
  //
  // Google used to be exempt here (`if (provider === 'google' && !phoneNumber) return
  // { ok: true, displayName }`), and that exemption is exactly how a "Continue with
  // Google" signup produced an account with a name and an address but no number —
  // silently, with no confirmation step and no way to sign in with a phone later.
  // The client now collects the number before provisioning, so the rule can hold for
  // all three providers.
  const phoneNumber = normalizePhoneNumber(
    input.provider === 'phone' ? input.tokenPhone : input.submittedPhone,
  );
  if (!phoneNumber || !isValidNorthAmericanPhone(phoneNumber)) {
    return { ok: false, error: "A valid phone number is required" };
  }

  return { ok: true, displayName, phoneNumber };
}
