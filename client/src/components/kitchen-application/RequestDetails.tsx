/**
 * "Your details" on the one-page request to cook (owner, Oct 23). Smart about the email, as top booking flows are:
 * signed in, it shows who is sending; signed out, the email is checked when entered: an existing account signs in
 * right here (the code is sent at once; Google or password if the account has them), a new email asks only for the
 * name and mobile number the account needs. Send then emails a 6-digit code (useConfirmByCode + EmailCodeStep): the
 * account is created only once the code proves the inbox, already verified (owner, Oct 26).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { resolveAuthIdentifier } from "@/lib/login-challenge";
import { cn } from "@/lib/utils";
import { normalizePhoneNumber, isValidNorthAmericanPhone, formatPhoneForDisplay } from "@shared/phone-validation";
import { duplicateAccountKind } from "@/lib/registration-error";
import GoogleIcon from "@/components/auth/GoogleIcon";
import { useIsChefShell } from "@/layouts/chef-shell-context";

export type RequestIdentity = { fullName: string; email: string; phone: string };
export type DetailsMode = "signed-in" | "email" | "existing" | "new";

const EMAIL = /^\S+@\S+\.\S+$/;
/** Required mark: the asterisk is for the eye, aria-required on the field is for screen readers. */
const Req = () => <span aria-hidden className="ml-0.5 text-destructive">*</span>;

function CodeInput({ value, onChange, onComplete, disabled, invalid, label }: {
  value: string; onChange: (value: string) => void; onComplete: (code: string) => void; disabled: boolean; invalid: boolean; label: string;
}) {
  const slot = cn("h-12 flex-1 rounded-lg border border-slate-200 bg-white text-lg font-semibold tabular-nums ring-inset ring-offset-0 first:rounded-lg last:rounded-lg", invalid && "border-red-300");
  return <InputOTP maxLength={6} pattern={REGEXP_ONLY_DIGITS} inputMode="numeric" autoComplete="one-time-code" value={value} disabled={disabled}
    aria-label={label} pasteTransformer={(pasted: string) => pasted.replace(/\D/g, "").slice(0, 6)} containerClassName="mt-3 w-full gap-2"
    onChange={onChange} onComplete={onComplete}>
    <InputOTPGroup className="flex flex-1 gap-1.5">{[0, 1, 2].map(i => <InputOTPSlot key={i} index={i} className={slot} />)}</InputOTPGroup>
    <span aria-hidden className="h-px w-2.5 shrink-0 bg-slate-300" />
    <InputOTPGroup className="flex flex-1 gap-1.5">{[3, 4, 5].map(i => <InputOTPSlot key={i} index={i} className={slot} />)}</InputOTPGroup>
  </InputOTP>;
}
const mask = (email: string) => { const [name = "", domain = ""] = email.split("@"); return domain ? `${name.slice(0, 2)}***@${domain}` : email; };

