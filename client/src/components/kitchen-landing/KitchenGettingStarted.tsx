import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { CalendarDays, Check, Clock3, FileCheck2, FileText, ImagePlus, MapPin, Settings2, ShieldCheck } from "lucide-react";
import { SiStripe } from "react-icons/si";
import kitchenImage from "@/assets/harbour-kitchen-hub.jpg";

const steps = [
  { title: "startListingTitle", body: "startListingBody", preview: "startListingPreview" },
  { title: "startPreferencesTitle", body: "startPreferencesBody", preview: "startPreferencesPreview" },
  { title: "startAccessTitle", body: "startAccessBody", preview: "startAccessPreview" },
] as const;

const CYCLE_MS = 8000;
const ease = [0.22, 1, 0.36, 1] as const;
const cardClass = "overflow-hidden rounded-[22px] border border-[#2C2C2C]/[0.08] bg-white shadow-[0_1px_2px_rgba(44,44,44,0.05),0_28px_56px_-28px_rgba(44,44,44,0.3)]";

export default function KitchenGettingStarted() {
  const { t, i18n } = useTranslation("kitchen");
  const id = useId();
  const previewRef = useRef<HTMLDivElement>(null);
  const inView = useInView(previewRef, { amount: 0.2 });
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const playing = inView && !reduceMotion && !hovered && !focused;
  const money = new Intl.NumberFormat(i18n.language || "en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(40);

  const preview = active === 0 ? (
    <div className="space-y-3">
      <div className={cardClass}>
        <div className="relative h-[116px] overflow-hidden sm:h-[144px]">
          <img src={kitchenImage} alt="" width={1400} height={466} loading="lazy" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#17191D]/80 to-transparent" />
          <span className="absolute right-4 top-4 rounded-full border border-white/30 bg-white/95 px-2.5 py-1 text-[10px] font-medium text-[#5F5F5F]">{t("startDraft")}</span>
          <div className="absolute bottom-4 left-5 right-5">
            <p className="text-[15px] font-semibold text-white">{t("startYourCommercialKitchen")}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/85"><MapPin className="h-3 w-3" />{t("startYourLocation")}</p>
          </div>
        </div>
        <div className="space-y-3.5 p-4 sm:space-y-4 sm:p-5">
          <div className="flex items-center gap-3 rounded-xl bg-[#F8F9FA] p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#2C2C2C]/[0.07] bg-white"><ImagePlus className="h-4 w-4 text-[#5F5F5F]" /></span>
            <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-[#1F1F1F]">{t("startPhotosDetails")}</p><p className="mt-0.5 text-[10px] leading-relaxed text-[#7A7A7A]">{t("startShowYourSpace")}</p></div>
            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          </div>
          <div className="flex items-center gap-3 border-t border-[#2C2C2C]/[0.07] pt-4">
            <FileCheck2 className="h-4 w-4 shrink-0 text-[#5F5F5F]" />
            <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-[#1F1F1F]">{t("startKitchenLicence")}</p><p className="mt-0.5 text-[10px] leading-relaxed text-[#7A7A7A]">{t("startLicenceReview")}</p></div>
            <span className="shrink-0 rounded-full bg-[#F3F4F5] px-2 py-1 text-[9px] font-medium text-[#666]">{t("heroHostForReview")}</span>
          </div>
        </div>
      </div>
      <div className={`${cardClass} p-4`}>
        <div className="flex items-center justify-between gap-2"><p className="text-[12px] font-semibold text-[#1F1F1F]">{t("startKitchenTour")}</p><span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-medium text-emerald-700"><Check className="h-2.5 w-2.5" />{t("startTourConfirmed")}</span></div>
        <div className="mt-3 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-[#F51042]/10 bg-[#FFF1F4]"><CalendarDays className="h-4 w-4 text-[#D90E3A]" /><span className="mt-0.5 text-[9px] font-semibold text-[#D90E3A]">{t("heroThursday")}</span></span>
          <div className="min-w-0"><p className="text-[12px] font-medium text-[#1F1F1F]">{t("startTourTime")}</p><p className="mt-0.5 text-[10px] leading-relaxed text-[#7A7A7A]">{t("startTourNote")}</p></div>
        </div>
      </div>
    </div>
  ) : active === 1 ? (
    <div className="space-y-3">
      <div className={cardClass}>
        <div className="flex items-center justify-between gap-3 border-b border-[#2C2C2C]/[0.06] px-5 py-3.5"><p className="text-[12px] font-semibold text-[#1F1F1F]">{t("startAvailabilityRates")}</p><Settings2 className="h-4 w-4 shrink-0 text-[#7A7A7A]" /></div>
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between rounded-xl bg-[#F8F9FA] px-3.5 py-2.5"><p className="text-[11px] text-[#666]">{t("startHourlyRate")}</p><p className="text-[16px] font-semibold tabular-nums tracking-tight text-[#1F1F1F]">{money}<span className="ml-1 text-[9px] font-medium text-[#7A7A7A]">CAD</span></p></div>
          <div className="mt-4 grid grid-cols-[34px_1fr_1fr] items-center gap-x-2 gap-y-2 text-[10px]">
            <span /><span className="text-[#7A7A7A]">{t("heroHostYourHours")}</span><span className="text-[#7A7A7A]">{t("startOpenToBookings")}</span>
            {(["heroMonday", "heroTuesday"] as const).map(day => <div key={day} className="contents"><span className="font-medium text-[#666]">{t(day)}</span><span className="whitespace-nowrap rounded-lg bg-[#F1F2F4] px-1.5 py-2 text-center text-[#666]">{t("heroHostOwnTime")}</span><span className="whitespace-nowrap rounded-lg border border-[#F51042]/10 bg-[#FFF1F4] px-1.5 py-2 text-center font-medium text-[#D90E3A]">{t("heroHostSessionTime")}</span></div>)}
          </div>
          <div className="mt-3 border-t border-[#2C2C2C]/[0.07] pt-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold text-[#666]"><FileCheck2 className="h-3 w-3" />{t("startBookingPolicies")}</p>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {([{ label: "startCancellation", value: "startCancellationNotice" }, { label: "startMinimumBooking", value: "startMinimumDuration" }] as const).map(policy => <div key={policy.label} className="rounded-lg bg-[#F8F9FA] px-2.5 py-2"><p className="text-[9px] leading-relaxed text-[#7A7A7A]">{t(policy.label)}</p><p className="mt-0.5 text-[11px] font-medium leading-relaxed text-[#1F1F1F]">{t(policy.value)}</p></div>)}
            </div>
          </div>
        </div>
      </div>
      <div className={`${cardClass} flex items-center gap-3 px-4 py-4 sm:px-5`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 bg-[#635BFF]/[0.08]"><SiStripe className="h-7 w-7 text-[#635BFF]" /></span>
        <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-[#1F1F1F]">{t("startPayments")}</p><p className="mt-0.5 text-[10px] leading-relaxed text-[#7A7A7A]">{t("startStripeReady")}</p></div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-medium text-emerald-700"><Check className="h-2.5 w-2.5" />{t("startConnected")}</span>
      </div>
    </div>
  ) : (
    <div className="space-y-3">
      <div className={cardClass}>
        <div className="flex items-center justify-between gap-3 border-b border-[#2C2C2C]/[0.06] px-5 py-4"><p className="text-[12px] font-semibold text-[#1F1F1F]">{t("heroHostApplication")}</p><span className="rounded-full bg-[#F3F4F5] px-2 py-1 text-[9px] font-medium text-[#666]">{t("heroHostForReview")}</span></div>
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF1F4] text-[13px] font-semibold text-[#D90E3A]">NB</span><div className="min-w-0"><p className="text-[13px] font-semibold text-[#1F1F1F]">{t("heroHostApplicant")}</p><p className="mt-0.5 text-[10px] text-[#7A7A7A]">{t("heroHostApplicantType")}</p></div></div>
          <div className="mt-4 space-y-2 border-t border-[#2C2C2C]/[0.07] pt-3">
            {(["heroHostBusinessDetails", "heroHostDocuments"] as const).map(key => <p key={key} className="flex items-center gap-2 text-[11px] text-[#666]"><Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />{t(key)}</p>)}
          </div>
          <p className="mt-4 flex items-center gap-2 border-t border-[#2C2C2C]/[0.07] pt-3 text-[10px] font-medium leading-relaxed text-[#1F1F1F]"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#D90E3A]" />{t("heroHostApprovalNote")}</p>
        </div>
      </div>
      <div className={cardClass}>
        <p className="border-b border-[#2C2C2C]/[0.06] px-4 py-2.5 text-[10px] font-medium text-[#7A7A7A] sm:px-5">{t("startAfterBooking")}</p>
        <div className="px-4 sm:px-5">
          <div className="flex items-center gap-3 py-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#2C2C2C]/[0.07] bg-[#F8F9FA]"><FileText className="h-4 w-4 text-[#666]" /></span><div className="min-w-0"><p className="text-[12px] font-semibold text-[#1F1F1F]">{t("startDamageClaims")}</p><p className="mt-0.5 text-[10px] leading-relaxed text-[#7A7A7A]">{t("startClaimEvidence")}</p></div></div>
          <div className="flex items-center gap-3 border-t border-[#2C2C2C]/[0.07] py-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#2C2C2C]/[0.07] bg-[#F8F9FA]"><Clock3 className="h-4 w-4 text-[#666]" /></span><div className="min-w-0"><p className="text-[12px] font-semibold text-[#1F1F1F]">{t("startStorageOverstay")}</p><p className="mt-0.5 text-[10px] leading-relaxed text-[#7A7A7A]">{t("startOverstayReview")}</p></div></div>
        </div>
      </div>
    </div>
  );

  return (
    <section id="how-it-works" aria-labelledby={`${id}-heading`} className="scroll-mt-24 bg-white px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-[1120px]">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold tracking-[0.08em] text-[#D90E3A]">{t("startEyebrow")}</p>
          <h2 id={`${id}-heading`} className="mt-4 text-balance text-[1.9rem] font-bold leading-[1.12] tracking-[-0.025em] text-[#1F1F1F] sm:text-[2.5rem] lg:text-[3rem]"><span className="block">{t("startHeadlineOne")}</span><span className="block text-[#D90E3A]">{t("startHeadlineTwo")}</span></h2>
          <p className="mx-auto mt-5 max-w-[37rem] text-balance text-[1rem] leading-relaxed text-[#5F5F5F] sm:text-[1.1rem]">{t("startIntro")}</p>
        </div>

        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }} className="mt-10 grid min-w-0 items-center gap-8 sm:mt-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
          <div className="order-2 min-w-0 lg:order-1">
            <ol className="space-y-2">
              {steps.map((step, index) => <li key={step.title}>
                <button type="button" onClick={() => setActive(index)} aria-current={index === active ? "step" : undefined} aria-controls={`${id}-preview`} className={`group relative flex min-h-[122px] w-full gap-4 overflow-hidden rounded-[20px] p-4 text-left transition-[background-color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] sm:p-5 ${index === active ? "bg-[#F8F9FA] ring-1 ring-inset ring-[#2C2C2C]/[0.07]" : "hover:bg-[#F8F9FA]/70"}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors duration-300 ${index === active ? "bg-[#F51042] text-white shadow-[0_6px_14px_-6px_rgba(245,16,66,0.55)]" : "bg-[#F1F2F4] text-[#7A7A7A]"}`}>{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1"><span className={`block text-[1.05rem] font-semibold tracking-[-0.01em] transition-colors duration-300 ${index === active ? "text-[#1F1F1F]" : "text-[#666]"}`}>{t(step.title)}</span><span className="mt-2 block text-pretty text-[0.9rem] leading-relaxed text-[#666]">{t(step.body)}</span></span>
                  {index === active && <span aria-hidden="true" className="absolute inset-x-5 bottom-0 h-0.5 overflow-hidden rounded-full bg-[#2C2C2C]/[0.06]"><span className="kitchen-walkthrough-progress block h-full origin-left rounded-full bg-[#F51042]" style={{ animationDuration: `${CYCLE_MS}ms`, animationPlayState: playing ? "running" : "paused", animationName: reduceMotion ? "none" : undefined }} onAnimationEnd={() => { if (playing) setActive(index => (index + 1) % steps.length); }} /></span>}
                </button>
              </li>)}
            </ol>
          </div>

          <div ref={previewRef} id={`${id}-preview`} role="region" aria-label={t(steps[active].preview)} className="relative isolate order-1 flex h-[600px] min-w-0 flex-col overflow-hidden rounded-[28px] border border-[#2C2C2C]/[0.06] bg-[#F6F7F8] p-4 sm:rounded-[32px] sm:p-7 lg:order-2">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: "radial-gradient(rgba(44,44,44,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px", maskImage: "radial-gradient(ellipse 75% 65% at 50% 55%, #000 20%, transparent 90%)" }} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[85%]" style={{ background: "radial-gradient(ellipse at 50% 65%, rgba(245,16,66,0.075), transparent 65%)" }} />
            <div aria-hidden="true" className="flex items-center justify-between gap-3 border-b border-[#2C2C2C]/[0.07] pb-4"><p className="text-[11px] font-medium text-[#666]">{t("startJourney")}</p><span className="rounded-full border border-[#2C2C2C]/[0.07] bg-white/80 px-2.5 py-1 text-[10px] font-medium tabular-nums text-[#7A7A7A]">{String(active + 1).padStart(2, "0")} / 03</span></div>
            <div aria-hidden="true" className="flex min-h-0 flex-1 items-center justify-center py-5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={active} initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -10, scale: reduceMotion ? 1 : 0.98 }} transition={{ duration: reduceMotion ? 0 : 0.4, ease }} className="w-full max-w-[360px]">
                  {preview}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
