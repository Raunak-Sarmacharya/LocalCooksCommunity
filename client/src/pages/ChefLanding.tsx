import { logger } from "@/lib/logger";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";
import { useFirebaseAuth } from "@/hooks/use-auth";
import CustomerSupportButton from "@/components/CustomerSupportButton";
import { useEffect, useState, useMemo, useRef, useCallback, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SiStripe } from "react-icons/si";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import FadeInSection from "@/components/ui/FadeInSection";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { addCollection, Icon } from "@iconify/react";
import { icons as mdiIcons } from "@iconify-json/mdi";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { KitchenLocationCard } from "@/components/chef-landing/KitchenLocationCard";
import { TruncatedText } from "@/components/common/TruncatedText";
import { landingBrowseKitchensPath, landingDashboardPath } from "@/lib/landing-cta";
import { scrollToPageSection } from "@/lib/scroll-to-page-section";
import {
  motion,
  AnimatePresence,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
import logoWhite from "@assets/logo-white.png";
import SellerJourneyDialog from "@/components/home/SellerJourneyDialog";
import { ChefServiceIllustration } from "@/components/home/ChefServiceIllustration";

import truckIcon from "@assets/truck.png";
import interacIcon from "@assets/Interac.svg";

addCollection(mdiIcons);

const APP_ICONS: Record<string, { icon?: string; imgSrc?: string; bg: string; color?: string; imgClass?: string }> = {
  instagram: { icon: "mdi:instagram", bg: "linear-gradient(135deg, #833AB4, #FD1D1D, #F77737)", color: "#ffffff" },
  gmail: { icon: "mdi:gmail", bg: "#ffffff", color: "#EA4335" },
  messenger: { icon: "mdi:facebook-messenger", bg: "linear-gradient(135deg, #00B2FF, #006AFF)", color: "#ffffff" },
  whatsapp: { icon: "mdi:whatsapp", bg: "#25D366", color: "#ffffff" },
  marketplace: { icon: "mdi:storefront-outline", bg: "#1877F2", color: "#ffffff" },
  iosMessages: { icon: "mdi:message-processing", bg: "#34C759", color: "#ffffff" },
  truck: { imgSrc: truckIcon, bg: "#ffffff", imgClass: "w-[65%] h-[65%] object-contain" },
  interac: { imgSrc: interacIcon, bg: "#ffffff", imgClass: "w-[90%] h-[90%] object-contain" },
};

// ═══════════════════════════════════════════════════════════════════════════════
// "THE PROBLEM" SECTION: FLOATING APP ICONS
// ═══════════════════════════════════════════════════════════════════════════════
// Each icon is three nested layers, and each layer owns exactly one transform:
//   1. scroll parallax (y, driven by a spring-smoothed scroll progress)
//   2. the one-time entrance (opacity, scale, rotate)
//   3. a slow idle float (CSS keyframes)
// Never animate the same property from two sources on one element. The entrance
// used to animate `y` on the element whose `y` the scroll also wrote, so every
// scroll tick during the entrance snapped the icon ~35px and back.
// ═══════════════════════════════════════════════════════════════════════════════

const ICON_DEPTH = {
  1: { opacity: 1, zIndex: 30, shadow: "0 22px 40px -12px rgba(0, 0, 0, 0.28)" },
  2: { opacity: 0.95, zIndex: 20, shadow: "0 16px 30px -10px rgba(0, 0, 0, 0.22)" },
  3: { opacity: 0.88, zIndex: 10, shadow: "0 12px 22px -8px rgba(0, 0, 0, 0.18)" },
} as const;

interface ParallaxIconProps {
  iconKey: string;
  /** CSS offsets inside the heading block, e.g. "12%" or "16px". */
  left: string;
  top?: string;
  bottom?: string;
  size: number;
  /** 1 = front (largest, travels furthest), 3 = back. */
  depth: 1 | 2 | 3;
  /** Resting rotation in degrees. */
  rotation: number;
  /** Pixels travelled either side of the resting position across the section's scroll. */
  parallaxY: number;
  /** Position in the entrance stagger. */
  order: number;
  className?: string;
  progress: MotionValue<number>;
}

function ParallaxIcon({
  iconKey,
  left,
  top,
  bottom,
  size,
  depth,
  rotation,
  parallaxY,
  order,
  className,
  progress,
}: ParallaxIconProps) {
  const reduceMotion = useReducedMotion();
  const y = useTransform(progress, [0, 1], reduceMotion ? [0, 0] : [parallaxY, -parallaxY]);
  const { opacity, zIndex, shadow } = ICON_DEPTH[depth];
  const app = APP_ICONS[iconKey];

  return (
    <motion.div
      className={cn("pointer-events-none absolute", className)}
      style={{ left, top, bottom, y, zIndex, willChange: "transform" }}
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.55, rotate: rotation * 2.5 }}
        whileInView={{ opacity, scale: 1, rotate: rotation }}
        viewport={{ once: true, margin: "0px 0px -8% 0px" }}
        transition={{
          type: "spring",
          stiffness: 170,
          damping: 17,
          mass: 0.8,
          delay: 0.1 + order * 0.07,
          opacity: { duration: 0.45, ease: "easeOut", delay: 0.1 + order * 0.07 },
        }}
      >
        <div
          className="chaos-float"
          style={{ animationDelay: `${-order * 1.3}s`, animationDuration: `${6 + (order % 3) * 1.2}s` }}
        >
          <div
            className="flex items-center justify-center overflow-hidden rounded-[22%] ring-1 ring-black/[0.04]"
            style={{ width: size, height: size, boxShadow: shadow, background: app?.bg || "#fff" }}
          >
            {app?.imgSrc ? (
              <img src={app.imgSrc} alt="" className={app.imgClass || "h-full w-full object-cover"} />
            ) : (
              <Icon
                icon={app?.icon || "mdi:help"}
                className="h-full w-full p-[18%]"
                style={{ color: app?.color || "#252832" }}
                aria-hidden
              />
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

type IconPlacement = Omit<ParallaxIconProps, "order" | "progress" | "className">;

// Desktop: a loose ring around the heading, kept inside the block so nothing drifts into the
// phones below. Front icons are largest and travel furthest; back icons are small and slow.
const DESKTOP_ICONS: IconPlacement[] = [
  { iconKey: "instagram", left: "5%", top: "6%", size: 80, depth: 1, rotation: -12, parallaxY: 90 },
  { iconKey: "whatsapp", left: "83%", top: "16%", size: 76, depth: 1, rotation: 8, parallaxY: 84 },
  { iconKey: "messenger", left: "14%", top: "34%", size: 64, depth: 2, rotation: 6, parallaxY: 64 },
  { iconKey: "gmail", left: "77%", top: "50%", size: 66, depth: 2, rotation: -5, parallaxY: 68 },
  { iconKey: "marketplace", left: "3%", top: "56%", size: 62, depth: 2, rotation: -8, parallaxY: 56 },
  { iconKey: "iosMessages", left: "87%", top: "68%", size: 58, depth: 2, rotation: 10, parallaxY: 60 },
  { iconKey: "truck", left: "17%", top: "74%", size: 56, depth: 3, rotation: -4, parallaxY: 38 },
  { iconKey: "interac", left: "70%", top: "78%", size: 52, depth: 3, rotation: 5, parallaxY: 34 },
];

// Mobile: two loose rows, one above the heading and one below the last line, in the padding the
// block reserves for them. Scattered around the copy on a 390px screen they sat on the words.
const MOBILE_ICONS: IconPlacement[] = [
  { iconKey: "instagram", left: "6%", top: "10px", size: 40, depth: 1, rotation: -10, parallaxY: 14 },
  { iconKey: "messenger", left: "28%", top: "44px", size: 30, depth: 2, rotation: 6, parallaxY: 10 },
  { iconKey: "gmail", left: "60%", top: "40px", size: 30, depth: 2, rotation: -6, parallaxY: 10 },
  { iconKey: "whatsapp", left: "80%", top: "6px", size: 38, depth: 1, rotation: 8, parallaxY: 14 },
  { iconKey: "marketplace", left: "7%", bottom: "30px", size: 32, depth: 2, rotation: -7, parallaxY: 10 },
  { iconKey: "truck", left: "31%", bottom: "4px", size: 30, depth: 3, rotation: -4, parallaxY: 8 },
  { iconKey: "iosMessages", left: "59%", bottom: "8px", size: 30, depth: 3, rotation: 9, parallaxY: 8 },
  { iconKey: "interac", left: "80%", bottom: "32px", size: 34, depth: 2, rotation: 5, parallaxY: 10 },
];

function ScrollLinkedChaosIcons() {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });
  // Mouse wheels scroll in 100px steps. Feeding the raw progress straight into the icons made
  // each notch a visible hop; the spring turns the steps into one continuous glide.
  const progress = useSpring(scrollYProgress, { stiffness: 110, damping: 26, mass: 0.5, restDelta: 0.0005 });

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
      {DESKTOP_ICONS.map((icon, i) => (
        <ParallaxIcon key={icon.iconKey} {...icon} order={i} progress={progress} className="hidden sm:block" />
      ))}
      {MOBILE_ICONS.map((icon, i) => (
        <ParallaxIcon key={`m-${icon.iconKey}`} {...icon} order={i} progress={progress} className="sm:hidden" />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// "THE PROBLEM" SECTION: PHONES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A rolling notification stack: newest on top, oldest pushed off the bottom.
 *
 * State holds indices, never strings. The copy is resolved at render time, so notifications
 * created before the `chef` namespace finished loading still pick up their translations
 * (storing the text itself froze the first four on their raw keys, e.g. "notifSarahMsg").
 * It only ticks while the phone is on screen.
 */
function useNotificationStack(count: number, intervalMs: number, active: boolean) {
  const INITIAL = 4;
  const MAX = 5;
  const [items, setItems] = useState(() =>
    Array.from({ length: INITIAL }, (_, i) => ({ uid: i, index: i % count })),
  );
  const nextUid = useRef(INITIAL);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const uid = nextUid.current++;
      setItems((prev) => [{ uid, index: uid % count }, ...prev].slice(0, MAX));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, count, intervalMs]);

  return items;
}

const NOTIFICATION_MOTION = {
  initial: { opacity: 0, y: -20, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.25, ease: "easeOut" } },
  transition: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
} as const;

/** An iPhone on its lock screen. The notifications are passed in. */
function PhoneMockup({
  tone,
  children,
}: {
  tone: "chaos" | "calm";
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage || "en-CA", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [i18n.resolvedLanguage],
  );

  return (
    <div className="relative mx-auto w-[262px] md:w-[278px]" aria-hidden="true">
      <div
        className={cn(
          "pointer-events-none absolute -inset-10 rounded-full blur-3xl",
          tone === "chaos" ? "bg-[#2C2C2C]/[0.12]" : "bg-[#F51042]/[0.18]",
        )}
      />

      {/* Side buttons */}
      <span className="absolute -left-[2px] top-[108px] h-7 w-[3px] rounded-l bg-[#2A2A2C]" />
      <span className="absolute -left-[2px] top-[150px] h-12 w-[3px] rounded-l bg-[#2A2A2C]" />
      <span className="absolute -left-[2px] top-[208px] h-12 w-[3px] rounded-l bg-[#2A2A2C]" />
      <span className="absolute -right-[2px] top-[168px] h-16 w-[3px] rounded-r bg-[#2A2A2C]" />

      <div className="relative rounded-[50px] bg-gradient-to-b from-[#4A4A4E] via-[#1F1F21] to-[#3A3A3D] p-[2.5px] shadow-[0_50px_90px_-40px_rgba(0,0,0,0.55),0_24px_40px_-24px_rgba(0,0,0,0.35)]">
        <div className="rounded-[47.5px] bg-black p-[7px]">
          <div className="relative h-[500px] overflow-hidden rounded-[41px] md:h-[530px]">
            {/* Wallpaper */}
            {tone === "chaos" ? (
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(120% 55% at 50% 0%, #3A3A3F 0%, #151517 55%, #0A0A0B 100%)",
                }}
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(90% 50% at 20% 0%, #FF8FA5 0%, rgba(255,143,165,0) 60%), radial-gradient(80% 60% at 100% 100%, #9E0728 0%, rgba(158,7,40,0) 70%), linear-gradient(180deg, #FF4D6F 0%, #F51042 45%, #C80A36 100%)",
                }}
              />
            )}

            {/* Status bar and Dynamic Island */}
            <div className="absolute left-1/2 top-[11px] h-[26px] w-[88px] -translate-x-1/2 rounded-full bg-black" />
            <div className="relative flex h-[48px] items-center justify-end gap-1 px-6 pt-1 text-white">
              <Icon icon="mdi:signal-cellular-3" className="h-3.5 w-3.5" />
              <Icon icon="mdi:wifi" className="h-3.5 w-3.5" />
              <Icon icon="mdi:battery-high" className="h-4 w-4 rotate-90" />
            </div>

            {/* Lock screen clock */}
            <div className="relative text-center text-white">
              <p className="text-[13px] font-semibold text-white/85 first-letter:uppercase">{date}</p>
              <p className="mt-0.5 text-[64px] font-semibold leading-none tracking-[-0.03em] text-white/95 tabular-nums">
                9:41
              </p>
            </div>

            {/* Notifications, fading out towards the bottom of the screen */}
            <div
              className="absolute inset-x-[9px] bottom-0 top-[152px] overflow-hidden"
              style={{
                maskImage: "linear-gradient(to bottom, #000 72%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, #000 72%, transparent 100%)",
              }}
            >
              {children}
            </div>

            {/* Home indicator */}
            <div className="absolute bottom-2 left-1/2 h-[5px] w-[108px] -translate-x-1/2 rounded-full bg-white/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

const CHAOS_APP_ICON: Record<string, { icon: string; gradient: string }> = {
  instagram: { icon: "mdi:instagram", gradient: "from-[#833AB4] via-[#FD1D1D] to-[#F77737]" },
  whatsapp: { icon: "mdi:whatsapp", gradient: "from-[#25D366] to-[#128C7E]" },
  phone: { icon: "mdi:phone", gradient: "from-[#34C759] to-[#28A745]" },
  marketplace: { icon: "mdi:facebook", gradient: "from-[#1877F2] to-[#0866FF]" },
  interac: { icon: "mdi:credit-card-outline", gradient: "from-[#FFB800] to-[#FF8C00]" },
  messenger: { icon: "mdi:facebook-messenger", gradient: "from-[#00B2FF] to-[#006AFF]" },
};

/** "Scattered everywhere": eight apps, all talking at once. */
function ChaosNotificationFeed({ active }: { active: boolean }) {
  const { t } = useTranslation("chef");
  const notifications = [
    { app: "Instagram", sender: "sarah_foodie", message: t("notifSarahMsg"), time: t("timeNow"), iconType: "instagram" },
    { app: "WhatsApp", sender: "Mike Chen", message: t("notifMikeMsg"), time: t("timeNow"), iconType: "whatsapp" },
    { app: "Phone", sender: t("notifMissedCall"), message: "+1 (709) 555-0142", time: "2m", iconType: "phone" },
    { app: "Marketplace", sender: "FB Marketplace", message: t("notifMarketplaceMsg"), time: "3m", iconType: "marketplace" },
    { app: "WhatsApp", sender: "Jennifer W", message: t("notifJenniferMsg"), time: "5m", iconType: "whatsapp" },
    { app: "Interac", sender: "INTERAC e-Transfer", message: t("notifInteracMsg"), time: "8m", iconType: "interac" },
    { app: "Messenger", sender: "David K", message: t("notifDavidMsg"), time: "12m", iconType: "messenger" },
    { app: "Instagram", sender: "foodie_lover", message: t("notifFoodieMsg"), time: "15m", iconType: "instagram" },
  ];
  const items = useNotificationStack(notifications.length, 1800, active);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {items.map(({ uid, index }) => {
        const n = notifications[index];
        const icon = CHAOS_APP_ICON[n.iconType];
        return (
          <motion.div key={uid} layout {...NOTIFICATION_MOTION} className="pb-[7px]">
            <div data-notif className="rounded-[18px] bg-[#2A2A2D]/80 px-2.5 py-2 ring-1 ring-inset ring-white/[0.06] backdrop-blur-xl">
              <div className="flex items-center gap-2.5">
                <div className={cn("flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br", icon.gradient)}>
                  <Icon icon={icon.icon} className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[10px] font-semibold text-white/55">{n.app}</span>
                    <span className="flex-shrink-0 text-[9.5px] text-white/40">{n.time}</span>
                  </div>
                  <p data-notif-line className="truncate text-[12px] font-medium leading-[1.3] text-white/95">
                    {n.sender}
                  </p>
                  <p className="truncate text-[10.5px] leading-[1.3] text-white/55">{n.message}</p>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

/** "Powered by LocalCooks": one app, calmly bringing in money. */
function LocalCooksNotificationFeed({ active }: { active: boolean }) {
  const { t } = useTranslation("chef");
  const notifications = [
    { amount: "$112.50", headline: t("notifChaChing"), subtext: t("notifOrderDowntown") },
    { amount: "$42.88", headline: t("notifRepeatCustomer"), subtext: t("notifMikeOrderAgain") },
    { amount: "$78.33", headline: t("notifPreorderConfirmed"), subtext: t("notifReadyPickupTomorrow") },
    { amount: "$31.29", headline: t("notifTipReceived"), subtext: t("notifThanksFood") },
    { amount: "", headline: t("notifReviewPosted"), subtext: t("notifBestBiryani") },
    { amount: "$54.25", headline: t("notifTrendingWeek"), subtext: t("notifTrendingArea") },
    { amount: "$123.75", headline: t("notifExpressOrder"), subtext: t("notifVipPrep") },
  ];
  const items = useNotificationStack(notifications.length, 1500, active);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {items.map(({ uid, index }) => {
        const n = notifications[index];
        return (
          <motion.div key={uid} layout {...NOTIFICATION_MOTION} className="pb-[7px]">
            <div data-notif className="rounded-[18px] bg-white/90 px-2.5 py-2 shadow-[0_10px_24px_-14px_rgba(90,0,20,0.6)] backdrop-blur-xl">
              <div className="flex items-center gap-2.5">
                <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[#F51042] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
                  <img src={logoWhite} alt="" className="h-[18px] w-[18px] object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[10px] font-semibold text-[#8A8A8E]">LocalCooks</span>
                    <span className="flex-shrink-0 text-[9.5px] text-[#A0A0A5]">{t("timeNow")}</span>
                  </div>
                  <p data-notif-line className="truncate text-[12px] font-medium leading-[1.3] text-[#1C1C1E]">
                    {n.headline}
                    {n.amount && <span className="tabular-nums text-emerald-600"> {n.amount}</span>}
                  </p>
                  <p className="truncate text-[10.5px] leading-[1.3] text-[#6E6E73]">{n.subtext}</p>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

/** Both phones, side by side, with the feeds running only while they are on screen. */
function PhoneComparison() {
  const { t } = useTranslation("chef");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px -10% 0px" });
  const reduceMotion = useReducedMotion();
  const active = inView && !reduceMotion;

  return (
    <div
      ref={ref}
      className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] items-center gap-y-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-x-6 lg:gap-x-12"
    >
      <motion.figure
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "0px 0px -10% 0px" }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center"
      >
        <PhoneMockup tone="chaos">
          <ChaosNotificationFeed active={active} />
        </PhoneMockup>
        <figcaption className="mt-7 text-center">
          <p className="text-[0.98rem] font-semibold text-[#1F1F1F]">{t("scatteredEverywhere")}</p>
          <p className="mt-1 text-[0.85rem] text-[#6B6B6B]">{t("fragmentedTools")}</p>
        </figcaption>
      </motion.figure>

      {/* The turn from one phone to the other. Across on desktop, down on a phone. */}
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0, scale: 0.8 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "0px 0px -10% 0px" }}
        transition={{ duration: 0.6, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center justify-center md:-mt-20 md:flex-col"
      >
        <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#2C2C2C]/15 md:h-16 md:w-px md:bg-gradient-to-b" />
        <span className="mx-3 flex h-11 w-11 items-center justify-center rounded-full border border-[#2C2C2C]/[0.08] bg-white shadow-[0_8px_20px_-8px_rgba(44,44,44,0.25)] md:mx-0 md:my-3">
          <Icon icon="mdi:arrow-down" className="h-5 w-5 text-[#F51042] md:hidden" />
          <Icon icon="mdi:arrow-right" className="hidden h-5 w-5 text-[#F51042] md:block" />
        </span>
        <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#2C2C2C]/15 md:h-16 md:w-px md:bg-gradient-to-t" />
      </motion.div>

      <motion.figure
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "0px 0px -10% 0px" }}
        transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center"
      >
        <PhoneMockup tone="calm">
          <LocalCooksNotificationFeed active={active} />
        </PhoneMockup>
        <figcaption className="mt-7 text-center">
          <p className="text-[0.98rem] font-semibold text-[#1F1F1F]">
            {t("poweredBy")} <span className="font-logo text-[1.1rem] font-normal text-[#F51042]">LocalCooks</span>
          </p>
          <p className="mt-1 text-[0.85rem] text-[#6B6B6B]">{t("unifiedPlatform")}</p>
        </figcaption>
      </motion.figure>
    </div>
  );
}

// Testimonial Carousel Component with Auto-Scroll
function TestimonialCarouselSection() {
  const { t } = useTranslation("chef");
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "start",
    duration: 25, // Smooth transition duration in milliseconds
    dragFree: false,
    containScroll: "trimSnaps"
  });

  // Auto-scroll functionality
  useEffect(() => {
    if (!emblaApi) return;

    const scrollInterval = setInterval(() => {
      if (emblaApi.canScrollNext()) {
        emblaApi.scrollNext();
      } else {
        emblaApi.scrollTo(0); // Reset to start if at end
      }
    }, 3000); // Scroll every 3 seconds

    return () => clearInterval(scrollInterval);
  }, [emblaApi]);

  const testimonials = [
    {
      text: t("testimonialDafna"),
      name: "Dafna",
      role: "Sababa Cafe NL",
      color: "#fc7545",
      textColor: "#2C2C2C",
    },
    {
      text: t("testimonialEmily"),
      name: "Emily",
      role: "The Waffle Lady",
      color: "#06516D",
      textColor: "#ffffff",
    },
    {
      text: t("testimonialKanij"),
      name: "Kanij",
      role: "Misti Mountain",
      color: "#30524e",
      textColor: "#ffffff",
    },
    {
      text: t("testimonialFardin"),
      name: "Fardin",
      role: "Alu Bhaja",
      color: "#ff8c42",
      textColor: "#2C2C2C",
    },
  ];

  return (
    <section id="testimonials" className="scroll-mt-24 py-12 sm:py-16 md:py-20 lg:py-32 px-4 sm:px-6 bg-white relative overflow-visible">
      <div className="container mx-auto max-w-7xl">
        <FadeInSection>
          <div className="text-center mb-12 md:mb-16">
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-tight"
            >
              {t("someKindWords")} {" "}
              <span className="relative inline-block">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">{t("chefsWord")}</span>
                <motion.svg
                  className="absolute -bottom-1 md:-bottom-2 left-0 w-full"
                  viewBox="0 0 200 12"
                  fill="none"
                  initial={{ pathLength: 0, opacity: 0 }}
                  whileInView={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.2, delay: 0.6 }}
                  viewport={{ once: true }}
                >
                  <motion.path
                    d="M2 8C30 4 70 4 100 6C130 8 170 5 198 8"
                    stroke="#F51042"
                    strokeWidth="3"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    transition={{ duration: 1.2, delay: 0.6 }}
                    viewport={{ once: true }}
                  />
                </motion.svg>
              </span>
            </motion.h2>
          </div>
        </FadeInSection>

        {/* Testimonial Carousel with Auto-Scroll */}
        <div className="relative px-4 sm:px-6 md:px-8 lg:px-12 py-8 sm:py-10 md:py-12">
          <div className="overflow-hidden" ref={emblaRef} style={{ willChange: 'transform' }}>
            <div className="flex">
              {testimonials.map((testimonial, index) => (
                <div
                  key={index}
                  className="flex-[0_0_100%] sm:flex-[0_0_50%] lg:flex-[0_0_33.333%] min-w-0 px-2 sm:px-2.5 md:px-3"
                >
                  <div className="h-full py-4 sm:py-5 md:py-6">
                    <div
                      className="relative rounded-2xl p-4 sm:p-5 md:p-6 h-full shadow-xl transition-transform duration-300 ease-in-out hover:scale-[1.02]"
                      style={{
                        backgroundColor: testimonial.color,
                        transform: `rotate(${index % 2 === 0 ? '-1.5deg' : '1.5deg'}) translateZ(0)`,
                        zIndex: 10 - (index % 3),
                      }}
                    >
                      {/* Elegant Quotation Mark */}
                      <div className="absolute top-2 left-2 sm:top-3 sm:left-3 md:top-4 md:left-4">
                        <span
                          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-serif leading-none"
                          style={{
                            color: testimonial.color === "#ffffff"
                              ? "rgba(44, 44, 44, 0.15)"
                              : testimonial.textColor === "#ffffff"
                                ? "rgba(255, 255, 255, 0.3)"
                                : "rgba(255, 255, 255, 0.4)",
                            fontFamily: "'Georgia', 'Times New Roman', serif",
                            lineHeight: "1",
                          }}
                        >
                          &ldquo;
                        </span>
                      </div>

                      {/* Content */}
                      <div className="relative z-10 pt-6 sm:pt-8 md:pt-10 lg:pt-12">
                        {/* Testimonial Text */}
                        <p
                          className="text-sm sm:text-base md:text-base lg:text-lg font-sans leading-relaxed mb-3 sm:mb-4 md:mb-5"
                          style={{
                            color: testimonial.textColor,
                          }}
                        >
                          {testimonial.text}
                        </p>

                        {/* Horizontal Line */}
                        <div
                          className="h-px mb-2 sm:mb-3 md:mb-4"
                          style={{
                            backgroundColor: testimonial.textColor === "#ffffff"
                              ? "rgba(255, 255, 255, 0.3)"
                              : "rgba(44, 44, 44, 0.2)",
                          }}
                        />

                        {/* Chef Name and Role */}
                        <div>
                          <p
                            className="font-bold text-xs sm:text-sm md:text-base lg:text-lg mb-0.5 sm:mb-1"
                            style={{
                              color: testimonial.textColor,
                            }}
                          >
                            {testimonial.name}
                          </p>
                          <p
                            className="text-xs sm:text-sm md:text-base"
                            style={{
                              color: testimonial.textColor === "#ffffff"
                                ? "rgba(255, 255, 255, 0.8)"
                                : "rgba(44, 44, 44, 0.7)",
                            }}
                          >
                            {testimonial.role}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Typewriter component - centered over the CTA button
function TypewriterText() {
  const { t } = useTranslation("chef");
  const words = [t("twCooks"), t("twCompany"), t("twCommunity")];
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const currentWord = words[currentWordIndex];
  const typingSpeed = 120;
  const deletingSpeed = 80;
  const pauseDuration = 2500;

  const tick = useCallback(() => {
    if (isPaused) return;

    if (!isDeleting) {
      // Typing
      if (currentText.length < currentWord.length) {
        setCurrentText(currentWord.slice(0, currentText.length + 1));
      } else {
        // Word complete, pause before deleting
        setIsPaused(true);
        setTimeout(() => {
          setIsPaused(false);
          setIsDeleting(true);
        }, pauseDuration);
      }
    } else {
      // Deleting
      if (currentText.length > 0) {
        setCurrentText(currentWord.slice(0, currentText.length - 1));
      } else {
        // Word deleted, move to next
        setIsDeleting(false);
        setCurrentWordIndex((prev) => (prev + 1) % words.length);
      }
    }
  }, [currentText, currentWord, isDeleting, isPaused, pauseDuration, words.length]);

  useEffect(() => {
    const speed = isDeleting ? deletingSpeed : typingSpeed;
    const timer = setTimeout(tick, speed);
    return () => clearTimeout(timer);
  }, [tick, isDeleting, deletingSpeed, typingSpeed]);

  return (
    <span
      className="font-logo inline-flex items-center justify-center text-3xl md:text-4xl lg:text-5xl text-white whitespace-nowrap min-h-[1.3em]"
      style={{ fontFamily: "'Lobster', cursive" }}
    >
      <span>{t("twLocal")}</span>
      <span className="ml-2.5 md:ml-3.5">{currentText}</span>
      <span
        className="typewriter-cursor inline-block"
        style={{
          backgroundColor: 'white',
          marginLeft: '6px',
          height: '0.85em',
          verticalAlign: 'middle',
        }}
      />
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHEF HERO
// ═══════════════════════════════════════════════════════════════════════════════
// The chef-side landing hero. Two things must survive any future edit to this file:
//
// 1. The two services are INDEPENDENT, and must LOOK independent. A chef can take the
//    storefront, the kitchen, or both — never one *then* the other. So the two path cards
//    are siblings with the same size, the same type scale and the same emphasis, and the
//    sell path must never mention kitchens (a cross-reference reads as a prerequisite, or
//    as a cross-sell). The independence claim is asserted in dev/shot-chef-hero.mjs; if you
//    add a line mentioning kitchens to the sell card, that check will fail, by design.
//
// 2. Every claim here has to be provable. The forbidden-phrase scan in the same script
//    catches marketing superlatives and any implication that WE certify the kitchens —
//    the partner kitchens are certified by their own health authority, not by us.
//
// Copy lives in shared/i18n/locales/*/chef.json under `hero*`. All three locales are
// required: a missing key renders the key text itself, which the harness reports as an
// unresolved locale entry rather than a silent English fallback.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Glues the last two words of a line together, so a wrapping headline can never leave a single
 * word stranded on its own line ("Book a commercial / kitchen.").
 */
function keepLastWordsTogether(line: string) {
  return line.replace(/\s+(\S+)\s*$/, "\u00A0$1");
}

/** Section label used inside the product previews. */
function PreviewLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9A9A9A]">
      {children}
    </p>
  );
}

/**
 * The tinted stage each product preview sits on. The window inside is anchored to the top and
 * runs off the bottom edge, where it fades into the stage, so the stage height is set by the
 * crop rather than by the content and both halves stay exactly the same height.
 */
function PreviewStage({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-[20px] bg-[#F6F5F3] px-3 pt-4 sm:px-7 sm:pt-7 lg:h-[300px]"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(44,44,44,0.09) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 0%, #000 20%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 0%, #000 20%, transparent 80%)",
        }}
      />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-48 w-[80%] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(245,16,66,0.08), rgba(245,16,66,0))",
        }}
      />
      <div className="relative transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/path:-translate-y-1.5">
        {children}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#F6F5F3] via-[#F6F5F3]/70 to-transparent" />
    </div>
  );
}

/** The app window chrome shared by both previews. */
function PreviewWindow({ status, children }: { status: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-t-[14px] border border-b-0 border-[#2C2C2C]/[0.08] bg-white shadow-[0_1px_2px_rgba(44,44,44,0.05),0_18px_40px_-18px_rgba(44,44,44,0.28)] transition-shadow duration-500 group-hover/path:shadow-[0_1px_2px_rgba(44,44,44,0.05),0_26px_50px_-18px_rgba(44,44,44,0.34)]">
      <div className="flex h-9 items-center gap-1.5 border-b border-[#2C2C2C]/[0.06] bg-[#FCFCFB] px-3.5">
        <span className="h-2 w-2 rounded-full bg-[#2C2C2C]/[0.12]" />
        <span className="h-2 w-2 rounded-full bg-[#2C2C2C]/[0.12]" />
        <span className="h-2 w-2 rounded-full bg-[#2C2C2C]/[0.12]" />
        <span className="ml-auto">{status}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The storefront half of the platform card. Every number here is illustrative, and the
 * content is the same sample data the hero has always shown.
 */
function SellPreview() {
  const { t } = useTranslation("chef");

  const topItems = [
    { name: "Handmade Truffle Tagliatelle", sold: 42 },
    { name: "Wood-Fired Margherita", sold: 36 },
    { name: "Artisan Birria Tacos", sold: 28 },
  ];

  const orders = [
    { id: "#00198", amount: "$112.50", state: "Out for delivery" },
    { id: "#00197", amount: "$48.00", state: "Paid" },
  ];

  return (
    <PreviewWindow
      status={
        <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-emerald-600">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          {t("heroMiniLive")}
        </span>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 pb-3 sm:grid-cols-2 sm:gap-5">
        <div className="flex min-w-0 flex-col">
          <PreviewLabel>{t("heroMiniRevenue")}</PreviewLabel>
          <div className="mt-1.5 flex items-center gap-2">
            <p className="text-[1.65rem] font-bold leading-none tracking-[-0.03em] text-[#1F1F1F] tabular-nums">
              $4,286
            </p>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[0.66rem] font-semibold text-emerald-600">
              <Icon icon="mdi:trending-up" className="h-3 w-3 flex-shrink-0" />
              18%
            </span>
          </div>

          {/* The chart draws itself in, which is what makes the window read as live. */}
          <div className="relative mt-3 h-[64px]">
            <div className="absolute inset-0 flex flex-col justify-between">
              <span className="border-t border-dashed border-[#2C2C2C]/[0.07]" />
              <span className="border-t border-dashed border-[#2C2C2C]/[0.07]" />
              <span className="border-t border-[#2C2C2C]/[0.08]" />
            </div>
            <svg viewBox="0 0 200 64" className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lc-showcase-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F51042" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#F51042" stopOpacity="0" />
                </linearGradient>
              </defs>
              <motion.path
                d="M0,50 L28,44 L56,47 L84,30 L112,36 L140,18 L168,24 L200,8 L200,64 L0,64 Z"
                fill="url(#lc-showcase-fill)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.9, delay: 1.9 }}
              />
              <motion.path
                d="M0,50 L28,44 L56,47 L84,30 L112,36 L140,18 L168,24 L200,8"
                fill="none"
                stroke="#F51042"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.6, delay: 1, ease: "easeInOut" }}
              />
            </svg>
            <motion.span
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 2.5 }}
              className="absolute right-0 top-[12.5%] flex h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F51042] opacity-30" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-[#F51042] shadow-[0_0_0_1px_rgba(245,16,66,0.25)]" />
            </motion.span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col border-t border-[#2C2C2C]/[0.06] pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <PreviewLabel>{t("revTopSellingItems")}</PreviewLabel>
          <ul className="mt-1 flex flex-col">
            {topItems.map((item, i) => (
              <li
                key={item.name}
                className={cn(
                  "flex items-center gap-2.5 py-[7px]",
                  i > 0 && "border-t border-[#2C2C2C]/[0.06]",
                )}
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-[#F6F5F3] text-[0.6rem] font-bold tabular-nums text-[#8A8A8A]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.76rem] font-medium text-[#3A3A3A]">
                  {item.name}
                </span>
                <span className="flex-shrink-0 text-[0.76rem] font-semibold tabular-nums text-[#1F1F1F]">
                  {item.sold}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 px-4 pb-10 sm:grid-cols-2">
        {orders.map((o, i) => (
          <motion.div
            key={o.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.5 + i * 0.16 }}
            className="flex items-center gap-2 rounded-lg border border-[#2C2C2C]/[0.07] bg-[#FAFAF9] px-2.5 py-2"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                o.state === "Paid" ? "bg-emerald-500" : "bg-[#F51042]",
              )}
            />
            <span className="flex-shrink-0 text-[0.74rem] font-semibold tabular-nums text-[#1F1F1F]">
              {o.amount}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.66rem] tabular-nums text-[#A0A0A0]">
              {o.id}
            </span>
            <span
              className={cn(
                "flex-shrink-0 text-[0.64rem] font-semibold",
                o.state === "Paid" ? "text-emerald-600" : "text-[#6B6B6B]",
              )}
            >
              {o.state}
            </span>
          </motion.div>
        ))}
      </div>
    </PreviewWindow>
  );
}

/** The kitchen half of the platform card. Same sample data as before, restyled. */
function KitchenPreview() {
  const { t } = useTranslation("chef");

  const kitchens = [
    { name: "Harbour Kitchen Hub", rate: "$24/hr", booked: false },
    { name: "Downtown Commissary", rate: "$220/day", booked: true },
  ];

  return (
    <PreviewWindow
      status={
        <span className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-[#8A8A8A]">
          <Icon icon="mdi:map-marker-outline" className="h-3 w-3 flex-shrink-0" />
          {t("heroMiniNearby")}
        </span>
      }
    >
      <div className="px-4 pb-10 pt-1.5">
        <div className="flex flex-col">
          {kitchens.map((k, i) => (
            <motion.div
              key={k.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 1.1 + i * 0.16 }}
              className={cn(
                "flex items-center gap-3 py-2",
                i > 0 && "border-t border-[#2C2C2C]/[0.06]",
              )}
            >
              <span className="hidden h-7 w-7 flex-shrink-0 items-center sm:flex justify-center rounded-lg border border-[#2C2C2C]/[0.06] bg-[#F6F5F3] text-[#7A7A7A]">
                <Icon icon="mdi:silverware-fork-knife" className="h-3.5 w-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 truncate text-[0.8rem] font-semibold text-[#1F1F1F] sm:flex-1">
                  {k.name}
                </span>
                <span className="flex-shrink-0 text-[0.72rem] font-semibold tabular-nums text-[#6B6B6B] sm:text-[0.78rem] sm:font-bold sm:text-[#1F1F1F]">
                  {k.rate}
                </span>
              </span>
              {/* Both badges share one height, so the tick on "Booked" cannot make it taller. */}
              <span
                className={cn(
                  "inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-full px-2.5 text-[0.66rem] font-semibold",
                  k.booked
                    ? "border border-emerald-600/15 bg-emerald-50 text-emerald-700"
                    : "bg-[#F51042] text-white shadow-[0_4px_10px_-4px_rgba(245,16,66,0.6)]",
                )}
              >
                {k.booked && <Icon icon="mdi:check" className="h-3 w-3 flex-shrink-0" />}
                {k.booked ? t("heroMiniBooked") : t("heroMiniBook")}
              </span>
            </motion.div>
          ))}
        </div>

        {/* The booked kitchen's confirmation, laid out as a ticket. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.5 }}
          className="mt-1.5 flex gap-3.5 rounded-xl border border-[#2C2C2C]/[0.07] bg-[#FAFAF9] p-3"
        >
          <div className="flex w-[3.25rem] flex-shrink-0 flex-col items-center overflow-hidden rounded-lg border border-[#2C2C2C]/[0.08] bg-white text-center shadow-[0_1px_2px_rgba(44,44,44,0.05)]">
            <span className="w-full bg-[#F51042] py-[3px] text-[0.58rem] font-bold uppercase tracking-[0.08em] text-white">
              Sep
            </span>
            <span className="pt-1 text-[1.2rem] font-bold leading-none tabular-nums text-[#1F1F1F]">25</span>
            <span className="pb-1.5 pt-0.5 text-[0.6rem] font-medium text-[#8A8A8A]">Thu</span>
          </div>

          <div className="min-w-0 flex-1">
            <PreviewLabel>{t("bdBookingDetails")}</PreviewLabel>
            <p className="mt-0.5 text-[0.8rem] font-semibold tabular-nums text-[#1F1F1F]">2:00 to 6:00 PM</p>
            <p className="mt-1 flex items-center gap-1.5 text-[0.72rem] text-[#6B6B6B]">
              <Icon icon="mdi:map-marker-outline" className="h-3.5 w-3.5 flex-shrink-0 text-[#A8A8A8]" />
              <span className="min-w-0 truncate">Downtown Commissary</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.72rem] text-[#6B6B6B]">
              <Icon icon="mdi:stove" className="h-3.5 w-3.5 flex-shrink-0 text-[#A8A8A8]" />
              <span className="min-w-0 truncate">Range, oven, walk-in cold storage</span>
            </p>
          </div>
        </motion.div>
      </div>
    </PreviewWindow>
  );
}

export interface ChefHeroProps {
  /** Handles in-page anchors (how-it-works, kitchen-access). */
  onScrollToSection?: (id: string) => void;
  /** Handles real route changes (compare-kitchens, dashboard). */
  onNavigate?: (path: string) => void;
  /** Opens the seller-journey dialog. */
  onStartApplication?: () => void;
  /** Harness-only: name of the assertion to deliberately break. Never set in app code. */
  negative?: string;
}

export function ChefHero({
  onScrollToSection,
  onNavigate,
  onStartApplication,
  negative = "",
}: ChefHeroProps) {
  const { t } = useTranslation("chef");

  const trust = [t("heroTrustFee"), t("heroTrustKeep"), t("heroTrustPayouts")];

  // Armed only by ?negative=…; every branch exists so a check can be shown to FAIL.
  const headlineLine1 =
    negative === "orphan"
      ? `${t("heroHeadlineLine1")} And a great deal more besides that`
      : t("heroHeadlineLine1");
  const headlineLine2 = t("heroHeadlineLine2");
  const subhead = negative === "claim" ? `${t("heroSubhead")} Guaranteed unlimited growth.` : t("heroSubhead");

  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <section data-hero className="relative overflow-hidden">
      {/* ── Background: a fine grid that fades out from under the headline, and one soft
          brand glow. Enough texture that the fold is not a blank sheet, never enough to
          compete with the type. ─────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-white" />
        <div
          className="absolute inset-x-0 top-0 h-[820px]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(44,44,44,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(44,44,44,0.055) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            backgroundPosition: "center -1px",
            maskImage: "radial-gradient(ellipse 60% 55% at 50% 12%, #000 25%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(ellipse 60% 55% at 50% 12%, #000 25%, transparent 78%)",
          }}
        />
        <div
          className="absolute left-1/2 top-[-220px] h-[620px] w-[min(1100px,140%)] -translate-x-1/2"
          style={{
            background: "radial-gradient(closest-side, rgba(245,16,66,0.09), rgba(245,16,66,0))",
          }}
        />
      </div>

      {/* Negative-test only: a floating layer over the copy. Never rendered in the app. */}
      {negative === "overlap" && (
        <div
          data-float
          aria-hidden="true"
          className="absolute inset-x-6 top-[90px] z-30 h-[340px] rounded-3xl bg-[#F51042]/15"
        />
      )}

      <div
        data-hero-content
        className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-20 pt-[calc(var(--header-height)+2.5rem)] sm:px-6 sm:pb-24 sm:pt-[calc(var(--header-height)+3rem)] lg:px-8 lg:pb-28 lg:pt-[calc(var(--header-height)+3.5rem)]"
      >
        {/* ── Heading block ─────────────────────────────────────────────────────── */}
        <div className="mx-auto max-w-4xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05, ease }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#2C2C2C]/[0.08] bg-white/80 py-1 pl-1 pr-3.5 text-[0.78rem] font-medium text-[#4A4A4A] shadow-[0_1px_2px_rgba(44,44,44,0.05)] backdrop-blur-sm sm:mb-7 sm:text-[0.82rem]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F51042]/[0.09]">
              <Icon icon="mdi:chef-hat" className="h-3.5 w-3.5 text-[#F51042]" />
            </span>
            {t("heroEyebrow")}
          </motion.p>

          <motion.h1
            data-h="headline"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease }}
            className="text-[clamp(1.85rem,8.2vw,2.6rem)] font-bold leading-[1.05] tracking-[-0.035em] text-[#1F1F1F] sm:text-[3.25rem] md:text-[3.75rem] lg:text-[4.25rem] xl:text-[4.6rem]"
          >
            <span
              data-h="headline-line"
              className="block bg-gradient-to-b from-[#1F1F1F] to-[#3F3F3F] bg-clip-text pb-[0.06em] text-transparent"
            >
              {keepLastWordsTogether(headlineLine1)}
            </span>
            <span
              data-h="headline-line"
              className="block bg-gradient-to-b from-[#1F1F1F] to-[#3F3F3F] bg-clip-text pb-[0.06em] text-transparent"
            >
              {keepLastWordsTogether(headlineLine2)}
            </span>
          </motion.h1>

          <motion.p
            data-h="subhead"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease }}
            className="mx-auto mt-5 max-w-[38rem] text-balance text-[1rem] leading-[1.6] text-[#5F5F5F] sm:mt-6 sm:text-[1.125rem]"
          >
            {subhead}
          </motion.p>
        </div>

        {/* ── One platform, two independent services ─────────────────────────────
            A single card, because it is one platform. Split down the middle, because either
            half works on its own: each service sits directly under its own product preview,
            with its own button, and the label on the seam says so. The sell half must never
            mention kitchens, since a cross-reference reads as a prerequisite. */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease }}
          className="relative mx-auto mt-12 max-w-[1120px] sm:mt-14 lg:mt-16"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-16 -bottom-16 top-10"
            style={{
              background:
                "radial-gradient(60% 55% at 50% 45%, rgba(245,16,66,0.10) 0%, rgba(245,16,66,0) 70%)",
            }}
          />

          <p className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
            <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[#2C2C2C]/10 bg-white px-3.5 py-1.5 text-[0.76rem] font-semibold text-[#4A4A4A] shadow-[0_4px_14px_-4px_rgba(44,44,44,0.18)]">
              <Icon icon="mdi:arrow-bottom-left" className="hidden h-3.5 w-3.5 text-[#B0B0B0] lg:block" aria-hidden />
              {t("heroPathsNote")}
              <Icon icon="mdi:arrow-bottom-right" className="hidden h-3.5 w-3.5 text-[#B0B0B0] lg:block" aria-hidden />
            </span>
          </p>

          <div className="relative rounded-[28px] border border-[#2C2C2C]/[0.07] bg-white p-2 shadow-[0_1px_2px_rgba(44,44,44,0.04),0_30px_70px_-30px_rgba(44,44,44,0.28)]">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
              {/* ── PATH 1 · SELL ─────────────────────────────────────────────── */}
              <motion.div
                data-path="sell"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.45, ease }}
                className={cn(
                  "group/path flex flex-col",
                  negative === "truncate" && "w-[150px]",
                  negative === "overflow" && "w-[3000px]",
                )}
              >
                <PreviewStage>
                  <SellPreview />
                </PreviewStage>

                <div className="flex flex-1 flex-col px-3 pb-4 pt-6 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6 lg:pt-7">
                  <h2
                    data-path-title
                    className="text-balance text-[1.3rem] font-bold leading-tight tracking-[-0.02em] text-[#1F1F1F] sm:text-[1.45rem]"
                  >
                    {t("heroPathSellTitle")}
                  </h2>
                  <p
                    data-path-body
                    className="mt-2.5 flex-1 text-pretty text-[0.94rem] leading-[1.65] text-[#5F5F5F]"
                  >
                    {negative === "crossTalk"
                      ? `${t("heroPathSellBody")} Commercial kitchen space available.`
                      : t("heroPathSellBody")}
                  </p>
                  <div className="mt-6">
                    <button
                      type="button"
                      data-cta="path-sell"
                      onClick={onStartApplication}
                      className="group/btn inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#F51042] px-6 text-[0.95rem] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(245,16,66,0.3),0_10px_24px_-10px_rgba(245,16,66,0.7)] transition-all duration-300 hover:bg-[#E30D3C] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(245,16,66,0.3),0_14px_30px_-10px_rgba(245,16,66,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto"
                    >
                      <span className="truncate">{t("heroPathSellCta")}</span>
                      <Icon
                        icon="mdi:arrow-right"
                        className="h-4 w-4 flex-shrink-0 transition-transform duration-300 group-hover/btn:translate-x-0.5"
                      />
                    </button>
                  </div>
                </div>
              </motion.div>

              {/* ── PATH 2 · BOOK A KITCHEN ───────────────────────────────────── */}
              <motion.div
                data-path="kitchen"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.55, ease }}
                className="group/path flex flex-col border-t border-[#2C2C2C]/[0.06] pt-2 lg:border-t-0 lg:pt-0"
              >
                <PreviewStage>
                  <KitchenPreview />
                </PreviewStage>

                <div className="flex flex-1 flex-col px-3 pb-4 pt-6 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6 lg:pt-7">
                  <h2
                    data-path-title
                    className="text-balance text-[1.3rem] font-bold leading-tight tracking-[-0.02em] text-[#1F1F1F] sm:text-[1.45rem]"
                  >
                    {t("heroPathKitchenTitle")}
                  </h2>
                  <p
                    data-path-body
                    className="mt-2.5 flex-1 text-pretty text-[0.94rem] leading-[1.65] text-[#5F5F5F]"
                  >
                    {t("heroPathKitchenBody")}
                  </p>
                  <div className="mt-6">
                    <button
                      type="button"
                      data-cta="path-kitchen"
                      onClick={() => onScrollToSection?.("kitchen-access")}
                      className="group/btn inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#F51042]/30 bg-white px-6 text-[0.95rem] font-semibold text-[#F51042] shadow-[0_1px_2px_rgba(245,16,66,0.08),0_10px_24px_-12px_rgba(245,16,66,0.35)] transition-all duration-300 hover:border-[#F51042] hover:bg-[#FFF5F7] hover:shadow-[0_1px_2px_rgba(245,16,66,0.1),0_14px_30px_-12px_rgba(245,16,66,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto"
                    >
                      <span className="truncate">{t("heroPathKitchenCta")}</span>
                      <Icon
                        icon="mdi:arrow-right"
                        className="h-4 w-4 flex-shrink-0 transition-transform duration-300 group-hover/btn:translate-x-0.5"
                      />
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* ── Trust row ───────────────────────────────────────────────────────────
            Led by the Stripe mark in its brand colour (tailwind `stripe`), because a
            recognisable processor answers "can I trust the payments" faster than a sentence.
            Stated once, here, and nowhere inside the previews. */}
        <motion.div
          data-fold="trust-bar"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.7, ease }}
          className="mx-auto mt-10 flex max-w-[1120px] flex-wrap items-center justify-center gap-x-5 gap-y-3 sm:mt-12"
        >
          <span className="inline-flex items-center gap-2 text-[0.85rem] font-semibold text-[#3A3A3A]">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-stripe shadow-[0_2px_6px_-2px_rgba(99,91,255,0.6)]">
              <SiStripe className="h-3.5 w-3.5 text-white" aria-hidden />
            </span>
            {t("heroTrustStripe")}
          </span>
          {trust.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-5 text-[0.85rem] font-medium text-[#6B6B6B]">
              <span className="hidden h-4 w-px bg-[#2C2C2C]/[0.12] sm:block" aria-hidden="true" />
              {item}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

export default function ChefLanding() {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const { t } = useTranslation("chef");

  // Harness-only: read by dev/chef-hero-harness.tsx to induce a failure. Always empty in the app.
  const negative =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("negative") ?? "";

  // Fetch locations data (same endpoint structure as preview page uses)
  const { data: locations = [], isLoading: kitchensLoading } = useQuery({
    queryKey: ["/api/public/locations"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/public/locations", {
          method: "GET",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        // Log the actual data received from API (works in production too)
        logger.info("[ChefLanding] API Response - Locations data:", data);
        if (Array.isArray(data) && data.length > 0) {
          logger.info("[ChefLanding] First location sample:", {
            id: data[0].id,
            name: data[0].name,
            featuredKitchenImage: data[0].featuredKitchenImage,
            logoUrl: data[0].logoUrl
          });
        }
        return Array.isArray(data) ? data : [];
      } catch (error) {
        logger.error("Error fetching locations:", error);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // Use locations data directly (same structure as preview page)
  const uniqueLocations = useMemo(() => {
    if (!locations || locations.length === 0) {
      logger.info("[ChefLanding] No locations data available");
      return [];
    }
    // Locations already come with normalized URLs from the API
    const mapped = locations.map((loc: any) => {
      // Use featuredKitchenImage from actual kitchens for the main card image
      const mainImage = loc.featuredKitchenImage || null;

      // Always log in production to debug
      logger.info(`[ChefLanding] Processing Location ${loc.id} (${loc.name}):`, {
        featuredKitchenImage: loc.featuredKitchenImage,
        mainImage: mainImage,
        logoUrl: loc.logoUrl,
        hasMainImage: !!mainImage
      });

      return {
        id: loc.id,
        slug: loc.slug || undefined,
        name: loc.name,
        address: loc.address || "",
        logoUrl: loc.logoUrl || null,
        featuredKitchenImage: loc.featuredKitchenImage || null,
        mainImage: mainImage, // Combined image for display
        kitchenCount: loc.kitchenCount || 1,
        description: loc.description || null,
        // The kitchen this card is for. The API returns one row per location, so it also names the
        // single kitchen the card stands for — the card used to be titled with the location, which
        // is an address, not something a chef can book.
        featuredKitchen: loc.featuredKitchen || null
      };
    });
    logger.info(`[ChefLanding] Processed ${mapped.length} locations`);
    return mapped;
  }, [locations]);

  useEffect(() => {
    const target = window.sessionStorage.getItem("chef-landing-scroll-target");
    window.sessionStorage.removeItem("chef-landing-scroll-target");

    if (target) {
      const timeout = window.setTimeout(() => {
        scrollToPageSection(target);
      }, 100);
      return () => window.clearTimeout(timeout);
    }

    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, []);

  const [sellerJourneyOpen, setSellerJourneyOpen] = useState(false);
  const handleGetStarted = () => {
    if (user) {
      navigate(landingDashboardPath(user));
      return;
    }
    setSellerJourneyOpen(true);
  };
  const handleBrowseKitchens = () => navigate(landingBrowseKitchensPath(user));

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <SEOHead
        title={t("seoTitle")}
        description={t("seoDescription")}
        canonicalUrl="/"
        keywords={[
          t("kwBecomeChef"), t("kwHomeChef"), t("kwFoodBizNL"),
          t("kwKitchenRental"), t("kwChefPlatform"), t("kwLocalChef"),
          t("kwStartFoodBiz"), t("kwHomeCookCompliance"), t("kwKitchenBooking"),
          t("kwFoodDelivery"), t("kwLocalCooksChef"), t("kwCookFromHome")
        ]}
        showLocalBusiness
        breadcrumbs={[
          { name: "LocalCooks", url: "https://www.localcooks.ca/" },
          { name: t("breadcrumbForChefs"), url: "https://chef.localcooks.ca/" },
        ]}
        faq={[
          { question: t("faqQ1"), answer: t("faqA1") },
          { question: t("faqQ2"), answer: t("faqA2") },
          { question: t("faqQ3"), answer: t("faqA3") },
          { question: t("faqQ4"), answer: t("faqA4") },
        ]}
        siteNavigation={[
          { name: t("navApplyChef"), description: t("navApplyDesc"), url: "https://chef.localcooks.ca/apply" },
          { name: t("navBookKitchen"), description: t("navBookDesc"), url: "https://chef.localcooks.ca/book-kitchen" },
          { name: t("navCompareKitchens"), description: t("navCompareDesc"), url: "https://chef.localcooks.ca/compare-kitchens" },
          { name: t("navForKitchenOwners"), description: t("navOwnersDesc"), url: "https://kitchen.localcooks.ca/" },
          { name: t("navOrderFood"), description: t("navOrderDesc"), url: "https://localcook.shop" },
          { name: t("navBlog"), description: t("navBlogDesc"), url: "https://www.localcooks.ca/blog" },
        ]}
      />
      <CustomerSupportButton />
      <Header hideHowItWorks />

      <main className="flex-grow">
        <ChefHero
          negative={negative}
          onScrollToSection={scrollToPageSection}
          onNavigate={navigate}
          onStartApplication={handleGetStarted}
        />

        {/* ═══════════════════════════════════════════════════════════════════════
            "THE PROBLEM" SECTION
            The heading sits in a ring of the apps a chef juggles today, then two phones make
            the same point as a picture: eight apps talking at once, or one calm feed.
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:pb-24 sm:pt-20 lg:pb-32 lg:pt-24">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute inset-0 bg-gradient-to-b from-white via-[#FAFAF9] to-white" />
            <div
              className="absolute left-1/2 top-[38%] h-[640px] w-[min(1100px,140%)] -translate-x-1/2"
              style={{
                background: "radial-gradient(closest-side, rgba(245,16,66,0.06), rgba(245,16,66,0))",
              }}
            />
          </div>

          <div className="container relative mx-auto max-w-7xl">
            {/* Heading block. On a phone it reserves a band above and below the copy for the
                icons, so they never sit on the words. */}
            <div className="relative mb-12 flex flex-col items-center justify-center pb-[84px] pt-[92px] text-center sm:mb-12 sm:min-h-[440px] sm:py-0 lg:mb-14 lg:min-h-[480px]">
              <ScrollLinkedChaosIcons />

              <div className="relative z-40 mx-auto max-w-[46rem] sm:px-12">
                <motion.h2
                  className="text-balance text-[1.7rem] font-bold leading-[1.18] tracking-[-0.025em] text-[#1F1F1F] sm:text-[2.25rem] lg:text-[2.75rem] lg:leading-[1.12]"
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  viewport={{ once: true, margin: "0px 0px -10% 0px" }}
                >
                  {t("didntStartCooking")}{" "}
                  <span className="relative inline-block">
                    <span className="relative z-10 bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A] bg-clip-text text-transparent">
                      {t("buriedInAdmin")}
                    </span>
                    <svg
                      className="absolute -bottom-1 left-0 w-full md:-bottom-2"
                      viewBox="0 0 300 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <motion.path
                        d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8"
                        stroke="url(#underlineGradient)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        initial={{ pathLength: 0, opacity: 0 }}
                        whileInView={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 1, delay: 0.6, ease: [0.65, 0, 0.35, 1] }}
                        viewport={{ once: true }}
                      />
                      <defs>
                        <linearGradient id="underlineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#F51042" stopOpacity="0.5" />
                          <stop offset="50%" stopColor="#FF6B7A" stopOpacity="0.75" />
                          <stop offset="100%" stopColor="#F51042" stopOpacity="0.5" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </span>
                </motion.h2>

                <motion.p
                  className="mx-auto mt-6 max-w-[36rem] text-pretty text-[0.98rem] leading-relaxed text-[#5F5F5F] sm:text-[1.075rem]"
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  viewport={{ once: true, margin: "0px 0px -10% 0px" }}
                >
                  {t("managingOrders")}{" "}
                  <span className="font-semibold text-[#1F1F1F]">{t("allOnYourOwn")}</span>
                </motion.p>

                <motion.p
                  className="mt-6 inline-flex items-center gap-2 text-balance text-[0.92rem] font-semibold text-[#1F1F1F] sm:mt-7 sm:rounded-full sm:border sm:border-[#2C2C2C]/[0.08] sm:bg-white sm:px-4 sm:py-2 sm:text-[0.9rem] sm:shadow-[0_6px_16px_-8px_rgba(44,44,44,0.2)]"
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  viewport={{ once: true, margin: "0px 0px -10% 0px" }}
                >
                  <span className="hidden h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#F51042] sm:block" aria-hidden="true" />
                  {t("soundFamiliar")}
                </motion.p>
              </div>
            </div>

            <PhoneComparison />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            HOW IT WORKS - Clean, Balanced Design
            Color Theory: Coral red (#F51042) complemented by teal, amber/gold, soft coral
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="how-it-works" className="scroll-mt-24 py-20 md:py-28 px-4 bg-white">
          <div className="container mx-auto max-w-6xl">
            {/* Section Header */}
            <FadeInSection>
              <div className="text-center mb-16">
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-tight mb-4"
                >
                  {t("threeSimple")} {" "}
                  <span className="relative inline-block">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">{t("stepsWord")}</span>
                    <motion.svg
                      className="absolute -bottom-1 md:-bottom-2 left-0 w-full"
                      viewBox="0 0 200 12"
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1.2, delay: 0.6 }}
                      viewport={{ once: true }}
                    >
                      <motion.path
                        d="M2 8C30 4 70 4 100 6C130 8 170 5 198 8"
                        stroke="#F51042"
                        strokeWidth="3"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        transition={{ duration: 1.2, delay: 0.6 }}
                        viewport={{ once: true }}
                      />
                    </motion.svg>
                  </span>
                </motion.h2>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="text-[#6B6B6B] text-sm md:text-base lg:text-lg"
                >{t("joinPassionateChefs")}</motion.p>
              </div>
            </FadeInSection>

            {/* Connected visual story — an infographic rather than three isolated cards. */}
            <div className="relative grid md:grid-cols-3 gap-7 md:gap-10 lg:gap-14 mb-12 md:mb-16">
              <div className="pointer-events-none absolute left-[16%] right-[16%] top-16 hidden h-0.5 md:block">
                <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#f51042_0_8px,transparent_8px_16px)] opacity-25" />
              </div>

              {/* Step 1 - Apply */}
              <FadeInSection delay={1}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="group relative h-full text-center"
                >
                  <Card className="relative h-full rounded-2xl bg-white border-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
                    <CardContent className="p-6 md:p-7 lg:p-8 flex flex-col items-center h-full">
                      <div className="relative z-10 mb-5 w-full">
                        <ChefServiceIllustration variant="storefront" />
                      </div>

                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C] mb-1">{t("serviceStorefrontTitle", "Build your storefront")}</h3>
                      <p className="text-xs md:text-sm font-medium text-[#6B6B6B] mb-2 md:mb-3">{t("serviceStorefrontEyebrow", "Your brand, menu and prices")}</p>

                      <p className="text-[#6B6B6B] leading-relaxed text-xs md:text-sm">{t("serviceStorefrontDesc", "Create your own storefront and publish menus to sell directly through the LocalCooks marketplace.")}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              </FadeInSection>

              {/* Step 2 - We Approve You */}
              <FadeInSection delay={2}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="group relative h-full text-center"
                >
                  <Card className="relative h-full rounded-2xl bg-white border-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
                    <CardContent className="p-6 md:p-7 lg:p-8 flex flex-col items-center h-full">
                      <div className="relative z-10 mb-5 w-full">
                        <ChefServiceIllustration variant="operations" />
                      </div>

                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C] mb-1">{t("serviceOperationsTitle", "Cook—we handle the rest")}</h3>
                      <p className="text-xs md:text-sm font-medium text-[#6B6B6B] mb-2 md:mb-3">{t("serviceOperationsEyebrow", "Orders, payments and delivery")}</p>

                      <p className="text-[#6B6B6B] leading-relaxed text-xs md:text-sm">{t("serviceOperationsDesc", "Accept customer orders while LocalCooks coordinates secure payments and delivery logistics for you.")}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              </FadeInSection>

              {/* Step 3 - Menu. Price. Sell. */}
              <FadeInSection delay={3}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="group relative h-full text-center"
                >
                  <Card className="relative h-full rounded-2xl bg-white border-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
                    <CardContent className="p-6 md:p-7 lg:p-8 flex flex-col items-center h-full">
                      <div className="relative z-10 mb-5 w-full">
                        <ChefServiceIllustration variant="kitchen" />
                      </div>

                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C] mb-1">{t("serviceKitchenTitle", "Cook in the right kitchen")}</h3>
                      <p className="text-xs md:text-sm font-medium text-[#6B6B6B] mb-2 md:mb-3">{t("serviceKitchenEyebrow", "Commercial kitchens by the hour")}</p>

                      <p className="text-[#6B6B6B] leading-relaxed text-xs md:text-sm">{t("serviceKitchenDesc", "Browse commercial kitchens, compare what they offer and book prep time when you need it.")}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              </FadeInSection>
            </div>

            {/* CTA Section (Moved above What You Get) */}
            <FadeInSection>
              <div className="text-center mb-16 md:mb-20">
                <Button
                  onClick={handleGetStarted}
                  size="lg"
                  className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-bold py-3 md:py-4 px-3 sm:px-6 md:px-12 text-[11px] sm:text-sm md:text-lg rounded-full shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 min-h-[44px] sm:min-h-[48px]"
                >
                  <span className="flex items-center justify-center">{t("startYourJourney")}<Icon icon="mdi:arrow-right" className="ml-1.5 md:ml-2 h-3.5 w-3.5 md:h-5 md:w-5" />
                  </span>
                </Button>
              </div>
            </FadeInSection>

            {/* What You Get - Compact Bento Grid */}
            <FadeInSection>
              <div className="mb-10 md:mb-12">
                <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                  <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C]">{t("whatYouGet")}</h3>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { text: t("wygStorefront"), icon: "mdi:storefront-outline" },
                    { text: t("wygOrderManagement"), icon: "mdi:clipboard-list-outline" },
                    { text: t("wygMoneyFlows"), icon: "mdi:credit-card-outline" },
                    { text: t("wygDeliveryLogistics"), icon: "mdi:truck-delivery-outline" },
                    { text: t("wygKitchenAccess"), icon: "mdi:chef-hat" },
                    { text: t("wygHandleComplexity"), icon: "mdi:shield-check-outline" },
                    { text: t("wygStayInControl"), icon: "mdi:tune-variant" },
                    { text: t("wygRealSupport"), icon: "mdi:account-heart-outline" },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      whileHover={{ y: -2, scale: 1.01 }}
                      className="group"
                    >
                      <div className="h-full bg-white rounded-2xl p-4 border border-[#2C2C2C]/10 hover:shadow-md transition-all duration-300">
                        <div className="flex flex-row items-center text-left gap-3 md:items-start md:gap-2.5">
                          <div className="flex-shrink-0">
                            <Icon icon={item.icon} className="h-4 w-4 text-[#2C2C2C]" />
                          </div>
                          <p className="text-[#4A5568] text-[10px] md:text-xs leading-tight md:leading-relaxed">
                            {item.text}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </FadeInSection>

            {/* Explore Marketplace CTA (Moved under What You Get) */}
            <FadeInSection>
              <div className="text-center mt-12 mb-8">
                <Button
                  onClick={() => window.open('https://localcook.shop/', '_blank')}
                  variant="outline"
                  size="lg"
                  className="relative z-20 inline-flex items-center justify-center rounded-full border border-[#F51042]/25 bg-white py-3 md:py-4 px-3 sm:px-6 md:px-12 text-[11px] sm:text-sm md:text-lg font-bold text-[#F51042] shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 hover:border-[#F51042] min-h-[44px] sm:min-h-[48px]"
                >
                  {t("visitMarketplace", "Explore the live marketplace")}
                  <Icon icon="mdi:arrow-right" className="ml-1.5 md:ml-2 h-3.5 w-3.5 md:h-5 md:w-5" />
                </Button>
              </div>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            KITCHEN ACCESS - DRAMATIC BRAND SECTION with Bold Wave Dividers
            Inspired by Stripe, Linear, and LocalCooks.ca branding
        ═══════════════════════════════════════════════════════════════════════ */}

        {/* ══════ TOP WAVE DIVIDER - White to Primary Red ══════ */}
        <div className="relative w-full overflow-hidden" style={{ height: '120px', marginBottom: '-1px' }}>
          <svg
            viewBox="0 0 1440 320"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute bottom-0 w-full"
            style={{ height: '120px', minWidth: '100%' }}
            preserveAspectRatio="none"
          >
            {/* Wave pattern - solid brand red, no gradient */}
            <path
              fill="#F51042"
              fillOpacity="1"
              d="M0,224L48,224C96,224,192,224,288,213.3C384,203,480,181,576,192C672,203,768,245,864,256C960,267,1056,245,1152,224C1248,203,1344,181,1392,170.7L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>

        {/* ══════ MAIN KITCHEN ACCESS SECTION - Bold Primary Background ══════ */}
        <section id="kitchen-access" className="relative scroll-mt-24 py-20 md:py-28 px-4 overflow-hidden bg-[#F51042]">
          {/* Animated Background Effects with fade mask to blend into waves */}
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, transparent 5%, rgba(0,0,0,1) 10%, rgba(0,0,0,1) 90%, transparent 95%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, transparent 5%, rgba(0,0,0,1) 10%, rgba(0,0,0,1) 90%, transparent 95%, transparent 100%)'
            }}
          >
            {/* Large Floating Orbs */}
            <motion.div
              className="absolute -top-40 -right-40 w-[500px] h-[500px] md:w-[800px] md:h-[800px] rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 60%)' }}
              animate={{ scale: [1, 1.15, 1], x: [0, 40, 0], y: [0, 20, 0] }}
              transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute -bottom-60 -left-40 w-[400px] h-[400px] md:w-[600px] md:h-[600px] rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255, 255, 255, 0.12) 0%, transparent 60%)' }}
              animate={{ scale: [1.1, 1, 1.1], x: [0, -30, 0], y: [0, -40, 0] }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] md:w-[900px] md:h-[900px] rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255, 107, 107, 0.1) 0%, transparent 50%)' }}
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
            />

            {/* Cross Pattern Overlay */}
            <div className="absolute inset-0 opacity-[0.05]" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M20 0v40M0 20h40' stroke='%23fff' stroke-width='1'/%3E%3C/g%3E%3C/svg%3E")`,
            }} />
          </div>

          <div className="container mx-auto max-w-6xl relative z-10">
            {/* Section Header - White Text on Red */}
            <FadeInSection>
              <div className="text-center mb-12">
                <motion.h2
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight mb-4"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                >
                  {t("noKitchen")} 
                  <span className="relative inline-block">
                    <span className="relative z-10">{t("noProblem")}</span>
                    <motion.svg
                      className="absolute -bottom-1 md:-bottom-2 left-0 w-full"
                      viewBox="0 0 300 12"
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1, delay: 0.5 }}
                      viewport={{ once: true }}
                    >
                      <motion.path
                        d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8"
                        stroke="rgba(255,255,255,0.6)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        transition={{ duration: 1, delay: 0.5 }}
                        viewport={{ once: true }}
                      />
                    </motion.svg>
                  </span>
                </motion.h2>

                <motion.p
                  className="text-sm md:text-base lg:text-lg text-white/85 leading-relaxed max-w-5xl mx-auto"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >{t("accessCommercialKitchens")}</motion.p>
              </div>
            </FadeInSection>

            {/* Kitchen Location Cards - White Cards on Red Background */}
            {!kitchensLoading && uniqueLocations.length > 0 ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10 md:mb-12">
                {uniqueLocations.slice(0, 3).map((loc: any, i: number) => (
                  <FadeInSection key={loc.id} delay={Math.min(i % 4, 3) as 0 | 1 | 2 | 3}>
                    <KitchenLocationCard
                      location={loc}
                      navigate={navigate}
                    />
                  </FadeInSection>
                ))}
              </div>
            ) : !kitchensLoading ? (
              <FadeInSection delay={1}>
                <div className="flex justify-center mb-10 md:mb-12">
                  <div className="bg-white/15 backdrop-blur-md rounded-2xl border border-white/20 px-8 py-10 text-center max-w-md">
                    <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                      <Icon icon="mdi:office-building-outline" className="h-7 w-7 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{t("partnerKitchensComingSoon")}</h3>
                    <p className="text-sm text-white/80 leading-relaxed">{t("onboardingKitchens")}</p>
                  </div>
                </div>
              </FadeInSection>
            ) : null}

            {/* Browse all kitchens — discovery path to full listings */}
            {!kitchensLoading && (
              <FadeInSection delay={1}>
                <div className="flex justify-center mb-14 md:mb-16">
                  <Button
                    size="lg"
                    variant="outline"
                    className="group inline-flex items-center justify-center bg-white text-[#F51042] border-2 border-white font-semibold rounded-full px-6 sm:px-8 py-3 md:py-4 text-sm sm:text-base transition-all duration-300 shadow-lg shadow-black/10 hover:shadow-xl hover:-translate-y-0.5"
                    onClick={handleBrowseKitchens}
                  >
                    <Icon icon="mdi:calendar-month-outline" className="mr-2 h-4 w-4 sm:h-5 sm:w-5 shrink-0" />{t("browseAllKitchens")}<Icon icon="mdi:arrow-right" className="ml-2 h-4 w-4 sm:h-5 sm:w-5 shrink-0 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </FadeInSection>
            )}

            {/* Partner CTA - Container Card with Bento Grid Inside */}
            <FadeInSection delay={1}>
              <motion.div
                className="bg-white rounded-2xl shadow-xl overflow-hidden"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
              >
                {/* Bento Grid Content Area */}
                <div className="p-4 md:p-6">
                  {/* Header Row with Kitchen Icon */}
                  <div className="flex items-start gap-4 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className="h-12 w-12 shrink-0 text-[#2C2C2C]" aria-hidden="true">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path fill="currentColor" d="M11.473 10.596h1.399v-.7H11.75l-.938-3.94a.35.35 0 0 0-.341-.27H8.967a.35.35 0 0 0-.341.27l-.939 3.94H6.561v.7ZM9.244 6.385h.949l.836 3.509H8.408Zm1.527 8.07H8.666a.35.35 0 0 0-.351.35v1.755a.35.35 0 0 0 .351.351h2.105a.35.35 0 0 0 .351-.351v-1.755a.35.35 0 0 0-.351-.35m-.35 1.754H9.017v-1.053h1.4ZM6.21 14.455h.702v1.754H6.21Zm11.227-2.457h.702v1.754h-.702Zm0-3.156h.702v1.754h-.702Zm4.211-2.457h-4.912a.35.35 0 0 0-.35.351v6.666H2.35a.35.35 0 0 0-.35.351v4.21a.35.35 0 0 0 .35.351h19.299a.35.35 0 0 0 .351-.351V6.736a.35.35 0 0 0-.352-.351m-5.263 9.122h-4.211v-1.4h4.211Zm-13.684-1.4h4.562v3.509H2.701Zm5.263 0h3.509v1.4h-.012v.7h.012v1.4H7.964Zm4.21 2.1h4.211v1.4h-4.211Zm9.123 1.4h-4.211v-5.958h4.211Zm-4.211-6.66v-3.86h4.211v3.86Z" />
                    </svg>
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B] block mb-1">{t("forKitchenOwners")}</span>
                      <h3 className="text-lg md:text-xl lg:text-2xl font-bold text-[#1A1A1A] leading-tight">
                        {t("turnDowntimeInto")}{" "}
                        <span className="relative inline-block">
                          <span className="text-[#F51042]">{t("revenueBadge")}</span>
                          <motion.svg
                            className="absolute -bottom-0.5 left-0 w-full"
                            viewBox="0 0 300 12"
                            fill="none"
                            initial={{ pathLength: 0, opacity: 0 }}
                            whileInView={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1, delay: 0.3 }}
                            viewport={{ once: true }}
                          >
                            <motion.path
                              d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8"
                              stroke="#F51042"
                              strokeWidth="3"
                              strokeLinecap="round"
                              initial={{ pathLength: 0 }}
                              whileInView={{ pathLength: 1 }}
                              transition={{ duration: 1, delay: 0.3 }}
                              viewport={{ once: true }}
                            />
                          </motion.svg>
                        </span>
                      </h3>
                    </div>
                  </div>

                  <p className="text-sm text-[#6B6B6B] mb-4 max-w-xl">{t("dontLetKitchenSitEmpty")}</p>

                  {/* Bento Grid - Award-Winning Card Design with Background Icons */}
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-3">
                    {/* Reliable Weekly Revenue Card */}
                    <motion.div
                      className="relative bg-gradient-to-br from-[#4A90A4] to-[#2D6A7A] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Icon icon="mdi:credit-card-outline" className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />

                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">{t("reliableIncome")}</span>
                        <h4 className="text-base font-bold leading-tight mb-2">{t("weeklyRevenue")}</h4>
                        <p className="text-xs text-white/80 leading-relaxed">{t("forgetChasingInvoices")}</p>
                      </div>
                    </motion.div>

                    {/* Zero Risk, Total Compliance Card - Rich Violet (complementary to coral) */}
                    <motion.div
                      className="relative bg-gradient-to-br from-[#7C5295] to-[#5D3D70] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Icon icon="mdi:shield-outline" className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />

                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">{t("zeroRisk")}</span>
                        <h4 className="text-base font-bold leading-tight mb-2">{t("totalCompliance")}</h4>
                        <p className="text-xs text-white/80 leading-relaxed">{t("everyChefVerified")}</p>
                      </div>
                    </motion.div>

                    {/* Intelligent Hourly Management Card */}
                    <motion.div
                      className="relative bg-gradient-to-br from-[#0D9488] to-[#0F766E] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Icon icon="mdi:calendar-month-outline" className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />

                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">{t("automated")}</span>
                        <h4 className="text-base font-bold leading-tight mb-2">{t("bookingManagement")}</h4>
                        <p className="text-xs text-white/80 leading-relaxed">{t("automatedBookingEngine")}</p>
                      </div>
                    </motion.div>

                    {/* Your Kitchen, Your Rules Card */}
                    <motion.div
                      className="relative bg-gradient-to-br from-[#F5A623] to-[#E8940D] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Icon icon="mdi:lightning-bolt" className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />

                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">{t("yourControl")}</span>
                        <h4 className="text-base font-bold leading-tight mb-2">{t("yourRules")}</h4>
                        <p className="text-xs text-white/80 leading-relaxed">{t("maintainSovereignty")}</p>
                      </div>
                    </motion.div>

                    {/* Frictionless Flexibility Card */}
                    <motion.div
                      className="relative bg-gradient-to-br from-[#2D3E50] to-[#1A2530] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Icon icon="mdi:clock-outline" className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />

                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">{t("flexible")}</span>
                        <h4 className="text-base font-bold leading-tight mb-2">{t("frictionlessFlexibility")}</h4>
                        <p className="text-xs text-white/80 leading-relaxed">{t("noLongTermContracts")}</p>
                      </div>
                    </motion.div>
                  </div>
                </div>

                {/* Bottom Lip with Buttons */}
                <div className="bg-[#FAFAFA] border-t border-gray-100 px-4 md:px-6 py-4">
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <p className="text-sm text-[#6B6B6B] hidden sm:block">{t("joinKitchenPartners")}</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        onClick={() => window.location.href = 'https://kitchen.localcooks.ca'}
                        className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold py-3 md:py-4 px-6 rounded-full text-sm transition-all duration-300 group"
                      >{t("becomePartner")}<Icon icon="mdi:arrow-right" className="ml-1.5 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => window.location.href = 'https://kitchen.localcooks.ca'}
                        className="border border-[#2C2C2C]/20 text-[#2C2C2C] hover:border-[#F51042] hover:text-[#F51042] font-semibold py-3 md:py-4 px-6 rounded-full text-sm transition-all duration-300"
                      >{t("learnMore")}</Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </FadeInSection>
          </div>
        </section>

        {/* ══════ BOTTOM WAVE DIVIDER - Primary Red to Light ══════ */}
        <div className="relative w-full overflow-hidden" style={{ height: '120px', marginTop: '-1px' }}>
          <svg
            viewBox="0 0 1440 320"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute top-0 w-full"
            style={{ height: '120px', minWidth: '100%' }}
            preserveAspectRatio="none"
          >
            {/* Inverted wave pattern - solid brand red, no gradient */}
            <path
              fill="#F51042"
              fillOpacity="1"
              d="M0,96L48,106.7C96,117,192,139,288,149.3C384,160,480,160,576,138.7C672,117,768,75,864,64C960,53,1056,75,1152,96C1248,117,1344,139,1392,149.3L1440,160L1440,0L1392,0C1344,0,1248,0,1152,0C1056,0,960,0,864,0C768,0,672,0,576,0C480,0,384,0,288,0C192,0,96,0,48,0L0,0Z"
            />
          </svg>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            TESTIMONIALS CAROUSEL - Thrive Childcare Centers Style
        ═══════════════════════════════════════════════════════════════════════ */}
        <TestimonialCarouselSection />

        {/* ═══════════════════════════════════════════════════════════════════════
            RESOURCES — Preview section linking to full Chef Resources page
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="resources" className="scroll-mt-24 py-20 md:py-28 px-4 bg-gradient-to-b from-gray-50/80 to-white relative overflow-hidden">
          {/* Subtle decorative elements */}
          <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-[0.03]" style={{ background: "radial-gradient(circle, #F51042 0%, transparent 70%)" }} />
          <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full opacity-[0.04]" style={{ background: "radial-gradient(circle, #FFD700 0%, transparent 70%)" }} />

          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-16">
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-tight mb-4"
                >
                  {t("everythingYouNeedTo")}{" "}
                  <span className="relative inline-block">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">{t("getStarted")}</span>
                    <motion.svg
                      className="absolute -bottom-1 md:-bottom-2 left-0 w-full"
                      viewBox="0 0 250 12"
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1.2, delay: 0.6 }}
                      viewport={{ once: true }}
                    >
                      <motion.path
                        d="M2 8C40 4 90 4 125 6C160 8 210 5 248 8"
                        stroke="#F51042"
                        strokeWidth="3"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        transition={{ duration: 1.2, delay: 0.6 }}
                        viewport={{ once: true }}
                      />
                    </motion.svg>
                  </span>
                </motion.h2>
                <p className="text-[#6B6B6B] text-base md:text-lg max-w-2xl mx-auto leading-relaxed">{t("resourceGuideDesc")}</p>
              </div>
            </FadeInSection>

            <FadeInSection delay={1}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
                {[
                  {
                    icon: "mdi:shield-outline",
                    title: t("kbRegulatoryTitle"),
                    description: t("kbRegulatoryDesc"),
                    color: "bg-gray-100 text-gray-700",
                  },
                  {
                    icon: "mdi:certificate-outline",
                    title: t("kbFoodSafetyTitle"),
                    description: t("kbFoodSafetyDesc"),
                    color: "bg-gray-100 text-gray-700",
                  },
                  {
                    icon: "mdi:office-building-outline",
                    title: t("kbBizRegTitle"),
                    description: t("kbBizRegDesc"),
                    color: "bg-gray-100 text-gray-700",
                  },
                  {
                    icon: "mdi:scale-balance",
                    title: t("kbInsuranceTitle"),
                    description: t("kbInsuranceDesc"),
                    color: "bg-gray-100 text-gray-700",
                  },
                ].map((item, i) => (
                  <Card key={i} className="group border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-300 bg-white">
                    <CardContent className="p-6">
                      <div className={`w-10 h-10 rounded-lg ${item.color} flex items-center justify-center mb-4`}>
                        <Icon icon={item.icon} className="h-5 w-5" />
                      </div>
                      <h3 className="font-semibold text-[#2C2C2C] text-sm mb-2">{item.title}</h3>
                      <p className="text-[#6B6B6B] text-xs leading-relaxed">{item.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </FadeInSection>

            <FadeInSection delay={2}>
              <div className="text-center">
                <div className="inline-flex flex-col sm:flex-row items-center gap-4">
                  <Link href="/resources">
                    <Button
                      size="lg"
                      className="bg-[#F51042] hover:bg-[#D90935] text-white font-semibold py-3 md:py-4 px-10 text-base rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    >{t("exploreResourceGuide")}<Icon icon="mdi:arrow-right" className="ml-2 h-5 w-5" />
                    </Button>
                  </Link>
                </div>
              </div>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            FAQ
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="faq" className="scroll-mt-24 py-20 md:py-28 px-4 bg-white">
          <div className="container mx-auto max-w-3xl">
            <FadeInSection>
              <div className="text-center mb-12">
                <h2 className="font-display text-4xl md:text-5xl text-[#F51042]">{t("faq")}</h2>
              </div>
            </FadeInSection>

            <FadeInSection delay={1}>
              <Accordion type="single" collapsible className="space-y-3">
                {[
                  { q: t("chefFaqQ1"), a: t("chefFaqA1") },
                  { q: t("chefFaqQ2"), a: t("chefFaqA2") },
                  { q: t("chefFaqQ3"), a: t("chefFaqA3") },
                  { q: t("chefFaqQ4"), a: t("chefFaqA4") },
                  { q: t("chefFaqQ5"), a: t("chefFaqA5") },
                  { q: t("chefFaqQ6"), a: t("chefFaqA6") },
                  { q: t("chefFaqQ7"), a: t("chefFaqA7") },
                  { q: t("chefFaqQ8"), a: t("chefFaqA8") },
                ].map((item, i) => (
                  <AccordionItem key={i} value={`item-${i}`} className="border border-gray-100 rounded-xl bg-white px-6 shadow-sm">
                    <AccordionTrigger className="text-left text-lg font-semibold text-[#2C2C2C] py-3 md:py-5 hover:no-underline hover:text-[#F51042]">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-[#6B6B6B] pb-5 text-base leading-relaxed">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            FINAL CTA
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="relative py-16 md:py-20 px-4 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#F51042] via-[#E8103A] to-[#D90935]" />
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-10 left-10 w-96 h-96 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-10 w-80 h-80 bg-white rounded-full blur-3xl" />
          </div>

          <div className="container mx-auto max-w-5xl text-center relative z-10">
            <FadeInSection>
              {/* Section Title - Styled like other sections with animated underline */}
              <motion.div
                className="mb-8 md:mb-10"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight"
                >{t("passionToProfit")}<br />
                  <span className="relative inline-block">
                    <span className="text-white/95">{t("onYourTerms")}</span>
                    <motion.svg
                      className="absolute -bottom-1 md:-bottom-2 left-0 w-full"
                      viewBox="0 0 300 12"
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1.2, delay: 0.6 }}
                      viewport={{ once: true }}
                    >
                      <motion.path
                        d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8"
                        stroke="rgba(255,255,255,0.8)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        transition={{ duration: 1.2, delay: 0.6 }}
                        viewport={{ once: true }}
                      />
                    </motion.svg>
                  </span>
                </motion.h2>
              </motion.div>

              {/* Subheading - Single line on desktop */}
              <motion.div
                className="text-base md:text-lg lg:text-xl text-white/90 mb-5 md:mb-6 max-w-4xl mx-auto leading-tight font-medium md:whitespace-nowrap md:overflow-hidden md:text-ellipsis"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <TruncatedText>{t("perfectingCraft")}</TruncatedText>
              </motion.div>

              {/* Brand Statement - Single line on desktop */}
              <motion.div
                className="text-sm md:text-base lg:text-lg text-white/85 mb-6 md:mb-8 max-w-5xl mx-auto leading-tight md:whitespace-nowrap md:overflow-hidden md:text-ellipsis"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <TruncatedText>{t("platformBuiltForChefs")}</TruncatedText>
              </motion.div>

              {/* Three Truths Section - Centered */}
              <motion.div
                className="mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <p className="text-xs md:text-sm text-white/75 mb-4 font-medium tracking-wider uppercase">
                  {t("threeSimpleTruths")}
                </p>
                <div className="flex justify-center items-center">
                  <TypewriterText />
                </div>
              </motion.div>

              {/* CTA Button */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
              >
                <Button
                  onClick={handleGetStarted}
                  size="lg"
                  className="bg-white text-[#F51042] hover:bg-gray-100 font-bold py-3 md:py-4 px-12 text-lg md:text-xl rounded-full shadow-2xl hover:shadow-white/30 hover:-translate-y-1 transition-all"
                >{t("joinLocalCooks")}<Icon icon="mdi:arrow-right" className="ml-3 h-5 w-5 md:h-6 md:w-6" />
                </Button>
                <p className="text-white/70 mt-5 text-xs md:text-sm">{t("approved24hGuarantees")}</p>
              </motion.div>
            </FadeInSection>
          </div>
        </section>
      </main>

      <Footer />
      <SellerJourneyDialog open={sellerJourneyOpen} onOpenChange={setSellerJourneyOpen} />
    </div>
  );
}