export function RequestDetails({ profilePhone, showErrors, onChange, phoneError }: {
  profilePhone?: string | null;
  /** A refusal for the typed number (already on another account); shown under the field until the number changes. */
  phoneError?: string | null;
  /** True once Send was pressed, so missing details are named then and not before. */
  showErrors: boolean;
  onChange: (state: { mode: DetailsMode; identity: RequestIdentity | null; ready: boolean }) => void;
}) {
  const { t } = useTranslation("kitchen");
  const { user, logout, sendSignInCode, signInWithEmailCode, signInWithGoogle, login } = useFirebaseAuth();
  const inShell = useIsChefShell();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ email: string; state: "checking" | "existing" | "new" | "kitchen"; methods: string[]; name?: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // The address a sign-in code went to. Nothing is emailed until the visitor asks (owner, Oct 26).
  const [sentTo, setSentTo] = useState<string | null>(null);
  // A field is marked wrong only after the visitor has left it (or pressed Send), never while they type.
  const [left, setLeft] = useState<Record<string, boolean>>({});
  const shown = (key: string) => showErrors || !!left[key];
  const [refusedPhone, setRefusedPhone] = useState<string | null>(null);

  useEffect(() => { if (cooldown <= 0) return; const id = window.setTimeout(() => setCooldown(c => c - 1), 1000); return () => window.clearTimeout(id); }, [cooldown]);

  const signedIn = !!user;
  const mode: DetailsMode = signedIn ? "signed-in" : lookup?.state === "existing" ? "existing" : lookup?.state === "new" ? "new" : "email";
  const normalizedPhone = normalizePhoneNumber(phone) || "";
  const identity: RequestIdentity | null = signedIn
    ? { fullName: user?.displayName || user?.fullName || "", email: user?.email || "", phone: profilePhone || "" }
    : mode === "new" ? { fullName: fullName.trim(), email: email.trim().toLowerCase(), phone: normalizedPhone } : null;
  const nameOk = (identity?.fullName.trim().length ?? 0) >= 2;
  const phoneOk = !!identity?.phone && isValidNorthAmericanPhone(identity.phone);
  const ready = !!identity && EMAIL.test(identity.email) && nameOk && (signedIn || phoneOk);

  useEffect(() => { onChange({ mode, identity, ready }); }, [mode, identity?.fullName, identity?.email, identity?.phone, ready]);

  // A refused number: remember which one, bring the field into view and put the cursor in it.
  useEffect(() => {
    if (!phoneError) return;
    setRefusedPhone(normalizePhoneNumber(phone) || phone);
    const field = root.current?.querySelector<HTMLInputElement>("#rd-phone");
    field?.scrollIntoView({ behavior: "smooth", block: "center" }); field?.focus({ preventScroll: true });
  }, [phoneError]);
  const phoneRefused = !!phoneError && refusedPhone === (normalizePhoneNumber(phone) || phone);

  // When the email check opens the next fields, the cursor goes there (Tab had already moved past them).
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mode === "new" && root.current?.contains(document.activeElement) && document.activeElement?.id !== "rd-email") return;
    const target = mode === "new" ? root.current?.querySelector<HTMLInputElement>("#rd-name")
      : mode === "existing" && sentTo ? root.current?.querySelector<HTMLInputElement>("input[autocomplete='one-time-code']") : null;
    window.setTimeout(() => target?.focus(), 0);
  }, [mode, sentTo]);

  const sendCode = async (target: string) => {
    setError(null); setBusy(true);
    try { await sendSignInCode(target); setSentTo(target); setUsePassword(false); setCooldown(30); }
    catch { setError(t("rdCodeSendFailed", { defaultValue: "We couldn’t send a code. Try again in a moment." })); }
    finally { setBusy(false); }
  };

  // Check the email once it looks complete; an existing account gets its sign-in code straight away.
  const check = async (value: string) => {
    const target = value.trim().toLowerCase();
    if (!EMAIL.test(target) || lookup?.email === target) return;
    setLookup({ email: target, state: "checking", methods: [] });
    const result = await resolveAuthIdentifier(target, "chef");
    // A login without its app account (sign-up never finished) is new here: the code sign-up completes it.
    const existing = result.state === "existing";
    // A kitchen (manager) account can't request kitchen time: say so before anything is emailed.
    const state = existing && result.portalAllowed === false ? "kitchen" : existing ? "existing" : "new";
    setLookup(current => current?.email === target ? { email: target, state, methods: result.methods } : current);
  };

  const finish = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) {
      const message = e instanceof Error ? e.message : "";
      setCode("");
      setError(message === "code-wrong" ? t("rdCodeWrong", { defaultValue: "That code isn’t right. Try again." })
        : message === "code-expired" ? t("rdCodeExpired", { defaultValue: "That code has expired or was already used. Send a new one." })
        : message.includes("too-many-requests") ? t("rdTooMany", { defaultValue: "Too many attempts. Wait a few minutes and try again." })
        : usePassword ? t("rdPasswordWrong", { defaultValue: "That password isn’t right." })
        : t("rdSignInFailed", { defaultValue: "We couldn’t sign you in. Try again." }));
    } finally { setBusy(false); }
  };

  // Inside the app there is no "Not you?": the details simply come from the profile, editable there (owner, Oct 25).
  if (signedIn && inShell) {
    return <p className="text-sm text-foreground/80" data-testid="request-details-profile">
      {t("rdFromProfile", "From your profile:")} <span className="font-medium text-foreground">{identity?.fullName || user?.email}</span> · {user?.email}{profilePhone ? ` · ${formatPhoneForDisplay(profilePhone)}` : ""}
      {" · "}<a href="/dashboard?view=profile" className="font-medium text-primary underline-offset-4 hover:underline">{t("rdEditProfile", "Edit")}</a></p>;
  }
  if (signedIn) {
    return <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3" data-testid="request-details-signed-in">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{t("rdSendingAs", { defaultValue: "Sending as" })}</p>
        <p className="mt-0.5 break-words text-sm"><span className="font-medium">{identity?.fullName || user?.email}</span> · {user?.email}{profilePhone ? ` · ${formatPhoneForDisplay(profilePhone)}` : ""}</p>
      </div>
      <button type="button" onClick={() => void logout()} className="!min-h-0 text-sm font-medium text-primary underline-offset-4 hover:underline">{t("rdNotYou", { defaultValue: "Not you?" })}</button>
    </div>;
  }

  const fieldError = (show: boolean, text: string, id: string) => show ? <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">{text}</p> : null;
  const link = "!min-h-0 font-medium text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline";
  const codeOut = !!lookup && sentTo === lookup.email;

  return <div ref={root} className="space-y-4" data-testid={`request-details-${mode}`}>
    <div>
      <Label htmlFor="rd-email" className="text-sm font-medium">{t("rdEmail", { defaultValue: "Email" })}<Req /></Label>
      <Input id="rd-email" type="email" autoComplete="email" inputMode="email" className="mt-2 h-10" value={email} aria-required="true"
        aria-invalid={lookup?.state === "kitchen" || (showErrors && !EMAIL.test(email.trim()))}
        onChange={event => { setEmail(event.target.value); if (lookup && lookup.email !== event.target.value.trim().toLowerCase()) { setLookup(null); setCode(""); setError(null); setSentTo(null); setUsePassword(false); } }}
        onBlur={() => void check(email)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void check(email); } }} />
      {lookup?.state === "checking" && <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{t("rdChecking", { defaultValue: "Checking…" })}</p>}
      {mode === "new" && <p className="mt-1.5 text-xs text-muted-foreground">{t("rdNewHintCode", { defaultValue: "New to Local Cooks? When you send, we’ll email you a code to confirm this address." })}</p>}
      {lookup?.state === "kitchen" ? fieldError(true, t("rdKitchenAccount", { defaultValue: "This email is used for a kitchen account. Use a different email to request kitchen time." }), "rd-email-error")
        : mode === "email" && fieldError(showErrors, t("rdEmailNeeded", { defaultValue: "Enter your email to send the request." }), "rd-email-error")}
    </div>

    {mode === "existing" && <div className="rounded-xl bg-[#FFF0F3] p-4 sm:p-5" data-testid="request-details-sign-in">
      <p className="text-sm font-semibold text-foreground">{t("rdWelcomeBack", { defaultValue: "Welcome back." })}</p>
      <p className="mt-1 text-sm leading-6 text-foreground/80">
        {usePassword ? t("rdPasswordLead", { defaultValue: "Enter your password to send this request from your account." })
          : codeOut ? t("rdCodeSentLead", { defaultValue: "Enter the 6-digit code we emailed to {email}.", email: mask(lookup!.email) })
          : t("rdSignInLead", { defaultValue: "You already have a Local Cooks account. Sign in to send this request from it." })}</p>
      {/* Not a <form>: this sits inside the request form, and a nested form's button submits the outer one. */}
      {usePassword ? <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Label htmlFor="rd-password" className="sr-only">{t("rdPassword", { defaultValue: "Password" })}</Label>
        <Input id="rd-password" type="password" autoComplete="current-password" autoFocus className="h-11 bg-white" value={password} onChange={event => setPassword(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (password) void finish(() => login(lookup!.email, password)); } }} />
        <Button type="button" className="h-11 sm:px-6" disabled={busy || !password} onClick={() => void finish(() => login(lookup!.email, password))}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("rdSignIn", { defaultValue: "Sign in" })}</Button>
      </div> : codeOut ? <CodeInput value={code} disabled={busy} invalid={!!error} label={t("rdCodeLabel", { defaultValue: "Sign-in code" })}
        onChange={next => { setCode(next); if (error) setError(null); }}
        onComplete={next => void finish(() => signInWithEmailCode(lookup!.email, next))} />
      : <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" className="h-11 sm:px-6" disabled={busy} onClick={() => void sendCode(lookup!.email)} data-testid="request-details-email-code">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}{t("rdEmailMeCode", { defaultValue: "Email me a code" })}</Button>
        {lookup!.methods.includes("password") && <Button type="button" variant="outline" className="h-11 bg-white" disabled={busy} onClick={() => { setUsePassword(true); setError(null); }}>
          {t("rdUsePassword", { defaultValue: "Use password" })}</Button>}
        {lookup!.methods.includes("google") && <Button type="button" variant="outline" className="h-11 gap-2 bg-white" disabled={busy} onClick={() => void finish(() => signInWithGoogle(false))}>
          <GoogleIcon className="h-4 w-4" aria-hidden />{t("rdContinueGoogle", { defaultValue: "Continue with Google" })}</Button>}
      </div>}
      {busy && codeOut && !usePassword && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t("rdSigningIn", { defaultValue: "Signing you in…" })}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {(codeOut || usePassword) && <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {codeOut && !usePassword && <span>{t("rdNoCode", { defaultValue: "Didn’t get it?" })}{" "}
          <button type="button" className={link} disabled={cooldown > 0 || busy} onClick={() => void sendCode(lookup!.email)}>
            {cooldown > 0 ? t("rdResendIn", { defaultValue: "Send a new code in {seconds}s", seconds: cooldown }) : t("rdResend", { defaultValue: "Send a new code" })}</button></span>}
        {usePassword && <button type="button" className={link} disabled={busy} onClick={() => void sendCode(lookup!.email)}>{t("rdEmailCodeInstead", { defaultValue: "Email me a code instead" })}</button>}
        {codeOut && !usePassword && lookup!.methods.includes("password") && <button type="button" className={link} disabled={busy} onClick={() => { setUsePassword(true); setError(null); }}>{t("rdUsePassword", { defaultValue: "Use password" })}</button>}
        {lookup!.methods.includes("google") && <button type="button" className={link} disabled={busy} onClick={() => void finish(() => signInWithGoogle(false))}>{t("rdUseGoogle", { defaultValue: "Use Google" })}</button>}
      </p>}
      <p className="mt-3 text-xs text-muted-foreground">{t("rdFromAccount", { defaultValue: "Your name and phone come from your account once you’re in." })}</p>
    </div>}

    {mode === "new" && <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="rd-name" className="text-sm font-medium">{t("rdFullName", { defaultValue: "Full name" })}<Req /></Label>
        <Input id="rd-name" autoComplete="name" aria-required="true" className="mt-2 h-10" value={fullName} onChange={event => setFullName(event.target.value)} onBlur={() => setLeft(l => ({ ...l, name: true }))} aria-invalid={shown("name") && !nameOk} aria-describedby={shown("name") && !nameOk ? "rd-name-error" : undefined} />
        {fieldError(shown("name") && !nameOk, t("rdNameNeeded", { defaultValue: "Enter your full name." }), "rd-name-error")}
      </div>
      <div>
        <Label htmlFor="rd-phone" className="text-sm font-medium">{t("rdPhone", { defaultValue: "Mobile phone" })}<Req /></Label>
        <Input id="rd-phone" aria-required="true" type="tel" inputMode="tel" autoComplete="tel" placeholder="(709) 000-0000" className="mt-2 h-10" value={phone} onChange={event => setPhone(event.target.value)} onBlur={() => setLeft(l => ({ ...l, phone: true }))} aria-invalid={(shown("phone") && !phoneOk) || phoneRefused} aria-describedby={(shown("phone") && !phoneOk) || phoneRefused ? "rd-phone-error" : undefined} />
        {phoneRefused ? fieldError(true, phoneError!, "rd-phone-error")
          : fieldError(shown("phone") && !phoneOk, t("rdPhoneNeeded", { defaultValue: "Enter a valid mobile number." }), "rd-phone-error")}
      </div>
    </div>}
  </div>;
}

