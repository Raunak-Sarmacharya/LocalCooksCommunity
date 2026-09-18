import { Icon } from "@iconify/react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { SiStripe } from "react-icons/si";
import { EMAIL_NEW_ICON, RECEIPT_TAX_ICON } from "@/components/ui/showcase-icons";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";

// ── Preview content ───────────────────────────────────────────────────────────
// The figures reconcile on purpose: the three sessions listed for today sum to the
// day's total, and the sparkline is the same week the caption describes. A preview
// whose numbers contradict each other is the fastest way to read as a throwaway mockup.

const NAV_ICONS = [
  "mdi:view-dashboard-outline",
  "mdi:calendar-month-outline",
  "mdi:account-group-outline",
  "mdi:currency-usd-circle-outline",
  "mdi:cog-outline",
];

const TABS = ["Overview", "Bookings", "Availability", "Payouts"];

const TODAY = [
  { initials: "HP", name: "Harbour Prep Co.", time: "9:00–12:00", amount: "$108" },
  { initials: "NB", name: "Northside Bakes", time: "13:00–16:00", amount: "$126" },
  { initials: "SS", name: "Salt & Smoke", time: "17:30–21:30", amount: "$168" },
  { initials: "FF", name: "Fern & Fig", time: "19:00–22:00", amount: "$150" },
];

// Four rows on purpose: the dashboard crops the queue part-way down the fourth, so the
// list is visibly longer than the window it peeks through. A crop that lands exactly on
// the card's bottom edge is what made the old version read as an accident.
const REQUESTS = [
  { name: "Sunday Prep", when: "Sep 20 · 4 hrs" },
  { name: "Little Fold Bakery", when: "Sep 22 · 6 hrs" },
  { name: "Coastline Catering", when: "Sep 24 · 3 hrs" },
  { name: "The Preserve Co.", when: "Sep 25 · 8 hrs" },
];

/** Sessions per weekday, Mon–Sun. Ends on the week's peak so the trend reads upward. */
const WEEK = [2, 3, 2, 4, 5, 4, 6];
const WEEK_TOTAL = WEEK.reduce((a, b) => a + b, 0);
const WEEK_MAX = Math.max(...WEEK);

/** A 100×28 polyline, so the sparkline needs no chart library. */
const sparkPoints = WEEK.map((v, i) => [
  (i * 100) / (WEEK.length - 1),
  28 - (v / WEEK_MAX) * 26 - 1,
] as const);
const sparkLine = sparkPoints.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
const sparkArea = `${sparkLine} L100,28 L0,28 Z`;
const [lastX, lastY] = sparkPoints[sparkPoints.length - 1];

/** The platform capabilities the panel states. Every line is verifiable in the repo. */
const CAPABILITIES = [
  { icon: EMAIL_NEW_ICON, label: "Email + SMS alerts", value: "On every request" },
  { icon: "mdi:shield-check-outline", label: "Damage deposits", value: "Held per booking" },
  { icon: RECEIPT_TAX_ICON, label: "HST on bookings", value: "Itemised on payouts" },
  { icon: "mdi:account-check-outline", label: "Every chef vetted", value: "Approved by you" },
];

