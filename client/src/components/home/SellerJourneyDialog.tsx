import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSellerJourneyDraft, validateSellerJourneyPhone } from "@/lib/seller-journey";
import { ArrowRight, Building2, Home, HelpCircle } from "lucide-react";

type Preference = "commercial" | "home" | "notSure";

export default function SellerJourneyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [kitchenPreference, setKitchenPreference] = useState<Preference | null>(null);
  const [error, setError] = useState("");

  const continueToAccount = () => {
    if (fullName.trim().length < 2) return setError("Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!validateSellerJourneyPhone(phone)) return setError("Enter a valid North American phone number.");
    if (!kitchenPreference) return setError("Choose where you plan to cook.");

    saveSellerJourneyDraft({ fullName: fullName.trim(), email: email.trim(), phone, kitchenPreference });
    window.location.href = `/auth?tab=register&journey=seller&email=${encodeURIComponent(email.trim())}`;
  };

  const preferences = [
    { value: "commercial" as const, label: "Partner commercial kitchen", icon: Building2 },
    { value: "home" as const, label: "My home kitchen", icon: Home },
    { value: "notSure" as const, label: "I’m not sure yet", icon: HelpCircle },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border-0 p-0 shadow-2xl sm:rounded-3xl">
        <div className="bg-[#fffaf7] px-6 py-7 sm:px-8">
          <DialogHeader>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#F51042]">Seller application · Step 1</p>
            <DialogTitle className="text-2xl font-bold tracking-tight text-[#211d1b] sm:text-3xl">Tell us where your cooking journey begins</DialogTitle>
            <DialogDescription className="leading-relaxed text-[#6b625e]">This starts your seller application. Your email will become your LocalCooks account email.</DialogDescription>
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

          <p className="mt-5 rounded-xl bg-white px-4 py-3 text-xs leading-relaxed text-[#6b625e]">Food-safety documents are not required now. We’ll ask you to upload them from your dashboard after sign-in.</p>
          {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}
          <Button onClick={continueToAccount} className="mt-5 h-12 w-full rounded-full bg-[#F51042] font-bold text-white hover:bg-[#d90e3a]">Continue to secure account <ArrowRight className="ml-2 h-4 w-4" /></Button>
          <p className="mt-3 text-center text-xs text-[#756b66]">Already registered? Continue and choose Sign in on the next screen.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
