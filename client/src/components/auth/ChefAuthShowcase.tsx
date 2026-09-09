import { motion } from "framer-motion";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  PackageCheck,
  ShoppingBag,
  TrendingUp,
  Truck,
  WalletCards,
} from "lucide-react";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";

const reveal = {
  hidden: { opacity: 0, y: 18 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.52, delay, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function ChefAuthShowcase() {
  return (
    <section
      aria-label="A preview of LocalCooks chef tools"
      className="relative hidden min-h-screen overflow-hidden border-r border-[#D90E3A]/30 bg-gradient-to-br from-primary to-primary/80 p-7 lg:flex lg:h-screen lg:min-h-0 lg:w-[54%] xl:p-10"
    >
      <div className="absolute -left-16 top-16 h-56 w-56 rounded-full bg-white/10" />
      <div className="absolute -right-20 top-[34%] h-72 w-72 rounded-full bg-white/[0.08]" />
      <div className="absolute bottom-10 left-[38%] h-36 w-36 rounded-full bg-white/[0.07]" />

      <div className="relative mx-auto flex w-full max-w-[760px] flex-col">
        <motion.div custom={0.08} initial="hidden" animate="visible" variants={reveal} className="flex items-start justify-between gap-6">
          <div>
            <div className="mb-3 inline-flex items-center rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur">
              Built for independent food businesses
            </div>
            <h2 className="max-w-lg text-[clamp(2rem,3.2vw,3.4rem)] font-bold leading-[1.02] tracking-[-0.045em] text-white">
              Your kitchen business,
              <span className="block text-white">all in one place.</span>
            </h2>
          </div>
        </motion.div>

        <motion.div
          custom={0.18}
          initial="hidden"
          animate="visible"
          variants={reveal}
          className="relative mt-8 min-h-[590px] flex-1 xl:mt-10"
        >
          <div className="absolute left-[2%] top-[3%] w-[64%] rounded-[1.65rem] border border-slate-200/90 bg-white p-5 shadow-[0_22px_60px_-32px_rgba(15,23,42,0.34)] xl:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <WalletCards className="h-4 w-4 text-[#F51042]" /> Revenue this month
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">$4,286.40</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                <TrendingUp className="h-3.5 w-3.5" /> 18.4%
              </span>
            </div>
            <div className="mt-5 flex h-16 items-end gap-2" aria-hidden="true">
              {[38, 54, 45, 68, 58, 82, 73, 94].map((height, index) => (
                <div key={height} className="flex-1 rounded-t-md bg-[#F51042]/10">
                  <div className="ml-auto h-full rounded-t-md bg-[#F51042]" style={{ height: `${height}%`, opacity: 0.58 + index * 0.05 }} />
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><ShoppingBag className="h-5 w-5" /></div>
                <div><p className="text-xs text-slate-500">Top selling item</p><p className="text-sm font-bold text-slate-900">Smoky Bacon Burger</p></div>
              </div>
              <p className="text-sm font-bold text-slate-900">45 sold</p>
            </div>
          </div>

          <div className="absolute right-[1%] top-[10%] w-[34%] rounded-[1.45rem] border border-slate-200/90 bg-white p-4 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.35)]">
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Truck className="h-4.5 w-4.5" /></div>
              <span className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500">LIVE</span>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Fulfillment</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-[86%] rounded-full bg-teal-500" /></div>
            <div className="mt-2 flex justify-between text-[11px] font-medium text-slate-500"><span>14% pickup</span><span>86% delivery</span></div>
          </div>

          <div className="absolute bottom-[10%] left-[8%] w-[54%] rounded-[1.65rem] border border-slate-200/90 bg-white p-3 shadow-[0_24px_64px_-30px_rgba(15,23,42,0.38)] xl:p-4">
            <div className="relative h-28 overflow-hidden rounded-[1.15rem] bg-[#FDE7E3]">
              <img
                src={harbourKitchenImage}
                alt="A bright shared commercial kitchen with professional equipment"
                className="h-full w-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/5 via-transparent to-black/10" />
              <div className="absolute right-5 top-5 rounded-full border border-white/80 bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 backdrop-blur">$24/hour</div>
            </div>
            <div className="px-1 pb-1 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#F51042]">Next kitchen booking</p>
              <p className="mt-1 text-base font-bold text-slate-950">Harbour Kitchen Hub</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-[#F51042]" /> Sep 17</span>
                <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-[#F51042]" /> 10:00–12:00</span>
                <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[#F51042]" /> St. John’s</span>
              </div>
            </div>
          </div>

          <div className="absolute bottom-[4%] right-[2%] w-[38%] rounded-[1.45rem] border border-slate-200/90 bg-white p-4 shadow-[0_20px_50px_-26px_rgba(15,23,42,0.34)] xl:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><PackageCheck className="h-5 w-5" /></div>
              <div><p className="text-sm font-bold text-slate-900">Seller account</p><p className="text-xs text-emerald-700">Ready to sell</p></div>
            </div>
            <div className="my-4 h-px bg-slate-100" />
            <div className="space-y-2.5 text-xs font-medium text-slate-600">
              {['Menu published', 'Payouts connected', 'Profile verified'].map((item) => (
                <div key={item} className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-3 w-3" /></span>{item}</div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-800">
              Open storefront <ArrowUpRight className="h-3.5 w-3.5 text-[#F51042]" />
            </div>
          </div>
        </motion.div>

        <motion.p custom={0.34} initial="hidden" animate="visible" variants={reveal} className="mt-3 text-xs leading-relaxed text-white/75">
          Preview data shown for illustration. Your real dashboard updates as your business grows.
        </motion.p>
      </div>
    </section>
  );
}
