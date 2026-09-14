import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import GoogleIcon from "./GoogleIcon";
import { Loader2 } from "lucide-react";
import { useState } from "react";

interface GoogleAuthHintProps {
  /** The address the visitor typed, shown so they can confirm the right account. */
  email?: string;
  onContinueWithGoogle: () => void | Promise<void>;
  onTryAnotherWay: () => void;
}

export default function GoogleAuthHint({
  email,
  onContinueWithGoogle,
  onTryAnotherWay,
}: GoogleAuthHintProps) {
  const { t } = useTranslation("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueWithGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await onContinueWithGoogle();
    } catch {
      setError(t("errGoogleGeneric", "Unable to continue with Google. Please try another way."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 border border-slate-100">
        <GoogleIcon className="h-8 w-8" />
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-semibold">{t("googleHintTitle", "Log in with Google")}</h3>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          {t("googleHintDesc", "You logged in to LocalCooks this way in the past.")}
        </p>
        {email && <p className="text-sm font-medium text-slate-700 break-all">{email}</p>}
      </div>

      <div className="w-full space-y-3 pt-4">
        <Button
          type="button"
          onClick={continueWithGoogle}
          disabled={busy}
          className="w-full bg-[#E00A38] hover:bg-[#C00930] text-white"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon className="mr-2 h-4 w-4 rounded-full bg-white p-0.5" />}
          {t("continueWithGoogle", "Continue with Google")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onTryAnotherWay}
          disabled={busy}
          className="w-full border-slate-200"
        >
          {t("tryAnotherWay", "Try another way")}
        </Button>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