type CodeTarget = { email: string; identity: RequestIdentity | null };

/**
 * The request goes only from a confirmed email (owner, Oct 26). New email: a code first, then the account is created,
 * already verified. Signed in but unverified: a sign-in code to the account's email, which verifies it. Either way
 * `onConfirmed` then sends the request; nothing is held on the server.
 */
export function useConfirmByCode(onConfirmed: () => void | Promise<void>) {
  const { t, i18n } = useTranslation("kitchen");
  const { user, sendSignInCode, signInWithEmailCode, sendSignUpCode, signUpWithEmailCode, refreshUserData } = useFirebaseAuth();
  const [target, setTarget] = useState<CodeTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** "phone" when the typed number is on another account: the page shows it under the phone field. */
  const [errorField, setErrorField] = useState<"phone" | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const id = window.setTimeout(() => setCooldown(c => c - 1), 1000); return () => window.clearTimeout(id); }, [cooldown]);

  const word =(e: unknown) => {
    const message = e instanceof Error ? e.message : "";
    // One account per email and per phone: name which one is taken, so the chef knows what to change.
    const taken = duplicateAccountKind(e);
    if (taken === "phone") return t("rdPhoneTaken", { defaultValue: "This number is already on another Local Cooks account. Use a different number, or sign in with that account’s email." });
    if (taken === "email") return t("rdAccountExists", { defaultValue: "This email already has an account. Re-enter it above to sign in." });
    return message === "code-wrong" ? t("rdCodeWrong", { defaultValue: "That code isn’t right. Try again." })
      : message === "code-expired" ? t("rdCodeExpired", { defaultValue: "That code has expired or was already used. Send a new one." })
      : message.includes("too-many-requests") ? t("rdTooMany", { defaultValue: "Too many attempts. Wait a few minutes and try again." })
      : message === "account-exists" ? t("rdAccountExists", { defaultValue: "This email already has an account. Re-enter it above to sign in." })
      : message === "profile-invalid" ? t("rdProfileInvalid", { defaultValue: "Check your full name and mobile number, then send again." })
      : message === "code-send-failed" ? t("rdCodeSendFailed", { defaultValue: "We couldn’t send a code. Try again in a moment." })
      : t("rtcSendFailed", { defaultValue: "We couldn’t send your request. Try again." });
  };
  const send = async (next: CodeTarget) => {
    if (user) await sendSignInCode(next.email);
    else await sendSignUpCode(next.email, i18n.language, { fullName: next.identity!.fullName, phone: next.identity!.phone });
    setCooldown(30);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setErrorField(null);
    try { await action(); } catch (e) { setError(word(e)); setErrorField(duplicateAccountKind(e) === "phone" ? "phone" : null); } finally { setBusy(false); }
  };
  return {
    target, busy, error, errorField, cooldown,
    /** Signed in: the account's own email. Signed out: the details just typed. */
    start: (identity: RequestIdentity | null) => run(async () => {
      const next = { email: user?.email || identity?.email || "", identity };
      await send(next);
      setTarget(next);
    }),
    resend: () => target && run(() => send(target)),
    confirm: (code: string) => target && run(async () => {
      if (user) { await signInWithEmailCode(target.email, code); await refreshUserData({ forceToken: true }); }
      else await signUpWithEmailCode({ email: target.email, code, fullName: target.identity!.fullName, phone: target.identity!.phone, termsAccepted: true });
      // The code step (and its "Confirming and sending…") stays until the request is sent; hiding it first flashed the form back.
      try { await onConfirmed(); } finally { setTarget(null); }
    }),
    cancel: () => { setTarget(null); setError(null); setErrorField(null); },
  };
}

