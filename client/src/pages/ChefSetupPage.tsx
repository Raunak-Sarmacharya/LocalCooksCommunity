import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import TidioController, { useTidioChat } from "@/components/chat/TidioController";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import WelcomeScreen from "@/pages/welcome-screen";
import kitchenImage from "@/assets/commercial-kitchen.jpg";
import sellImage from "@/assets/home-cook.jpg";

type ChefPath = "kitchen" | "localcooks";

const JELLYBEAN = ["#E3B62C", "#7A2E3E", "#3F6E5C", "#5D7F95", "#B5402F", "#6A4C8C"];

/** Where each choice lands: straight to the work, never another info page. */
export function landingFor(paths: ChefPath[]): string {
  if (paths.length === 1 && paths[0] === "kitchen") return chefDashboardHref("discover-kitchens");
  if (paths.length === 1 && paths[0] === "localcooks") return `${chefDashboardHref("applications")}&action=new`;
  return "/dashboard";
}

function PathChoice() {
  const { t } = useTranslation("chef");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, logout, refreshUserData } = useFirebaseAuth();
  const { openChat } = useTidioChat();
  const [picked, setPicked] = useState<ChefPath[]>([]);
  const [saving, setSaving] = useState<"go" | "skip" | null>(null);

  // A chef a kitchen already knows (request sent, or added by the kitchen) starts with kitchens ticked.
  const { data: kitchenApplications } = useQuery({
    queryKey: ["/api/firebase/chef/kitchen-applications"],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/firebase/chef/kitchen-applications", { headers: { Authorization: `Bearer ${token}` } });
      return res.ok ? res.json() : [];
    },
    enabled: !!user,
  });
  useEffect(() => {
    if (Array.isArray(kitchenApplications) && kitchenApplications.length > 0) setPicked((p) => (p.length ? p : ["kitchen"]));
  }, [kitchenApplications]);

  const toggle = (path: ChefPath) => setPicked((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]));

  const finish = async (paths: ChefPath[], kind: "go" | "skip") => {
    setSaving(kind);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/user/chef-onboarding-complete", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ selectedPaths: paths }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshUserData();
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      navigate(landingFor(paths));
    } catch (error) {
      logger.error("[Chef setup] Could not save the chosen paths:", error);
      toast({ title: t("choiceSaveError"), variant: "destructive" });
      setSaving(null);
    }
  };

  const key = [...picked].sort().join(",");
  const cta = { "": t("choiceCtaNone"), kitchen: t("choiceCtaKitchen"), localcooks: t("choiceCtaSell"), "kitchen,localcooks": t("choiceCtaBoth") }[key];

  const options: { path: ChefPath; image: string; position: string; title: string; body: string; next: string }[] = [
    { path: "kitchen", image: kitchenImage, position: "center 35%", title: t("choiceKitchenTitle"), body: t("choiceKitchenBody"), next: t("choiceKitchenNext") },
    { path: "localcooks", image: sellImage, position: "center 40%", title: t("choiceSellTitle"), body: t("choiceSellBody"), next: t("choiceSellNext") },
  ];

  return (
    <div className="min-h-screen bg-[#E8E8E5] text-foreground sm:flex sm:p-3">
      <div className="flex min-h-screen flex-1 flex-col bg-[#FAFAFA] sm:min-h-0 sm:overflow-hidden sm:rounded-2xl">
        <div className="flex h-2 shrink-0 sm:h-2.5" aria-hidden="true">
          {[...JELLYBEAN, ...JELLYBEAN].map((c, i) => <i key={i} className="flex-1" style={{ background: c }} />)}
        </div>
        <header className="flex items-center justify-between px-5 py-4 sm:px-10 sm:py-5">
          <span className="flex items-center gap-2.5">
            <Logo variant="brand" className="h-9 w-auto" />
            <span className="font-logo text-2xl leading-none text-primary">LocalCooks</span>
          </span>
          <nav className="flex gap-6 text-sm text-muted-foreground">
            <button type="button" onClick={openChat} className="hover:text-foreground">{t("choiceHelp")}</button>
            <button type="button" onClick={() => logout()} className="hover:text-foreground">{t("choiceSignOut")}</button>
          </nav>
        </header>

        <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col justify-center px-5 pt-3 sm:px-10 sm:pt-6">
          <h1 id="choice-title" className="text-[32px] font-bold leading-[1.05] tracking-[-0.03em] [text-wrap:balance] sm:text-[clamp(36px,3.4vw,52px)]">{t("choiceTitle")}</h1>
          <p className="mt-3 text-[17px] text-muted-foreground [text-wrap:pretty] sm:text-xl">{t("choiceLede")}</p>
          <div role="group" aria-labelledby="choice-title" className="mt-6 grid gap-3.5 sm:mt-9 sm:grid-cols-2 sm:gap-5">
            {options.map((o) => {
              const on = picked.includes(o.path);
              return (
                <button
                  key={o.path}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(o.path)}
                  data-testid={`choice-${o.path}`}
                  className={cn(
                    "group relative overflow-hidden rounded-[18px] bg-white text-left transition-[box-shadow,transform] duration-200 active:scale-[.99]",
                    "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-foreground",
                    on ? "shadow-[0_0_0_2.5px_hsl(var(--primary))]" : "shadow-[0_0_0_1.5px_#E2E1DD] hover:shadow-[0_0_0_1.5px_#BDBBB5]",
                  )}
                >
                  <img src={o.image} alt="" className="h-28 w-full object-cover sm:h-[200px]" style={{ objectPosition: o.position }} />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute right-4 top-32 grid h-7 w-7 place-items-center rounded-full transition-colors sm:right-[22px] sm:top-[216px]",
                      on ? "bg-primary text-primary-foreground" : "bg-white shadow-[inset_0_0_0_2px_#C9C7C1]",
                    )}
                  >
                    <Check className={cn("h-4 w-4 transition-all", on ? "scale-100 opacity-100" : "scale-50 opacity-0")} strokeWidth={3} />
                  </span>
                  <span className="block px-[18px] pb-5 pt-[18px] sm:px-6 sm:pb-6 sm:pt-[22px]">
                    <span className="block pr-10 text-[21px] font-semibold leading-tight tracking-[-0.015em] sm:text-2xl">{o.title}</span>
                    <span className="mt-2 block text-muted-foreground">{o.body}</span>
                    <span className="mt-4 block text-[15px]"><b className="font-semibold">{t("choiceNextLabel")}</b> {o.next}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </main>

        <footer className="sticky bottom-0 mx-auto flex w-full max-w-[1040px] flex-col-reverse items-stretch gap-2.5 bg-[#FAFAFA] px-5 py-3.5 shadow-[0_-1px_0_#E2E1DD] sm:static sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-7 sm:shadow-none">
          <p className="text-center text-[15px] text-muted-foreground sm:text-left">
            {t("choiceSkipLead")}{" "}
            <button type="button" disabled={!!saving} onClick={() => finish([], "skip")} className="text-foreground underline underline-offset-[3px]" data-testid="choice-skip">
              {t("choiceSkip")}
            </button>
          </p>
          <Button
            size="lg"
            disabled={!picked.length || !!saving}
            onClick={() => finish(picked, "go")}
            className="h-12 rounded-full px-7 text-base font-semibold sm:min-w-[220px]"
            data-testid="choice-continue"
          >
            {saving === "go" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {cta}
          </Button>
        </footer>
      </div>
      <TidioController userEmail={user?.email || undefined} userName={user?.displayName || undefined} userId={user?.uid} />
    </div>
  );
}

export default function ChefSetupPage() {
  const { user } = useFirebaseAuth();
  const [welcomed, setWelcomed] = useState(false);
  // First visit only: the welcome marks has_seen_welcome, then the choice.
  if (user?.has_seen_welcome === false && !welcomed) return <WelcomeScreen onContinue={() => setWelcomed(true)} />;
  return <PathChoice />;
}
