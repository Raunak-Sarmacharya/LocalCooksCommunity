import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import restaurantImage from "@/assets/kitchen-hosts/Restaurant_and_cafe.webp";
import communityImage from "@/assets/kitchen-hosts/Community_centres.webp";
import worshipImage from "@/assets/kitchen-hosts/Places_of_worship.webp";
import nonprofitImage from "@/assets/kitchen-hosts/Nonprofits.webp";
import sharedImage from "@/assets/kitchen-hosts/Shared_kitchens.webp";

const kitchenTypes = [
  { id: "restaurant", label: "heroRestaurants", heading: "opportunityRestaurantHeading", body: "opportunityRestaurantBody", image: restaurantImage },
  { id: "community", label: "heroCommunityCentres", heading: "opportunityCommunityHeading", body: "opportunityCommunityBody", image: communityImage },
  { id: "worship", label: "heroPlacesOfWorship", heading: "opportunityWorshipHeading", body: "opportunityWorshipBody", image: worshipImage },
  { id: "nonprofit", label: "heroNonprofits", heading: "opportunityNonprofitHeading", body: "opportunityNonprofitBody", image: nonprofitImage },
  { id: "shared", label: "heroSharedKitchens", heading: "opportunitySharedHeading", body: "opportunitySharedBody", image: sharedImage },
] as const;

const CYCLE_MS = 8000;

