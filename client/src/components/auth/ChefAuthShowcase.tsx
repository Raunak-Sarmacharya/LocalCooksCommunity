import { motion, useReducedMotion } from "framer-motion";
import { Icon } from "@iconify/react";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";

const products = [
  ["Smoky Bacon Burger", "45 sold"],
  ["Jerk Chicken Bowl", "31 sold"],
  ["Maple Brisket Melt", "24 sold"],
];

export default function ChefAuthShowcase() {
  const reduceMotion = useReducedMotion();
  const reveal = (delay: number, x = 0, y = 18) => ({
    initial: reduceMotion ? false as const : { opacity: 0, x, y },
    animate: { opacity: 1, x: 0, y: 0 },
    transition: { duration: 0.55, delay: reduceMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <section aria-label="A preview of LocalCooks seller and kitchen booking tools" className="relative hidden min-h-screen overflow-hidden px-7 py-8 lg:flex lg:h-screen lg:min-h-0 lg:w-[58%] xl:px-12">
      <div className="absolute -left-20 top-12 h-64 w-64 rounded-full bg-white/10 blur-sm" />
      <div className="absolute right-[5%] top-[38%] h-80 w-80 rounded-full bg-white/[0.07]" />

      <div className="relative mx-auto flex w-full max-w-[790px] flex-col justify-center">
        <motion.div {...reveal(0.06, -18)}>
          <h2 className="max-w-[660px] text-[clamp(2rem,3.2vw,3.5rem)] font-bold leading-[1.02] tracking-[-0.05em] text-white">
            Everything your business needs, in one place.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 xl:text-base">
            Local food starts with local cooks — like you. Open your own storefront. Cook in a professional kitchen, on your schedule.
          </p>
        </motion.div>

        <div className="relative mt-7 h-[500px] xl:h-[550px] w-full perspective-[1200px]">
          {/* ═════════ CLUSTER 1: STOREFRONT & REVENUE (Top Right) ═════════ */}
          
          {/* Revenue & Top Sellers (Base Card) */}
          <motion.div
            {...reveal(0.14, 20, -10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[5%] top-[2%] z-10 w-[55%] rounded-[1.4rem] border border-white/45 bg-white p-4 shadow-[0_22px_55px_-24px_rgba(41,8,18,0.55)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <Icon icon="mdi:wallet-outline" className="h-3.5 w-3.5 text-[#F51042]" /> Revenue this month
                </div>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">$4,286.40</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                <Icon icon="mdi:trending-up" className="h-3 w-3" /> 18.4%
              </span>
            </div>
            <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
              {products.map(([name, sold], index) => (
                <div key={name} className="flex items-center gap-2 py-2 text-xs">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <Icon icon="mdi:shopping-outline" className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] text-slate-500">#{index + 1} top seller</p>
                    <p className="truncate font-bold text-slate-900">{name}</p>
                  </div>
                  <p className="font-bold text-slate-700">{sold}</p>
                </div>
              ))}
            </div>
          </motion.div>



          {/* Example 1: 5★ Review (Top Left, Overlapping Revenue) */}
          <motion.div
            {...reveal(0.25, -20, -10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[50%] top-[-2%] z-30 w-max pr-6 rounded-[1rem] border border-white/45 bg-white/95 backdrop-blur-md p-2.5 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-500 flex-shrink-0">
                <Icon icon="mdi:star" className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[10px] font-bold text-slate-900">"Best patties!"</p>
                <p className="text-[8px] text-slate-500">From Michael T.</p>
              </div>
            </div>
          </motion.div>

          {/* Orders & Delivery (Overlapping Bottom Left of Revenue) */}
          <motion.div
            {...reveal(0.22, -20, 10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[55%] top-[22%] z-20 w-max min-w-[160px] pr-6 rounded-[1.25rem] border border-white/45 bg-white/95 backdrop-blur-md p-3 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <Icon icon="mdi:truck-outline" className="h-4 w-4" />
              </div>
              <p className="text-xs font-bold text-slate-900">Live Orders</p>
              <span className="ml-auto text-[9px] font-bold text-emerald-600">TRACKING</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[10px]">
              <div className="rounded-lg bg-slate-50 p-2">
                <strong className="block text-base text-slate-950">18</strong>
                <span className="text-slate-500">today</span>
              </div>
              <div className="rounded-lg bg-teal-50 p-2">
                <strong className="block text-base text-teal-800">86%</strong>
                <span className="text-teal-700">delivered</span>
              </div>
            </div>
          </motion.div>

          {/* Smaller Stripe Payouts (Overlapping Bottom Right of Revenue) */}
          <motion.div
            {...reveal(0.28, 20, 20)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute right-[2%] top-[38%] z-30 w-max pr-6 rounded-[1rem] border border-white/45 bg-white/95 backdrop-blur-md p-2 shadow-xl"
          >
            <div className="flex items-center justify-between gap-4 px-1">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-[#635BFF]">
                  <Icon icon="mdi:currency-usd" className="h-3 w-3" />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-slate-900 leading-tight">Payout</p>
                  <p className="text-[8px] text-emerald-600 font-medium leading-tight">Tomorrow</p>
                </div>
              </div>
              <strong className="text-[11px] text-slate-900 pr-1">$812.60</strong>
            </div>
          </motion.div>


          {/* ═════════ CLUSTER 2: KITCHEN BOOKING & TOUR (Bottom Left) ═════════ */}
          
          {/* Kitchen Hub Booking (Base Card) */}
          <motion.div
            {...reveal(0.32, -20, 20)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[2%] left-[5%] z-10 flex w-[55%] flex-col overflow-hidden rounded-[1.4rem] border border-white/45 bg-white p-1.5 shadow-[0_24px_60px_-20px_rgba(41,8,18,0.55)]"
          >
            <div className="relative h-[110px] w-full rounded-t-xl rounded-b-sm overflow-hidden bg-slate-100 group">
              <img src={harbourKitchenImage} alt="Harbour Kitchen Hub" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
              <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-sm rounded-full px-2 py-1 text-[9px] font-bold text-emerald-700 flex items-center gap-1 shadow-sm">
                <Icon icon="mdi:check-circle-outline" className="h-3 w-3" /> Confirmed
              </div>
            </div>
            <div className="p-3.5 bg-white">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#F51042]">Upcoming Booking</p>
              <p className="mt-1 text-sm font-bold text-slate-950">Harbour Kitchen Hub</p>
              <div className="mt-2 space-y-1 text-[10px] text-slate-500">
                <span className="flex items-center gap-1.5"><Icon icon="mdi:calendar-outline" className="h-3 w-3 text-[#F51042]" /> Sep 17 · 10:00–12:00</span>
                <span className="flex items-center gap-1.5"><Icon icon="mdi:map-marker-outline" className="h-3 w-3 text-[#F51042]" /> Station 3 · $24/hour</span>
              </div>
            </div>
          </motion.div>

          {/* Tour & Actions (Overlapping Right edge of Kitchen) */}
          <motion.div
            {...reveal(0.38, 20, 30)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[10%] left-[48%] z-20 w-[40%] rounded-[1.25rem] border border-white/45 bg-white/95 backdrop-blur-md p-3.5 shadow-2xl"
          >
            <p className="mb-2 text-xs font-bold text-slate-900">Kitchen Access</p>
            <div className="flex flex-col gap-2">
              <div className="w-full rounded-lg bg-[#F51042] py-2 text-center text-[11px] font-bold text-white shadow-md flex items-center justify-center gap-1.5 cursor-default pointer-events-none">
                <Icon icon="mdi:play-circle-outline" className="h-3.5 w-3.5" /> Kitchen Tour
              </div>
              <div className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-center text-[11px] font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-default pointer-events-none">
                <Icon icon="mdi:calendar-plus" className="h-3.5 w-3.5" /> Extend Storage Booking
              </div>
            </div>
          </motion.div>

          {/* Example: Priority Support (Floating near bottom right) */}
          <motion.div
            {...reveal(0.4, 30, 20)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[-2%] left-[52%] z-30 w-max pr-6 rounded-xl border border-white/45 bg-white/95 backdrop-blur-md p-2 shadow-xl"
          >
            <div className="flex items-center gap-2 px-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-600 flex-shrink-0">
                <Icon icon="mdi:headset" className="h-3 w-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-slate-900 leading-tight">Chef Support</p>
                <p className="text-[8px] text-blue-600 font-semibold leading-tight">24/7 Priority</p>
              </div>
            </div>
          </motion.div>

          {/* New Example: Storage Unit Active */}
          <motion.div
            {...reveal(0.42, -30, 10)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[35%] left-[2%] z-30 w-max pr-6 rounded-xl border border-white/45 bg-white/95 backdrop-blur-md p-2 shadow-xl"
          >
            <div className="flex items-center gap-2 px-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-50 text-amber-600 flex-shrink-0">
                <Icon icon="mdi:package-variant" className="h-3 w-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-slate-900 leading-tight">Storage D4</p>
                <p className="text-[8px] text-slate-500 font-semibold leading-tight">Active till Friday</p>
              </div>
            </div>
          </motion.div>

          {/* New Example: Included Equipment */}
          <motion.div
            {...reveal(0.45, -20, 20)}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            className="absolute bottom-[34%] left-[28%] z-30 w-max pr-6 rounded-xl border border-white/45 bg-white/95 backdrop-blur-md p-2 shadow-xl"
          >
            <div className="flex items-center gap-2 px-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 flex-shrink-0">
                <Icon icon="mdi:silverware-fork-knife" className="h-3 w-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-slate-900 leading-tight">Equipment</p>
                <p className="text-[8px] text-slate-500 font-semibold leading-tight">Comml. Oven</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
