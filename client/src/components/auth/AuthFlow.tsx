import { useState, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { User as FirebaseUser } from "firebase/auth";
import { Button } from "@/components/ui/button";
import IdentifierGate from "./IdentifierGate";
import GoogleAuthHint from "./GoogleAuthHint";
import PhoneOtpChallenge from "./PhoneOtpChallenge";
import AuthMethodChooser from "./AuthMethodChooser";
import EnhancedLoginForm from "./EnhancedLoginForm";
import EnhancedRegisterForm from "./EnhancedRegisterForm";
import WelcomeBackCard from "./WelcomeBackCard";
import { getRememberedAuthMethod, isMissingProfileError, resolveAuthIdentifier, resolveIdentifierStep, type LoginChallenge } from "@/lib/login-challenge";
import type { LastAccount } from "@/lib/last-account";
import type { AuthAccountState, AuthMethod } from "@shared/auth-resolution";

export type AuthFlowStep = "welcome-back" | "identifier" | "login" | "register" | "google-hint" | "phone-otp" | "methods" | "account-help";
type ActiveAuthMethod = AuthMethod;

type LoginFormProps = ComponentProps<typeof EnhancedLoginForm>;
type RegisterFormProps = ComponentProps<typeof EnhancedRegisterForm>;

export interface AuthFlowProps {
  /** Controlled step. Omit to let AuthFlow own the state. */
  step?: AuthFlowStep;
  /** Starting step when uncontrolled. */
  initialStep?: AuthFlowStep;
  onStepChange?: (step: AuthFlowStep) => void;
  /** Everything except the identifier — AuthFlow owns that. */
  loginProps?: Omit<LoginFormProps, "initialEmail" | "onSwitchToRegister">;
  registerProps?: Omit<RegisterFormProps, "initialEmail" | "onSwitchToLogin">;
  onGoogleSignIn?: () => void | Promise<void>;
  onPhoneExistingUser?: () => void | Promise<void>;
  onPhoneNewUser?: (user: FirebaseUser) => void | Promise<void>;
  /** Rendered under every step — used for wizard "Previous" controls. */
  footer?: ReactNode;
  /** Set false in flows that must not switch identity mid-way (kitchen applications). */
  allowBack?: boolean;
  /**
   * The account this browser last signed in with. Supplying it enables the
   * `welcome-back` step; omit it and the flow is byte-for-byte what it was, so
   * the other three hosts are unaffected.
   */
  lastAccount?: LastAccount | null;
  /** The visitor rejected the remembered account. The owner clears its record. */
  onDismissLastAccount?: () => void;
}

export default function AuthFlow({
  step: controlledStep,
  initialStep = "identifier",
  onStepChange,
  loginProps,
  registerProps,
  onGoogleSignIn,
  onPhoneExistingUser,
  onPhoneNewUser,
  footer,
  allowBack = true,
  lastAccount = null,
  onDismissLastAccount,
}: AuthFlowProps) {
  const { t } = useTranslation("auth");
  const [ownStep, setOwnStep] = useState<AuthFlowStep>(initialStep);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loginChallenge, setLoginChallenge] = useState<LoginChallenge>("email-link");
  const [activeMethod, setActiveMethod] = useState<ActiveAuthMethod>("email-link");
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<AuthAccountState>("unavailable");
  const [availableMethods, setAvailableMethods] = useState<AuthMethod[]>([]);
  const [phoneFromMethods, setPhoneFromMethods] = useState(false);
  const [autoSendEmailLink, setAutoSendEmailLink] = useState(false);
  const step = controlledStep ?? ownStep;

  const go = (next: AuthFlowStep) => {
    setOwnStep(next);
    onStepChange?.(next);
  };

  const handleGoogleSignIn = async () => {
    try {
      await onGoogleSignIn?.();
    } catch (error) {
      if (isMissingProfileError(error)) {
        if (typeof (error as { email?: unknown }).email === "string") {
          setEmail((error as { email: string }).email);
        }
        go("register");
        return;
      }
      throw error;
    }
  };

  const applyResolution = (resolution: Awaited<ReturnType<typeof resolveAuthIdentifier>>) => {
    setAccountState(resolution.state);
    setAvailableMethods(resolution.methods);
    setMaskedPhone(resolution.maskedPhone);
    setMaskedEmail(resolution.maskedEmail);
    setLinkedPhone(resolution.linkedPhone);
    setLinkedEmail(resolution.linkedEmail);
  };

  const chooseEmailEntryStep = async (knownEmail: string) => {
    const [remembered, resolution] = await Promise.all([
      getRememberedAuthMethod(knownEmail),
      resolveAuthIdentifier(knownEmail),
    ]);
    applyResolution(resolution);

    if (resolution.state === "new") {
      go("register");
      return;
    }
    if (resolution.state === "identity-conflict") {
      go("account-help");
      return;
    }
    if (resolution.state === "profile-incomplete" && !resolution.methods.includes("google")) {
      go("account-help");
      return;
    }

    const rememberedIsLinked = remembered && resolution.methods.includes(remembered);
    const selected = rememberedIsLinked
      ? remembered
      : resolution.methods.includes("google") && !resolution.methods.includes("password")
        ? "google"
      : resolution.methods.length === 1
        ? resolution.methods[0]
        : resolution.methods.includes("email-link")
          ? "email-link"
          : resolution.methods[0];

    // When account resolution is temporarily unavailable, retain the safe,
    // generic email-link path rather than locking out a legitimate user.
    const method = selected || "email-link";
    setActiveMethod(method);
    setAutoSendEmailLink(method === "email-link");
    if (method === "email-link" || method === "password") setLoginChallenge(method);
    go(method === "google" ? "google-hint" : method === "phone" ? "phone-otp" : "login");
  };

  const continueWithRememberedAccount = async () => {
    if (!lastAccount) return;
    if (lastAccount.method === "google") {
      // Straight into the popup — the visitor already told us which account.
      await handleGoogleSignIn();
      return;
    }
    // For the email-based methods, reuse the identifier-first routing verbatim
    // rather than adding a second code path. It re-resolves the account
    // server-side and picks the correct challenge, so a stale local record
    // self-corrects instead of dead-ending.
    setEmail(lastAccount.email);
    setPhone("");
    await chooseEmailEntryStep(lastAccount.email);
  };

  const hasAlternativeMethod = availableMethods.some((method) => method !== activeMethod);
  let content: ReactNode = null;

  const identifierContent = (
    <IdentifierGate
      onEmailKnown={async (knownEmail) => {
        setEmail(knownEmail);
        setPhone("");
        await chooseEmailEntryStep(knownEmail);
      }}
      onPhoneKnown={async (knownPhone) => {
        setPhone(knownPhone);
        setEmail("");
        applyResolution(await resolveAuthIdentifier(knownPhone));
        setPhoneFromMethods(false);
        setActiveMethod("phone");
        go(resolveIdentifierStep("phone"));
      }}
      onGoogleSignIn={handleGoogleSignIn}
    />
  );

  switch (step) {
    case "welcome-back":
      content = lastAccount ? (
        <WelcomeBackCard
          account={lastAccount}
          onContinue={continueWithRememberedAccount}
          onNotYou={() => {
            onDismissLastAccount?.();
            go("identifier");
          }}
        />
      ) : (
        // Defensive: the step is only entered when a record exists, but never
        // render an empty card if the owner cleared it mid-flight.
        identifierContent
      );
      break;

    case "identifier":
      content = identifierContent;
      break;

    case "google-hint":
      content = (
        <GoogleAuthHint
          email={email}
          onContinueWithGoogle={handleGoogleSignIn}
          onTryAnotherWay={() => { setActiveMethod("google"); go("methods"); }}
        />
      );
      break;

    case "phone-otp":
      content = (
        <PhoneOtpChallenge
          initialPhone={phone}
          autoSend={!!phone}
          existingAccountOnly={accountState === "existing"}
          onCancel={() => go(phoneFromMethods ? "methods" : "identifier")}
          onTryAnotherWay={availableMethods.some((method) => method !== "phone")
            ? () => { setActiveMethod("phone"); go("methods"); }
            : undefined}
          onExistingUser={() => onPhoneExistingUser?.()}
          onNewUser={(user) => (onPhoneNewUser ? onPhoneNewUser(user) : go("register"))}
        />
      );
      break;

    case "login":
      content = (
        <EnhancedLoginForm
          {...loginProps}
          initialEmail={email}
          initialChallenge={loginChallenge}
          availableChallenges={availableMethods
            .filter((method) => method === "email-link" || method === "password")
            .map((method) => method as LoginChallenge)}
          accountConfirmed={accountState === "existing" && !!email}
          showChallengeSwitcher={false}
          autoSendEmailLink={autoSendEmailLink}
          onTryAnotherWay={hasAlternativeMethod ? () => go("methods") : undefined}
          onChallengeChange={(challenge) => {
            if (challenge === "email-link" || challenge === "password") setActiveMethod(challenge);
          }}
        />
      );
      break;

    case "methods":
      content = (
        <AuthMethodChooser
          kind={phone ? "phone" : "email"}
          identifier={phone || email}
          phoneHint={maskedPhone || undefined}
          emailHint={maskedEmail || undefined}
          onEmailLink={availableMethods.includes("email-link") && activeMethod !== "email-link" ? () => { setActiveMethod("email-link"); setLoginChallenge("email-link"); setEmail(linkedEmail || email); setAutoSendEmailLink(true); go("login"); } : undefined}
          onPassword={availableMethods.includes("password") && activeMethod !== "password" ? () => { setActiveMethod("password"); setLoginChallenge("password"); setEmail(linkedEmail || email); setAutoSendEmailLink(false); go("login"); } : undefined}
          onTextCode={availableMethods.includes("phone") && activeMethod !== "phone" ? () => { setActiveMethod("phone"); setPhone(linkedPhone || phone); setPhoneFromMethods(true); go("phone-otp"); } : undefined}
          onGoogle={availableMethods.includes("google") && activeMethod !== "google" ? handleGoogleSignIn : undefined}
          onDifferentIdentifier={() => { setEmail(""); setPhone(""); setMaskedPhone(null); setMaskedEmail(null); setLinkedPhone(null); setLinkedEmail(null); setAvailableMethods([]); setAccountState("unavailable"); setPhoneFromMethods(false); setAutoSendEmailLink(false); go("identifier"); }}
        />
      );
      break;

    case "register":
      content = (
        <EnhancedRegisterForm
          {...registerProps}
          initialEmail={email}
        />
      );
      break;

    case "account-help":
      content = (
        <div className="mx-auto w-full max-w-md space-y-5 py-4 text-center">
          <h3 className="text-xl font-semibold text-slate-900">{t("accountSetupNeedsHelp", "Let's finish setting up your account")}</h3>
          <p className="text-sm leading-6 text-slate-600">
            {t("accountSetupNeedsHelpBody", "Your sign-in identity exists, but its LocalCooks profile is incomplete. To protect your account and avoid creating a duplicate, contact support for a quick identity repair.")}
          </p>
          <Button asChild className="w-full rounded-xl">
            <a href="mailto:support@localcooks.ca?subject=Account%20setup%20help">{t("contactSupport", "Contact support")}</a>
          </Button>
          <Button type="button" variant="outline" onClick={() => go("identifier")} className="w-full rounded-xl">
            {t("useDifferentEmailOrPhone", "Use a different email or phone number")}
          </Button>
        </div>
      );
      break;
  }

  // phone-otp and google-hint ship their own escape hatches, and account-help
  // renders its own "use a different email or phone number" button.
  //
  // `login` normally reaches `methods` through onTryAnotherWay, which is only
  // passed when a second method exists. A single-method account (email-link
  // only, or password only) therefore had no route back to the identifier step
  // at all — reloading the page was the only exit. Show the back control in
  // exactly that case, so the two escapes never appear together.
  const showBack =
    allowBack && (step === "register" || (step === "login" && !hasAlternativeMethod));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {showBack && (
        <div className="shrink-0 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => go("identifier")}
            className="-ml-4 text-slate-500 h-8"
          >
            &larr; {t("back", "Back")}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pt-2">{content}</div>
      {footer ? <div className="shrink-0 pt-3">{footer}</div> : null}
    </div>
  );
}
