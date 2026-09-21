import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { SiStripe } from "react-icons/si";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import Logo from "@/components/ui/logo";
import { markWelcomeDismissed } from "@/lib/manager-welcome";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";

/**
 * The manager's welcome screen: the first thing a new manager sees.
 *
 * WHY IT IS STANDALONE
 * `ManagerOnboardingWizard` has a welcome step, but it lives inside the dashboard, i.e.
 * AFTER the Terms & Conditions gate. A new manager's first screen was therefore a legal
 * page. This is the warm moment that should come first, and dismissing it records
 * `has_seen_welcome`, which is what lets the manager on into the wizard.
 *
 * It does NOT mark the wizard's own welcome STEP complete. Those are two different screens with two
 * different jobs — this one introduces the product, the wizard's one lays out the work and offers
 * "Maybe later" — and reading this flag as the step's completion skipped the step before the manager
 * could act on it (and, because the skip ran in an effect, flashed it first).
 *
 * WHY IT SHOWS THE PRODUCT RATHER THAN DESCRIBING IT
 * Research on welcome screens is consistent on this point:
 *   - "Text-only approach doesn't really work with welcome screens ... it's less engaging
 *     compared to visuals where you can use visual cues to associate with the information"
 *   - Asana is the cited exemplar: "minimal copy with accompanying illustrations and
 *     screenshots from the app to keep things light but still informative"
 *   - Lead with OUTCOMES, not features: "Build life-changing habits" beats "Track your habits"
 *   - Strava "previews what the user's stats will look like once they're active", which is
 *     precisely what the window below does
 *   - And do not overload: "a wall of text or an endless carousel of screens kills momentum"
 *   - "The welcome screen is a dispatcher, not a brochure" — so nothing here is a feature
 *     list; every capability is shown as part of the product doing its job
 *
 * WHY IT DOES NOT LOOK LIKE THE LOGIN PAGE
 * `KitchenAuthShowcase` (the login's left panel) puts three white cards directly on the
 * brand field and is a side-by-side split. This screen is a different composition on
 * purpose: the page itself is light — the product the manager is about to enter is light —
 * and the brand red is a framed STAGE that the product sits on. That inverts the login's
 * treatment rather than repeating it, and gives the moment more weight than the login
 * because it is the arrival, not the door.
 *
 * WHY THE THREE PANES
 * One wide app window with three panes, rather than the login's overlapping stack. The
 * three panes are deliberately three different KINDS of information — what is booked, what
 * it earned, and what the manager controls — so the screen covers more of the platform
 * without becoming a grid of marketing cards. A manager reading it learns: bookings come in,
 * money comes out, and I am the one deciding. The figures reconcile on purpose (the four
 * sessions sum to the day's total): a preview whose numbers contradict each other is the
 * fastest way to read as a throwaway mockup.
 */
interface ManagerWelcomeScreenProps {
  /** Called once the seen-state is recorded. The host owns where they go next. */
  onContinue: () => void;
}

/** First name only. "Welcome, Rob" is about the person; "Welcome to LocalCooks" is not. */
export function resolveWelcomeFirstName(
  user:
    | { displayName?: string | null; fullName?: string | null; username?: string | null }
    | null
    | undefined,
): string {
  const full = user?.displayName?.trim() || user?.fullName?.trim();
  if (full) return full.split(/\s+/)[0];

  const username = user?.username?.trim();
  if (!username) return "";
  return username.includes("@") ? username.split("@")[0] : username;
}

/** Today's sessions. They sum to the figure quoted above them. */
const TODAY = [
  { initials: "HP", name: "Harbour Prep Co.", amount: "$108" },
  { initials: "NB", name: "Northside Bakes", amount: "$126" },
  { initials: "SS", name: "Salt & Smoke", amount: "$168" },
  { initials: "FF", name: "Fern & Fig", amount: "$150" },
  { initials: "CC", name: "Coastline Catering", amount: "$96" },
] as const;
const TODAY_TOTAL = 108 + 126 + 168 + 150 + 96;