export default function KitchenOpportunity({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation("kitchen");
  const panelRef = useRef<HTMLDivElement>(null);
  const inView = useInView(panelRef, { amount: 0.3 });
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [readyImages, setReadyImages] = useState<number[]>([]);
  const [photo, setPhoto] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const playing = inView && !reduceMotion && !hovered && !focused;

  // Keep the previous photo visible until the next one has loaded.
  useEffect(() => {
    if (readyImages.includes(active)) setPhoto(active);
  }, [active, readyImages]);

  const chooseType = (id: string) => {
    const index = kitchenTypes.findIndex(type => type.id === id);
    if (index < 0) return;
    setActive(index);
  };

  return (
    <section id="lost-revenue" aria-labelledby="kitchen-opportunity-heading" className="scroll-mt-24 border-y border-[#2C2C2C]/[0.06] bg-[#F8F9FA] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-[1120px]">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold tracking-[0.08em] text-[#D90E3A]">{t("opportunityEyebrow")}</p>
          <h2 id="kitchen-opportunity-heading" className="mt-4 text-balance text-[1.9rem] font-bold leading-[1.15] tracking-[-0.025em] text-[#1F1F1F] sm:text-[2.5rem] lg:text-[3rem]">
            <span className="block">{t("opportunityHeadlineOne")}</span>
            <span className="block">{t("opportunityHeadlineTwo")}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-[38rem] text-balance text-[1rem] leading-relaxed text-[#5F5F5F] sm:text-[1.1rem]">{t("opportunityBody")}</p>
        </div>

        <div ref={panelRef} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
          <Tabs value={kitchenTypes[active].id} onValueChange={chooseType} className="mt-8 sm:mt-10">
            <TabsList aria-label={t("opportunityChooseType")} className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-2 overflow-visible rounded-none bg-transparent p-0 sm:flex sm:flex-wrap sm:justify-center">
              {kitchenTypes.map((type, index) => <TabsTrigger key={type.id} value={type.id} className={`relative overflow-hidden min-h-11 whitespace-normal rounded-full border border-[#2C2C2C]/[0.1] bg-white px-4 py-2.5 text-xs font-medium leading-relaxed text-[#6B6B6B] transition-colors hover:border-[#2C2C2C]/25 hover:text-[#2C2C2C] focus-visible:ring-[#F51042] data-[state=active]:border-[#F51042]/25 data-[state=active]:bg-[#FFF1F4] data-[state=active]:text-[#D90E3A] data-[state=active]:shadow-none sm:text-[13px] ${type.id === "shared" ? "col-span-2 sm:col-span-1" : ""}`}>
                {t(type.label)}
                {index === active && <span aria-hidden="true" className="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full bg-[#F51042]/10">
                  <span className="kitchen-opportunity-progress block h-full origin-left rounded-full bg-[#F51042]" style={{ animationDuration: `${CYCLE_MS}ms`, animationPlayState: playing ? "running" : "paused", animationName: reduceMotion ? "none" : undefined }} onAnimationEnd={() => { if (playing) setActive(index => (index + 1) % kitchenTypes.length); }} />
                </span>}
              </TabsTrigger>)}
            </TabsList>

            <div className="mt-6 overflow-hidden rounded-[26px] border border-[#2C2C2C]/[0.08] bg-white p-2 shadow-[0_30px_80px_-38px_rgba(28,28,32,0.16),0_3px_12px_-6px_rgba(28,28,32,0.12)] sm:mt-8 sm:rounded-[30px] sm:p-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)] lg:min-h-[400px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                <div className="relative isolate aspect-[16/10] min-h-[180px] min-w-0 w-full overflow-hidden rounded-[18px] bg-[#E9ECEE] sm:aspect-[2/1] sm:min-h-[280px] sm:rounded-[21px] lg:aspect-auto lg:min-h-0">
                  {kitchenTypes.map((type, index) => <img key={type.id} src={type.image} width={2816} height={1536} alt={index === photo ? t("opportunityImageAlt") : ""} aria-hidden={index !== photo} loading="lazy" decoding="async" onLoad={() => setReadyImages(ready => ready.includes(index) ? ready : [...ready, index])} className="absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" style={{ opacity: index === photo ? 1 : 0 }} />)}
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#17191D]/85 via-[#17191D]/5 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 lg:p-9">
                    <p className="text-xs font-medium text-white">{t("heroHostHoursNote")}</p>
                    <p className="mt-3 hidden max-w-[19rem] text-[1.8rem] font-medium leading-[1.25] tracking-[-0.025em] text-white sm:block">{t("opportunityPhotoCaption")}</p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col items-start justify-center px-5 pb-6 pt-7 sm:p-8 lg:px-10 lg:py-9 xl:px-12 xl:py-10">
                  {/* Stacked stories reserve the same space at every breakpoint and in every locale. */}
                  <div className="grid w-full">
                    {kitchenTypes.map((type, index) => <TabsContent key={type.id} value={type.id} forceMount aria-hidden={index !== active} tabIndex={index === active ? 0 : -1} className="col-start-1 row-start-1 mt-0 min-w-0 focus-visible:ring-[#F51042] data-[state=inactive]:pointer-events-none">
                      <motion.div initial={false} animate={{ opacity: index === active ? 1 : 0, y: index === active ? 0 : 8 }} transition={{ duration: reduceMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}>
                        <p className="text-xs font-medium text-[#737373]">{t(type.label)}</p>
                        <h3 className="mt-4 text-balance text-[1.5rem] font-bold leading-[1.2] tracking-[-0.025em] text-[#1F1F1F] sm:text-[1.8rem] lg:text-[2rem]">{t(type.heading)}</h3>
                        <p className="mt-4 text-pretty text-sm leading-[1.8] text-[#5F5F5F] sm:text-[15px]">{t(type.body)}</p>
                      </motion.div>
                    </TabsContent>)}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-col items-start justify-between gap-4 rounded-[18px] border-t border-[#2C2C2C]/[0.04] bg-[#F8F9FA] px-5 py-5 sm:mt-2.5 sm:flex-row sm:items-center sm:gap-6 sm:rounded-[21px] sm:px-7 lg:px-8">
                <p className="flex max-w-[40rem] items-start gap-2.5 text-xs font-medium leading-relaxed text-[#666] sm:text-[13px]"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#737373]" aria-hidden="true" />{t("opportunityControlNote")}</p>
                <button type="button" onClick={onStart} className="group inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-[#F51042] px-7 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_20px_-12px_rgba(245,16,66,0.5)] transition-colors hover:bg-[#D90E3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-4 focus-visible:ring-offset-[#F8F9FA] sm:w-auto">
                  {t("heroHostStart")}<ArrowRight className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </Tabs>
        </div>
      </div>
    </section>
  );
}
