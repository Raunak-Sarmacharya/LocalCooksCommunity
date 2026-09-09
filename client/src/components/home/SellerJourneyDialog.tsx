import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { saveSellerJourneyDraft, validateSellerJourneyPhone } from "@/lib/seller-journey";
import { ArrowRight, Building2, Home, HelpCircle, Loader2 } from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { isDuplicateAccountError } from "@/lib/registration-error";
import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { auth } from "@/lib/firebase";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { logger } from "@/lib/logger";
import LoadingOverlay from "@/components/auth/LoadingOverlay";

type Preference = "commercial" | "home" | "notSure";
type JourneyStage = "form" | "creating" | "verify" | "sign-in-link" | "finishing";

export default function SellerJourneyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [kitchenPreference, setKitchenPreference] = useState<Preference | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<JourneyStage>("form");
  const { signup, sendEmailLink, updateUserVerification } = useFirebaseAuth();

  const continueToAccount = async () => {
    if (fullName.trim().length < 2) return setError("Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!validateSellerJourneyPhone(phone)) return setError("Enter a valid North American phone number.");
    if (!kitchenPreference) return setError("Choose where you plan to cook.");
    if (!acceptedTerms) return setError("Accept the Terms & Conditions and Privacy Policy to continue.");

    const normalizedEmail = email.trim().toLowerCase();
    saveSellerJourneyDraft({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone,
      kitchenPreference,
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    });

    setError("");
    setStage("creating");
    try {
      const randomBase = crypto.randomUUID().replace(/-/g, "");
      const generatedPassword = `A1!${randomBase}`.slice(0, 16);
      await signup(normalizedEmail, generatedPassword, fullName.trim(), "chef", true);
      setStage("verify");
    } catch (registrationError) {
      if (isDuplicateAccountError(registrationError)) {
        try {
          await sendEmailLink(normalizedEmail);
          setStage("sign-in-link");
          return;
        } catch (signInError) {
          logger.error("Unable to send seller journey sign-in link", signInError);
          setError("This email is already registered, but we couldn’t send a sign-in link. Please try again.");
        }
      } else {
        logger.error("Unable to create seller journey account", registrationError);
        setError("We couldn’t create your account right now. Please try again.");
      }
      setStage("form");
    }
  };

  const resetAccountStep = () => {
    setStage("form");
    setError("");
  };

  const preferences = [
    { value: "commercial" as const, label: "Commercial kitchen", icon: Building2 },
    { value: "home" as const, label: "My home kitchen", icon: Home },
    { value: "notSure" as const, label: "I’m not sure yet", icon: HelpCircle },
  ];

  return (
    <>
      <LoadingOverlay
        isVisible={stage === "creating" || stage === "finishing"}
        message={stage === "finishing" ? "Preparing your application…" : "Creating your secure account…"}
        submessage={stage === "finishing" ? "Your email is verified. We’re submitting your application and opening your dashboard." : "Please stay here while we securely set up your LocalCooks account."}
        type="verifying"
      />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border-0 p-0 shadow-2xl sm:rounded-3xl">
        <div className="bg-[#fffaf7] px-6 py-7 sm:px-8">
          {stage === "verify" || stage === "sign-in-link" ? (
            <div>
            <EmailVerificationScreen
              email={email.trim().toLowerCase()}
              mode={stage === "sign-in-link" ? "magic-link" : "verification"}
              onGoBack={resetAccountStep}
              onResend={async () => {
                if (stage === "sign-in-link") {
                  await sendEmailLink(email.trim().toLowerCase());
                } else {
                  await sendVerificationEmailWithFallback({
                    email: email.trim().toLowerCase(),
                    role: "chef",
                    returnUrl: window.location.href,
                  });
                }
              }}
              onCheckVerified={async () => {
                const updatedUser = await updateUserVerification();
                if (!hasVerifiedEmail(auth.currentUser, updatedUser)) {
                  setError("We haven’t detected verification yet. Open the link in your email, then try again.");
                  return;
                }
                setStage("finishing");
                await new Promise((resolve) => setTimeout(resolve, 100));
                window.location.reload();
              }}
            />
            {error && <p role="alert" className="mt-4 text-center text-sm font-medium text-red-600">{error}</p>}
            </div>
          ) : (
          <>
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold tracking-tight text-[#211d1b] sm:text-3xl">Start your journey with Local Cooks</DialogTitle>
            <DialogDescription className="leading-relaxed text-[#6b625e]">We’ll use this email to send you updates and next steps.</DialogDescription>
          </DialogHeader>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="journey-name">Full name</Label>
              <Input id="journey-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-2 h-11 bg-white" />
            </div>
            <div>
              <Label htmlFor="journey-email">Email address</Label>
              <Input id="journey-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-11 bg-white" />
            </div>
            <div>
              <Label htmlFor="journey-phone">Phone number</Label>
              <Input id="journey-phone" type="tel" autoComplete="tel" placeholder="+1 (709) 555-0123" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2 h-11 bg-white" />
            </div>
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold text-[#332d2a]">Where do you plan to prepare food?</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {preferences.map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" aria-pressed={kitchenPreference === value} onClick={() => setKitchenPreference(value)} className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-4 text-center text-xs font-semibold transition-all ${kitchenPreference === value ? "border-[#F51042] bg-[#F51042]/5 text-[#F51042] ring-1 ring-[#F51042]" : "border-[#ded7d1] bg-white text-[#4f4844] hover:border-[#F51042]/50"}`}>
                  <Icon className="h-5 w-5" aria-hidden />
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
          <Button disabled={stage === "creating"} onClick={continueToAccount} className="mt-5 h-12 w-full rounded-full bg-[#F51042] font-bold text-white hover:bg-[#d90e3a]">
            {stage === "creating" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating your secure account…</> : <>Continue to secure account <ArrowRight className="ml-2 h-4 w-4" /></>}
          </Button>
          </>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
