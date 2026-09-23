import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { SiStripe } from "react-icons/si";
import storefrontCover from "@/assets/chef-cooking.png";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";

// ── Preview content ───────────────────────────────────────────────────────────
// Everything on this panel reconciles with everything else on it: the sparkline is the week its
// own caption counts, the payout is a share of the month's revenue, and the kitchen booked in
// the dashboard is the one the strip behind it lists as booked, at the rate that strip shows.
// A preview whose own numbers contradict each other is the fastest way to read as a mockup.

/** The chef dashboard's own rail, so the window reads as the app rather than a web page. */
const NAV_ICONS = [
  "mdi:view-dashboard-outline",
  "mdi:clipboard-list-outline",
  "mdi:storefront-outline",
  "mdi:currency-usd-circle-outline",
  "mdi:message-outline",
];

/** Kitchens a chef can book, nearest first. One is already booked — that is the point. */
const KITCHENS = [
  { name: "Harbour Kitchen", distance: "0.8 km", rate: "$30/hr", booked: true },
  { name: "The Culinary Hub", distance: "1.6 km", rate: "$18/hr" },
  { name: "Saltbox Commissary", distance: "2.4 km", rate: "$22/hr" },
  { name: "Eastside Prep House", distance: "3.2 km", rate: "$20/hr" },
];

/** Today's orders, newest first. Real names, because "sell to local customers" is the claim. */
const ORDERS = [
  { initials: "JW", name: "Jennifer W.", amount: "$48.00" },
  { initials: "MT", name: "Michael T.", amount: "$22.50" },
  { initials: "PS", name: "Priya S.", amount: "$63.00" },
  { initials: "DR", name: "Daniel R.", amount: "$31.00" },
];

/**
 * The chef's next session in a commercial kitchen — the same kitchen the strip behind this window
 * lists as booked.
 *
 * NOTE: the total is PINNED to the requested figure, it is not derived from the strip's rate.
 * 10:00–12:00 is two hours, which at $30/hr is $60 — so these two numbers do not reconcile, and
 * that is deliberate until the copy is settled. Everything else on this panel does reconcile.
 */
const NEXT_BOOKING = {
  kitchen: "Harbour Kitchen",
  when: "Sep 29 · 10:00–12:00",
  station: "Station 3",
  total: "$30.00",
};

/** Orders per weekday, Mon–Sun. Ends on the week's peak so the trend reads upward. */
const WEEK = [11, 14, 9, 18, 22, 19, 26];
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

/**
 * What the platform carries on the chef's behalf. Order management and the delivery/tracking
 * story belong to the customer side of the product (the LocalCooks apps), not this repo; the
 * licence gate is real here (`kitchen_license_status` — a lapsed licence blocks new bookings),
 * and payouts run through Stripe Connect.
 *
 * Each value must ADD to its label, never restate it, and must answer the question the label
 * raises rather than describe our process: "Every kitchen certified / Licence checked" said the
 * same thing twice, "We handle it" said nothing, and "Reviewed by our team" told a chef about
 * our paperwork when what they want to know is whether the kitchen is fit to cook in.
 */
const CAPABILITIES = [
  { icon: "mdi:truck-delivery-outline", label: "Live delivery tracking", value: "Door to door" },
  { icon: "mdi:clipboard-list-outline", label: "Order management", value: "In one place" },
  { icon: "mdi:shield-check-outline", label: "Every kitchen certified", value: "Inspected & licensed" },
  { icon: "mdi:account-heart-outline", label: "Chef support", value: "24/7" },
];

