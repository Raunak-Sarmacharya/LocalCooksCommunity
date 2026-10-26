/**
 * "Join [kitchen]" (owner, Oct 24): a kitchen added this person as a customer and emailed them this link. They sign in
 * or create an account with the invited email, agree to the kitchen's terms, and join. The token is in the URL
 * fragment, so it never reaches a server log; it only travels in request bodies.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import KitchenJourneyAuth from "@/components/auth/KitchenJourneyAuth";

type Invite = { status: string; email: string; fullName: string; locationId: number; locationName: string; address?: string | null; termsUrl?: string | null;
  requirementsChoice: string; imageUrl?: string | null };

export default function JoinKitchenPage() {
  const { t } = useTranslation("chef");
  const { t: tc } = useTranslation("common");
  const [, navigate] = useLocation();
  const { refreshUserData } = useFirebaseAuth();
  const token = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadError, setLoadError] = useState("");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(auth.currentUser);
  const [agreed, setAgreed] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => onAuthStateChanged(auth, setFirebaseUser), []);
  useEffect(() => {
    if (!token) { setLoadError(t("joinInvalid", "This invitation link isn’t valid. Ask the kitchen to send it again.")); return; }
    void fetch("/api/public/customer-invites/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async response => { const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error); setInvite(data); })
      .catch(readError => setLoadError(readError?.message || t("joinInvalid", "This invitation link isn’t valid. Ask the kitchen to send it again.")));
  }, [token, t]);

  const join = async () => {
    setJoining(true); setError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/firebase/chef/customer-invites/accept", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }, body: JSON.stringify({ token }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || t("joinFailed", "We couldn’t add you just now. Please try again."));
      // Accepting verified the email: pick that up before moving on.
      await auth.currentUser?.reload().catch(() => undefined);
      await refreshUserData({ forceToken: true }).catch(() => null);
      navigate(`/dashboard?view=kitchen-requests&application=${data.applicationId}&sent=joined`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : t("joinFailed", "We couldn’t add you just now. Please try again."));
    } finally { setJoining(false); }
  };

  const open = invite?.status === "sent";
  const signedInAs = firebaseUser?.email?.toLowerCase() || null;
  const wrongAccount = !!(signedInAs && invite && signedInAs !== invite.email.toLowerCase());
  const kitchen = invite?.locationName;
  // What happens after joining, in the kitchen's chosen way (the same three steps the kitchen page tracks).
  const steps = !invite ? [] : [
    { title: t("joinStepJoin", "Join"), note: t("joinStepJoinNote", "Now, about 2 minutes"), now: true },
    ...(invite.requirementsChoice === "customer" ? [{ title: t("trRequirements", "Booking requirements"), note: t("joinStepSend", "Send what the kitchen asks for") }]
      : invite.requirementsChoice === "uploaded" ? [{ title: t("trRequirements", "Booking requirements"), note: t("joinStepOnFile", "The kitchen has your documents; send anything still missing") }] : []),
    { title: t("joinStepBook", "Book"), note: invite.requirementsChoice === "customer" ? t("joinStepBookAfterCheck", "Once the kitchen checks them")
      : invite.requirementsChoice === "uploaded" ? t("joinStepBookUnlessMissing", "Once nothing is missing") : t("joinStepBookRightAway", "Right after you join") },
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* The same lockup as the top bar. */}
      <header className="px-5 py-4 sm:px-10 sm:py-5">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <Logo variant="brand" className="h-[30px] w-auto flex-shrink-0 sm:h-[34px]" />
          <span className="flex flex-col justify-center">
            <span className="font-logo text-[1.3rem] leading-[0.95] tracking-[-0.005em] text-[#E10939] sm:text-[1.45rem]">LocalCooks</span>
            <span className="mt-[3px] text-[8.5px] font-semibold uppercase leading-none tracking-[0.16em] text-[#6B6B6B] sm:text-[9px]">{tc("forChefs")}</span>
          </span>
        </Link>
      </header>
      <main className={cn("mx-auto px-5 pb-12 pt-4 sm:px-10 sm:pt-8", invite && open ? "max-w-6xl" : "max-w-lg")}>
        {!invite && !loadError && <div className="space-y-3"><Skeleton className="aspect-[16/10] w-full rounded-2xl" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24 w-full" /></div>}
        {(loadError || (invite && !open)) && (
          <section className="space-y-2 pt-8">
            <h1 className="text-2xl font-semibold tracking-tight">{t("joinUnavailableTitle", "This invitation can’t be used")}</h1>
            <p className="text-muted-foreground">{loadError || (invite!.status === "accepted" ? t("joinAccepted", "This invitation was already accepted. Sign in to see your kitchens.")
              : invite!.status === "withdrawn" ? t("joinWithdrawn", "The kitchen withdrew this invitation.") : t("joinExpired", "This invitation has expired. Ask the kitchen to send it again."))}</p>
            {invite?.status === "accepted" && <Button className="mt-2" onClick={() => navigate("/dashboard?view=kitchen-requests")}>{t("joinGoToKitchens", "Go to my kitchens")}</Button>}
          </section>
        )}
        {invite && open && (
          <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
            <section aria-labelledby="join-title">
              {/* No photo on file: the title leads; an empty box would read as broken. */}
              {invite.imageUrl && <img src={invite.imageUrl} alt={kitchen} className="mb-6 aspect-[16/10] w-full rounded-2xl object-cover lg:aspect-[4/3]" />}
              <h1 id="join-title" className="text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">{t("joinTitle", "{kitchen} invited you to book its kitchen", { kitchen })}</h1>
              {invite.address && <p className="mt-1.5 text-muted-foreground">{invite.address}</p>}
              <ol className={cn("mt-6 grid gap-3", steps.length === 3 ? "grid-cols-3" : "grid-cols-2")} aria-label={t("joinStepsLabel", "What happens next")}>
                {steps.map(step => (
                  <li key={step.title} className={cn("border-t-[3px] pt-2.5", step.now ? "border-primary" : "border-border")} aria-current={step.now ? "step" : undefined}>
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="text-[13px] leading-snug text-muted-foreground">{step.note}</p>
                  </li>
                ))}
              </ol>
            </section>
            <section className="self-start rounded-2xl border bg-card p-5 sm:p-7" aria-label={t("joinSignInTitle", "Sign in or create your account")}>
              {!firebaseUser ? (
                <>
                  <KitchenJourneyAuth title={t("joinWithEmailTitle", "Join with your email")} initialEmail={invite.email} initialName={invite.fullName} lockEmail
                    description={t("joinSignInLead", "This invitation is for {email}, so your account uses it.", { email: invite.email })} subject={t("joinSubject", "invitation")} />
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t("joinNotYou", "Not you? Ask {kitchen} to send the invitation to the right address.", { kitchen })}</p>
                </>
              ) : wrongAccount ? (
                <div className="space-y-3">
                  <h2 className="text-lg font-semibold tracking-tight">{t("joinWrongAccountTitle", "Use the invited account")}</h2>
                  <p className="text-sm">{t("joinWrongAccount", "This invitation was sent to {invited}. You’re signed in as {current}.", { invited: invite.email, current: signedInAs })}</p>
                  <Button variant="outline" className="w-full" onClick={() => void signOut(auth)}>{t("joinSwitchAccount", "Sign out and use {invited}", { invited: invite.email })}</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold tracking-tight">{t("joinAgreeTitle", "Agree to the kitchen’s terms")}</h2>
                  <p className="text-sm text-muted-foreground">{t("joinSignedInAs", "Signed in as {email}", { email: signedInAs })}</p>
                  <label className="flex items-start gap-3 text-sm">
                    <Checkbox checked={agreed} onCheckedChange={checked => setAgreed(checked === true)} className="mt-0.5" />
                    <span>
                      {t("joinAgreeStart", "I agree to")}{" "}
                      {invite.termsUrl
                        ? <a href={invite.termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">{t("joinKitchenTerms", "{kitchen}’s terms", { kitchen })}</a>
                        : t("joinKitchenTerms", "{kitchen}’s terms", { kitchen })}
                      {" "}{t("joinAgreeAnd", "and the")}{" "}
                      <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">{t("joinLocalCooksTerms", "Local Cooks terms")}</a>.
                    </span>
                  </label>
                  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                  <Button className="w-full" disabled={!agreed || joining} onClick={() => void join()}>
                    {joining ? t("joinJoining", "Joining…") : t("joinButton", "Join {kitchen}", { kitchen })}
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