export function EmailCodeStep({ flow, newAccount }: { flow: ReturnType<typeof useConfirmByCode>; newAccount: boolean }) {
  const { t } = useTranslation("kitchen");
  const [code, setCode] = useState("");
  const link = "!min-h-0 font-medium text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline";
  useEffect(() => { if (flow.error) setCode(""); }, [flow.error]);
  if (!flow.target) return null;
  return <div className="rounded-xl bg-[#FFF0F3] p-4" data-testid="email-code-step">
    <p className="text-sm font-medium">{t("rdConfirmTitle", { defaultValue: "Check your email" })}</p>
    <p className="mt-1 text-sm">{newAccount
      ? t("rdConfirmLeadNew", { defaultValue: "Enter the 6-digit code we sent to {email}. Then we create your account and send your request.", email: mask(flow.target.email) })
      : t("rdConfirmLead", { defaultValue: "Enter the 6-digit code we sent to {email} to confirm it and send your request.", email: mask(flow.target.email) })}</p>
    <CodeInput value={code} disabled={flow.busy} invalid={!!flow.error} label={t("rdConfirmCodeLabel", { defaultValue: "Confirmation code" })}
      onChange={setCode} onComplete={next => void flow.confirm(next)} />
    {flow.busy && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t("rdConfirming", { defaultValue: "Confirming and sending…" })}</p>}
    {flow.error && <p role="alert" className="mt-2 text-sm text-destructive">{flow.error}</p>}
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>{t("rdNoCode", { defaultValue: "Didn’t get it?" })}{" "}
        <button type="button" className={link} disabled={flow.cooldown > 0 || flow.busy} onClick={() => void flow.resend()}>
          {flow.cooldown > 0 ? t("rdResendIn", { defaultValue: "Send a new code in {seconds}s", seconds: flow.cooldown }) : t("rdResend", { defaultValue: "Send a new code" })}</button></span>
      <button type="button" className={link} disabled={flow.busy} onClick={flow.cancel}>{newAccount ? t("rdChangeDetails", { defaultValue: "Change details" }) : t("rdCancelCode", { defaultValue: "Cancel" })}</button>
    </p>
  </div>;
}
