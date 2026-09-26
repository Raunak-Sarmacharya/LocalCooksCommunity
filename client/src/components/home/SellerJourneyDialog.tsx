import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { clearSellerJourneyDraft, getSellerJourneyDraft, saveSellerJourneyDraft, sellerJourneyPayload } from "@/lib/seller-journey";
import { Input } from "@/components/ui/input";
import PhoneSignInSettings from "@/components/auth/PhoneSignInSettings";
import LoadingOverlay from "@/components/auth/LoadingOverlay";
import { useAuthTransition } from "@/components/auth/AuthTransition";
import { PHONE_AUTH_ENABLED } from "@/lib/feature-flags";
import { formatPhoneForDisplay } from "@shared/phone-validation";
import { Icon } from "@iconify/react";
import KitchenJourneyAuth from "@/components/auth/KitchenJourneyAuth";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { hasVerifiedEmail, hasVerifiedPhone } from "@/lib/auth-verification";

type Preference = "commercial" | "home" | "notSure";
type JourneyStage = "form" | "account";

/**
 * One status for the whole journey.
 *
 * Deliberately NOT a per-request phase machine: `loading` covers every async step
 * (checking for an existing application, submitting, saving a phone number) and the
 * copy below says which one it is. `submitted` is terminal — the chef leaves it by
 * choosing a destination, or by closing, which returns them to the landing page.
 */
export type SellerJourneyStatus = "idle" | "loading" | "submitted";

/** Which async step the single `loading` status is currently covering. Copy only. */
type SellerJourneyTask = "checking_applications" | "submitting_application" | "saving_phone_number";

const JOURNEY_PROGRESS: Record<SellerJourneyTask, { message: string; submessage: string }> = {
  checking_applications: {
    message: "Checking your applications…",
    submessage: "Making sure you don’t already have one on file with us.",
  },
  submitting_application: {
    message: "Submitting your application…",
    submessage: "We’re saving your details and setting up your seller profile.",
  },
  saving_phone_number: {
    message: "Saving your phone number…",
    submessage: "We’re adding it to your account so you can sign in with it next time.",
  },
};

const SUBMITTED_COPY = {
  message: "Application submitted",
  submessage: "We’ve received your seller application. Upload your kitchen documents next, or head to your dashboard.",
};

