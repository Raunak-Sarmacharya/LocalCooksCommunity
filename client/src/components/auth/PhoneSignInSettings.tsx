import { useEffect, useRef, useState } from "react";
import {
  type ConfirmationResult,
  linkWithPhoneNumber,
  RecaptchaVerifier,
  unlink,
} from "firebase/auth";
import { AlertCircle, Check, Clock, Loader2, Phone } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { logger } from "@/lib/logger";
import { isValidNorthAmericanPhone, normalizePhoneNumber, formatPhoneForDisplay } from "@shared/phone-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasRecentFirebaseAuth } from "@/lib/firebase-auth-security";
import {
  ContactInfoCard,
  ContactStatusPill,
  ContactVerificationRow,
  DANGER_ROW_ACTION,
  PRIMARY_ROW_ACTION,
  QUIET_ROW_ACTION,
  type ContactTone,
} from "@/components/profile/ContactVerificationRow";

function maskPhone(phone: string): string {
  return phone.length > 4 ? `••• ••• ${phone.slice(-4)}` : phone;
}

/** Which of the four states the phone row is in. */
export type PhoneRowState = "verified" | "code-sent" | "unverified" | "empty";

/**
 * Decide the phone row's state.
 *
 * This row used to be driven by the Firebase credential ALONE (`linkedPhone`), so a
 * number stored on the account but never proved was INVISIBLE: the holder saw "No
 * phone number added", could not tell which number needed verifying, and the "Add
 * phone number" button invited them to retype a number they had already given.
 *
 * Priority order matters:
 *   verified   — a Firebase phone credential, so it is usable to sign in.
 *   code-sent  — an OTP is outstanding; the code form is the only thing to show.
 *   unverified — the number is on the account but has never been proved. Visible
 *                and actionable, but NOT presented as verified.
 *   empty      — nothing on file.
 */
export function resolvePhoneRowState(input: {
  linkedPhone: string;
  hasPendingCode: boolean;
  storedPhone: string;
}): PhoneRowState {
  if (input.linkedPhone) return "verified";
  if (input.hasPendingCode) return "code-sent";
  if (input.storedPhone) return "unverified";
  return "empty";
}

/** The verdict from the availability check. `unknown` means we could not tell. */
export type PhoneAvailability = "available" | "taken" | "unknown";

/**
 * Ask the server whether this number may be attached to the signed-in account.
 *
 * `unknown` is deliberately distinct from `taken`: one means "somebody else owns
 * it" and the other means "we could not find out", and they need different copy.
 * Both BLOCK the send — a number we could not clear is one we must not text, since
 * the Firebase link would outlive a rejected save and lock the real owner out.
 */
