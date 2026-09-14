import { isValidNorthAmericanPhone, normalizePhoneNumber } from "@shared/phone-validation";

export function validateNewRegistrationProfile(input: {
  displayName: string;
  provider: 'phone' | 'email';
  tokenPhone?: string | null;
  submittedPhone?: string | null;
}): { ok: true; displayName: string; phoneNumber: string } | { ok: false; error: string } {
  const displayName = input.displayName.trim();
  if (displayName.length < 2) return { ok: false, error: "Full name is required" };

  const phoneNumber = normalizePhoneNumber(
    input.provider === 'phone' ? input.tokenPhone : input.submittedPhone,
  );
  if (!phoneNumber || !isValidNorthAmericanPhone(phoneNumber)) {
    return { ok: false, error: "A valid phone number is required" };
  }

  return { ok: true, displayName, phoneNumber };
}
