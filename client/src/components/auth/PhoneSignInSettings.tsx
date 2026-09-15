import { useEffect, useRef, useState } from "react";
import {
  type ConfirmationResult,
  linkWithPhoneNumber,
  RecaptchaVerifier,
  unlink,
} from "firebase/auth";
import { CheckCircle2, Loader2, MessageSquareText, Phone, XCircle } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { logger } from "@/lib/logger";
import { isValidNorthAmericanPhone, normalizePhoneNumber, formatPhoneForDisplay } from "@shared/phone-validation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { hasRecentFirebaseAuth } from "@/lib/firebase-auth-security";

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
      await onPhoneUnlinked?.();
    } catch (err: any) {
      if (err?.code === "auth/no-such-provider") {
        // Already unlinked — sync state
        setLinkedPhone("");
        setPhone("");
        await onPhoneUnlinked?.();
      } else {
        setError("Could not remove phone number. Try again.");
      }
    } finally {
      setUnlinking(false);
    }
  };

  const body = linkedPhone ? (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
        <div className="flex-1">
          <p className="font-medium text-emerald-900">Phone verified</p>
          <p className="mt-1 text-sm text-emerald-700">{formatPhoneForDisplay(linkedPhone)}</p>
        </div>
        <button
          type="button"
          onClick={handleUnlink}
          disabled={unlinking}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {unlinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          Remove
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  ) : (
    <div className="space-y-4">
      {!confirmation ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="security-phone-number">Phone number</Label>
            <Input
              id="security-phone-number"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(416) 555-0123"
              disabled={busy}
            />
          </div>
          <label className="flex items-start gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={smsConsent}
              onChange={(event) => setSmsConsent(event.target.checked)}
              className="mt-1"
            />
            <span>I agree to receive a one-time authentication text. Message and data rates may apply.</span>
          </label>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="security-phone-code">Verification code</Label>
          <Input
            id="security-phone-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">We sent a 6-digit code to {formatPhoneForDisplay(phone)}.</p>
        </div>
      )}

      <div id={recaptchaId.current} className="absolute h-0 w-0" aria-hidden="true" />

      <Button
        type="button"
        onClick={confirmation ? verifyCode : sendCode}
        disabled={busy || (!!confirmation && code.length !== 6)}
        className={cn(embedded ? "w-full sm:w-auto" : "w-full")}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {confirmation ? "Verify and add phone" : "Verify phone number"}
      </Button>
      {confirmation && (
        <button
          type="button"
          onClick={() => { setConfirmation(null); setCode(""); clearVerifier(); }}
          className="block text-sm text-muted-foreground underline"
        >
          Use a different number
        </button>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );

  if (embedded) {
    return (
      <>
        {body}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" />Phone</CardTitle>
        <CardDescription>Add a verified phone as another way to access this same account.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