export default function ChefAuthShowcase() {
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
      aria-label="A preview of the storefront, orders and commercial kitchen space a chef gets on LocalCooks"
      className="relative hidden min-h-screen overflow-hidden px-7 py-8 lg:flex lg:h-screen lg:min-h-0 lg:w-[58%] xl:px-12"
    >
      <div aria-hidden className="absolute -left-20 top-12 h-64 w-64 rounded-full bg-white/10 blur-sm" />
      <div aria-hidden className="absolute right-[5%] top-[38%] h-80 w-80 rounded-full bg-white/[0.07]" />

      <div className="relative mx-auto flex w-full max-w-[790px] flex-col justify-center lg:h-full">
        <motion.div {...reveal(0.06, -18)}>
          {/* TWO KEYS, ON PURPOSE — they are the two halves of one sentence, and a translator
              must not be able to reorder them. The break is a design decision: at the measure
              this panel offers, the whole sentence either collapses to a single thin ribbon
              (1440) or strands "on" at the end of line one (1920). Authoring the break per
              language gives every locale a clean two-line headline, which is also the shape
              the manager panel's headline has. `block` on the tail is what forces it; a
              trailing space in the markup keeps the accessible name one sentence. */}
          <h2 className="text-pretty text-[clamp(2.05rem,2.95vw,3.05rem)] font-bold leading-[1.07] tracking-[-0.028em] text-white">
            {t("chefShowcaseHeadline", "Build your food business")}{" "}
            <span className="block">{t("chefShowcaseHeadlineTail", "on your terms.")}</span>
          </h2>
          {/* The measure is set for the LONGEST of the three locales, not for English. At the
              560px English wants, the French and Ukrainian subheads each stranded a two-word
              last line. `text-pretty` alone does not rescue that — Chromium only pulls back a
              line that is down to a single word. */}
          <p className="mt-5 max-w-[620px] text-pretty text-[15px] leading-[1.6] text-white/80 xl:text-base">
            {t(
              "chefShowcaseSubhead",
              "Launch your online storefront, sell directly to local customers, and book certified commercial kitchen space whenever you need it.",
            )}
          </p>
        </motion.div>

        {/* ══════════════════════════════════════════════════════════════════════
            One composed scene, three surfaces on a single depth axis — the same
            arrangement the manager panel uses, so the two portals read as one
            product rather than two builds:
              z-10  kitchens      — the space the chef books, offset up and inset,
                                    so it stacks behind the storefront instead of
                                    floating beside it.
              z-20  storefront    — the focal surface: the chef's own business.
              z-30  capabilities  — sits on the storefront's lower-left, which the
                                    layout keeps empty, so it overlaps without ever
                                    covering a figure.
            ══════════════════════════════════════════════════════════════════════ */}
        <div className="relative mt-7 hidden w-full lg:block lg:min-h-0 lg:flex-1 lg:max-h-[500px] xl:max-h-[550px]">
          <div className="absolute inset-0 flex flex-col justify-center">
            <div className="relative h-full max-h-[520px] w-full">
              {/* ── z-10 · Commercial kitchens ────────────────────────────────── */}
              <motion.div
                {...reveal(0.12, 16, -12)}
                data-surface="kitchens"
                className="absolute right-[4%] top-0 z-10 w-[86%] overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.06] shadow-[0_20px_46px_-26px_rgba(60,8,24,0.5)]"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5">
                  <Icon icon="mdi:chef-hat" className="h-3.5 w-3.5 text-[#F51042]" aria-hidden />
                  <span className="text-[10px] font-bold text-slate-800">Commercial kitchens</span>
                  <span className="rounded-full bg-[#F51042]/10 px-2 py-0.5 text-[9px] font-semibold text-[#F51042]">
                    12 nearby
                  </span>
                  <span className="ml-auto text-[9px] font-medium text-slate-400">
                    Book by the hour or day
                  </span>
                </div>
                {/* The list is taller than the window it peeks through, so the fourth row
                    is deliberately cropped. A crop that lands exactly on the card's bottom
                    edge is what reads as an accident. */}
                <div className="divide-y divide-slate-100">
                  {KITCHENS.map((k) => (
                    <div key={k.name} className="flex items-center gap-2.5 px-3.5 py-[7px]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-200" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-800">
                        {k.name}
                      </span>
                      <span className="shrink-0 text-[9px] text-slate-400">{k.distance}</span>
                      <span className="w-11 shrink-0 text-right text-[10px] font-bold text-slate-900">
                        {k.rate}
                      </span>
                      {k.booked ? (
                        /* The closing beat of the scene: the booking lands last, after
                           the three surfaces have settled. One pop, no loop. */
                        <motion.span
                          initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{
                            duration: reduceMotion ? 0 : 0.32,
                            delay: reduceMotion ? 0 : 1.35,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-[3px] text-[9px] font-bold text-emerald-700"
                        >
                          <Icon icon="mdi:check" className="h-2.5 w-2.5" aria-hidden /> Booked
                        </motion.span>
                      ) : (
                        <span className="shrink-0 rounded-full border border-slate-200 px-2.5 py-[3px] text-[9px] font-semibold text-slate-600">
                          Book
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* ── z-20 · The storefront ────────────────────────────────────── */}
              <motion.div
                {...reveal(0.18, 20, 14)}
                data-surface="storefront"
                className="absolute bottom-0 right-0 top-[24%] z-20 flex w-[94%] flex-col overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.06] shadow-[0_-18px_34px_-20px_rgba(60,8,24,0.55),0_36px_80px_-30px_rgba(60,8,24,0.55)]"
              >
                {/* Window chrome — the storefront's live state, then its social proof. */}
                <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3.5 py-2.5">
                  <span className="h-2 w-2 rounded-full bg-slate-200" />
                  <span className="h-2 w-2 rounded-full bg-slate-200" />
                  <span className="h-2 w-2 rounded-full bg-slate-200" />
                  <img
                    src={storefrontCover}
                    alt=""
                    aria-hidden
                    className="ml-1.5 h-5 w-5 shrink-0 rounded-[6px] object-cover"
                  />
                  <span className="truncate text-[10px] font-bold text-slate-800">Spice &amp; Spoon</span>
                  <span className="h-3 w-px shrink-0 bg-slate-200" aria-hidden />
                  <span className="inline-flex shrink-0 items-center gap-1 text-[9px] font-semibold text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> Accepting orders
                  </span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[9px] font-medium text-slate-400">
                    <Icon icon="mdi:star" className="h-3 w-3 text-amber-400" aria-hidden /> 5.0 · 124 reviews
                  </span>
                </div>

                <div className="flex min-h-0 flex-1">
                  {/* Nav rail. It reads as the chef's own dashboard rather than a storefront
                      page — and it is load-bearing for the composition: without it the right
                      column starts ~9px left of the capability panel's edge, and the panel
                      clips "Waiting on you". */}
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

                  <div className="flex min-w-0 flex-1 flex-col p-3.5">
                  {/* Tab strip — names the screens that are not rendered. */}
                  <div className="flex shrink-0 items-center gap-4 border-b border-slate-100">
                    {["Storefront", "Orders", "Menu", "Payouts"].map((tab, i) => (
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
                    {/* Left column — the focal figure, then the week behind it. Kept
                        short on purpose: the capability panel lands in the space
                        underneath it. */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Revenue this month
                      </p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <p className="text-[30px] font-bold leading-none tracking-[-0.02em] text-slate-950">
                          $4,286.40
                        </p>
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                          <Icon icon="mdi:trending-up" className="h-2.5 w-2.5" aria-hidden /> 18.4%
                        </span>
                      </div>

                      <div className="mt-4">
                        <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-9 w-full" aria-hidden>
                          <defs>
                            <linearGradient id="lc-chef-spark" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#F51042" stopOpacity="0.28" />
                              <stop offset="100%" stopColor="#F51042" stopOpacity="0.02" />
                            </linearGradient>
                          </defs>
                          <path d={sparkArea} fill="url(#lc-chef-spark)" />
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
                          {WEEK_TOTAL} orders this week
                        </p>
                      </div>
                    </div>

                    {/* Right column — the customers, because "sell directly to local
                        customers" is the claim the panel has to make good on. Three stacked
                        blocks, matching the manager panel's density: two blocks left a 130px
                        void between them that read as an unfinished layout. */}
                    <div data-col="orders" className="flex w-[58%] shrink-0 flex-col justify-between gap-3">
                      <div className="min-h-0">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Orders today
                        </p>
                        <div className="mt-1.5 divide-y divide-slate-100">
                          {ORDERS.map((o, i) => (
                            /* One-shot, opacity-only: the list fills in once and settles,
                               which tells the "orders arriving" story without a loop and
                               without moving anything. */
                            <motion.div
                              key={o.name}
                              initial={reduceMotion ? false : { opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{
                                duration: reduceMotion ? 0 : 0.5,
                                delay: reduceMotion ? 0 : 0.5 + i * 0.1,
                                ease: "easeOut",
                              }}
                              className="flex items-center gap-2 py-[6px]"
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">
                                {o.initials}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-800">
                                {o.name}
                              </span>
                              <span className="shrink-0 text-[10px] font-bold text-slate-900">
                                {o.amount}
                              </span>
                            </motion.div>
                          ))}
                        </div>
                      </div>

                      <div className="min-h-0">
                        <div className="flex items-baseline justify-between">
                          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Next kitchen booking
                          </p>
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-600">
                            <Icon icon="mdi:check-circle" className="h-2.5 w-2.5" aria-hidden /> Confirmed
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2.5 rounded-xl bg-slate-50 p-2 ring-1 ring-inset ring-slate-900/[0.04]">
                          <img
                            src={harbourKitchenImage}
                            alt=""
                            aria-hidden
                            className="h-9 w-9 shrink-0 rounded-lg object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10px] font-bold text-slate-900">
                              {NEXT_BOOKING.kitchen}
                            </p>
                            <p className="mt-0.5 truncate text-[9px] text-slate-500">
                              {NEXT_BOOKING.when}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[10px] font-bold text-slate-900">{NEXT_BOOKING.total}</p>
                            <p className="mt-0.5 text-[8px] text-slate-400">{NEXT_BOOKING.station}</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Waiting on you
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px]">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                          <span className="text-slate-500">
                            <b className="font-bold text-slate-800">3</b> new orders
                          </span>
                          <span className="text-slate-300" aria-hidden>
                            ·
                          </span>
                          <span className="text-slate-500">
                            <b className="font-bold text-slate-800">1</b> message
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              </motion.div>

              {/* ── z-30 · What the platform carries, over the storefront's empty
                  lower-left ── */}
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
                    <span className="shrink-0 text-[9px] font-medium text-slate-400">$812.60 · Friday</span>
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
