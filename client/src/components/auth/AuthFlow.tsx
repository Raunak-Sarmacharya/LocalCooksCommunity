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
import { getRememberedAuthMethod, isMissingProfileError, resolveAuthIdentifier, resolvePhoneEntryStep, type LoginChallenge } from "@/lib/login-challenge";
import type { LastAccount } from "@/lib/last-account";
import type { AuthAccountState, AuthMethod } from "@shared/auth-resolution";

export type AuthFlowStep =
  | "welcome-back"
  | "identifier"
  | "login"
  | "register"
  | "google-hint"
  | "phone-otp"
  // The two states a phone identifier can be refused in, BEFORE any code is sent.
  | "phone-unknown"
  | "phone-unverified"
  | "methods"
  | "account-help";
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
   * Seeds the identifier field on mount.
   *
   * This is a `useState` initial value, not a controlled prop, and that is
   * deliberate: the host's loading gate REPLACES the card with a loading screen,
   * which unmounts this component and destroys `email`, `phone`, `methods` and
   * the rest. A step can therefore survive the gate (it is owned by the host)
   * while the data it needs does not. Re-seeding on remount is what lets a
   * failure land on the register step with the address still filled in.
   */
  initialIdentifier?: string;
  /**
   * The account this browser last signed in with. Supplying it enables the
   * `welcome-back` step; omit it and the flow is byte-for-byte what it was, so
   * the other three hosts are unaffected.
   */
  lastAccount?: LastAccount | null;
  /** The visitor rejected the remembered account. The owner clears its record. */
  onDismissLastAccount?: () => void;
  /**
   * The account exists but its email is unconfirmed. The host owns the
   * verification surface, so it is told to show it rather than AuthFlow picking
   * a challenge the account cannot actually complete.
   */
  onUnverifiedAccount?: (email: string) => void;
  /**
   * Which portal this flow runs in, so portal authority is settled server-side
   * BEFORE any credential is issued.
   *
   * This exists for the phone path. The post-authentication portal check cannot
   * protect it: by then a real SMS has already gone out and a Firebase identity
   * has been created for an account we are about to refuse. A phone resolves to
   * its account before any code is sent, so the refusal can come first and cost
   * nothing.
   *
   * Omit it and no portal gate runs — the host's existing check still applies.
   */
  portal?: "manager" | "chef";
  /** The account may not use this portal. The host owns the alert. */
  onPortalRejected?: () => void;
  /**
   * Abandon an in-flight Google registration when the visitor leaves the register step
   * for the identifier step.
   *
   * A PROP rather than a `useFirebaseAuth()` call on purpose. This component is
   * presentational — every other host interaction arrives as a callback — and reaching
   * for the context here made it unusable outside an `AuthProvider`, which broke its own
   * tests and would break any future bare usage.
   */
  onDiscardPendingGoogleRegistration?: () => void;
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
  onUnverifiedAccount,
  portal,
  onPortalRejected,
  onDiscardPendingGoogleRegistration,
  initialIdentifier = "",
}: AuthFlowProps) {
  const { t } = useTranslation("auth");
  const [ownStep, setOwnStep] = useState<AuthFlowStep>(initialStep);
  const [email, setEmail] = useState(initialIdentifier);
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
  /**
   * True while the login card is showing its "we sent you a link" state. That state carries
   * its own named escape, so the host's "← Back" arrow is suppressed while it is up — see
   * `showBack` below. Reported by `EnhancedLoginForm` because the sent state is internal to it.
   */
  const [loginSent, setLoginSent] = useState(false);
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

    // An account whose email is still unconfirmed is mid-onboarding, not a
    // returning user. Picking a method for it sent a passwordless SIGN-IN link:
    // a different email, a different landing page, and none of the resend /
    // "check again" affordances the verification screen provides — so a visitor
    // who was told "confirm your email" came back and was told "sign in".
    // Resume the flow they are actually in.
    //
    // Only an explicit `false` diverts; `null` means the state could not be
    // read, and guessing there would send every returning user down this path
    // whenever the lookup hiccups.
    if (resolution.emailVerified === false && onUnverifiedAccount) {
      onUnverifiedAccount(knownEmail);
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

  /**
   * The phone counterpart of `chooseEmailEntryStep`.
   *
   * It did not exist. The phone branch called `resolveIdentifierStep("phone")`,
   * which returned "phone-otp" unconditionally — so the resolution was fetched
   * and then thrown away, and EVERY number received an SMS: one registered to
   * someone else, one registered to nobody, and one belonging to an account that
   * cannot use this portal.
   *
   * Note this gate runs only for phone. The email path keeps its existing
   * post-authentication check, because for email nothing is sent on the happy
   * path — a password or Google sign-in is instant and the refusal costs the
   * visitor nothing. `portal` is therefore only ever passed from here.
   */
  const choosePhoneEntryStep = async (knownPhone: string) => {
    const resolution = await resolveAuthIdentifier(knownPhone, portal);
    applyResolution(resolution);

    switch (resolvePhoneEntryStep(resolution)) {
      case "portal-rejected":
        // Nothing was sent, so there is nothing to roll back. The host owns the
        // alert; the card goes back to the gate behind it.
        onPortalRejected?.();
        go("identifier");
        return;
      case "phone-unknown":
        go("phone-unknown");
        return;
      case "phone-unverified":
        go("phone-unverified");
        return;
      default:
        go("phone-otp");
    }
  };

  /**
   * The escape offered when a number cannot sign in yet: sign in with the
   * address the account already has, which always works, and verify the phone
   * from inside the account afterwards.
   */
  const continueWithLinkedEmail = async () => {
    if (!linkedEmail) {
      go("identifier");
      return;
    }
    setEmail(linkedEmail);
    setPhone("");
    await chooseEmailEntryStep(linkedEmail);
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
      // Seeds the field from whatever the flow already knows, so returning to
      // correct an address is an edit rather than a retype. Empty on a cold start
      // and after "Not you?", where the visitor wants a different account.
      initialIdentifier={email}
      onEmailKnown={async (knownEmail) => {
        setEmail(knownEmail);
        setPhone("");
        await chooseEmailEntryStep(knownEmail);
      }}
      onPhoneKnown={async (knownPhone) => {
        setPhone(knownPhone);
        setEmail("");
        setPhoneFromMethods(false);
        setActiveMethod("phone");
        await choosePhoneEntryStep(knownPhone);
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

    // A phone that resolves to no account. Deliberately not a bare refusal: the
    // visitor has told us what they hold, so the useful thing is the step they
    // actually need, with the reason stated.
    case "phone-unknown":
      content = (
        <div className="mx-auto w-full max-w-md space-y-4 py-4 text-center">
          <h3 className="text-xl font-semibold text-slate-900">
            {t("phoneNoAccountTitle", "No account uses this number")}
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            {t("phoneNoAccountBody", "No Local Cooks account is linked to")}
          </p>
          <p className="text-base font-medium text-slate-900">{phone}</p>
          <p className="text-sm leading-6 text-slate-600">
            {t("phoneNoAccountHint", "Create an account to get started, or try a different email or phone number.")}
          </p>
          <Button type="button" onClick={() => go("register")} className="w-full rounded-xl">
            {t("createAccountCta", "Create an account")}
          </Button>
          <Button type="button" variant="outline" onClick={() => go("identifier")} className="w-full rounded-xl">
            {t("useDifferentEmailOrPhone", "Use a different email or phone number")}
          </Button>
        </div>
      );
      break;

    // The number belongs to an account but has never been proved, so it is not
    // yet a sign-in method. Email is the primary identifier and always works, so
    // the visitor is sent there instead of being left at a dead end — and can
    // verify the phone from inside the account afterwards.
    case "phone-unverified":
      content = (
        <div className="mx-auto w-full max-w-md space-y-4 py-4 text-center">
          <h3 className="text-xl font-semibold text-slate-900">
            {t("phoneUnverifiedTitle", "This number can't sign you in yet")}
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            {t("phoneUnverifiedBody", "Phone sign-in turns on once you've verified the number from inside your account. Until then, email is the way in.")}
          </p>
          {maskedEmail && (
            <p className="text-sm text-slate-500">
              {t("accountEmailHint", "Your account's email")}:{" "}
              <span className="font-medium text-slate-900">{maskedEmail}</span>
            </p>
          )}
          <Button type="button" onClick={continueWithLinkedEmail} className="w-full rounded-xl">
            {t("continueWithEmail", "Continue with email")}
          </Button>
          <Button type="button" variant="outline" onClick={() => go("identifier")} className="w-full rounded-xl">
            {t("useDifferentEmailOrPhone", "Use a different email or phone number")}
          </Button>
        </div>
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
          onSentStateChange={setLoginSent}
          onUseDifferentEmail={() => go("identifier")}
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
          // Routed through the SAME gate as the identifier step. Going straight to
          // "phone-otp" here would have been a way around it: a gate with a bypass
          // is not a gate. (Unreachable today, because `methods` only ever
          // contains "phone" when Firebase holds a phone credential and no account
          // in this project has one — so do NOT feed the database phone number into
          // `resolveAuthMethods` without keeping this call.)
          onTextCode={availableMethods.includes("phone") && activeMethod !== "phone" ? () => {
            const target = linkedPhone || phone;
            if (!target) { go("identifier"); return; }
            setActiveMethod("phone");
            setPhone(target);
            setPhoneFromMethods(true);
            void choosePhoneEntryStep(target);
          } : undefined}
          onGoogle={availableMethods.includes("google") && activeMethod !== "google" ? handleGoogleSignIn : undefined}
          onDifferentIdentifier={() => { setEmail(""); setPhone(""); setMaskedPhone(null); setMaskedEmail(null); setLinkedPhone(null); setLinkedEmail(null); setAvailableMethods([]); setAccountState("unavailable"); setPhoneFromMethods(false); setAutoSendEmailLink(false); go("identifier"); }}
        />
      );
      break;

    case "register":
      content = (
        <>
          <EnhancedRegisterForm
            {...registerProps}
            initialEmail={email}
          />
          {allowBack && (
            // The Airbnb shape: one primary action, then a plain-text route to
            // the other. A "← Back" control ABOVE the form reads as a wizard
            // step and buries the likelier intent — "I already have an account"
            // — behind an arrow that says nothing about signing in. Gated on
            // `allowBack` so flows that must not switch identity mid-way
            // (kitchen applications) keep neither affordance.
            <p className="pt-6 text-center text-sm text-slate-600">
              {t("alreadyHaveAccount", "Already have an account?")}{" "}
              <button
                type="button"
                onClick={() => {
                  // Leaving the register step abandons any Google registration started
                  // here. There is no page load on this path, so the load-time sweep
                  // never runs and the orphaned Firebase identity — the thing that makes
                  // the address look registered — would survive.
                  onDiscardPendingGoogleRegistration?.();
                  go("identifier");
                }}
                // index.css forces min-height/min-width 44px on EVERY button,
                // which would blow this inline link out of its line. `!` prefix
                // (Tailwind v3) beats the unlayered rule.
                className="!min-h-0 !min-w-0 font-medium text-[#E00A38] underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {t("loginLink", "Log in")}
              </button>
            </p>
          )}
        </>
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
  // `login` reaches `methods` through onTryAnotherWay, which is only passed when
  // a second method exists — so a single-method account (email-link only, or
  // password only) had no route back to the identifier step at all. Show the back
  // control in exactly that case.
  //
  // `register` no longer uses it: it carries an explicit "Already have an
  // account? Log in" link instead, which names the destination.
  //
  // `loginSent` suppresses it in the email-link sent state. That state now carries its own
  // named escape ("Wrong email? Use a different email"), so an arrow above it would be a
  // second, wordless route to the same place — and the one control that made the state look
  // like a wizard step rather than a destination.
  const showBack =
    allowBack && step === "login" && !hasAlternativeMethod && !loginSent;

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