export default function SellerJourneyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [kitchenPreference, setKitchenPreference] = useState<Preference | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // One error slot per surface. A single shared string put phone failures under the
  // kitchen-preference fieldset, nowhere near the control that failed.
  const [formError, setFormError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [status, setStatus] = useState<SellerJourneyStatus>("idle");
  const [progress, setProgress] = useState<SellerJourneyTask>("submitting_application");
  const [activeApplicationExists, setActiveApplicationExists] = useState(false);
  const [reviewName, setReviewName] = useState("");
  const [showPhoneForm, setShowPhoneForm] = useState(false);
  const [stage, setStage] = useState<JourneyStage>(() => getSellerJourneyDraft() ? "account" : "form");
  const { user, loading, refreshUserData } = useFirebaseAuth();
  const { begin: beginHandoff, isHolding } = useAuthTransition();
  const [, navigate] = useLocation();
  const seededReviewRef = useRef(false);
  const accountMismatch = stage === "account" && !!email && user?.email && user.email.toLowerCase() !== email.toLowerCase();
  const readyToReview = !loading && !!user && hasVerifiedEmail(auth.currentUser, user) && !!getSellerJourneyDraft();
  // A proved number is read-only. `hasVerifiedPhone` reads the profile flag, which the
  // server derives from `phone_verified_at` OR the Firebase claim.
  const phoneVerified = hasVerifiedPhone(auth.currentUser, user);
  const busy = status !== "idle";

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

  // Seed the editable name once, the first time the review card appears. Guarded by a ref
  // so deliberately clearing the field does not silently refill it on a later user refresh.
  useEffect(() => {
    if (!readyToReview || seededReviewRef.current) return;
    seededReviewRef.current = true;
    setReviewName(user?.displayName?.trim() || getSellerJourneyDraft()?.fullName?.trim() || "");
  }, [readyToReview, user]);

  /**
   * Radix asks to close whenever `open` flips, including when we flip it ourselves to
   * put the overlay up. Forwarding that would strip `?journey=seller` mid-submit.
   */
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && busy) return;
    onOpenChange(nextOpen);
  };

  const continueToAccount = async () => {
    if (!kitchenPreference) return setFormError("Choose where you plan to cook.");
    if (!acceptedTerms) return setFormError("Accept the Terms & Conditions and Privacy Policy to continue.");

    saveSellerJourneyDraft({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone,
      kitchenPreference,
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    });

    setFormError("");
    const url = new URL(window.location.href);
    url.searchParams.set("journey", "seller");
    window.history.replaceState(window.history.state, "", url);
    setStage("account");
  };

  // The number is proved by OTP inside PhoneSignInSettings, which then hands it back.
  // Saving it needs a FORCE-refreshed token: the server OTP guard reads
  // `firebaseUser.phone_number` off the decoded token, and a cached token still lacks it.
  const handlePhoneLinked = async (verifiedPhone: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    setPhoneError("");
    setProgress("saving_phone_number");
    setStatus("loading");
    try {
      const token = await currentUser.getIdToken(true);
      const response = await fetch("/api/chef/my-profile", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: verifiedPhone }),
      });
      if (!response.ok) throw new Error("profile save failed");
      await refreshUserData({ forceToken: true });
      setShowPhoneForm(false);
    } catch {
      setPhoneError("Your number is verified, but we could not save it to your account. Please try again.");
    } finally {
      setStatus("idle");
    }
  };

  const submitApplication = async () => {
    const draft = getSellerJourneyDraft();
    const currentUser = auth.currentUser;
    if (!draft || !user?.email || !currentUser || !kitchenPreference) {
      setReviewError("Your application details are incomplete. Please try again.");
      return;
    }

    const trimmedName = reviewName.trim();
    if (!trimmedName) {
      setReviewError("Add your full name before submitting.");
      return;
    }

    // The applications table stores a validated, non-null phone, so the number itself is
    // required even though proving it is optional.
    if (!user.phoneNumber) {
      setReviewError("Add a phone number before submitting. We use it to reach you about bookings.");
      return;
    }

    setReviewError("");
    setActiveApplicationExists(false);
    setProgress("checking_applications");
    setStatus("loading");
    try {
      const token = await currentUser.getIdToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const existingResponse = await fetch("/api/firebase/applications/my", { headers });
      if (!existingResponse.ok) throw new Error("Could not check your existing applications. Please try again.");
      const existing = await existingResponse.json();
      if (Array.isArray(existing) && existing.some((application) => !["cancelled", "rejected"].includes(application.status))) {
        setActiveApplicationExists(true);
        return;
      }

      const updatedDraft = {
        ...draft,
        fullName: trimmedName,
        email: user.email,
        phone: user.phoneNumber,
        kitchenPreference,
      };
      saveSellerJourneyDraft(updatedDraft);
      setProgress("submitting_application");
      const response = await fetch("/api/firebase/applications", {
        method: "POST",
        headers,
        body: JSON.stringify(sellerJourneyPayload(updatedDraft)),
      });
      if (!response.ok) throw new Error("We couldn’t submit your application. Your draft is saved. Please try again.");
      clearSellerJourneyDraft();
      setStatus("submitted");
    } catch (submissionError) {
      setReviewError(submissionError instanceof Error ? submissionError.message : "We couldn’t submit your application. Please try again.");
    } finally {
      // Never clobber the terminal state the success branch just set.
      setStatus((current) => (current === "loading" ? "idle" : current));
    }
  };

  /**
   * End of the journey. The overlay releases and the cross-route handoff takes over:
   * `AuthTransitionProvider` renders above the router, so its loader survives the
   * navigation and releases once the destination's queries have settled.
   */
  const leaveFor = (to: string, message: string, submessage: string, markSubmitted = false) => {
    if (markSubmitted) window.sessionStorage.setItem("localcooks:seller-journey-result", "submitted");
    beginHandoff(message, submessage);
    navigate(to);
  };

  const dismissSubmitted = () => {
    setStatus("idle");
    setStage("form");
    setReviewName("");
    seededReviewRef.current = false;
    onOpenChange(false);
  };

  const preferences = [
    { value: "commercial" as const, label: "Commercial kitchen", icon: "mdi:office-building" },
    { value: "home" as const, label: "My home kitchen", icon: "mdi:home" },
    { value: "notSure" as const, label: "I’m not sure yet", icon: "mdi:help-circle-outline" },
  ];

  const submittedActions = (
    <>
      <Button
        className="w-full rounded-full bg-[#F51042] font-bold text-white hover:bg-[#d90e3a]"
        onClick={() => leaveFor("/dashboard?view=applications&journey=submitted", "Opening your application…", "We’re loading your seller application and the next steps.", true)}
      >
        View my application
      </Button>
      <Button
        variant="outline"
        className="w-full rounded-full"
        onClick={() => leaveFor("/dashboard", "Opening your dashboard…", "We’re loading your Local Cooks dashboard.")}
      >
        Go to dashboard
      </Button>
      <button
        type="button"
        onClick={dismissSubmitted}
        className="mt-1 text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
      >
        Close
      </button>
    </>
  );

  return (
    <Dialog open={open && status === "idle"} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border-0 p-0 shadow-2xl sm:rounded-3xl">
        <div className="bg-[#fffaf7] px-6 py-7 sm:px-8">
          {loading && stage === "account" ? (
            <div role="status" className="py-8 text-center text-sm text-[#6b625e]">Restoring your account and saved application…</div>
          ) : accountMismatch ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-[#211d1b]">Choose the account for this application</h2>
              <p className="text-sm leading-6 text-[#6b625e]">Your plans were started with {email}, but you signed in as {user.email}. We’ll use the name and phone number saved on the account you choose.</p>
              <Button className="w-full rounded-full bg-[#F51042] text-white hover:bg-[#d90e3a]" onClick={() => {
                const draft = getSellerJourneyDraft();
                if (!draft || !user.email) return;
                saveSellerJourneyDraft({ ...draft, fullName: user.displayName?.trim() || draft.fullName, email: user.email, phone: user.phoneNumber || "" });
                setFullName(user.displayName?.trim() || draft.fullName);
                setEmail(user.email);
                setPhone(user.phoneNumber || "");
              }}>Continue as {user.email}</Button>
              <Button variant="outline" className="w-full rounded-full" onClick={() => window.location.assign("/dashboard?view=profile")}>Open account profile</Button>
            </div>
          ) : readyToReview && stage === "account" ? (
            <div className="space-y-5" data-testid="seller-journey-review">
              <div>
                <h2 className="text-2xl font-semibold text-[#211d1b]">Review your application</h2>
                <p className="mt-1 text-sm text-[#6b625e]">Check your details, then submit when you’re ready.</p>
              </div>
              <div className="space-y-4 rounded-2xl border border-[#e8dfda] bg-white p-4 text-sm">
                <div className="space-y-1.5">
                  <Label htmlFor="review-full-name" className="text-xs font-semibold text-[#332d2a]">Full name</Label>
                  <Input
                    id="review-full-name"
                    value={reviewName}
                    onChange={(event) => setReviewName(event.target.value)}
                    disabled={busy}
                    placeholder="Your full name"
                  />
                </div>
                <p><span className="text-[#6b625e]">Email:</span> {user?.email}</p>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3">
                    <Label className="text-xs font-semibold text-[#332d2a]">Phone</Label>
                    {!phoneVerified && PHONE_AUTH_ENABLED ? (
                      <span className="text-[11px] font-medium text-[#8a7f79]">Recommended</span>
                    ) : null}
                  </div>
                  {showPhoneForm ? (
                    <PhoneSignInSettings layout="form" initialPhone={user?.phoneNumber || ""} onPhoneLinked={handlePhoneLinked} />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <p className="text-[#211d1b]">{formatPhoneForDisplay(user?.phoneNumber) || "No phone number added"}</p>
                      {!phoneVerified && PHONE_AUTH_ENABLED ? (
                        <button
                          type="button"
                          onClick={() => { setShowPhoneForm(true); setPhoneError(""); }}
                          className="text-xs font-semibold text-[#d90e3a] underline-offset-2 hover:underline"
                        >
                          {user?.phoneNumber ? "Verify number" : "Add a phone number"}
                        </button>
                      ) : null}
                    </div>
                  )}
                  {!phoneVerified && PHONE_AUTH_ENABLED && !showPhoneForm ? (
                    <p className="text-xs leading-relaxed text-[#8a7f79]">
                      Verify your number so we can reach you about bookings, and so you can sign in with it next time.
                    </p>
                  ) : null}
                  {!PHONE_AUTH_ENABLED && !user?.phoneNumber ? (
                    <p className="text-xs leading-relaxed text-[#8a7f79]">
                      Add a phone number in your{" "}
                      <a href="/dashboard?view=profile" className="font-semibold text-[#d90e3a] underline-offset-2 hover:underline">account profile</a>
                      {" "}to submit your application.
                    </p>
                  ) : null}
                  {phoneError && <p role="alert" className="text-xs font-medium text-red-600">{phoneError}</p>}
                </div>
              </div>
              <fieldset disabled={busy}>
                <legend className="text-sm font-semibold text-[#332d2a]">Where do you plan to prepare food?</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {preferences.map(({ value, label, icon }) => (
                    <button key={value} type="button" aria-pressed={kitchenPreference === value} onClick={() => {
                      setKitchenPreference(value);
                      const draft = getSellerJourneyDraft();
                      if (draft) saveSellerJourneyDraft({ ...draft, kitchenPreference: value });
                    }} className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-4 text-center text-xs font-semibold transition-all ${kitchenPreference === value ? "border-[#F51042] bg-[#F51042]/5 text-[#F51042] ring-1 ring-[#F51042]" : "border-[#ded7d1] bg-white text-[#4f4844] hover:border-[#F51042]/50"}`}>
                      <Icon icon={icon} className="h-5 w-5" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
              {reviewError && <p role="alert" className="text-sm font-medium text-red-600">{reviewError}</p>}
              {activeApplicationExists ? (
                <div role="status" className="space-y-3">
                  <p className="text-sm text-[#6b625e]">You already have an active application. You can review it in My Applications.</p>
                  <Button className="w-full rounded-full bg-[#F51042] text-white" onClick={() => leaveFor("/dashboard?view=applications", "Opening your applications…", "We’re loading your applications.")}>Open My Applications</Button>
                </div>
              ) : (
                <Button className="h-12 w-full rounded-full bg-[#F51042] font-bold text-white hover:bg-[#d90e3a]" disabled={busy} onClick={() => void submitApplication()}>
                  Submit application
                </Button>
              )}
            </div>
          ) : stage === "account" ? (
            <>
              <button type="button" onClick={() => setStage("form")} className="mb-5 text-sm text-[#6b625e] hover:text-[#d90e3a]">← Edit your plans</button>
              <KitchenJourneyAuth title="Continue your seller journey" description="Sign in or create your Local Cooks account. Once your email is verified, you’ll review and submit your seller application here." initialEmail={email} initialTermsAccepted={acceptedTerms} subject="seller application" />
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
                if (checked === true) setFormError("");
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
          {formError && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{formError}</p>}
          <Button onClick={continueToAccount} className="mt-5 h-12 w-full rounded-full bg-[#F51042] font-bold text-white hover:bg-[#d90e3a]">
            Continue to secure account <Icon icon="mdi:arrow-right" className="ml-2 h-4 w-4" />
          </Button>
          </>
          )}
        </div>
      </DialogContent>
      {/*
        Portaled to body, which a modal Dialog sets to pointer-events:none — so this is
        only interactive because the Dialog itself closes while `status !== "idle"`.
        `!isHolding` yields to the cross-route handoff overlay, which is the one that
        survives the navigation.
      */}
      <LoadingOverlay
        isVisible={busy && !isHolding}
        type={status === "submitted" ? "success" : "loading"}
        message={status === "submitted" ? SUBMITTED_COPY.message : JOURNEY_PROGRESS[progress].message}
        submessage={status === "submitted" ? SUBMITTED_COPY.submessage : JOURNEY_PROGRESS[progress].submessage}
        actions={status === "submitted" ? submittedActions : undefined}
      />
    </Dialog>
  );
}