/** Sessions per weekday, Mon to Sun. The sparkline is this week. */
const WEEK = [2, 3, 2, 4, 5, 4, 6];
const WEEK_TOTAL = WEEK.reduce((a, b) => a + b, 0);
const WEEK_MAX = Math.max(...WEEK);
const sparkPoints = WEEK.map(
  (v, i) => [(i * 100) / (WEEK.length - 1), 28 - (v / WEEK_MAX) * 26 - 1] as const,
);
const sparkLine = sparkPoints
  .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`)
  .join(" ");
const sparkArea = `${sparkLine} L100,28 L0,28 Z`;
const [lastX, lastY] = sparkPoints[sparkPoints.length - 1];

/** The dashboard's nav rail, so the window reads as a real surface and not a mockup. */
const NAV_ICONS = [
  "mdi:view-dashboard-outline",
  "mdi:calendar-month-outline",
  "mdi:account-group-outline",
  "mdi:currency-usd-circle-outline",
  "mdi:package-variant-closed",
];

/**
 * "Your rules" — the manager's controls, not a feature list.
 *
 * Each row is a thing they DECIDE, which is the platform's actual promise ("you approve
 * every booking"). Two of them are the capabilities the login panel states; the rest are
 * surfaces the login panel does not mention, because this screen has the room to show that
 * the platform is more than bookings. Every one is verifiable in the repo:
 * storage and equipment listings (`pages/StorageListingManagement`,
 * `EquipmentListingManagement` — also parts 2 and 3 of the wizard's kitchen step),
 * hourly/daily rates (`schema.ts` `hourlyRate` / `dailyRate`),
 * tax kept by the manager (`schema.ts` `taxAmount`).
 */
const RULES = [
  {
    icon: "mdi:account-check-outline",
    key: "welcomeCap4",
    label: "Every chef vetted",
    valueKey: "welcomeCap4Value",
    value: "Approved by you",
  },
  {
    icon: "mdi:shield-check-outline",
    key: "welcomeCap2",
    label: "Damage deposits",
    valueKey: "welcomeCap2Value",
    value: "Held per booking",
  },
  {
    icon: "mdi:clock-outline",
    key: "welcomeRuleRate",
    label: "By the hour or the day",
    valueKey: "welcomeRuleRateValue",
    value: "You set the rates",
  },
  {
    icon: "mdi:package-variant-closed",
    key: "welcomeRuleStorage",
    label: "Storage & equipment",
    valueKey: "welcomeRuleStorageValue",
    value: "Rent those out too",
  },
  {
    icon: "mdi:receipt-text-outline",
    key: "welcomeCap3",
    label: "HST on bookings",
    valueKey: "welcomeCap3Value",
    value: "Itemised on payouts",
  },
] as const;

export default function ManagerWelcomeScreen({ onContinue }: ManagerWelcomeScreenProps) {
  const { t } = useTranslation("manager");
  const { user } = useFirebaseAuth();
  const reduceMotion = useReducedMotion();
  const [isCompleting, setIsCompleting] = useState(false);

  const firstName = resolveWelcomeFirstName(user);

  const reveal = (delay: number, y = 16) => ({
    initial: reduceMotion ? (false as const) : { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: reduceMotion ? 0 : 0.55,
      delay: reduceMotion ? 0 : delay,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  });

  const handleContinue = async () => {
    setIsCompleting(true);
    // Record the dismissal for this session FIRST, whatever the server says. The write below
    // is best-effort, and if it fails the server flag stays false — so without this the guard
    // that put the reader here would send them straight back on the next navigation.
    markWelcomeDismissed();
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/user/seen-welcome", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!response.ok) {
          logger.warn("Could not record the welcome screen as seen:", response.status);
        }
      } else {
        logger.warn("No Firebase user when completing the manager welcome screen");
      }
    } catch (error) {
      logger.error("Error completing the manager welcome screen:", error);
    } finally {
      setIsCompleting(false);
      // Always continue. A failed flag write must not trap someone on a greeting; the
      // worst case is that they see this once more, which is far better than a dead end.
      onContinue();
    }
  };

  return (
    // The brand wash lives on the FULL-BLEED wrapper, not on a max-width child: an
    // absolutely-positioned glow inside a narrower element stops at its edge and leaves a
    // visible seam down the page.
    <div className="relative min-h-screen overflow-hidden bg-[#FBFAF9]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-20rem] h-[36rem] w-[68rem] -translate-x-1/2 rounded-full bg-[#F51042]/[0.07] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-14rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#F51042]/[0.05] blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen max-w-[1180px] flex-col justify-center px-5 py-10 sm:px-8">
        {/* ── The lockup ────────────────────────────────────────────────────────
            Byte-for-byte the lockup from the manager login / sign-up card
            (`ManagerLogin.tsx`): `<Logo variant="brand">` — the white mark with the brand
            filter applied, which is how it is rendered in brand colour everywhere — the
            Lobster wordmark as ONE word, and the "For kitchens" qualifier. Using a
            different asset or "Local Cooks" in two words made the first screen after
            sign-up look like a different product from the one that signed them up. */}
        <motion.div {...reveal(0.02)} className="flex items-center justify-center gap-2.5">
          {/* No `aria-hidden`: `Logo` takes only `className`/`variant`, and `ManagerLogin`
              renders it the same way. */}
          <Logo variant="brand" className="h-9 w-auto shrink-0" />
          <span className="flex flex-col justify-center">
            <span className="font-logo text-xl font-normal leading-none tracking-tight text-[#F51042]">
              LocalCooks
            </span>
            <span className="mt-0.5 text-[9px] font-medium uppercase leading-none tracking-wider text-gray-500/70">
              {t("welcomeForKitchens", "For kitchens")}
            </span>
          </span>
        </motion.div>

        <motion.div {...reveal(0.08)} className="mt-7 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
            <Check className="h-3 w-3" aria-hidden />
            {t("welcomeBadge", "Account created")}
          </span>

          <h1 className="mx-auto mt-5 max-w-3xl text-balance text-[clamp(2rem,4.6vw,3rem)] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950">
            {firstName ? (
              <>
                {t("welcomeGreetingNamed", "Welcome")}
                {", "}
                {firstName}
              </>
            ) : (
              t("welcomeGreeting", "Welcome to Local Cooks")
            )}
          </h1>

          {/* Two tiers on purpose: the promise, then the mechanism. One long paragraph
              reads as body copy and gets skipped; a bold line gets read. */}
          <p className="mx-auto mt-5 max-w-2xl text-balance text-[19px] font-semibold leading-[1.45] tracking-[-0.01em] text-slate-800 sm:text-[21px]">
            {t("welcomeValueLead", "Your kitchen is about to start earning.")}
          </p>
          <p className="mx-auto mt-2.5 max-w-2xl text-balance text-[15px] leading-[1.6] text-slate-600 sm:text-base">
            {t(
              "welcomeValueDetail",
              "Chefs book it by the hour or by the day. You approve every booking, and payouts arrive automatically.",
            )}
          </p>
        </motion.div>

        {/* ══════════════════════════════════════════════════════════════════════
            The stage. Brand red as a FRAME, not a field — the inverse of the login
            page's treatment, so the product reads as the bright object in the room.
            ══════════════════════════════════════════════════════════════════════ */}
        <motion.div {...reveal(0.18)} className="mx-auto mt-9 w-full max-w-[940px]">
          <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#EE0F3F] via-[#c90f35] to-[#8f0a28] p-2.5 shadow-[0_30px_80px_-40px_rgba(143,10,40,0.6)] sm:p-3.5">
            {/* A 1px inner highlight along the top edge. It is what separates a rich
                material from a flat coloured slab. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-white/[0.10] blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-28 right-[-3rem] h-80 w-80 rounded-full bg-white/[0.07] blur-3xl"
            />

            <div className="relative overflow-hidden rounded-[18px] bg-white ring-1 ring-black/[0.06] shadow-[0_28px_70px_-38px_rgba(60,8,24,0.5)]">
              {/* ── Window chrome: names the kitchen being previewed and the two
                  trust facts a manager cares about (licence, locations). ── */}
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <span className="hidden h-2.5 w-2.5 rounded-full bg-slate-200 sm:block" />
                <span className="hidden h-2.5 w-2.5 rounded-full bg-slate-200 sm:block" />
                <span className="hidden h-2.5 w-2.5 rounded-full bg-slate-200 sm:block" />
                <img
                  src={harbourKitchenImage}
                  alt=""
                  aria-hidden
                  className="h-6 w-6 shrink-0 rounded-[7px] object-cover sm:ml-1.5"
                />
                <span className="truncate text-xs font-bold text-slate-800">
                  {t("welcomePreviewKitchen", "Harbour Kitchen")}
                </span>
                <span className="hidden h-3.5 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />
                <span className="hidden shrink-0 items-center gap-1 text-[10px] font-semibold text-emerald-600 sm:inline-flex">
                  <Icon icon="mdi:shield-check" className="h-3.5 w-3.5" aria-hidden />
                  {t("welcomePreviewLicence", "Licence verified")}
                </span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-slate-400">
                  <Icon icon="mdi:eye-outline" className="h-3.5 w-3.5" aria-hidden />
                  {t("welcomePreviewLabel", "Preview")}
                </span>
              </div>

              <div className="flex">
                {/* Nav rail — the same chrome the real dashboard has, so the window is
                    recognisably the product rather than an illustration of it. */}
                <div className="hidden w-11 shrink-0 flex-col items-center gap-3 border-r border-slate-100 py-4 sm:flex">
                  {NAV_ICONS.map((icon, i) => (
                    <span
                      key={icon}
                      className={
                        i === 0
                          ? "flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#F51042] text-white"
                          : "flex h-6 w-6 items-center justify-center rounded-[7px] text-slate-300"
                      }
                    >
                      <Icon icon={icon} className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  ))}
                </div>

                {/* ── The three panes: booked · earned · controlled ── */}
                <div className="grid min-w-0 flex-1 gap-x-6 gap-y-5 p-4 sm:p-5 lg:grid-cols-3">
                  {/* 1 · What is booked */}
                  <div className="min-w-0">
                    {/* Every pane header is pinned to the same height. Without it the
                        right-aligned figure in this one made its rows start a few pixels
                        lower than the other panes', and rows that do not line up across
                        columns are the thing that makes a composed scene look assembled
                        rather than designed. */}
                    <div className="flex h-4 items-baseline justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {t("welcomePreviewToday", "Today at your kitchen")}
                      </p>
                      <p className="shrink-0 text-xs font-bold text-slate-900">${TODAY_TOTAL}</p>
                    </div>
                    {/* Name and value only. A per-row time column was dropped: at this
                        width it truncated the longest kitchen name, and a truncated name
                        in a preview is the fastest way to read as a mockup. */}
                    <div className="mt-2 divide-y divide-slate-100">
                      {TODAY.map((b) => (
                        <div key={b.name} className="flex items-center gap-2 py-[9px]">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">
                            {b.initials}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800">
                            {b.name}
                          </span>
                          <span className="w-8 shrink-0 text-right text-[11px] font-bold text-slate-900">
                            {b.amount}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                      <b className="font-bold text-slate-800">2</b>
                      {t("welcomePreviewRequests", "requests waiting on you")}
                    </p>
                  </div>

                  {/* 2 · What it earned */}
                  <div className="min-w-0 lg:border-l lg:border-slate-100 lg:pl-6">
                    <p className="h-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      {t("welcomePreviewRevenue", "Revenue this month")}
                    </p>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <p className="text-[30px] font-bold leading-none tracking-[-0.03em] text-slate-950">
                        $6,420
                      </p>
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        <Icon icon="mdi:trending-up" className="h-3 w-3" aria-hidden />
                        14.2%
                      </span>
                    </div>

                    <svg
                      viewBox="0 0 100 28"
                      preserveAspectRatio="none"
                      className="mt-4 h-12 w-full"
                      aria-hidden
                    >
                      <defs>
                        <linearGradient id="lc-welcome-spark" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#F51042" stopOpacity="0.26" />
                          <stop offset="100%" stopColor="#F51042" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <path d={sparkArea} fill="url(#lc-welcome-spark)" />
                      <path
                        d={sparkLine}
                        fill="none"
                        stroke="#F51042"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={lastX}
                        cy={lastY}
                        r="1.7"
                        fill="#F51042"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <div className="mt-1.5 flex items-center justify-between text-[9px] font-medium text-slate-300">
                      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                        <span key={i}>{d}</span>
                      ))}
                    </div>
                    {/* The week caption belongs to the sparkline above it, not to the
                        utilisation bar below — it used to sit under the bar and read as
                        a caption for the wrong number. */}
                    <p className="mt-1.5 text-[10px] font-medium text-slate-400">
                      {t("welcomePreviewWeek", "Sessions booked this week")}: {WEEK_TOTAL}
                    </p>

                    {/* Utilisation: the second number a kitchen owner actually manages by,
                        and one the login page never shows. */}
                    <div className="mt-3.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          {t("welcomePreviewUtilisation", "Utilisation")}
                        </span>
                        <span className="text-xs font-bold text-slate-950">82%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-[#e00f3c] to-[#ff5c7a]" />
                      </div>
                    </div>
                  </div>

                  {/* 3 · What the manager controls */}
                  <div className="min-w-0 lg:border-l lg:border-slate-100 lg:pl-6">
                    <p className="h-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      {t("welcomePaneRules", "Your rules")}
                    </p>
                    <div className="mt-2 divide-y divide-slate-100">
                      {RULES.map((r) => (
                        <div key={r.key} className="flex items-center gap-2 py-[9px]">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#F51042]/10 text-[#F51042]">
                            <Icon icon={r.icon} className="h-3 w-3" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800">
                            {t(r.key, r.label)}
                          </span>
                          <span className="shrink-0 text-right text-[9px] text-slate-400">
                            {t(r.valueKey, r.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Status strip: where the money lands, and how the manager hears
                  about it. Two facts that belong together and would have cost two
                  more cards above the fold. ── */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-[#635BFF] text-white">
                    <SiStripe className="h-2.5 w-2.5" aria-hidden />
                  </span>
                  {t("welcomePreviewPayout", "Payout")} · $1,284 ·{" "}
                  {t("welcomePreviewPayoutDay", "Friday")}
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
                  <Icon icon="mdi:email-fast-outline" className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  {t("welcomeCap1", "Email + SMS alerts")}
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── The single action ─────────────────────────────────────────────────
            There is deliberately NO step indicator here.
            A step indicator belongs to a process the user is WORKING THROUGH and that
            has its own back/next navigation — the USWDS step-indicator guidance is
            explicit that it "is designed to complement standard back/next navigation in
            a linear sequence, not to be navigation of its own". This screen has no
            navigation; it has one button. It also duplicates progress the manager meets
            minutes later in two places that DO have real navigation:
            `ManagerOnboardingWizard`'s `EnterpriseStepper` (whose first step is
            literally `welcome`) and the dashboard's `ManagerGettingStarted` checklist.
            A third, decorative one would dilute both. The next step is stated in words
            below the button instead, which is what the welcome-screen research actually
            asks for: "one line on what happens next". */}
        <motion.div {...reveal(0.26)} className="mx-auto mt-8 flex w-full max-w-md flex-col items-center">
          <Button
            onClick={handleContinue}
            disabled={isCompleting}
            size="lg"
            className="w-full rounded-xl bg-[#F51042] font-semibold text-white shadow-[0_2px_6px_-1px_rgba(15,23,42,0.1),0_10px_28px_-8px_rgba(245,16,66,0.38)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#E00A38]"
          >
            {isCompleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                {t("welcomeContinuing", "One moment...")}
              </>
            ) : (
              <>
                {t("welcomeContinue", "Set up my kitchen")}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </>
            )}
          </Button>
          <p className="mt-3 text-center text-xs text-slate-400">
            {t(
              "welcomeContinueHint",
              "Next: accept the Terms & Conditions to activate your account.",
            )}
          </p>
          <span className="mt-3 inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
            <SiStripe className="h-3.5 w-3.5 text-[#635BFF]" aria-hidden />
            {t("welcomePayouts", "Payouts handled by Stripe")}
          </span>
        </motion.div>
      </div>
    </div>
  );
}
