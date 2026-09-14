import { useEffect, useRef, useState } from "react";
import {
  type ConfirmationResult,
  deleteUser,
  getAdditionalUserInfo,
  RecaptchaVerifier,
  PhoneAuthProvider,
  signInWithPhoneNumber,
  signOut,
  updatePhoneNumber,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { isValidNorthAmericanPhone, normalizePhoneNumber } from "@shared/phone-validation";
import { didPhoneAuthCreateNewIdentity, markPhoneAuthInProgress } from "@/lib/phone-registration";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, MessageSquareText } from "lucide-react";

interface PhoneOtpChallengeProps {
  initialPhone?: string;
  autoSend?: boolean;
  existingAccountOnly?: boolean;
  onCancel: () => void;
  onTryAnotherWay?: () => void;
  onGoogleSignIn?: () => void | Promise<void>;
  onExistingUser: () => void | Promise<void>;
  onNewUser: (user: FirebaseUser) => void | Promise<void>;
  purpose?: "sign-in" | "link";
  onLinkedPhone?: (user: FirebaseUser) => void | Promise<void>;
}

const PHONE_SEND_ERROR_MESSAGES: Record<string, string> = {
  "auth/billing-not-enabled": "SMS verification requires billing to be enabled for this Firebase project.",
  "auth/captcha-check-failed": "The security check failed or expired. Complete it again and retry.",
  "auth/invalid-app-credential": "Firebase rejected the security check. Reload the page and try again.",
  "auth/invalid-phone-number": "Enter a valid phone number, including its country code.",
  "auth/missing-phone-number": "Enter a phone number before requesting a code.",
  "auth/operation-not-allowed": "Phone sign-in is not enabled for this Firebase project.",
  "auth/quota-exceeded": "This Firebase project's SMS quota has been reached. Try again later.",
  "auth/too-many-requests": "Too many attempts were made from this device or number. Please wait before retrying.",
  "auth/unauthorized-domain": "This website domain is not authorized for Firebase phone sign-in.",
};

export function getPhoneSendErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const message = PHONE_SEND_ERROR_MESSAGES[code];
  if (message) return `${message} (${code})`;
  return `We could not send the verification code. Please try again.${code ? ` (${code})` : ""}`;
}

