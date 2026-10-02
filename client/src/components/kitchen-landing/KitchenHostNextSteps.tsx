import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Check, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const kitchenHostFaqs = [
  { question: "kFaqQ1", answer: "kFaqA1" },
  { question: "kFaqQ2", answer: "kFaqA2" },
  { question: "kFaqQ3", answer: "kFaqA3" },
  { question: "kFaqQ4", answer: "kFaqA4" },
  { question: "kFaqQ5", answer: "kFaqA5" },
  { question: "kFaqQ6", answer: "kFaqA6" },
  { question: "kFaqQ7", answer: "kFaqA7" },
  { question: "kFaqQ8", answer: "kFaqA8" },
  { question: "kFaqQ9", answer: "kFaqA9" },
  { question: "kFaqQ10", answer: "kFaqA10" },
] as const;

const chapters = [
  { title: "hostGuideLegalTitle", body: "hostGuideLegalBody" },
  { title: "hostGuideInsuranceTitle", body: "hostGuideInsuranceBody" },
  { title: "hostGuideOperationsTitle", body: "hostGuideOperationsBody" },
  { title: "hostGuidePricingTitle", body: "hostGuidePricingBody" },
] as const;
const headingClass = "text-balance text-[1.9rem] font-bold leading-[1.12] tracking-[-0.025em] text-[#1F1F1F] sm:text-[2.5rem] lg:text-[3rem]";
const eyebrowClass = "text-xs font-semibold tracking-[0.08em] text-[#D90E3A]";
const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-4";

