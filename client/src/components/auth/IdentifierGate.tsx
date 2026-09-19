import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import GoogleIcon from "./GoogleIcon";
import { isValidNorthAmericanPhone, normalizePhoneNumber } from "@shared/phone-validation";
import { logger } from "@/lib/logger";

interface IdentifierGateProps {
  onEmailKnown: (email: string) => void | Promise<void>;
  onPhoneKnown: (phone: string) => void | Promise<void>;
  onGoogleSignIn: () => void | Promise<void>;
  /**
   * Pre-fills the field on mount. The gate is unmounted whenever the step
   * changes, so this re-applies on every return — which is the point: coming
   * back to correct an address should let the visitor EDIT it rather than retype
   * it from nothing. Empty on a cold start.
   */
  initialIdentifier?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function IdentifierGate({
  onEmailKnown,
  onPhoneKnown,
  onGoogleSignIn,
  initialIdentifier = "",
}: IdentifierGateProps) {
  const { t } = useTranslation("auth");
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneMode = identifier.length > 0 && !identifier.includes("@") && /^[+\d\s().-]+$/.test(identifier);
  const showCallingCode = phoneMode && !identifier.trim().startsWith("+");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = identifier.trim();
    if (!raw) {
      setError(t("errIdentifierRequired", "Email or phone number is required."));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      // An "@" can only appear in an email address, so it is the only reliable
      // way to tell the two apart — a digit-only string is otherwise ambiguous
      // (a vanity address like 14165550123@example.com looks like a phone).
      const phone = raw.includes("@") ? null : normalizePhoneNumber(raw);

      if (phone) {
        if (!isValidNorthAmericanPhone(phone)) {
          setError(t("errInvalidPhone", "Please enter a valid US or Canadian phone number."));
          return;
        }
        await onPhoneKnown(phone);
        return;
      }

      const email = raw.toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        setError(t("errInvalidIdentifier", "Please enter a valid email or phone number."));
        return;
      }

      await onEmailKnown(email);
    } catch (err) {
      logger.warn("Account lookup failed", err);
      setError(t("errGenericCheck", "Unable to check account status. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="identifier" className="sr-only">
            {t("emailOrPhone", "Phone number or email")}
          </Label>
          <div className="relative">
            {showCallingCode && (
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center border-r border-slate-200 pr-3 text-sm font-medium text-slate-600">
                +1
              </span>
            )}
            <Input
              id="identifier"
              name="identifier"
              type={phoneMode ? "tel" : "text"}
              inputMode={phoneMode ? "tel" : "email"}
              placeholder={t("emailOrPhone", "Phone number or email")}
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setError(null);
              }}
              disabled={busy}
              className={`h-12 rounded-xl text-base ${showCallingCode ? "pl-16" : ""}`}
              autoComplete="username"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "identifier-error" : undefined}
              autoFocus
            />
          </div>
          {phoneMode && (
            <p className="px-1 text-xs text-slate-500">{t("northAmericaCallingCode", "US & Canada (+1)")}</p>
          )}
          {error && (
            <p id="identifier-error" role="alert" className="text-sm text-red-600 px-1">
              {error}
            </p>
          )}
        </div>

        <p className="text-xs text-slate-500">
          {t(
            "phoneAuthDisclaimer",
            "We may email or text you a code to log you in."
          )}
        </p>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-12 bg-[#E00A38] hover:bg-[#C00930] text-white text-base font-semibold rounded-xl"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t("btnContinue", "Continue")}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-slate-500">{t("or", "or")}</span>
        </div>
      </div>

      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onGoogleSignIn();
            } catch (err) {
              logger.warn("Google authentication failed", err);
              setError(t("errGoogleGeneric", "Unable to continue with Google. Please try another way."));
            } finally {
              setBusy(false);
            }
          }}
          className="h-12 w-full gap-3 rounded-xl border-slate-300 font-medium"
        >
          <GoogleIcon className="h-5 w-5" />
          <span>{t("continueWithGoogle", "Continue with Google")}</span>
        </Button>
      </div>
    </div>
  );
}
