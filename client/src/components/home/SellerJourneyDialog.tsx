import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { getSellerJourneyDraft, saveSellerJourneyDraft } from "@/lib/seller-journey";
import { Icon } from "@iconify/react";
import KitchenJourneyAuth from "@/components/auth/KitchenJourneyAuth";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { hasVerifiedEmail } from "@/lib/auth-verification";

type Preference = "commercial" | "home" | "notSure";
type JourneyStage = "form" | "account";

export default function SellerJourneyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [kitchenPreference, setKitchenPreference] = useState<Preference | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<JourneyStage>(() => getSellerJourneyDraft() ? "account" : "form");
  const { user, loading } = useFirebaseAuth();
  const accountMismatch = stage === "account" && !!email && user?.email && user.email.toLowerCase() !== email.toLowerCase();
  const missingAccountPhone = !loading && user?.email && !user.phoneNumber && hasVerifiedEmail(auth.currentUser, user);

  useEffect(() => {
    if (!open) return;
    const draft = getSellerJourneyDraft();
    if (!draft) {
      if (user) {
        setFullName((current) => current || user.displayName || "");
        setEmail((current) => current || user.email || "");
        setPhone((current) => current || user.phoneNumber || "");
      }
      return;
    }
    setFullName(draft.fullName);
    setEmail(draft.email);
    setPhone(draft.phone);
    setKitchenPreference(draft.kitchenPreference);
    setAcceptedTerms(true);
    setStage("account");
  }, [open, user]);

  const continueToAccount = async () => {
    if (!kitchenPreference) return setError("Choose where you plan to cook.");
    if (!acceptedTerms) return setError("Accept the Terms & Conditions and Privacy Policy to continue.");

    saveSellerJourneyDraft({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone,
      kitchenPreference,
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    });

    setError("");
    const url = new URL(window.location.href);
    url.searchParams.set("journey", "seller");
    window.history.replaceState(window.history.state, "", url);
    setStage("account");
    if (user && hasVerifiedEmail(auth.currentUser, user)) window.location.reload();
  };

  const preferences = [
    { value: "commercial" as const, label: "Commercial kitchen", icon: "mdi:office-building" },
    { value: "home" as const, label: "My home kitchen", icon: "mdi:home" },
    { value: "notSure" as const, label: "I’m not sure yet", icon: "mdi:help-circle-outline" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border-0 p-0 shadow-2xl sm:rounded-3xl">
        <div className="bg-[#fffaf7] px-6 py-7 sm:px-8">
          {missingAccountPhone ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-[#211d1b]">Add a phone number to continue</h2>
              <p className="text-sm leading-6 text-[#6b625e]">Your seller application is saved. Add a phone number to your Local Cooks profile, then return here to submit it.</p>
              <Button className="w-full rounded-full bg-[#F51042] text-white hover:bg-[#d90e3a]" onClick={() => window.location.assign("/dashboard?view=profile")}>Open account profile</Button>
            </div>
          ) : accountMismatch ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-[#211d1b]">Choose the account for this application</h2>
              <p className="text-sm leading-6 text-[#6b625e]">Your plans were started with {email}, but you signed in as {user.email}. We’ll use the name and phone number saved on the account you choose.</p>
              {user.phoneNumber ? (
                <Button className="w-full rounded-full bg-[#F51042] text-white hover:bg-[#d90e3a]" onClick={() => {
                  const draft = getSellerJourneyDraft();
                  if (!draft || !user.email || !user.phoneNumber) return;
                  saveSellerJourneyDraft({ ...draft, fullName: user.displayName?.trim() || draft.fullName, email: user.email, phone: user.phoneNumber });
                  window.location.reload();
                }}>Continue as {user.email}</Button>
              ) : (
                <p className="text-sm text-[#6b625e]">Add a phone number in your account profile before continuing your seller application.</p>
              )}
              <Button variant="outline" className="w-full rounded-full" onClick={() => window.location.assign("/dashboard?view=profile")}>Open account profile</Button>
            </div>
          ) : stage === "account" ? (
            <>
              <button type="button" onClick={() => setStage("form")} className="mb-5 text-sm text-[#6b625e] hover:text-[#d90e3a]">← Edit your plans</button>
              <KitchenJourneyAuth title="Continue your seller journey" description="Sign in or create your Local Cooks account. Once your email is verified, we’ll save your application and open it in your dashboard." initialEmail={email} initialTermsAccepted={acceptedTerms} subject="seller application" />
            </>
          ) : (
          <>
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold tracking-tight text-[#211d1b] sm:text-3xl">Start your journey with Local Cooks</DialogTitle>
            <DialogDescription className="leading-relaxed text-[#6b625e]">Tell us where you plan to cook. Your Local Cooks account details come next.</DialogDescription>
          </DialogHeader>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold text-[#332d2a]">Where do you plan to prepare food?</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {preferences.map(({ value, label, icon }) => (
                <button key={value} type="button" aria-pressed={kitchenPreference === value} onClick={() => setKitchenPreference(value)} className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-4 text-center text-xs font-semibold transition-all ${kitchenPreference === value ? "border-[#F51042] bg-[#F51042]/5 text-[#F51042] ring-1 ring-[#F51042]" : "border-[#ded7d1] bg-white text-[#4f4844] hover:border-[#F51042]/50"}`}>
                  <Icon icon={icon} className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#e8dfda] bg-white px-4 py-3">
            <Checkbox
              id="journey-terms"
              checked={acceptedTerms}
              onCheckedChange={(checked) => {
                setAcceptedTerms(checked === true);
                if (checked === true) setError("");
              }}
              className="mt-0.5 border-[#b8ada7] data-[state=checked]:border-[#F51042] data-[state=checked]:bg-[#F51042]"
            />
            <Label htmlFor="journey-terms" className="cursor-pointer text-xs font-normal leading-relaxed text-[#5f5651]">
              I agree to the{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#d90e3a] underline-offset-2 hover:underline">Terms &amp; Conditions</a>
              {" "}and{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#d90e3a] underline-offset-2 hover:underline">Privacy Policy</a>.
            </Label>
          </div>
          {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}
          <Button onClick={continueToAccount} className="mt-5 h-12 w-full rounded-full bg-[#F51042] font-bold text-white hover:bg-[#d90e3a]">
            Continue to secure account <Icon icon="mdi:arrow-right" className="ml-2 h-4 w-4" />
          </Button>
          </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
