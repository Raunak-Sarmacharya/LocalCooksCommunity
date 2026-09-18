import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GoogleIcon from "./GoogleIcon";
import type { LastAccount } from "@/lib/last-account";

interface WelcomeBackCardProps {
  /** The account this browser last signed in with. */
  account: LastAccount;
  /** Runs the remembered method. For Google this opens the popup directly. */
  onContinue: () => void | Promise<void>;
  /** "Not you?" — forget this account and fall through to the identifier step. */
  onNotYou: () => void;
}

/**
 * The pre-step to `IdentifierGate`: offers the account this browser already
 * knows instead of asking for an address. Purely a rendering of local state —
 * it performs no lookup, so showing it reveals nothing the browser did not
 * already hold.
 *
 * The avatar carries the *person* (their initial) and the button carries the
 * *method* (the Google mark). Keeping those separate is what lets the same card
 * work for a Google, email-link, or password account.
 */
export default function WelcomeBackCard({
  account,
  onContinue,
  onNotYou,
}: WelcomeBackCardProps) {
  const { t } = useTranslation("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = (account.firstName?.[0] ?? account.email[0] ?? "?").toUpperCase();
  const isGoogle = account.method === "google";

  const continueWithAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await onContinue();
    } catch {
      setError(
        t(
          "errWelcomeBackGeneric",
          "Unable to continue with this account. Please try another way.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FCE3E9]">
        <span className="text-2xl font-semibold leading-none text-[#F51042]">{initial}</span>
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-semibold">
          {account.firstName
            ? t("welcomeBackTitle", "Welcome back, {name}", { name: account.firstName })
            : t("welcomeBackTitleGeneric", "Welcome back")}
        </h3>
        <p className="mx-auto max-w-sm text-sm text-slate-500">
          {t("welcomeBackDesc", "You logged in to LocalCooks this way in the past.")}
        </p>
        <p className="break-all text-sm font-medium text-slate-700">{account.maskedEmail}</p>
      </div>

      <div className="w-full space-y-3 pt-4">
        <Button
          type="button"
          onClick={continueWithAccount}
          disabled={busy}
          className="w-full bg-[#E00A38] text-white hover:bg-[#C00930]"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : isGoogle ? (
            <GoogleIcon className="mr-2 h-4 w-4 rounded-full bg-white p-0.5" />
          ) : null}
          {isGoogle
            ? t("continueWithGoogle", "Continue with Google")
            : t("welcomeBackContinue", "Continue")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onNotYou}
          disabled={busy}
          className="w-full border-slate-200"
        >
          {t("welcomeBackNotYou", "Not you?")}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