export async function checkPhoneAvailable(phone: string, idToken: string): Promise<PhoneAvailability> {
  try {
    const response = await fetch("/api/user/phone-availability", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    if (!response.ok) return "unknown";
    const data = await response.json() as { available?: unknown };
    if (typeof data.available !== "boolean") return "unknown";
    return data.available ? "available" : "taken";
  } catch {
    return "unknown";
  }
}

interface PhoneSignInSettingsProps {
  /** Render without wrapping Card/section — parent controls layout */
  embedded?: boolean;
  /** Pre-fill the phone input (e.g. from DB profile) */
  initialPhone?: string;
  /** Called after OTP verification succeeds and phone is linked to Firebase UID */
  onPhoneLinked?: (phone: string) => void | Promise<void>;
  /** Called after phone is unlinked from Firebase UID */
  onPhoneUnlinked?: () => void | Promise<void>;
}

export default function PhoneSignInSettings({
  embedded = false,
  initialPhone,
  onPhoneLinked,
  onPhoneUnlinked,
}: PhoneSignInSettingsProps) {
  const { user: firebaseUser } = useFirebaseAuth();
  const [linkedPhone, setLinkedPhone] = useState(auth.currentUser?.phoneNumber || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [code, setCode] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const recaptchaId = useRef(`link-phone-recaptcha-${crypto.randomUUID()}`);

  useEffect(() => {
    setLinkedPhone(auth.currentUser?.phoneNumber || "");
  }, [firebaseUser?.uid]);

  // Sync initialPhone prop when it changes (e.g. after profile fetch)
  useEffect(() => {
    if (initialPhone && !linkedPhone) {
      setPhone(initialPhone);
    }
  }, [initialPhone, linkedPhone]);

  const clearVerifier = () => {
    const verifier = verifierRef.current;
    verifierRef.current = null;
    if (!verifier) return;
    try {
      verifier.clear();
    } catch (clearError) {
      logger.warn("Firebase phone-link reCAPTCHA cleanup was already complete", clearError);
    }
  };

  useEffect(() => () => clearVerifier(), []);

  const sendCode = async () => {
    const user = auth.currentUser;
    const normalized = normalizePhoneNumber(phone);
    if (!user) {
      setError("Sign in again before adding phone number.");
      return;
    }
    if (!normalized || !isValidNorthAmericanPhone(normalized)) {
      setError("Enter a valid US or Canadian phone number.");
      return;
    }
    if (!smsConsent) {
      setError("Confirm that we may send a one-time authentication text.");
      return;
    }

    setBusy(true);
    setError(null);
    clearVerifier();
    try {
      const token = await user.getIdTokenResult();
      if (!hasRecentFirebaseAuth(token.claims.auth_time)) {
        setError("For security, sign out and sign back in before adding a phone.");
        return;
      }

      // Refuse a number that ANOTHER account already holds, BEFORE sending anything.
      // Learning this at save time is far too late: the text has gone out and the
      // number is now linked to THIS Firebase user, so the real owner can never
      // attach it. Fails CLOSED — if we cannot check, we do not send.
      const availability = await checkPhoneAvailable(normalized, token.token);
      if (availability === "taken") {
        setError("That phone number is already linked to another Local Cooks account. Use a different number.");
        return;
      }
      if (availability === "unknown") {
        setError("We could not check that number just now. Please try again in a moment.");
        return;
      }

      // If a different phone is already linked, unlink it first
      const existingPhone = user.phoneNumber;
      if (existingPhone && existingPhone !== normalized) {
        try {
          await unlink(user, "phone");
          logger.info("Unlinked previous phone before re-linking new number");
        } catch (unlinkErr: any) {
          // auth/no-such-provider means no phone linked — safe to continue
          if (unlinkErr?.code !== "auth/no-such-provider") {
            setError("Could not replace the existing phone. Try again.");
            return;
          }
        }
      }

      const verifier = new RecaptchaVerifier(auth, recaptchaId.current, {
        size: "invisible",
        "expired-callback": () => setError("The security check expired. Please try again."),
      });
      verifierRef.current = verifier;
      const result = await linkWithPhoneNumber(user, normalized, verifier);
      setPhone(normalized);
      setConfirmation(result);
    } catch (linkError: any) {
      clearVerifier();
      const code = String(linkError?.code || "");
      if (code === "auth/credential-already-in-use") {
        setError("This phone is attached to another account. Sign in to that account or contact support.");
      } else if (code === "auth/requires-recent-login") {
        setError("For security, sign out and sign back in before adding a phone.");
      } else if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") {
        setError("Too many verification attempts. Please wait before trying again.");
      } else {
        setError("We could not send the verification code. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      const credential = await confirmation.confirm(code);
      await credential.user.reload();
      const verifiedPhone = credential.user.phoneNumber || phone;
      setLinkedPhone(verifiedPhone);
      setConfirmation(null);
      setCode("");
      setIsAdding(false);
      setSmsConsent(false);
      clearVerifier();
      // Notify parent so it can sync verified phone to DB
      await onPhoneLinked?.(verifiedPhone);
    } catch (verifyError: any) {
      setError(verifyError?.code === "auth/invalid-verification-code"
        ? "That code is incorrect. Check the text message and try again."
        : "We could not link this phone. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setUnlinking(true);
    setError(null);
    try {
      await unlink(user, "phone");
      await user.reload();
      setLinkedPhone("");
      setPhone("");
      setIsAdding(false);
      setSmsConsent(false);
      await onPhoneUnlinked?.();
    } catch (err: any) {
      if (err?.code === "auth/no-such-provider") {
        // Already unlinked — sync state
        setLinkedPhone("");
        setPhone("");
        setIsAdding(false);
        setSmsConsent(false);
        await onPhoneUnlinked?.();
      } else {
        setError("Could not remove phone number. Try again.");
      }
    } finally {
      setUnlinking(false);
    }
  };

  const cancelAdding = () => {
    setIsAdding(false);
    setError(null);
    setCode("");
    setSmsConsent(false);
    clearVerifier();
  };

  /**
   * Open the inline form. `prefill` is the number being PROVED, or `""` when there is
   * nothing on file to prove.
   *
   * Every route goes through the form rather than sending straight away, because the
   * form carries the SMS-consent checkbox and a one-time text must not be sent without
   * it. The form is also the ONLY place the number can be edited, so `sendCode`'s
   * pre-flight — the one that refuses a number another account already holds, and fails
   * closed when it cannot check — stays on the single path every send takes.
   *
   * The pre-fill is converted to the DISPLAY format. A raw `+17096318480` sitting in an
   * editable field reads like a database value rather than the number the manager
   * recognises, and `normalizePhoneNumber` strips non-digits anyway, so the formatted
   * text normalises back to exactly the same E.164 string.
   */
  const startAdding = (prefill: string) => {
    setPhone(prefill ? formatPhoneForDisplay(prefill) : "");
    setError(null);
    setIsAdding(true);
  };

  // The number held on the ACCOUNT (`users.phone_number`). It is NOT a credential
  // until it has been proved, so it is tracked separately from `linkedPhone`, and
  // the row is explicit about which of the two it is showing.
  const storedPhone = normalizePhoneNumber(initialPhone || "") || "";
  const rowState = resolvePhoneRowState({
    linkedPhone,
    hasPendingCode: !!confirmation,
    storedPhone,
  });

  const tone: ContactTone =
    rowState === "verified"
      ? "verified"
      : rowState === "code-sent"
        ? "pending"
        : rowState === "unverified"
          ? "action"
          : "empty";

  const statusLabel =
    rowState === "verified"
      ? "Verified"
      : rowState === "code-sent"
        ? "Code sent"
        : rowState === "unverified"
          ? "Not verified"
          : "Not added";

  const value =
    rowState === "verified"
      ? formatPhoneForDisplay(linkedPhone)
      : rowState === "code-sent"
        ? formatPhoneForDisplay(phone)
        : rowState === "unverified"
          ? formatPhoneForDisplay(storedPhone)
          : "No phone number added";

  // No `secondary`: the status pill directly above already says Verified / Code sent /
  // Not verified / Not added, and repeating it on the value line was half the reason
  // this row ran to four lines. The long explanation moves behind the ⓘ.
  let description: string | undefined;
  let help: string | undefined;
  if (rowState === "verified") {
    help = "You can use this number to sign in.";
  } else if (rowState === "code-sent") {
    // A live instruction, not an explanation — it stays in the row.
    description = `Enter the 6-digit code we sent to ${formatPhoneForDisplay(phone)}.`;
  } else if (rowState === "unverified") {
    help =
      "This number is on your account but has not been verified yet, so it cannot sign you in. Verify it to also use it for sign-in.";
  } else {
    help = "Add a mobile number for booking. It is verified with a one-time code.";
  }

  const addForm = (
    <div className="max-w-md space-y-3 rounded-xl border bg-background p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="security-phone-number" className="text-xs font-medium">
            Mobile number
          </Label>
          {/* Offered ONLY here, and only when there is a number to replace. "Change
              number" used to sit beside "Verify this number" as a second button of
              equal weight, which made proving a number and replacing it read as the
              same action — so neither read as important.

              It clears the field and does nothing else. The send still goes through
              `sendCode`, which is the single place the duplicate-number pre-flight
              lives, so nothing here can bypass it. */}
          {phone ? (
            <button
              type="button"
              onClick={() => setPhone("")}
              disabled={busy}
              className="!min-h-0 !min-w-0 inline-flex items-center rounded-md text-xs font-medium text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Change number
            </button>
          ) : null}
        </div>
        <Input
          id="security-phone-number"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="(416) 555-0123"
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">US and Canadian numbers only.</p>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={smsConsent}
          onChange={(event) => setSmsConsent(event.target.checked)}
          className="mt-0.5"
          disabled={busy}
        />
        {/* One sentence, one line. It used to run on and wrap, orphaning "apply." onto
            a second line — the rates disclosure is its own line instead. The checkbox
            is untouched: `sendCode` refuses to send without it. */}
        <span>I agree to receive a one-time authentication text.</span>
      </label>
      <p className="pl-[1.35rem] text-[11px] leading-snug text-muted-foreground">
        Message and data rates may apply.
      </p>
      <div id={recaptchaId.current} className="absolute h-0 w-0" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className={PRIMARY_ROW_ACTION}
          onClick={sendCode}
          disabled={busy}
        >
          {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />}
          Send code
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={QUIET_ROW_ACTION}
          onClick={cancelAdding}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );

  const codeForm = (
    <div className="max-w-md space-y-2 rounded-xl border bg-background p-4">
      <Label htmlFor="security-phone-code" className="text-xs font-medium">
        Verification code
      </Label>
      <Input
        id="security-phone-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        disabled={busy}
        className="tracking-[0.35em]"
      />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className={PRIMARY_ROW_ACTION}
          onClick={verifyCode}
          disabled={busy || code.length !== 6}
        >
          {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />}
          Verify and add phone
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={QUIET_ROW_ACTION}
          onClick={() => {
            setConfirmation(null);
            setCode("");
            clearVerifier();
          }}
          disabled={busy}
        >
          Use a different number
        </Button>
      </div>
    </div>
  );

  const row = (
    <ContactVerificationRow
      id="phone-verification"
      labelId="phone-verification-heading"
      icon={
        rowState === "verified" ? (
          <Check className="size-4" />
        ) : rowState === "code-sent" ? (
          <Clock className="size-4" />
        ) : rowState === "unverified" ? (
          <AlertCircle className="size-4" />
        ) : (
          <Phone className="size-4" />
        )
      }
      label="Phone number"
      tone={tone}
      badges={<ContactStatusPill tone={tone}>{statusLabel}</ContactStatusPill>}
      value={value}
      help={help}
      description={
        description || error ? (
          <>
            {description ? <p>{description}</p> : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </>
        ) : undefined
      }
      actions={
        rowState === "verified" ? (
          // Removing a credential is destructive, so it takes danger colour and never
          // the weight of the primary beside it.
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={DANGER_ROW_ACTION}
            onClick={handleUnlink}
            disabled={unlinking}
          >
            {unlinking && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />}
            Remove
          </Button>
        ) : confirmation || isAdding ? undefined
        : rowState === "unverified" ? (
          // ONE action, and the only one on the page that is filled: the number is
          // already on the account, so proving it is the whole job of this row.
          // Replacing it is a different intent and lives inside the form, beside the
          // number itself. Two buttons of equal weight made "verify" and "change" read
          // as the same thing, so neither read as important.
          <Button
            type="button"
            size="sm"
            className={PRIMARY_ROW_ACTION}
            onClick={() => startAdding(storedPhone)}
            disabled={busy}
          >
            Verify this number
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className={PRIMARY_ROW_ACTION}
            onClick={() => startAdding("")}
          >
            Add phone number
          </Button>
        )
      }
    >
      {rowState === "verified" ? null : confirmation ? codeForm : isAdding ? addForm : null}
    </ContactVerificationRow>
  );

  if (embedded) return row;

  return <ContactInfoCard>{row}</ContactInfoCard>;
}