export default function KitchenAuthShowcase() {
  const { t } = useTranslation("auth");
  const reduceMotion = useReducedMotion();
  const reveal = (delay: number, x = 0, y = 18) => ({
    initial: reduceMotion ? false as const : { opacity: 0, x, y },
    animate: { opacity: 1, x: 0, y: 0 },
    transition: {
      duration: 0.55,
      delay: reduceMotion ? 0 : delay,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  });

  return (
    <section
      aria-label="Why commercial kitchens use LocalCooks"
      className="relative hidden min-h-screen overflow-hidden px-7 py-8 lg:flex lg:h-screen lg:min-h-0 lg:w-[58%] xl:px-12"
    >
      <div className="absolute -left-20 top-12 h-64 w-64 rounded-full bg-white/10 blur-sm" />
      <div className="absolute right-[5%] top-[38%] h-80 w-80 rounded-full bg-white/[0.07]" />

      <div className="relative mx-auto flex w-full max-w-[790px] flex-col justify-center lg:h-full">
        <motion.div {...reveal(0.06, -18)}>
          <h2 className="text-balance text-[clamp(2.05rem,2.95vw,3.05rem)] font-bold leading-[1.07] tracking-[-0.028em] text-white">
            {t("showcaseHeadline", "Turn your kitchen’s downtime into revenue.")}
          </h2>
          <p className="mt-5 max-w-[560px] text-[15px] leading-[1.6] text-white/80 xl:text-base">
            {t("showcaseSubhead", "Local food businesses book your licensed kitchen by the hour or day. You approve who cooks in it, and payouts arrive automatically.")}
          </p>
        </motion.div>

        {/* ══════════════════════════════════════════════════════════════════════
            One composed scene, three surfaces on a single depth axis:
              z-10  requests queue  — SAME width as the dashboard, inset 2% a side,
                                      offset up. A deliberate stack, not a stray card.
              z-20  dashboard       — the focal surface
              z-30  capability panel— sits on the dashboard's lower-left corner, which
                                      the layout keeps empty, so it overlaps without
                                      ever covering a number.
            ══════════════════════════════════════════════════════════════════════ */}
        <div className="relative mt-7 hidden w-full lg:block lg:min-h-0 lg:flex-1 lg:max-h-[500px] xl:max-h-[550px]">
          <div className="absolute inset-0 flex flex-col justify-center">
            <div className="relative h-full max-h-[520px] w-full">
              {/* ── z-10 · Requests queue ─────────────────────────────────────── */}
              <motion.div
                {...reveal(0.12, 16, -12)}
                data-surface="queue"
                className="absolute right-[4%] top-0 z-10 w-[86%] overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.06] shadow-[0_20px_46px_-26px_rgba(60,8,24,0.5)]"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5">
                  <Icon icon="mdi:inbox-arrow-down-outline" className="h-3.5 w-3.5 text-[#F51042]" aria-hidden />
                  <span className="text-[10px] font-bold text-slate-800">Booking requests</span>
                  {/* The closing beat: after the cards settle and the day fills in, the new-demand
                      count pops once. `inline-block` is required or the transform is ignored on a
                      span, and the scale is tiny (0.8→1) so it reads as a pop, not a movement. */}
                  <motion.span
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.32,
                      delay: reduceMotion ? 0 : 1.35,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="inline-block rounded-full bg-[#F51042]/10 px-2 py-0.5 text-[9px] font-semibold text-[#F51042]"
                  >
                    4 new
                  </motion.span>
                  <span className="ml-auto text-[9px] font-medium text-slate-400">
                    Waiting on your approval
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {REQUESTS.map((r) => (
                    <div key={r.name} className="flex items-center gap-2.5 px-3.5 py-[7px]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-800">
                        {r.name}
                      </span>
                      <span className="shrink-0 text-[9px] text-slate-400">{r.when}</span>
                      <span className="shrink-0 rounded-full border border-slate-200 px-2.5 py-[3px] text-[9px] font-semibold text-slate-600">
                        Review
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* ── z-20 · The dashboard ─────────────────────────────────────── */}
              <motion.div
                {...reveal(0.18, 20, 14)}
                data-surface="dashboard"
                className="absolute bottom-0 right-0 top-[24%] z-20 flex w-[94%] flex-col overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.06] shadow-[0_-18px_34px_-20px_rgba(60,8,24,0.55),0_36px_80px_-30px_rgba(60,8,24,0.55)]"
              >
                {/* Window chrome */}
                <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3.5 py-2.5">
                  <span className="h-2 w-2 rounded-full bg-slate-200" />
                  <span className="h-2 w-2 rounded-full bg-slate-200" />
                  <span className="h-2 w-2 rounded-full bg-slate-200" />
                  <img
                    src={harbourKitchenImage}
                    alt=""
                    aria-hidden
                    className="ml-1.5 h-5 w-5 shrink-0 rounded-[6px] object-cover"
                  />
                  <span className="truncate text-[10px] font-bold text-slate-800">Harbour Kitchen</span>
                  <span className="h-3 w-px shrink-0 bg-slate-200" aria-hidden />
                  <span className="inline-flex shrink-0 items-center gap-1 text-[9px] font-semibold text-emerald-600">
                    <Icon icon="mdi:shield-check" className="h-3 w-3" aria-hidden /> Licence verified
                  </span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[9px] font-medium text-slate-400">
                    <Icon icon="mdi:map-marker-outline" className="h-3 w-3" aria-hidden /> 2 locations
                  </span>
                </div>

                <div className="flex min-h-0 flex-1">
                  {/* Nav rail */}
                  <div className="flex w-10 shrink-0 flex-col items-center gap-3 border-r border-slate-100 py-3">
                    {NAV_ICONS.map((icon, i) => (
                      <span
                        key={icon}
                        className={
                          i === 0
                            ? "flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#F51042] text-white"
                            : "flex h-6 w-6 items-center justify-center rounded-[7px] text-slate-400"
                        }
                      >
                        <Icon icon={icon} className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    ))}
                  </div>

                  {/* Content */}
                  <div className="flex min-w-0 flex-1 flex-col p-3.5">
                    {/* Tab strip — names the screens that are not rendered */}
                    <div className="flex shrink-0 items-center gap-4 border-b border-slate-100">
                      {TABS.map((tab, i) => (
                        <span
                          key={tab}
                          className={
                            i === 0
                              ? "-mb-px border-b-2 border-[#F51042] pb-2 text-[10px] font-bold text-slate-900"
                              : "-mb-px border-b-2 border-transparent pb-2 text-[10px] font-medium text-slate-400"
                          }
                        >
                          {tab}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 flex min-h-0 flex-1 gap-3.5">
                      {/* Left column — the focal number, then the week */}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Revenue this month
                        </p>
                        <div className="mt-1 flex items-baseline gap-2">
                          <p className="text-[30px] font-bold leading-none tracking-[-0.02em] text-slate-950">
                            $6,420
                          </p>
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                            <Icon icon="mdi:trending-up" className="h-2.5 w-2.5" aria-hidden /> 14.2%
                          </span>
                        </div>

                        <div className="mt-4">
                          <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-9 w-full" aria-hidden>
                            <defs>
                              <linearGradient id="lc-spark" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#F51042" stopOpacity="0.28" />
                                <stop offset="100%" stopColor="#F51042" stopOpacity="0.02" />
                              </linearGradient>
                            </defs>
                            <path d={sparkArea} fill="url(#lc-spark)" />
                            <path
                              d={sparkLine}
                              fill="none"
                              stroke="#F51042"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                            <circle cx={lastX} cy={lastY} r="1.6" fill="#F51042" vectorEffect="non-scaling-stroke" />
                          </svg>
                          <div className="mt-1 flex items-center justify-between text-[8px] font-medium text-slate-300">
                            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                              <span key={i}>{d}</span>
                            ))}
                          </div>
                          <p className="mt-1 text-[9px] font-medium text-slate-400">
                            {WEEK_TOTAL} sessions booked this week
                          </p>
                        </div>
                      </div>

                      {/* Right column — utilisation, then today */}
                      <div className="flex w-[58%] shrink-0 flex-col justify-between gap-3">
                        <div>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                              Utilisation
                            </span>
                            <span className="text-[13px] font-bold text-slate-950">82%</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-900/[0.04]">
                            <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-[#e00f3c] to-[#ff5c7a]" />
                          </div>
                        </div>

                        <div className="min-h-0">
                          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Today at your kitchen
                          </p>
                          <div className="mt-1.5 divide-y divide-slate-100">
                            {TODAY.map((b, i) => (
                              /* One-shot, opacity-only. This is the whole motion budget for the
                                 scene: the list fills in once and settles, which tells the
                                 "bookings arriving" story without a loop and without moving
                                 anything. No position shift, nothing repeats — see the motion
                                 decision notes before adding more here. */
                              <motion.div
                                key={b.name}
                                initial={reduceMotion ? false : { opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{
                                  duration: reduceMotion ? 0 : 0.5,
                                  delay: reduceMotion ? 0 : 0.5 + i * 0.1,
                                  ease: "easeOut",
                                }}
                                className="flex items-center gap-2 py-[7px]"
                              >
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">
                                  {b.initials}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-800">
                                  {b.name}
                                </span>
                                <span className="shrink-0 text-[9px] text-slate-400">{b.time}</span>
                                <span className="w-7 shrink-0 text-right text-[10px] font-bold text-slate-900">
                                  {b.amount}
                                </span>
                              </motion.div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Waiting on you
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px]">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                            <span className="text-slate-500">
                              <b className="font-bold text-slate-800">2</b> requests
                            </span>
                            <span className="text-slate-300" aria-hidden>
                              ·
                            </span>
                            <span className="text-slate-500">
                              <b className="font-bold text-slate-800">4</b> applications
                            </span>
                            <span className="text-slate-300" aria-hidden>
                              ·
                            </span>
                            <span className="text-slate-500">
                              <b className="font-bold text-slate-800">1</b> tour
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* ── z-30 · Capabilities, over the dashboard's empty lower-left ── */}
              <motion.div
                {...reveal(0.3, -18, 18)}
                data-surface="panel"
                className="absolute bottom-[-2%] left-0 z-30 w-[47%] overflow-hidden rounded-[14px] bg-white ring-1 ring-black/[0.06] shadow-[0_0_20px_-4px_rgba(60,8,24,0.5),0_24px_54px_-16px_rgba(60,8,24,0.45)]"
              >
                <div className="divide-y divide-slate-100">
                  <div className="flex items-center gap-2 px-3 py-[6px]">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#635BFF] text-white">
                      <SiStripe className="h-3 w-3" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-800">
                      Payouts by Stripe
                    </span>
                    <span className="shrink-0 text-[9px] font-medium text-slate-400">$1,284 · Friday</span>
                  </div>
                  {CAPABILITIES.map((c) => (
                    <div key={c.label} className="flex items-center gap-2 px-3 py-[6px]">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-slate-100 text-slate-600">
                        <Icon icon={c.icon} className="h-3 w-3" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-800">
                        {c.label}
                      </span>
                      <span className="shrink-0 text-[9px] font-medium text-slate-400">{c.value}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
