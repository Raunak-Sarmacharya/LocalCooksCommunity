import { KeyRound, Loader2, Mail, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import GoogleIcon from "./GoogleIcon";

interface AuthMethodChooserProps {
  kind: "email" | "phone";
  identifier: string;
  phoneHint?: string;
  emailHint?: string;
  onEmailLink?: () => void;
  onPassword?: () => void;
  onTextCode?: () => void | Promise<void>;
  onGoogle?: () => void | Promise<void>;
  onDifferentIdentifier: () => void;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
}

export default function AuthMethodChooser({
  kind,
  identifier,
  phoneHint,
  emailHint,
  onEmailLink,
  onPassword,
  onTextCode,
  onGoogle,
  onDifferentIdentifier,
}: AuthMethodChooserProps) {
  const { t } = useTranslation("auth");
  const shownIdentifier = kind === "email" ? maskEmail(identifier) : identifier;
  const emailMethodHint = kind === "email"
    ? shownIdentifier
    : emailHint || t("enterLinkedEmail", "Enter the email linked to your account");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueWithGoogle = async () => {
    if (!onGoogle) return;
    setBusy(true);
    setError(null);
    try {
      await onGoogle();
    } catch {
      setError(t("errGoogleGeneric", "Unable to continue with Google. Please choose another way."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-5 py-2">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-slate-900">
          {t("tryAnotherWayTitle", "Try another way")}
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          {t("chooseSignInMethod", "Choose a secure way to continue.")}
        </p>
      </div>

      <div className="divide-y overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {onTextCode && (
          <button type="button" onClick={() => onTextCode()} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
            <MessageSquareText className="h-5 w-5 text-slate-600" />
            <span><span className="block text-sm font-medium">{t("continueWithPhone", "Continue with your phone")}</span><span className="block text-xs text-slate-500">{phoneHint || shownIdentifier}</span></span>
          </button>
        )}
        {onEmailLink && (
          <button type="button" onClick={onEmailLink} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
            <Mail className="h-5 w-5 text-slate-600" />
            <span><span className="block text-sm font-medium">{t("emailMeASignInLink", "Email me a sign-in link")}</span><span className="block text-xs text-slate-500">{emailMethodHint}</span></span>
          </button>
        )}
        {onPassword && (
          <button type="button" onClick={onPassword} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
            <KeyRound className="h-5 w-5 text-slate-600" />
            <span><span className="block text-sm font-medium">{t("signInWithPassword", "Sign in with email and password")}</span><span className="block text-xs text-slate-500">{emailMethodHint}</span></span>
          </button>
        )}
        {onGoogle && (
          <button type="button" onClick={continueWithGoogle} disabled={busy} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50 disabled:opacity-50">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon className="h-5 w-5" />}
            <span className="text-sm font-medium">{t("continueWithGoogle", "Continue with Google")}</span>
          </button>
        )}
      </div>

      <Button type="button" variant="outline" onClick={onDifferentIdentifier} className="w-full rounded-xl">
        {t("useDifferentEmailOrPhone", "Use a different email or phone number")}
      </Button>
      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