export default function PhoneOtpChallenge({
  initialPhone = "",
  autoSend = false,
  existingAccountOnly = false,
  onCancel,
  onTryAnotherWay,
  onGoogleSignIn,
  onExistingUser,
  onNewUser,
  purpose = "sign-in",
  onLinkedPhone,
}: PhoneOtpChallengeProps) {
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(autoSend);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const autoSendStartedRef = useRef(false);
  const recaptchaId = useRef(`phone-recaptcha-${crypto.randomUUID()}`);

  const clearVerifier = () => {
    const verifier = verifierRef.current;
    verifierRef.current = null;
    if (!verifier) return;

    // Firebase's clear() mutates the reCAPTCHA container. Clear it before React
    // removes that container when advancing to the OTP screen. The guard also
    // makes teardown idempotent under React Strict Mode.
    try {
      verifier.clear();
    } catch (error) {
      logger.warn("Firebase reCAPTCHA cleanup was already complete", error);
    }
  };

  useEffect(() => () => clearVerifier(), []);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const getVerifier = () => {
    clearVerifier();
    const verifier = new RecaptchaVerifier(auth, recaptchaId.current, {
      size: "invisible",
      "expired-callback": () => setError("The security check expired. Please try again."),
    });
    verifierRef.current = verifier;
    return verifier;
  };

  const sendCode = async () => {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized || !isValidNorthAmericanPhone(normalized)) {
      setError("Enter a valid US or Canadian phone number.");
      return;
    }
    setBusy(true);
    setError(null);
    if (purpose === "sign-in") markPhoneAuthInProgress(true);
    try {
      if (purpose === "link") {
        if (!auth.currentUser) throw new Error("Your Google registration session expired. Please start again.");
        const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(normalized, getVerifier());
        setVerificationId(id);
      } else {
        const confirmationResult = await signInWithPhoneNumber(auth, normalized, getVerifier());
        setConfirmation(confirmationResult);
      }
      setPhone(normalized);
      setResendCooldown(30);
    } catch (err: unknown) {
      if (purpose === "sign-in") markPhoneAuthInProgress(false);
      clearVerifier();
      const code = typeof err === "object" && err && "code" in err
        ? String((err as { code?: unknown }).code || "unknown")
        : "unknown";
      // Keep expected authentication failures in the form. console.error is
      // intercepted by the development runtime-error overlay even when caught.
      logger.warn("Firebase phone verification request failed", { code });
      setError(getPhoneSendErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!autoSend || autoSendStartedRef.current) return;
    autoSendStartedRef.current = true;
    void sendCode();
  }, [autoSend]);

  const verifyCode = async () => {
    if ((!confirmation && !verificationId) || !/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the text message.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (purpose === "link") {
        const googleUser = auth.currentUser;
        if (!googleUser || !verificationId) throw new Error("Your Google registration session expired. Please start again.");
        const phoneCredential = PhoneAuthProvider.credential(verificationId, code);
        await updatePhoneNumber(googleUser, phoneCredential);
        await googleUser.reload();
        await onLinkedPhone?.(auth.currentUser || googleUser);
        return;
      }
      if (!confirmation) throw new Error("The verification session expired. Please request another code.");
      const credential = await confirmation.confirm(code);
      const isNewIdentity = getAdditionalUserInfo(credential)?.isNewUser === true;
      markPhoneAuthInProgress(true, isNewIdentity);
      const token = await credential.user.getIdToken();
      const profileResponse = await fetch("/api/user/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (profileResponse.ok) {
        markPhoneAuthInProgress(false);
        await onExistingUser();
        return;
      }
      if (profileResponse.status !== 404) {
        throw new Error("Unable to check the account profile");
      }

      if (existingAccountOnly) {
        if (isNewIdentity) {
          await deleteUser(credential.user).catch(async () => {
            await signOut(auth).catch(() => undefined);
          });
        } else {
          await signOut(auth).catch(() => undefined);
        }
        markPhoneAuthInProgress(false);
        setConfirmation(null);
        setCode("");
        setError("That phone number is not linked to this Local Cooks account. Check the number or try another way.");
        return;
      }

      // The application database is authoritative for onboarding completion.
      // An interrupted attempt can be an existing Firebase identity with no
      // Neon profile, so Firebase's isNewUser flag is not sufficient here.
      await onNewUser(credential.user);
    } catch (err: any) {
      setError(err?.code === "auth/invalid-verification-code"
        ? "That code is incorrect. Check the text message and try again."
        : err?.code === "auth/credential-already-in-use"
          ? "That phone number is already linked to another account. Sign in with that number or use a different one."
          : err?.message?.includes("session expired")
            ? err.message
            : "We could not verify this code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    clearVerifier();
    const deleteTemporaryIdentity = didPhoneAuthCreateNewIdentity();
    markPhoneAuthInProgress(false);
    if (purpose === "link") {
      onCancel();
      return;
    }
    if (auth.currentUser?.providerData.some((provider: { providerId: string }) => provider.providerId === "phone")) {
      if (deleteTemporaryIdentity) {
        await deleteUser(auth.currentUser).catch(async () => {
          await signOut(auth).catch(() => undefined);
        });
      } else {
        await signOut(auth).catch(() => undefined);
      }
    }
    onCancel();
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-5" aria-live="polite">
      {!onTryAnotherWay && (
        <button type="button" onClick={cancel} className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <div>
        <div className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          <MessageSquareText className="h-5 w-5 text-[#F51042]" />
          {confirmation || verificationId ? "Enter your verification code" : autoSend && busy ? "Sending your code" : purpose === "link" ? "Verify your phone" : "Continue with your phone"}
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {confirmation || verificationId
            ? `We sent a 6-digit code to ${phone}.`
            : autoSend && busy
              ? `Requesting a 6-digit verification code for ${phone}.`
              : existingAccountOnly
                ? "Enter the full phone number linked to your account. We'll send a verification code."
                : "Enter your phone number and we'll send a verification code."}
        </p>
      </div>

      {!confirmation && !verificationId && !(autoSend && busy) && (
        <>
          <div className="space-y-2">
            <Label htmlFor="phone-auth-number">Phone number</Label>
            <Input
              id="phone-auth-number"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(416) 555-0123"
              disabled={busy}
            />
          </div>
        </>
      )}

      {/* Keep the host in the DOM for the verifier's full lifetime. Firebase may
          still touch its styles after signInWithPhoneNumber resolves. */}
      <div
        id={recaptchaId.current}
        className="absolute h-0 w-0"
        aria-hidden="true"
      />

      {!confirmation && !verificationId && autoSend && busy ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 py-4 text-sm text-slate-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Sending verification code…
        </div>
      ) : !confirmation && !verificationId ? (
        <Button type="button" onClick={sendCode} disabled={busy} className="w-full">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {autoSend && busy ? "Sending verification code…" : error ? "Try sending again" : "Send verification code"}
        </Button>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="phone-auth-code">Verification code</Label>
            <Input
              id="phone-auth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              disabled={busy}
            />
          </div>
          <Button type="button" onClick={verifyCode} disabled={busy || code.length !== 6} className="w-full">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Verify phone
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={sendCode}
            disabled={busy || resendCooldown > 0}
            className="w-full"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend verification code"}
          </Button>
          <button type="button" onClick={() => { setConfirmation(null); setVerificationId(null); setCode(""); clearVerifier(); }} className="w-full text-sm text-gray-600 underline">
            Use a different number
          </button>
        </>
      )}

      {(onTryAnotherWay || onGoogleSignIn) && (
        <button
          type="button"
          onClick={onTryAnotherWay || (() => onGoogleSignIn?.())}
          disabled={busy}
          className="w-full text-sm font-medium text-[#E00A38] underline underline-offset-4 disabled:opacity-50"
        >
          Try another way
        </button>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
