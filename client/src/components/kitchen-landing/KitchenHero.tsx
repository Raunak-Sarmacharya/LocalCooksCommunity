import { useId } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, CookingPot, Eye, FileCheck2, LayoutDashboard, LockKeyhole, Package, Settings2, Users, Wallet } from "lucide-react";
import { Icon } from "@iconify/react";
import { navIcons } from "@/assets/mdi-nav-icons";
import { SiStripe } from "react-icons/si";

const kitchenIcon = { ...navIcons.icons["storefront-outline"], width: 24, height: 24 };

interface KitchenHeroProps {
  onStart: () => void;
  onHowItWorks: () => void;
}

export default function KitchenHero({ onStart, onHowItWorks }: KitchenHeroProps) {
  const { t, i18n } = useTranslation("kitchen");
  const chartFill = useId();
  const reduceMotion = useReducedMotion();
  const reveal = (delay: number) => ({
    initial: reduceMotion ? false as const : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay: reduceMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] as const },
  });
  const money = (amount: number) => new Intl.NumberFormat(i18n.language || "en-CA", {
    style: "currency", currency: "CAD", maximumFractionDigits: 0,
  }).format(amount);
  const streams = [
    { key: "heroKitchenTime", amount: 960, color: "bg-[#E64B68]" },
    { key: "heroStorage", amount: 180, color: "bg-[#779AA4]" },
    { key: "heroEquipment", amount: 60, color: "bg-[#9A9AAE]" },
  ] as const;
  const totalRevenue = streams.reduce((total, stream) => total + stream.amount, 0);
  const audiences = ["heroRestaurants", "heroCommunityCentres", "heroPlacesOfWorship", "heroNonprofits", "heroSharedKitchens"] as const;
  const days = ["heroMonday", "heroTuesday", "heroWednesday", "heroThursday", "heroFriday"] as const;
  const navigation = [
    { key: "heroHostOverview", icon: LayoutDashboard },
    { key: "heroHostBookings", icon: CalendarDays },
    { key: "heroHostApplications", icon: Users },
    { key: "heroHostTours", icon: Eye },
    { key: "heroStorage", icon: Package },
    { key: "heroEquipment", icon: CookingPot },
    { key: "heroHostPayouts", icon: Wallet },
  ] as const;
  const activity = [
    { title: "startKitchenTour", detail: "heroHostTourDetail", status: "heroHostConfirmed", icon: Eye, confirmed: true },
    { title: "heroHostExtrasBooking", detail: "heroHostExtrasDetail", status: "heroHostReserved", icon: Package, confirmed: true },
    { title: "startDamageClaims", detail: "heroHostClaimDetail", status: "heroHostUnderReview", icon: FileCheck2, confirmed: false },
  ] as const;

  return (
    <section id="overview" aria-labelledby="kitchen-hero-heading" className="relative isolate overflow-hidden bg-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-[700px]" style={{
          backgroundImage: "linear-gradient(to right, rgba(44,44,44,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(44,44,44,0.045) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 65% 65% at 50% 0%, #000 20%, transparent 85%)",
        }} />
        <div className="absolute left-1/2 top-[-240px] h-[650px] w-[1100px] max-w-[160%] -translate-x-1/2" style={{
          background: "radial-gradient(closest-side, rgba(245,16,66,0.075), transparent)",
        }} />
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-16 pt-[calc(var(--header-total)_+_2.5rem)] sm:px-6 sm:pb-20 sm:pt-[calc(var(--header-total)_+_3rem)] lg:px-8 lg:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <motion.p {...reveal(0)} className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#2C2C2C]/[0.08] bg-white/80 py-1 pl-1 pr-3.5 text-xs font-medium text-[#5F5F5F] sm:text-[0.82rem]">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F51042]/[0.08]">
              <Icon icon={kitchenIcon} className="h-3.5 w-3.5 text-[#F51042]" aria-hidden="true" />
            </span>
            {t("heroHostEyebrow")}
          </motion.p>
          <motion.h1 {...reveal(0.08)} id="kitchen-hero-heading" className="text-balance text-[clamp(2.4rem,9vw,3.4rem)] font-bold leading-[1.06] tracking-[-0.04em] text-[#1F1F1F] sm:text-[3.75rem] lg:text-[4.6rem]">
            <span className="block">{t("heroHostHeadlineOne")}</span>
            <span className="block">{t("heroHostHeadlineTwo")}</span>
          </motion.h1>
          <motion.p {...reveal(0.16)} className="mx-auto mt-5 max-w-[46rem] text-pretty text-base leading-[1.65] text-[#5F5F5F] sm:mt-6 sm:text-lg">
            {t("heroHostBody")}
          </motion.p>
          <motion.div {...reveal(0.24)} className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-5">
            <button type="button" onClick={onStart} className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#F51042] px-7 py-3 text-[0.95rem] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(245,16,66,0.55)] transition-colors hover:bg-[#D90E3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-4 sm:w-auto">
              {t("heroHostStart")}
              <ArrowRight className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={onHowItWorks} className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full px-4 py-3 text-[0.95rem] font-semibold text-[#4A4A4A] transition-colors hover:text-[#F51042] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2">
              {t("heroHostHow")}
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </motion.div>
        </div>

        <motion.ul {...reveal(0.3)} aria-label={t("heroHostAudienceLabel")} className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-[#737373] sm:mt-9 sm:text-[0.8rem]">
          {audiences.map((key) => <li key={key} className="inline-flex items-center gap-2"><span className="h-1 w-1 shrink-0 rounded-full bg-[#F51042]/50" aria-hidden="true" />{t(key)}</li>)}
        </motion.ul>

        <motion.figure {...reveal(0.38)} aria-labelledby="host-preview-caption" className="relative mx-auto mt-9 max-w-[1120px] sm:mt-11">
          <figcaption id="host-preview-caption" className="mb-4 text-center text-xs font-medium text-[#737373] sm:text-[13px]">{t("heroHostPreviewCaption")}</figcaption>
          <div className="rounded-[24px] border border-[#DCDAD7]/80 bg-gradient-to-b from-[#F0EEEB] to-[#FAF9F7] p-1.5 shadow-[0_32px_80px_-40px_rgba(40,30,35,0.3),0_2px_8px_rgba(40,30,35,0.04)] sm:rounded-[28px] sm:p-2">
            <div className="overflow-hidden rounded-[19px] border border-black/[0.07] bg-white sm:rounded-[21px]">
              <div className="flex min-h-14 items-center gap-3 border-b border-black/[0.06] px-4 sm:px-5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#F51042] text-white shadow-sm"><Icon icon={kitchenIcon} className="h-4 w-4" aria-hidden="true" /></span>
                <span className="text-xs font-semibold tracking-tight text-[#343434]">{t("heroHostYourKitchen")}</span>
                <ChevronRight className="hidden h-3 w-3 text-[#BBB] sm:block" aria-hidden="true" />
                <span className="hidden text-xs text-[#737373] sm:block">{t("heroHostOverview")}</span>
                <div aria-hidden="true" className="ml-auto flex items-center gap-4"><Bell className="h-4 w-4 text-[#737373]" /><span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#DFE6DE] bg-[#EDF1EB]"><CookingPot className="h-3.5 w-3.5 text-[#788473]" /></span></div>
              </div>
              <div className="flex">
                <div aria-hidden="true" className="hidden w-14 shrink-0 flex-col border-r border-black/[0.05] bg-[#FCFCFB] px-2 py-5 sm:flex lg:w-44 lg:px-3">
                  <p className="mb-3 hidden px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#A1A1A1] lg:block">LocalCooks</p>
                  <div className="space-y-1.5">
                    {navigation.map(({key, icon: NavIcon}, index) => <div key={key} className={`flex min-h-9 items-center justify-center gap-2.5 rounded-lg px-2 lg:justify-start ${index === 0 ? "bg-[#F51042]/[0.07] font-semibold text-[#BD173A]" : "text-[#8A8A8A]"}`}><NavIcon className="h-3.5 w-3.5 shrink-0" /><span className="hidden text-[11px] lg:block">{t(key)}</span>{index === 2 && <span className="ml-auto hidden rounded bg-[#EFEEEC] px-1.5 py-0.5 text-[9px] text-[#737373] lg:block">1</span>}</div>)}
                  </div>
                  <div className="mt-auto flex items-center justify-center gap-2.5 px-2 pt-8 text-[#737373] lg:justify-start"><Settings2 className="h-3.5 w-3.5 shrink-0" /><span className="hidden text-[11px] lg:block">{t("heroHostSettings")}</span></div>
                </div>
                <div className="min-w-0 flex-1 bg-[#F8F9FA] p-3 sm:p-5 lg:p-6">
                  <div className="mb-4 flex items-start justify-between gap-3 sm:mb-5">
                    <div><p className="text-lg font-semibold tracking-[-0.025em] text-[#272727]">{t("heroHostOverview")}</p><p className="mt-1 text-[11px] leading-relaxed text-[#737373]">{t("heroHostOverviewNote")}</p></div>
                    <span className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-black/[0.07] bg-white px-2.5 py-2 text-[10px] font-medium text-[#737373]"><CalendarDays className="hidden h-3 w-3 sm:block" aria-hidden="true" />{t("heroHostThisWeek")}<ChevronDown className="h-3 w-3 text-[#AAA]" aria-hidden="true" /></span>
                  </div>
                  <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-4">
                    <div className="min-w-0 rounded-xl border border-black/[0.06] bg-white p-4 shadow-[0_2px_4px_-3px_rgba(0,0,0,0.08)] sm:p-5">
                      <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-[#737373]">{t("heroHostRevenue")}</p><span className="text-[9px] font-medium tracking-wide text-[#737373]">CAD</span></div>
                      <p className="mt-2 text-[2.2rem] font-semibold leading-none tracking-[-0.045em] text-[#232323] tabular-nums sm:text-[2.5rem]">{money(totalRevenue)}</p>
                      <div aria-hidden="true" className="relative mt-4 h-[94px] sm:h-[102px]">
                        <svg viewBox="0 0 420 104" preserveAspectRatio="none" className="h-full w-full overflow-visible">
                          <defs><linearGradient id={chartFill} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F51042" stopOpacity="0.13" /><stop offset="100%" stopColor="#F51042" stopOpacity="0" /></linearGradient></defs>
                          {[12, 52, 92].map(y => <line key={y} x1="0" y1={y} x2="420" y2={y} stroke="#F0F0F1" strokeDasharray="3 4" />)}
                          <path d="M0 92 C24 92 40 81 70 81 S110 81 140 63 S180 54 210 43 S250 34 280 27 S320 21 350 13 S394 4 420 3 L420 104 L0 104 Z" fill={`url(#${chartFill})`} />
                          <path d="M0 92 C24 92 40 81 70 81 S110 81 140 63 S180 54 210 43 S250 34 280 27 S320 21 350 13 S394 4 420 3" fill="none" stroke="#E73B5D" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                          <circle cx="420" cy="3" r="4" fill="#E73B5D" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        </svg>
                      </div>
                      <div aria-hidden="true" className="mt-2 flex justify-between text-[9px] text-[#AAA]">{days.map(day => <span key={day}>{t(day)}</span>)}</div>
                      <div className="mt-4 border-t border-black/[0.05] pt-3.5">
                        <div aria-hidden="true" className="flex h-1.5 gap-1 overflow-hidden rounded-full">{streams.map(({ key, amount, color }) => <span key={key} className={`h-full rounded-full ${color}`} style={{ flex: amount }} />)}</div>
                        <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                          {streams.map(({ key, amount, color }) => <div key={key} className="flex min-w-0 items-center justify-between gap-2 sm:block">
                            <dt className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[#737373] [overflow-wrap:anywhere]"><span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />{t(key)}</dt>
                            <dd className="shrink-0 text-[13px] font-semibold text-[#343434] tabular-nums sm:mt-1 sm:pl-3">{money(amount)}</dd>
                          </div>)}
                        </dl>
                      </div>
                    </div>
                    <div className="min-w-0 overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-[0_2px_4px_-3px_rgba(0,0,0,0.08)]">
                      <div className="flex items-center justify-between gap-2 px-4 py-3.5"><p className="text-xs font-semibold text-[#444]">{t("heroHostCalendar")}</p><span aria-hidden="true" className="flex gap-2 text-[#AAA]"><ChevronLeft className="h-3 w-3" /><ChevronRight className="h-3 w-3" /></span></div>
                      <div className="grid grid-cols-3 border-y border-black/[0.05] sm:grid-cols-5">
                        {days.map((day, index) => <div key={day} className={`${index > 2 ? "hidden sm:block" : ""} ${index > 0 ? "border-l border-black/[0.05]" : ""} min-w-0 break-words px-1.5 pb-3 sm:px-2`}>
                          <div className="mb-3 border-b border-black/[0.04] py-2.5 text-center text-[10px] font-medium text-[#737373]">{t(day)}</div>
                          <div className="flex min-h-[50px] flex-col justify-center rounded-md border-l-2 border-[#B9BCBF] bg-[#F0F1F2] px-1.5 py-2 text-[9px] leading-[1.5] text-[#676C71]"><span className="font-medium">{t("heroHostYourHours")}</span><span className="mt-1 text-[8px]">{t("heroHostOwnTime")}</span></div>
                          <div className={`mt-2 flex min-h-[66px] flex-col justify-center rounded-md px-1.5 py-2 text-[9px] leading-[1.5] ${index === 1 || index === 4 ? "border border-dashed border-[#DEDFE1] bg-[#FCFCFC] text-[#737373]" : index === 2 ? "border-l-2 border-[#87A1AA] bg-[#EDF3F4] text-[#466873]" : "border-l-2 border-[#E7768D] bg-[#FCEDF0] text-[#AF4560]"}`}>
                            {index === 1 || index === 4 ? <span>{t("heroHostAvailable")}</span> : <><span className="font-semibold">{t(index === 2 ? "heroHostCatering" : "heroHostBaking")}</span><span className="mt-1 text-[8px]">{t("heroHostSessionTime")}</span></>}
                          </div>
                        </div>)}
                      </div>
                      <p className="flex items-center gap-1.5 px-4 py-3 text-[10px] text-[#737373]"><LockKeyhole className="h-3 w-3 shrink-0" aria-hidden="true" />{t("heroHostHoursNote")}</p>
                    </div>
                    <div className="flex min-w-0 flex-col rounded-xl border border-black/[0.06] bg-white shadow-[0_2px_4px_-3px_rgba(0,0,0,0.08)] md:col-start-2 md:row-span-2 md:row-start-1">
                      <div className="flex items-center justify-between gap-3 border-b border-black/[0.05] px-4 py-4 sm:px-5">
                        <div><p className="text-xs font-semibold text-[#343434]">{t("heroHostActivityCentre")}</p><p className="mt-1 text-[10px] leading-relaxed text-[#737373]">{t("heroHostActivityNote")}</p></div>
                        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/[0.05] bg-[#FAFAFB]"><Bell className="h-3.5 w-3.5 text-[#737373]" /></span>
                      </div>
                      <div className="mx-3 mt-3 rounded-[10px] border border-[#F51042]/[0.09] bg-gradient-to-b from-[#FFF8FA] to-white p-3.5 sm:mx-4 sm:mt-4 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold text-[#444]">{t("heroHostApplication")}</p><span className="inline-flex items-center gap-1.5 rounded-full bg-[#F51042]/[0.06] px-2 py-1 text-[9px] font-medium text-[#BD173A]"><span className="h-1 w-1 rounded-full bg-[#E64B68]" aria-hidden="true" />{t("heroHostForReview")}</span></div>
                        <div className="mt-3.5 flex items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#F51042]/[0.08] bg-white text-[#B9546A]"><CookingPot className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0"><p className="text-[11px] font-semibold leading-relaxed text-[#333]">{t("heroHostApplicant")}</p><p className="mt-0.5 text-[10px] text-[#737373]">{t("heroHostApplicantType")}</p></div></div>
                        <ul className="my-3.5 space-y-2 text-[10px] text-[#737373]">
                          {(["heroHostBusinessDetails", "heroHostDocuments"] as const).map(key => <li key={key} className="flex items-center gap-2"><span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#EDF3EF]"><Check className="h-2.5 w-2.5 text-[#679377]" aria-hidden="true" /></span>{t(key)}</li>)}
                        </ul>
                        <div className="flex items-center justify-between gap-3 border-t border-[#F51042]/[0.07] pt-3"><p className="min-w-0 flex-1 text-[10px] leading-relaxed text-[#737373]">{t("heroHostApprovalNote")}</p><span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#F51042]/[0.1] bg-[#F51042]/[0.05] px-2.5 py-2 text-[10px] font-medium text-[#BD173A]">{t("heroHostReview")}<ArrowRight className="h-3 w-3" aria-hidden="true" /></span></div>
                      </div>
                      <ul className="flex flex-1 flex-col divide-y divide-black/[0.05] px-4 py-2 sm:px-5 sm:py-3">
                        {activity.map(({ title, detail, status, icon: ActivityIcon, confirmed }) => <li key={title} className="flex flex-1 items-center gap-3 py-3.5">
                          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-black/[0.04] bg-[#F8F9FA]"><ActivityIcon className="h-3.5 w-3.5 text-[#7A858C]" /></span>
                          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><p className="text-[11px] font-medium leading-relaxed text-[#444]">{t(title)}</p><span className={`inline-flex items-center gap-1 text-[9px] font-medium ${confirmed ? "text-[#508167]" : "text-[#777787]"}`}>{confirmed && <Check className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}{t(status)}</span></div><p className="mt-1 text-[10px] leading-relaxed text-[#737373]">{t(detail)}</p></div>
                        </li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.figure>

        <ul className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs text-[#6B6B6B] sm:mt-8 sm:text-[0.85rem]">
          <li className="inline-flex items-center gap-2"><SiStripe className="h-5 w-5 shrink-0 text-stripe" aria-hidden="true" />{t("heroHostStripe")}</li>
          <li className="inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4 shrink-0 text-[#737373]" aria-hidden="true" />{t("heroHostAccess")}</li>
          <li className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 shrink-0 text-[#737373]" aria-hidden="true" />{t("heroHostSchedule")}</li>
        </ul>
      </div>
    </section>
  );
}
