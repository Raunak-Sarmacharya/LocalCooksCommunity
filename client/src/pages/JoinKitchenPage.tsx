/**
 * "Join [kitchen]" (owner, Oct 24): a kitchen added this person as a customer and emailed them this link. They sign in
 * or create an account with the invited email, agree to the kitchen's terms, and join. The token is in the URL
 * fragment, so it never reaches a server log; it only travels in request bodies.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import KitchenJourneyAuth from "@/components/auth/KitchenJourneyAuth";

type Invite = { status: string; email: string; fullName: string; locationId: number; locationName: string; address?: string | null; termsUrl?: string | null; requirementsChoice: string };

export default function JoinKitchenPage() {
  const { t } = useTranslation("chef");
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
      navigate(`/dashboard?view=kitchen-requests&application=${data.applicationId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : t("joinFailed", "We couldn’t add you just now. Please try again."));
    } finally { setJoining(false); }
  };

  const open = invite?.status === "sent";
  const signedInAs = firebaseUser?.email?.toLowerCase() || null;
  const wrongAccount = !!(signedInAs && invite && signedInAs !== invite.email.toLowerCase());
  const next = invite?.requirementsChoice === "customer"
    ? t("joinNextRequirements", "After you join, you’ll send {kitchen} its booking requirements. You can book once they’re approved.", { kitchen: invite?.locationName })
    : invite?.requirementsChoice === "uploaded"
      ? t("joinNextUploaded", "{kitchen} already has your documents on file. If anything else is needed, you’ll see it after you join.", { kitchen: invite?.locationName })
      : t("joinNextBook", "You can book {kitchen} as soon as you join.", { kitchen: invite?.locationName });

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center px-5 py-10">
      {!invite && !loadError && <div className="space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24 w-full" /></div>}
      {loadError && (
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("joinUnavailableTitle", "This invitation can’t be used")}</h1>
          <p className="text-muted-foreground">{loadError}</p>
        </section>
      )}
      {invite && !open && (
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("joinUnavailableTitle", "This invitation can’t be used")}</h1>
          <p className="text-muted-foreground">{invite.status === "accepted" ? t("joinAccepted", "This invitation was already accepted. Sign in to see your kitchens.")
            : invite.status === "withdrawn" ? t("joinWithdrawn", "The kitchen withdrew this invitation.") : t("joinExpired", "This invitation has expired. Ask the kitchen to send it again.")}</p>
          {invite.status === "accepted" && <Button className="mt-2" onClick={() => navigate("/dashboard?view=kitchen-requests")}>{t("joinGoToKitchens", "Go to my kitchens")}</Button>}
        </section>
      )}
      {invite && open && (
        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("joinTitle", "{kitchen} invited you to book its kitchen", { kitchen: invite.locationName })}</h1>
            {invite.address && <p className="text-sm text-muted-foreground">{invite.address}</p>}
            <p className="text-sm text-foreground">{next}</p>
          </header>
          {!firebaseUser ? (
            <KitchenJourneyAuth title={t("joinSignInTitle", "Sign in or create your account")} initialEmail={invite.email}
              description={t("joinSignInLead", "Use {email}, the address this invitation was sent to.", { email: invite.email })} subject={t("joinSubject", "invitation")} />
          ) : wrongAccount ? (
            <section className="space-y-3 rounded-xl border p-5">
              <p className="text-sm">{t("joinWrongAccount", "This invitation was sent to {invited}. You’re signed in as {current}.", { invited: invite.email, current: signedInAs })}</p>
              <Button variant="outline" onClick={() => void signOut(auth)}>{t("joinSwitchAccount", "Sign out and use {invited}", { invited: invite.email })}</Button>
            </section>
          ) : (
            <section className="space-y-4 rounded-xl border p-5">
              <p className="text-sm text-muted-foreground">{t("joinSignedInAs", "Signed in as {email}", { email: signedInAs })}</p>
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={agreed} onCheckedChange={checked => setAgreed(checked === true)} className="mt-0.5" />
                <span>
                  {t("joinAgreeStart", "I agree to")}{" "}
                  {invite.termsUrl
                    ? <a href={invite.termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">{t("joinKitchenTerms", "{kitchen}’s terms", { kitchen: invite.locationName })}</a>
                    : t("joinKitchenTerms", "{kitchen}’s terms", { kitchen: invite.locationName })}
                  {" "}{t("joinAgreeAnd", "and the")}{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">{t("joinLocalCooksTerms", "Local Cooks terms")}</a>.
                </span>
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" disabled={!agreed || joining} onClick={() => void join()}>
                {joining ? t("joinJoining", "Joining…") : t("joinButton", "Join {kitchen}", { kitchen: invite.locationName })}
              </Button>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
