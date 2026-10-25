import { logger } from "@/lib/logger";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDown, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import stJohnsHarbour from "@/assets/st-johns-harbour.jpg";
import exampleKitchen from "@/assets/commercial-kitchen.jpg";

interface WelcomeScreenProps {
  onComplete?: () => void;
  onContinue?: () => void;
}

/** Shown once, to a chef's first visit (users.has_seen_welcome). */
export default function WelcomeScreen({ onComplete, onContinue }: WelcomeScreenProps) {
  const { t, i18n } = useTranslation("chef");
  const { user, logout } = useFirebaseAuth();
  const [isCompleting, setIsCompleting] = useState(false);
  const money = (n: number, cents = true) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "CAD", maximumFractionDigits: cents ? 2 : 0 }).format(n);

  const firstName = (user?.displayName || user?.fullName || "").trim().split(/\s+/)[0];

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/user/seen-welcome", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!response.ok) logger.warn("Welcome screen API call failed:", response.status);
      }
    } catch (error) {
      // Still let them continue; the screen shows again next visit at worst.
      logger.error("Error completing welcome screen:", error);
    } finally {
      setIsCompleting(false);
      (onComplete || onContinue)?.();
    }
  };

  const tick = <Check className="h-3.5 w-3.5" strokeWidth={2.5} />;

  const bookingStates: ReactNode[] = [
    <Panel key="find">
      <img src={exampleKitchen} alt="" className="h-36 w-full object-cover lg:h-44" />
      <div className="p-5">
        <p className="text-lg font-semibold">{t("welcomeExKitchenName")}</p>
        <p className="text-sm text-muted-foreground">{t("welcomeExKitchenArea")}</p>
        <div className="mt-3 flex gap-5 text-sm text-muted-foreground">
          <span><b className="text-lg text-foreground">{money(32, false)}</b> {t("welcomeExPerHour")}</span>
          <span><b className="text-lg text-foreground">{money(220, false)}</b> {t("welcomeExPerDay")}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(["welcomeExEquip1", "welcomeExEquip2", "welcomeExEquip3", "welcomeExEquip4"] as const).map((k) => (
            <span key={k} className="rounded-full bg-muted px-2.5 py-1 text-xs">{t(k)}</span>
          ))}
        </div>
        <span className="mt-4 block rounded-full bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground">{t("welcomeExRequestToCook")}</span>
      </div>
    </Panel>,
    <Panel key="apply">
      <PanelHead title={t("welcomeExAccessRequest")} sub={t("welcomeExKitchenName")} pill={t("welcomeExWithKitchen")} />
      <Row done label={t("welcomeExRequestToApply")} sub={t("welcomeExSentOct25")} icon={tick} />
      <Row done label={t("welcomeExFoodSafety")} sub={t("welcomeExExpiresMar2028")} end={t("welcomeExUploaded")} icon={tick} />
      <Row done label={t("welcomeExInsurance")} sub={t("welcomeExExpiresJan2027")} end={t("welcomeExUploaded")} icon={tick} />
      <Row label={t("welcomeExHouseRules")} sub={t("welcomeExAskedByKitchen")} end={t("welcomeExToDo")} />
    </Panel>,
    <Panel key="book">
      <PanelHead title={t("welcomeExBookingDate")} sub={t("welcomeExBookingTime")} pill={t("welcomeExConfirmed")} ok />
      <div className="px-5 pb-5 text-sm tabular-nums">
        <Line label={t("welcomeExKitchenTime", { rate: money(32) })} value={money(128)} />
        <Line label={t("welcomeExCoolerShelf")} value={money(12)} />
        <Line label={t("welcomeExChargedWhenAccepted")} value={money(140)} total />
        <p className="mt-3 text-xs text-muted-foreground">{t("welcomeExHeldNote")}</p>
      </div>
    </Panel>,
  ];

  const sellingStates: ReactNode[] = [
    <Panel key="apply">
      <PanelHead title={t("welcomeExYourApplication")} sub={t("welcomeExAbout10Min")} />
      <Row done label={t("welcomeExYourDetails")} end={t("welcomeExDone")} icon={tick} />
      <Row done label={t("welcomeExWhereYouCook")} end={t("welcomeExDone")} icon={tick} />
      <Row label={t("welcomeExFoodSafety")} end={t("welcomeExUpload")} />
    </Panel>,
    <Panel key="review">
      <PanelHead title={t("welcomeExApplicationSent")} sub={t("welcomeExSentOct25Time")} pill={t("welcomeExInReview")} />
      <p className="px-5 pb-5 text-sm text-muted-foreground">{t("welcomeExReviewNote")}</p>
    </Panel>,
    <Panel key="list">
      <PanelHead title={t("welcomeExStoreName")} sub={t("welcomeExDelivers")} pill={t("welcomeExTakingOrders")} ok />
      {([["welcomeExDish1", "welcomeExDish1Note", 9], ["welcomeExDish2", "welcomeExDish2Note", 16], ["welcomeExDish3", "welcomeExDish3Note", 18]] as const).map(([k, n, p]) => (
        <div key={k} className="flex justify-between gap-4 border-t px-5 py-3 text-sm tabular-nums">
          <div>{t(k)}<span className="block text-xs text-muted-foreground">{t(n)}</span></div>
          <span>{money(p)}</span>
        </div>
      ))}
    </Panel>,
  ];

  return (
    <div className="min-h-screen bg-[#E8E8E5] text-foreground">
      {/* Welcome: card + St. John's photo */}
      <section className="grid gap-3 p-3 lg:grid-cols-2 lg:items-start" aria-labelledby="welcome-title">
        <div className="relative order-first h-[30svh] overflow-hidden rounded-2xl lg:sticky lg:top-3 lg:order-last lg:h-[calc(100svh-1.5rem)]">
          <img src={stJohnsHarbour} alt={t("welcomePhotoAlt")} className="h-full w-full object-cover object-[30%_center]" />
          <p className="absolute bottom-4 left-4 rounded-full bg-black/55 px-3 py-1.5 text-sm font-medium text-white">{t("welcomePhotoCaption")}</p>
        </div>
        <div className="flex flex-col overflow-hidden rounded-2xl bg-[#FAFAFA] lg:min-h-[calc(100svh-1.5rem)]">
          <JellybeanStripe />
          <div className="flex items-center gap-2.5 px-6 pt-6 lg:px-12 lg:pt-7">
            <Logo variant="brand" className="h-9 w-auto" />
            <span className="font-logo text-2xl leading-none text-primary">LocalCooks</span>
          </div>
          <div className="flex flex-1 flex-col justify-center px-6 py-7 lg:max-w-[620px] lg:p-12">
            <h1 id="welcome-title" className="text-[44px] font-bold leading-none tracking-[-0.035em] lg:text-[clamp(44px,4.2vw,64px)]">
              {firstName ? t("welcomeTitleName", { name: firstName }) : t("welcomeTitle")}
            </h1>
            <p className="mt-5 text-lg leading-snug [text-wrap:pretty] lg:text-[22px]">
              <span className="lg:block">{t("welcomeLedeLine1")}</span>{" "}
              <span className="lg:block">{t("welcomeLedeLine2")}</span>
            </p>
            <div className="mt-8">
              <Button onClick={handleComplete} disabled={isCompleting} size="lg" className="h-12 rounded-full px-7 text-base font-semibold" data-testid="welcome-continue">
                {isCompleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("welcomeCta")}
              </Button>
            </div>
            <p className="mt-9 hidden text-sm text-muted-foreground lg:block">{t("welcomeSeeHow")}</p>
            <ul className="mt-2.5 hidden gap-1 lg:grid">
              {([["#welcome-book", "welcomeBookTitle", "welcomeBookShort"], ["#welcome-sell", "welcomeSellTitle", "welcomeSellShort"]] as const).map(([href, title, sub]) => (
                <li key={href}>
                  <a href={href} className="group flex items-center justify-between gap-4 rounded-xl bg-[#F1F1EE] px-5 py-4 transition-colors hover:bg-[#E9E9E5]">
                    <span><b className="block font-semibold">{t(title)}</b><span className="text-sm text-muted-foreground">{t(sub)}</span></span>
                    <ArrowDown className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <p className="px-6 pb-6 text-sm text-muted-foreground lg:px-12 lg:pb-7">
            {user?.email && <span className="block truncate sm:inline" title={user.email}>{t("welcomeSignedInAs", { email: user.email })}<span className="hidden sm:inline"> · </span></span>}
            <button type="button" onClick={() => logout()} className="whitespace-nowrap hover:text-foreground hover:underline">{t("welcomeSignOut")}</button>
          </p>
        </div>
      </section>

      <HowItWorks id="welcome-book" title={t("welcomeBookHowTitle")} intro={t("welcomeBookHowIntro")} stageLabel={t("welcomeExampleBooking")}
        steps={([["welcomeBookStep1", "welcomeBookStep1Body"], ["welcomeBookStep2", "welcomeBookStep2Body"], ["welcomeBookStep3", "welcomeBookStep3Body"]] as const).map(([a, b]) => [t(a), t(b)])}
        states={bookingStates} />
      <HowItWorks id="welcome-sell" title={t("welcomeSellHowTitle")} intro={t("welcomeSellHowIntro")} stageLabel={t("welcomeExampleStore")}
        steps={([["welcomeSellStep1", "welcomeSellStep1Body"], ["welcomeSellStep2", "welcomeSellStep2Body"], ["welcomeSellStep3", "welcomeSellStep3Body"]] as const).map(([a, b]) => [t(a), t(b)])}
        states={sellingStates} />

      {/* Close */}
      <section className="m-3 grid overflow-hidden rounded-2xl bg-[#FAFAFA] lg:grid-cols-2" aria-labelledby="welcome-close-title">
        <div className="px-6 py-12 lg:px-12 lg:py-[24svh]">
          <h2 id="welcome-close-title" className="text-[28px] font-semibold leading-tight tracking-[-0.02em] lg:text-[32px]">{t("welcomeCloseTitle")}</h2>
          <p className="mt-3 text-lg lg:text-[22px]">{t("welcomeCloseBody")}</p>
          <Button onClick={handleComplete} disabled={isCompleting} size="lg" className="mt-6 h-12 rounded-full px-7 text-base font-semibold">
            {t("welcomeCta")}
          </Button>
          <p className="mt-10 max-w-[46ch] text-sm text-muted-foreground">
            {t("welcomeCertNote")}{" "}
            <a href="https://skillspassnl.bluedrop.io/storefront/online-registration/10863" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">{t("welcomeCertLink")}</a>
          </p>
        </div>
        <img src={stJohnsHarbour} alt="" loading="lazy" className="h-[40svh] w-full object-cover object-[75%_center] lg:h-full" />
      </section>
    </div>
  );
}

/** St. John's Jellybean Row colours, the page's one ornament. */
function JellybeanStripe() {
  const colours = ["#E3B62C", "#7A2E3E", "#3F6E5C", "#5D7F95", "#B5402F", "#6A4C8C"];
  return (
    <div className="flex h-2 shrink-0 lg:h-2.5" aria-hidden="true">
      {[...colours, ...colours].map((c, i) => <i key={i} className="flex-1" style={{ background: c }} />)}
    </div>
  );
}

/** Three statements beside a pinned example that changes with the statement in view (desktop); inline on phones. */
function HowItWorks({ id, title, intro, stageLabel, steps, states }: { id: string; title: string; intro: string; stageLabel: string; steps: string[][]; states: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const watch = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(Number((e.target as HTMLElement).dataset.step))),
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && watch.observe(el));
    return () => watch.disconnect();
  }, []);

  return (
    <section id={id} className="mt-3 grid gap-3 lg:grid-cols-2 lg:items-start lg:px-3" aria-labelledby={`${id}-title`}>
      <div className="bg-[#FAFAFA] px-6 lg:rounded-2xl lg:px-12">
        <h2 id={`${id}-title`} className="pt-10 text-[26px] font-semibold leading-tight tracking-[-0.01em] lg:pt-[14vh]">{title}</h2>
        <p className="mt-2 max-w-[40ch] text-muted-foreground">{intro}</p>
        {steps.map(([head, body], i) => (
          <div
            key={head}
            ref={(el) => { refs.current[i] = el; }}
            data-step={i}
            className={cn("py-7 lg:flex lg:max-w-[460px] lg:flex-col lg:justify-center lg:py-0", i === 0 ? "lg:min-h-[46vh]" : i === steps.length - 1 ? "lg:min-h-[70vh]" : "lg:min-h-[56vh]")}
          >
            <p className={cn("text-2xl font-semibold leading-tight tracking-[-0.02em] transition-colors lg:text-[32px]", active === i ? "text-foreground" : "lg:text-muted-foreground")}>{head}</p>
            <p className="mt-3 text-muted-foreground">{body}</p>
            <div className="mt-5 lg:hidden" aria-hidden="true">{states[i]}</div>
          </div>
        ))}
      </div>
      <div className="sticky top-3 hidden h-[calc(100svh-1.5rem)] place-items-center rounded-2xl bg-[#F1F1EE] p-12 lg:grid" aria-hidden="true">
        <p className="absolute left-6 top-5 text-sm text-muted-foreground">{stageLabel}</p>
        <div className="w-full">
          {states.map((s, i) => (
            <div key={i} className={cn("transition-all duration-500 ease-out", active === i ? "translate-y-0 opacity-100" : "pointer-events-none absolute translate-y-2.5 opacity-0")}>{s}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border bg-white text-[15px]">{children}</div>;
}

function PanelHead({ title, sub, pill, ok }: { title: string; sub?: string; pill?: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 p-5">
      <div><p className="text-lg font-semibold">{title}</p>{sub && <p className="text-sm text-muted-foreground">{sub}</p>}</div>
      {pill && <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>{pill}</span>}
    </div>
  );
}

function Row({ label, sub, end, done, icon }: { label: string; sub?: string; end?: string; done?: boolean; icon?: ReactNode }) {
  return (
    <div className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 border-t px-5 py-3">
      <span className={cn("grid h-[22px] w-[22px] place-items-center rounded-full", done ? "bg-emerald-50 text-emerald-700" : "border-2 border-dashed border-muted-foreground/40")}>{done && icon}</span>
      <div>{label}{sub && <span className="block text-xs text-muted-foreground">{sub}</span>}</div>
      {end && <span className="text-xs text-muted-foreground">{end}</span>}
    </div>
  );
}

function Line({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 py-1.5", total && "mt-1.5 border-t pt-3 font-semibold")}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
