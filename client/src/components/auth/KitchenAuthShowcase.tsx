import { Icon } from "@iconify/react";
import { motion, useReducedMotion } from "framer-motion";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";

const bookingRows = [
  ["Harbour Prep Co.", "9:00–12:00", "$108"],
  ["Northside Bakes", "13:00–16:00", "$126"],
  ["Salt & Smoke", "17:30–21:30", "$168"],
];

export default function KitchenAuthShowcase() {
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
      aria-label="A preview of LocalCooks tools for commercial kitchen managers"
      className="relative hidden min-h-screen overflow-hidden px-7 py-8 lg:flex lg:h-screen lg:min-h-0 lg:w-[58%] xl:px-12"
    >
      <div className="absolute -left-20 top-12 h-64 w-64 rounded-full bg-white/10 blur-sm" />
      <div className="absolute right-[5%] top-[38%] h-80 w-80 rounded-full bg-white/[0.07]" />

      <div className="relative mx-auto flex w-full max-w-[790px] flex-col justify-center">
        <motion.div {...reveal(0.06, -18)}>
          <h2 className="max-w-[690px] text-[clamp(2rem,3.2vw,3.5rem)] font-bold leading-[1.02] tracking-[-0.05em] text-white">
            Put your kitchen space to work.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 xl:text-base">
            Manage availability, welcome local food businesses, and grow your kitchen revenue from one simple dashboard.
          </p>
        </motion.div>

        <div className="relative mt-7 h-[500px] w-full perspective-[1200px] xl:h-[550px]">
          {/* ═════════ CLUSTER 1: UTILIZATION & REVENUE (Top Right) ═════════ */}
          
          {/* Base Card: Kitchen utilization & Revenue */}
          <motion.div
            {...reveal(0.14, 20, -10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[4%] top-[2%] z-10 w-[57%] rounded-[1.4rem] border border-white/45 bg-white p-4 shadow-[0_22px_55px_-24px_rgba(41,8,18,0.55)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <Icon icon="mdi:chart-donut" className="h-3.5 w-3.5 text-[#F51042]" /> Kitchen utilization
                </div>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">82%</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                <Icon icon="mdi:trending-up" className="h-3 w-3" /> 14.2%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-[82%] rounded-full bg-[#F51042]" />
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-slate-400">Revenue this month</p>
                <p className="mt-0.5 text-lg font-bold text-slate-950">$6,420.00</p>
              </div>
              <p className="text-[10px] font-semibold text-slate-500">126 booked hours</p>
            </div>
          </motion.div>

          {/* New Example 1: Damage Claim (Top Left, Overlapping Utilization) */}
          <motion.div
            {...reveal(0.25, -20, -10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[48%] top-[-4%] z-30 w-max pr-6 rounded-[1rem] border border-white/45 bg-white/95 backdrop-blur-md p-2.5 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-50 text-rose-500 flex-shrink-0">
                <Icon icon="mdi:shield-check" className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[10px] font-bold text-slate-900">Damage claim</p>
                <p className="text-[8px] text-emerald-600 font-semibold">Approved · $150</p>
              </div>
            </div>
          </motion.div>

          {/* Overlapping 1: New request (Left edge of Base Card) */}
          <motion.div
            {...reveal(0.22, -20, 10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[56%] top-[18%] z-20 w-max min-w-[170px] pr-6 rounded-[1.2rem] border border-white/45 bg-white/95 p-3 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <Icon icon="mdi:account-clock-outline" className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">New request</p>
                <p className="truncate text-xs font-bold text-slate-900">Sunday Prep</p>
              </div>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700">REVIEW</span>
            </div>
            <div className="mt-2.5 flex items-center gap-3 border-t border-slate-100 pt-2.5 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><Icon icon="mdi:calendar-outline" /> Sep 20</span>
              <span className="flex items-center gap-1"><Icon icon="mdi:clock-outline" /> 4 hours</span>
            </div>
          </motion.div>

          {/* Overlapping 2: Next payout (Bottom Right of Base Card) */}
          <motion.div
            {...reveal(0.28, 20, 18)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[-2%] top-[26%] z-30 w-max rounded-[1rem] border border-white/45 bg-white/95 p-2 pr-6 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center justify-between gap-4 px-1">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-[#635BFF]">
                  <Icon icon="mdi:bank-transfer-in" className="h-3 w-3" />
                </div>
                <div>
                  <p className="text-[9px] font-bold leading-tight text-slate-900">Next payout</p>
                  <p className="text-[8px] font-medium leading-tight text-emerald-600">Arrives Friday</p>
                </div>
              </div>
              <strong className="text-[11px] text-slate-900 pr-1">$1,284</strong>
            </div>
          </motion.div>

          {/* ═════════ CLUSTER 2: BOOKINGS & MANAGEMENT (Bottom Left) ═════════ */}

          {/* Base Card: Kitchen Hub Booking */}
          <motion.div
            {...reveal(0.32, -20, 20)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[4%] left-[5%] z-10 w-[57%] overflow-hidden rounded-[1.4rem] border border-white/45 bg-white p-1.5 shadow-[0_24px_60px_-20px_rgba(41,8,18,0.55)]"
          >
            <div className="relative h-[102px] overflow-hidden rounded-t-xl rounded-b-sm bg-slate-100 group">
              <img src={harbourKitchenImage} alt="Commercial kitchen workspace" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
              <div className="absolute bottom-2.5 left-3 text-white">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/75">Today at your kitchen</p>
                <p className="text-sm font-bold">3 confirmed bookings</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100 px-3 py-1.5 bg-white">
              {bookingRows.map(([name, time, amount]) => (
                <div key={name} className="flex items-center gap-2 py-1.5 text-[9px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="min-w-0 flex-1 truncate font-bold text-slate-900">{name}</span>
                  <span className="text-slate-500">{time}</span>
                  <span className="w-8 text-right font-bold text-slate-800">{amount}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Overlapping 1: Manage your space (Right edge of Kitchen card) */}
          <motion.div
            {...reveal(0.38, 20, 30)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[16%] left-[52%] z-20 w-[40%] rounded-[1.25rem] border border-white/45 bg-white/95 p-3.5 shadow-2xl backdrop-blur-md"
          >
            <p className="mb-2 text-xs font-bold text-slate-900">Manage your space</p>
            <div className="flex flex-col gap-2">
              <div className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#F51042] py-2 text-center text-[11px] font-bold text-white shadow-md cursor-default pointer-events-none">
                <Icon icon="mdi:calendar-edit" className="h-3.5 w-3.5" /> Update availability
              </div>
              <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-center text-[11px] font-semibold text-slate-700 cursor-default pointer-events-none">
                <Icon icon="mdi:account-group-outline" className="h-3.5 w-3.5" /> Review applications
              </div>
            </div>
          </motion.div>

          {/* New Example 2: Overstay Penalty (Floating near bottom right of Base Card) */}
          <motion.div
            {...reveal(0.4, 30, 20)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[-2%] left-[50%] z-30 w-max pr-6 rounded-xl border border-white/45 bg-white/95 backdrop-blur-md p-2 shadow-xl"
          >
            <div className="flex items-center gap-2 px-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-50 text-orange-600 flex-shrink-0">
                <Icon icon="mdi:timer-sand-complete" className="h-3 w-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-slate-900 leading-tight">Overstay charged</p>
                <p className="text-[8px] text-emerald-600 font-semibold leading-tight">+$45 to next payout</p>
              </div>
            </div>
          </motion.div>

          {/* Overlapping 2: Kitchen tour (Top Left of Kitchen Card) */}
          <motion.div
            {...reveal(0.42, -30, 10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[40%] left-[-2%] z-30 w-max rounded-xl border border-white/45 bg-white/95 p-2 pr-6 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2 px-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                <Icon icon="mdi:video-outline" className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold leading-tight text-slate-900">Kitchen tour</p>
                <p className="text-[8px] font-semibold leading-tight text-teal-700">Tomorrow · 2:30 PM</p>
              </div>
            </div>
          </motion.div>

          {/* Overlapping 3: Storage & equipment (Top Right of Kitchen Card) */}
          <motion.div
            {...reveal(0.45, -20, 20)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[40%] left-[28%] z-30 w-max rounded-xl border border-white/45 bg-white/95 p-2 pr-6 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2 px-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                <Icon icon="mdi:package-variant-closed" className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold leading-tight text-slate-900">Storage spaces</p>
                <p className="text-[8px] font-semibold leading-tight text-slate-500">4 active rentals</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
