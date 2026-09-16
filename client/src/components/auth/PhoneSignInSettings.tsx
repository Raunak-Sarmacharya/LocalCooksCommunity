import { useEffect, useRef, useState } from "react";
import {
  type ConfirmationResult,
  linkWithPhoneNumber,
  RecaptchaVerifier,
  unlink,
} from "firebase/auth";
import { Check, Clock, Loader2, Phone, XCircle } from "lucide-react";
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
  type ContactTone,
} from "@/components/profile/ContactVerificationRow";

function maskPhone(phone: string): string {
  return phone.length > 4 ? `••• ••• ${phone.slice(-4)}` : phone;
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

  const tone: ContactTone = linkedPhone
    ? "verified"
    : confirmation
      ? "pending"
      : "empty";

  const statusLabel = linkedPhone
    ? "Verified"
    : confirmation
      ? "Code sent"
      : "Not added";

  const value = linkedPhone
    ? formatPhoneForDisplay(linkedPhone)
    : confirmation
      ? formatPhoneForDisplay(phone)
      : "No phone number added";

  let secondary: string;
  let description: string;
  if (linkedPhone) {
    secondary = "Verified";
    description =
      "You can use this number to sign in .";
  } else if (confirmation) {
    secondary = "Code sent";
    description = `Enter the 6-digit code we sent to ${formatPhoneForDisplay(phone)}.`;
  } else {
    secondary = "Not added";
    description =
      "Add a mobile number for booking . It is verified with a one-time code.";
  }

  const addForm = (
    <div className="max-w-md space-y-3">
      <div className="space-y-2">
        <Label htmlFor="security-phone-number" className="text-xs font-medium">
          Mobile number
        </Label>
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
        <span>
          I agree to receive a one-time authentication text. Message and data rates may
          apply.
        </span>
      </label>
      <div id={recaptchaId.current} className="absolute h-0 w-0" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={sendCode} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />}
          Send code
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={cancelAdding}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );

  const codeForm = (
    <div className="max-w-md space-y-2">
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
        linkedPhone ? (
          <Check className="size-4" />
        ) : tone === "pending" ? (
          <Clock className="size-4" />
        ) : (
          <Phone className="size-4" />
        )
      }
      label="Phone number"
      tone={tone}
      badges={<ContactStatusPill tone={tone}>{statusLabel}</ContactStatusPill>}
      value={value}
      secondary={secondary}
      description={
        <>
          <p>{description}</p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </>
      }
      actions={
        linkedPhone ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleUnlink}
            disabled={unlinking}
          >
            {unlinking ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <XCircle className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Remove
          </Button>
        ) : confirmation || isAdding ? undefined : (
          <Button type="button" size="sm" onClick={() => setIsAdding(true)}>
            Add phone number
          </Button>
        )
      }
    >
      {linkedPhone ? null : confirmation ? codeForm : isAdding ? addForm : null}
    </ContactVerificationRow>
  );

  if (embedded) return row;

  return <ContactInfoCard>{row}</ContactInfoCard>;
}
