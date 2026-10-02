import { useId } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CalendarDays, Check, FileCheck2, LockKeyhole, SlidersHorizontal, Users } from "lucide-react";
import { Icon } from "@iconify/react";
import { resolveEquipmentIcon, resolveStorageIcon } from "@/lib/kitchen-inventory-icons";

const cardClass = "min-w-0 overflow-hidden rounded-[24px] border border-[#2C2C2C]/[0.08] bg-white shadow-[0_1px_2px_rgba(44,44,44,0.03),0_16px_36px_-24px_rgba(44,44,44,0.18)]";
const controls = [
  { icon: CalendarDays, title: "earnHoursTitle", body: "earnHoursBody" },
  { icon: SlidersHorizontal, title: "earnRatesTitle", body: "earnRatesBody" },
  { icon: Users, title: "earnAccessTitle", body: "earnAccessBody" },
  { icon: FileCheck2, title: "earnPoliciesTitle", body: "earnPoliciesBody" },
] as const;

export default function KitchenEarningControl({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation("kitchen");
  const id = useId();
  const reduceMotion = useReducedMotion();

  return (
    <section id="revenue-streams" aria-labelledby={`${id}-heading`} className="scroll-mt-24 bg-[#F8F9FA] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-[1120px]">
        <div className="mx-auto max-w-[45rem] text-center">
          <p className="text-xs font-semibold tracking-[0.08em] text-[#D90E3A]">{t("earnEyebrow")}</p>
          <h2 id={`${id}-heading`} className="mt-4 text-balance text-[1.9rem] font-bold leading-[1.12] tracking-[-0.025em] text-[#1F1F1F] sm:text-[2.5rem] lg:text-[3rem]"><span className="block">{t("earnHeadlineOne")}</span><span className="block text-[#D90E3A]">{t("earnHeadlineTwo")}</span></h2>
          <p className="mx-auto mt-5 max-w-[39rem] text-balance text-[1rem] leading-relaxed text-[#5F5F5F] sm:text-[1.1rem]">{t("earnIntro")}</p>
        </div>

        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 20 }} whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="mt-10 grid gap-4 sm:mt-12 sm:gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <article className={`${cardClass} flex flex-col p-5 sm:p-7 lg:p-8`}>
            <p className="text-xs font-medium text-[#737373]">{t("earnKitchenLabel")}</p>
            <h3 className="mt-3 max-w-[24rem] text-balance text-[1.6rem] font-bold leading-[1.2] tracking-[-0.025em] text-[#1F1F1F] sm:text-[1.85rem]">{t("earnKitchenTitle")}</h3>
            <p className="mt-3 max-w-[27rem] text-pretty text-sm leading-[1.75] text-[#5F5F5F]">{t("earnKitchenBody")}</p>

            <div aria-hidden="true" className="mt-7 flex flex-1 flex-col justify-center rounded-[18px] border border-[#2C2C2C]/[0.06] bg-[#F6F7F8] p-2.5 sm:p-5">
              <div className="overflow-hidden rounded-[14px] border border-[#2C2C2C]/[0.07] bg-white shadow-[0_12px_26px_-18px_rgba(44,44,44,0.25)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2C2C2C]/[0.06] px-3.5 py-4 sm:px-5"><p className="text-[12px] font-semibold text-[#1F1F1F]">{t("earnAvailability")}</p><span className="rounded-full bg-[#F3F4F5] px-2 py-1 text-[9px] font-medium text-[#666]">{t("earnHourlyDaily")}</span></div>
                <div className="space-y-2.5 p-2.5 sm:p-5">
                  {(["heroMonday", "heroTuesday", "heroWednesday"] as const).map((day, index) => <div key={day} className={`${index === 2 ? "hidden sm:grid" : "grid"} grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)] sm:gap-2.5`}>
                    <span className="text-[10px] font-medium text-[#737373]">{t(day)}</span>
                    <div className="flex min-h-[60px] min-w-0 flex-col justify-center rounded-lg border-l-2 border-[#B9BCBF] bg-[#F1F2F4] px-1.5 py-2 text-[9px] leading-relaxed text-[#666] sm:px-3 sm:text-[10px]"><span className="font-medium">{t("heroHostYourHours")}</span><span className="mt-0.5">{t("heroHostOwnTime")}</span></div>
                    <div className="flex min-h-[60px] min-w-0 flex-col justify-center rounded-lg border-l-2 border-[#F51042]/60 bg-[#FFF1F4] px-1.5 py-2 text-[9px] leading-relaxed text-[#D90E3A] sm:px-3 sm:text-[10px]"><span className="font-medium">{t("startOpenToBookings")}</span><span className="mt-0.5">{t("heroHostSessionTime")}</span></div>
                  </div>)}
                </div>
                <p className="flex items-center gap-1.5 border-t border-[#2C2C2C]/[0.06] px-3.5 py-3 text-[10px] leading-relaxed text-[#666] sm:px-5"><LockKeyhole className="h-3 w-3 shrink-0" />{t("heroHostHoursNote")}</p>
              </div>
            </div>
          </article>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-1">
            <article className={`${cardClass} p-5 sm:p-6 lg:px-7`}>
              <p className="text-xs font-medium text-[#737373]">{t("earnStorageLabel")}</p>
              <h3 className="mt-2.5 text-balance text-[1.35rem] font-bold leading-[1.25] tracking-[-0.02em] text-[#1F1F1F]">{t("earnStorageTitle")}</h3>
              <p className="mt-2.5 text-pretty text-[13px] leading-[1.75] text-[#5F5F5F]">{t("earnStorageBody")}</p>
              <div aria-hidden="true" className="mt-5 grid grid-cols-3 gap-2 rounded-[14px] border border-[#2C2C2C]/[0.06] bg-[#F8F9FA] p-2.5">
                {([{ type: "dry", label: "earnDryStorage" }, { type: "cold", label: "earnColdStorage" }, { type: "freezer", label: "earnFreezerStorage" }] as const).map(storage => <div key={storage.type} className="flex min-w-0 flex-col items-center justify-center rounded-[10px] border border-[#2C2C2C]/[0.07] bg-white px-1.5 py-3 text-center shadow-[0_1px_2px_rgba(44,44,44,0.03)]"><Icon icon={resolveStorageIcon(storage.type)} className="h-5 w-5 text-[#666]" /><p className="mt-2 text-[10px] font-medium leading-relaxed text-[#666]">{t(storage.label)}</p></div>)}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[10px] font-medium text-[#737373]"><Check className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />{t("earnStorageControl")}</p>
            </article>

            <article className={`${cardClass} p-5 sm:p-6 lg:px-7`}>
              <p className="text-xs font-medium text-[#737373]">{t("earnEquipmentLabel")}</p>
              <h3 className="mt-2.5 text-balance text-[1.35rem] font-bold leading-[1.25] tracking-[-0.02em] text-[#1F1F1F]">{t("earnEquipmentTitle")}</h3>
              <p className="mt-2.5 text-pretty text-[13px] leading-[1.75] text-[#5F5F5F]">{t("earnEquipmentBody")}</p>
              <div aria-hidden="true" className="mt-5 divide-y divide-[#2C2C2C]/[0.06] rounded-[14px] border border-[#2C2C2C]/[0.06] bg-[#F8F9FA] px-3">
                {([{ type: "prep table", label: "earnPrepTable", status: "earnIncluded", paid: false }, { type: "mixer", label: "earnMixer", status: "earnPaidAddon", paid: true }] as const).map(equipment => <div key={equipment.type} className="flex items-center gap-2 py-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2C2C2C]/[0.07] bg-white"><Icon icon={resolveEquipmentIcon(equipment.type)} className="h-4 w-4 text-[#666]" /></span><p className="min-w-0 flex-1 text-[11px] font-medium leading-relaxed text-[#444]">{t(equipment.label)}</p><span className={`max-w-[45%] rounded-full px-2 py-1 text-center text-[9px] font-medium leading-relaxed ${equipment.paid ? "border border-[#F51042]/10 bg-[#FFF1F4] text-[#D90E3A]" : "bg-white text-[#737373]"}`}>{t(equipment.status)}</span></div>)}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[10px] font-medium text-[#737373]"><Check className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />{t("earnEquipmentControl")}</p>
            </article>
          </div>
        </motion.div>

        <div id="everything-included" aria-labelledby={`${id}-control`} className="mt-5 scroll-mt-24 rounded-[24px] border border-[#2C2C2C]/[0.08] bg-white p-5 shadow-[0_1px_2px_rgba(44,44,44,0.03),0_16px_36px_-24px_rgba(44,44,44,0.12)] sm:p-7 lg:p-8">
          <div className="flex flex-col gap-3 border-b border-[#2C2C2C]/[0.07] pb-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <h3 id={`${id}-control`} className="text-[1.35rem] font-bold tracking-[-0.02em] text-[#1F1F1F]">{t("earnControlTitle")}</h3>
            <p className="max-w-[23rem] text-pretty text-sm leading-relaxed text-[#5F5F5F]">{t("earnControlIntro")}</p>
          </div>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-7">
            {controls.map(({ icon: ControlIcon, title, body }) => <li key={title} className="min-w-0"><ControlIcon className="h-5 w-5 text-[#D90E3A]" strokeWidth={1.6} aria-hidden="true" /><h4 className="mt-3 text-sm font-semibold text-[#1F1F1F]">{t(title)}</h4><p className="mt-2 text-pretty text-[13px] leading-[1.75] text-[#666]">{t(body)}</p></li>)}
          </ul>
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-4 text-center sm:mt-9 sm:flex-row sm:gap-6 sm:text-left">
          <p className="text-sm font-medium text-[#5F5F5F]">{t("earnStartNote")}</p>
          <button type="button" onClick={onStart} className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#F51042] px-6 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_22px_-12px_rgba(245,16,66,0.5)] transition-colors hover:bg-[#D90E3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-4 sm:w-auto">{t("heroHostStart")}<ArrowRight className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  );
}