export default function KitchenHostNextSteps({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation("kitchen");
  const id = useId();

  return <>
    <section id="resources" aria-labelledby={`${id}-resources`} className="scroll-mt-24 bg-white px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto grid max-w-[1120px] items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className={eyebrowClass}>{t("hostGuideEyebrow")}</p>
          <h2 id={`${id}-resources`} className={`mt-4 max-w-[27rem] ${headingClass}`}><span className="block">{t("hostGuideHeadlineOne")}</span><span className="block text-[#D90E3A]">{t("hostGuideHeadlineTwo")}</span></h2>
          <p className="mt-5 max-w-[27rem] text-pretty text-base leading-relaxed text-[#5F5F5F] sm:text-[1.1rem]">{t("hostGuideIntro")}</p>
          <Link href="/resources" className={`group mt-7 inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full border border-[#2C2C2C]/15 bg-white px-6 py-3 text-sm font-semibold text-[#1F1F1F] transition-colors hover:border-[#F51042]/40 hover:bg-[#FFF5F7] hover:text-[#D90E3A] ${focusClass}`}>
            {t("hostGuideCta")}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="relative isolate min-w-0 rounded-[28px] border border-[#2C2C2C]/[0.06] bg-[#F6F7F8] p-4 sm:p-7 lg:p-8">
          <div aria-hidden="true" className="absolute inset-x-8 bottom-3 top-12 -z-10 rounded-[18px] border border-[#2C2C2C]/[0.08] bg-white sm:bottom-5" />
          <div className="relative overflow-hidden rounded-[18px] border border-[#2C2C2C]/[0.08] bg-white shadow-[0_2px_4px_rgba(44,44,44,0.03),0_20px_40px_-24px_rgba(44,44,44,0.24)]">
            <div className="relative border-b border-[#2C2C2C]/[0.07] px-5 pb-5 pt-6 sm:px-7 sm:pt-7">
              <div aria-hidden="true" className="absolute right-6 top-0 h-9 w-5 bg-[#F51042] [clip-path:polygon(0_0,100%_0,100%_100%,50%_80%,0_100%)]" />
              <p className="pr-7 text-[11px] font-semibold tracking-[0.08em] text-[#737373]">LocalCooks</p>
              <h3 className="mt-2.5 text-[1.3rem] font-bold leading-tight tracking-[-0.02em] text-[#1F1F1F] sm:text-[1.5rem]">{t("hostGuideTitle")}</h3>
              <p className="mt-2 text-xs leading-relaxed text-[#737373]">{t("hostGuideSubtitle")}</p>
            </div>
            <ol className="divide-y divide-[#2C2C2C]/[0.06] px-5 sm:px-7">
              {chapters.map((chapter, index) => <li key={chapter.title} className="flex gap-4 py-4 sm:py-5">
                <span aria-hidden="true" className="pt-0.5 text-[11px] font-medium tabular-nums text-[#A1A1A1]">0{index + 1}</span>
                <div className="min-w-0"><h4 className="text-sm font-semibold text-[#333]">{t(chapter.title)}</h4><p className="mt-1 text-xs leading-relaxed text-[#737373]">{t(chapter.body)}</p></div>
              </li>)}
            </ol>
            <Link href="/resources" className={`group flex min-h-12 items-center justify-between gap-3 border-t border-[#2C2C2C]/[0.06] bg-[#FAFAFA] px-5 py-3.5 text-xs font-medium text-[#5F5F5F] transition-colors hover:bg-[#FFF5F7] hover:text-[#D90E3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F51042] sm:px-7`}>
              <span className="flex items-center gap-2"><BookOpen aria-hidden="true" className="h-4 w-4 shrink-0" />{t("hostGuideBrowse")}</span><ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    </section>

    <section id="host-support" aria-labelledby={`${id}-support`} className="scroll-mt-24 bg-[#F8F9FA] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-[1120px]">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <p className={eyebrowClass}>{t("hostSupportEyebrow")}</p>
            <h2 id={`${id}-support`} className={`mt-4 ${headingClass}`}><span className="block">{t("hostSupportHeadlineOne")}</span><span className="block text-[#D90E3A]">{t("hostSupportHeadlineTwo")}</span></h2>
            <p className="mt-5 max-w-[28rem] text-pretty text-base leading-relaxed text-[#5F5F5F] sm:text-[1.1rem]">{t("hostSupportIntro")}</p>
          </div>
          <div className="overflow-hidden rounded-[24px] border border-[#2C2C2C]/[0.08] bg-white p-5 shadow-[0_1px_2px_rgba(44,44,44,0.03),0_16px_36px_-24px_rgba(44,44,44,0.18)] sm:p-7">
            <p className="text-xs font-medium text-[#737373]">{t("hostSupportApproach")}</p>
            {([{ title: "hostSupportSharedTitle", body: "hostSupportSharedBody" }, { title: "hostSupportSpecificTitle", body: "hostSupportSpecificBody" }] as const).map((item, index) => <div key={item.title} className={`flex gap-3.5 ${index === 0 ? "mt-5" : "mt-5 border-t border-[#2C2C2C]/[0.07] pt-5"}`}>
              <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#F51042]/70" />
              <div><h3 className="text-base font-semibold tracking-[-0.01em] text-[#1F1F1F]">{t(item.title)}</h3><p className="mt-2 text-sm leading-relaxed text-[#5F5F5F]">{t(item.body)}</p></div>
            </div>)}
            <p className="mt-6 rounded-xl bg-[#F8F9FA] px-4 py-3 text-xs leading-relaxed text-[#737373]">{t("hostSupportReviewNote")}</p>
          </div>
        </div>
        <div className="mt-8 flex flex-col items-start justify-between gap-5 border-t border-[#2C2C2C]/[0.08] pt-6 sm:flex-row sm:items-center lg:mt-10">
          <p className="max-w-[38rem] text-sm leading-relaxed text-[#5F5F5F]">{t("hostSupportNextStep")}</p>
          <button type="button" onClick={onStart} className={`group inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full border border-[#2C2C2C]/15 bg-white px-6 py-3 text-sm font-semibold text-[#1F1F1F] transition-colors hover:border-[#F51042]/40 hover:text-[#D90E3A] sm:w-auto ${focusClass}`}>{t("hostSupportCta")}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5" /></button>
        </div>
      </div>
    </section>

    <section id="faq" aria-labelledby={`${id}-faq`} className="scroll-mt-24 bg-white px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto grid max-w-[1120px] items-start gap-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
        <div>
          <p className={eyebrowClass}>{t("hostFaqEyebrow")}</p>
          <h2 id={`${id}-faq`} className={`mt-4 max-w-[23rem] ${headingClass}`}><span className="block">{t("hostFaqHeadlineOne")}</span><span className="block text-[#D90E3A]">{t("hostFaqHeadlineTwo")}</span></h2>
          <p className="mt-5 max-w-[22rem] text-pretty text-base leading-relaxed text-[#5F5F5F]">{t("hostFaqIntro")}</p>
          <p className="mt-6 max-w-[22rem] border-l-2 border-[#F51042]/25 pl-4 text-sm leading-relaxed text-[#737373]">{t("hostFaqHelp")}</p>
        </div>
        <Accordion type="single" collapsible className="min-w-0 overflow-hidden rounded-[24px] border border-[#2C2C2C]/[0.08] bg-white px-5 shadow-[0_1px_2px_rgba(44,44,44,0.03),0_16px_36px_-24px_rgba(44,44,44,0.12)] sm:px-7 motion-reduce:[&_[data-state]]:animate-none">
          {kitchenHostFaqs.map(faq => <AccordionItem key={faq.question} value={faq.question} className="border-[#2C2C2C]/[0.08] last:border-b-0">
            <AccordionTrigger className="gap-4 py-5 text-left text-[0.94rem] font-semibold leading-relaxed text-[#333] hover:text-[#D90E3A] hover:no-underline focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] sm:py-6 sm:text-base [&>svg]:text-[#8A8A8A] [&[data-state=open]]:text-[#D90E3A]">{t(faq.question)}</AccordionTrigger>
            <AccordionContent className="pb-6 pr-3 text-sm leading-[1.8] text-[#5F5F5F] motion-reduce:transition-none">{t(faq.answer)}</AccordionContent>
          </AccordionItem>)}
        </Accordion>
      </div>
    </section>

    <section id="start-hosting" aria-labelledby={`${id}-start`} className="bg-white px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8 lg:pb-24">
      <div className="mx-auto max-w-[1120px] rounded-[28px] bg-[#202124] p-6 shadow-[0_20px_48px_-30px_rgba(44,44,44,0.4)] sm:p-10 lg:p-12">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center lg:gap-12">
          <div className="max-w-[37rem]">
            <p className="text-xs font-medium tracking-[0.08em] text-white/60">{t("hostClosingEyebrow")}</p>
            <h2 id={`${id}-start`} className="mt-4 text-balance text-[1.9rem] font-bold leading-[1.15] tracking-[-0.025em] text-white sm:text-[2.5rem] lg:text-[2.75rem]">{t("hostClosingTitle")}</h2>
            <p className="mt-4 max-w-[33rem] text-pretty text-base leading-relaxed text-white/70">{t("hostClosingBody")}</p>
          </div>
          <div className="w-full lg:w-auto lg:max-w-[19rem]">
            <button type="button" onClick={onStart} className={`group inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-[#F51042] px-8 py-4 text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] transition-colors hover:bg-[#D90E3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-[#202124]`}>{t("heroHostStart")}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5" /></button>
            <p className="mt-3 text-center text-xs leading-relaxed text-white/60">{t("hostClosingNote")}</p>
          </div>
        </div>
        <ul className="mt-8 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:flex-wrap sm:gap-x-7 lg:mt-10">
          {(["hostClosingHours", "hostClosingRates", "hostClosingAccess"] as const).map(key => <li key={key} className="flex items-center gap-2 text-xs font-medium leading-relaxed text-white/70"><Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-white/50" />{t(key)}</li>)}
        </ul>
      </div>
    </section>
  </>;
}
