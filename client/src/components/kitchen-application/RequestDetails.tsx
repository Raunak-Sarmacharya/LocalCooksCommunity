/**
 * "Your details" on the one-page request to cook (owner, Oct 23). Smart about the email, as top booking flows are:
 * signed in, it shows who is sending; signed out, the email is checked when entered: an existing account signs in
 * right here (the code is sent at once; Google or password if the account has them), a new email asks only for the
 * name and mobile number the account needs. The account itself is created when the request is sent.
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
import { normalizePhoneNumber, isValidNorthAmericanPhone } from "@shared/phone-validation";

export type RequestIdentity = { fullName: string; email: string; phone: string };
export type DetailsMode = "signed-in" | "email" | "existing" | "new";

const EMAIL = /^\S+@\S+\.\S+$/;
const mask = (email: string) => { const [name = "", domain = ""] = email.split("@"); return domain ? `${name.slice(0, 2)}***@${domain}` : email; };

export function RequestDetails({ profilePhone, showErrors, onChange }: {
  profilePhone?: string | null;
  /** True once Send was pressed, so missing details are named then and not before. */
  showErrors: boolean;
  onChange: (state: { mode: DetailsMode; identity: RequestIdentity | null; ready: boolean }) => void;
}) {
  const { t } = useTranslation("kitchen");
  const { user, logout, sendSignInCode, signInWithEmailCode, signInWithGoogle, login } = useFirebaseAuth();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ email: string; state: "checking" | "existing" | "new"; methods: string[]; name?: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentFor = useRef<string | null>(null);
  // A field is marked wrong only after the visitor has left it (or pressed Send), never while they type.
  const [left, setLeft] = useState<Record<string, boolean>>({});
  const shown = (key: string) => showErrors || !!left[key];

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

  // When the email check opens the next fields, the cursor goes there (Tab had already moved past them).
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mode !== "new" && mode !== "existing") return;
    if (root.current?.contains(document.activeElement) && document.activeElement?.id !== "rd-email") return;
    const target = root.current?.querySelector<HTMLInputElement>(mode === "new" ? "#rd-name" : "input[autocomplete='one-time-code']");
    window.setTimeout(() => target?.focus(), 0);
  }, [mode]);

  const sendCode = async (target: string) => {
    setError(null);
    try { await sendSignInCode(target); setCooldown(30); }
    catch { setError(t("rdCodeSendFailed", { defaultValue: "We couldn’t send a code. Try again in a moment." })); }
  };

  // Check the email once it looks complete; an existing account gets its sign-in code straight away.
  const check = async (value: string) => {
    const target = value.trim().toLowerCase();
    if (!EMAIL.test(target) || lookup?.email === target) return;
    setLookup({ email: target, state: "checking", methods: [] });
    const result = await resolveAuthIdentifier(target, "chef");
    const existing = result.state === "existing" || result.state === "profile-incomplete";
    setLookup(current => current?.email === target ? { email: target, state: existing ? "existing" : "new", methods: result.methods } : current);
    if (existing && sentFor.current !== target) { sentFor.current = target; void sendCode(target); }
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

  if (signedIn) {
    return <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3" data-testid="request-details-signed-in">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{t("rdSendingAs", { defaultValue: "Sending as" })}</p>
        <p className="mt-0.5 break-words text-sm"><span className="font-medium">{identity?.fullName || user?.email}</span> · {user?.email}{profilePhone ? ` · ${profilePhone}` : ""}</p>
      </div>
      <button type="button" onClick={() => void logout()} className="!min-h-0 text-sm font-medium text-primary underline-offset-4 hover:underline">{t("rdNotYou", { defaultValue: "Not you?" })}</button>
    </div>;
  }

  const fieldError = (show: boolean, text: string, id: string) => show ? <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">{text}</p> : null;
  const link = "!min-h-0 font-medium text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline";

  return <div ref={root} className="space-y-4" data-testid={`request-details-${mode}`}>
    <div>
      <Label htmlFor="rd-email" className="text-sm font-medium">{t("rdEmail", { defaultValue: "Email" })}</Label>
      <Input id="rd-email" type="email" autoComplete="email" inputMode="email" className="mt-2 h-10" value={email}
        aria-invalid={showErrors && !EMAIL.test(email.trim())}
        onChange={event => { setEmail(event.target.value); if (lookup && lookup.email !== event.target.value.trim().toLowerCase()) { setLookup(null); setCode(""); setError(null); } }}
        onBlur={() => void check(email)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void check(email); } }} />
      {lookup?.state === "checking" && <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{t("rdChecking", { defaultValue: "Checking…" })}</p>}
      {mode === "new" && <p className="mt-1.5 text-xs text-muted-foreground">{t("rdNewHint", { defaultValue: "New to Local Cooks? We’ll create your account with this email when you send." })}</p>}
      {mode === "email" && fieldError(showErrors, t("rdEmailNeeded", { defaultValue: "Enter your email to send the request." }), "rd-email-error")}
    </div>

    {mode === "existing" && <div className="rounded-xl bg-[#FFF0F3] p-4" data-testid="request-details-sign-in">
      <p className="text-sm"><span className="font-medium">{t("rdWelcomeBack", { defaultValue: "Welcome back." })}</span>{" "}
        {usePassword ? t("rdPasswordLead", { defaultValue: "Enter your password to send this request from your account." })
          : t("rdCodeLead", { defaultValue: "You already have an account. Enter the 6-digit code we just emailed to {email} to send this request from it.", email: mask(lookup!.email) })}</p>
      {usePassword ? <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); void finish(() => login(lookup!.email, password)); }}>
        <Label htmlFor="rd-password" className="sr-only">{t("rdPassword", { defaultValue: "Password" })}</Label>
        <Input id="rd-password" type="password" autoComplete="current-password" className="h-10 bg-white" value={password} onChange={event => setPassword(event.target.value)} />
        <Button type="submit" disabled={busy || !password}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("rdSignIn", { defaultValue: "Sign in" })}</Button>
      </form> : <InputOTP id="rd-code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} inputMode="numeric" autoComplete="one-time-code" value={code} disabled={busy}
        aria-label={t("rdCodeLabel", { defaultValue: "Sign-in code" })}
        pasteTransformer={(pasted: string) => pasted.replace(/\D/g, "").slice(0, 6)}
        containerClassName="mt-3 w-full gap-2"
        onChange={next => { setCode(next); if (error) setError(null); }}
        onComplete={(next: string) => void finish(() => signInWithEmailCode(lookup!.email, next))}>
        <InputOTPGroup className="flex flex-1 gap-1.5">{[0, 1, 2].map(i => <InputOTPSlot key={i} index={i} className={cn("h-12 flex-1 rounded-lg border border-slate-200 bg-white text-lg font-semibold tabular-nums ring-inset ring-offset-0 first:rounded-lg last:rounded-lg", error && "border-red-300")} />)}</InputOTPGroup>
        <span aria-hidden className="h-px w-2.5 shrink-0 bg-slate-300" />
        <InputOTPGroup className="flex flex-1 gap-1.5">{[3, 4, 5].map(i => <InputOTPSlot key={i} index={i} className={cn("h-12 flex-1 rounded-lg border border-slate-200 bg-white text-lg font-semibold tabular-nums ring-inset ring-offset-0 first:rounded-lg last:rounded-lg", error && "border-red-300")} />)}</InputOTPGroup>
      </InputOTP>}
      {busy && !usePassword && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t("rdSigningIn", { defaultValue: "Signing you in…" })}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {!usePassword && <span>{t("rdNoCode", { defaultValue: "Didn’t get it?" })}{" "}
          <button type="button" className={link} disabled={cooldown > 0 || busy} onClick={() => void sendCode(lookup!.email)}>
            {cooldown > 0 ? t("rdResendIn", { defaultValue: "Send a new code in {seconds}s", seconds: cooldown }) : t("rdResend", { defaultValue: "Send a new code" })}</button></span>}
        {lookup!.methods.includes("google") && <button type="button" className={link} disabled={busy} onClick={() => void finish(() => signInWithGoogle(false))}>{t("rdUseGoogle", { defaultValue: "Use Google" })}</button>}
        {lookup!.methods.includes("password") && <button type="button" className={link} disabled={busy} onClick={() => { setUsePassword(p => !p); setError(null); }}>
          {usePassword ? t("rdUseCode", { defaultValue: "Use a code instead" }) : t("rdUsePassword", { defaultValue: "Use password" })}</button>}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{t("rdFromAccount", { defaultValue: "Your name and phone come from your account once you’re in." })}</p>
    </div>}

    {mode === "new" && <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="rd-name" className="text-sm font-medium">{t("rdFullName", { defaultValue: "Full name" })}</Label>
        <Input id="rd-name" autoComplete="name" className="mt-2 h-10" value={fullName} onChange={event => setFullName(event.target.value)} onBlur={() => setLeft(l => ({ ...l, name: true }))} aria-invalid={shown("name") && !nameOk} aria-describedby={shown("name") && !nameOk ? "rd-name-error" : undefined} />
        {fieldError(shown("name") && !nameOk, t("rdNameNeeded", { defaultValue: "Enter your full name." }), "rd-name-error")}
      </div>
      <div>
        <Label htmlFor="rd-phone" className="text-sm font-medium">{t("rdPhone", { defaultValue: "Mobile phone" })}</Label>
        <Input id="rd-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(709) 000-0000" className="mt-2 h-10" value={phone} onChange={event => setPhone(event.target.value)} onBlur={() => setLeft(l => ({ ...l, phone: true }))} aria-invalid={shown("phone") && !phoneOk} aria-describedby={shown("phone") && !phoneOk ? "rd-phone-error" : undefined} />
        {fieldError(shown("phone") && !phoneOk, t("rdPhoneNeeded", { defaultValue: "Enter a valid mobile number." }), "rd-phone-error")}
      </div>
    </div>}
  </div>;
}
