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
import { addCollection, Icon } from "@iconify/react";
import { icons as mdiIcons } from "@iconify-json/mdi";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { KitchenLocationCard } from "@/components/chef-landing/KitchenLocationCard";
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
import logoWhite from "@assets/logo-white.png";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";
import emptyKitchenImage from "@assets/emptykitchen.png";
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

// ═══════════════════════════════════════════════════════════════════════════════
// HOW IT WORKS
// ═══════════════════════════════════════════════════════════════════════════════
// One section for what used to be three ("How it works", "What you get" and the resource
// guide). The two services are shown as two separate paths behind a toggle, never as one
// sequence, because a chef can take either on its own. Every figure in the mockups is
// illustrative sample data, reusing the names the hero and phones already show.
// ═══════════════════════════════════════════════════════════════════════════════

type HowPath = "sell" | "kitchen";

const HOW_STEP_MS = 5200;

const MENU_SAMPLE = [
  {
    name: "Handmade Truffle Tagliatelle",
    price: "$24.00",
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=120&h=120&fit=crop",
  },
  {
    name: "Wood-Fired Margherita",
    price: "$18.00",
    image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=120&h=120&fit=crop",
  },
  {
    name: "Artisan Birria Tacos",
    price: "$16.00",
    image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=120&h=120&fit=crop",
  },
];

/** White app card used by every step mockup. */
function MockCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-[380px] overflow-hidden rounded-[20px] border border-[#2C2C2C]/[0.07] bg-white shadow-[0_1px_2px_rgba(44,44,44,0.05),0_28px_56px_-28px_rgba(44,44,44,0.35)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MockHeader({ title, badge }: { title: string; badge?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#2C2C2C]/[0.06] px-4 py-3">
      <p className="truncate text-[0.82rem] font-semibold text-[#1F1F1F]">{title}</p>
      {badge}
    </div>
  );
}

function MockPill({ tone, icon, children }: { tone: "green" | "red" | "neutral"; icon?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.66rem] font-semibold",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "red" && "bg-[#F51042]/[0.08] text-[#F51042]",
        tone === "neutral" && "bg-[#F4F2F0] text-[#6B6B6B]",
      )}
    >
      {icon && <Icon icon={icon} className="h-3 w-3" />}
      {children}
    </span>
  );
}

/** Rows inside a mockup rise in one after another. */
function MockRow({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.15 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function StepMockup({ path, step }: { path: HowPath; step: number }) {
  const { t, i18n } = useTranslation("chef");

  if (path === "sell" && step === 0) {
    return (
      <MockCard>
        <MockHeader
          title={t("hiwMockApplication")}
          badge={
            <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.75 }}>
              <MockPill tone="green" icon="mdi:check">{t("hiwMockSubmitted")}</MockPill>
            </motion.span>
          }
        />
        <div className="space-y-3.5 p-4">
          <MockRow i={0}>
            <p className="text-[0.66rem] font-medium text-[#8A8A8A]">{t("hiwMockName")}</p>
            <div className="mt-1 flex h-9 items-center justify-between rounded-lg border border-[#2C2C2C]/10 px-3">
              <span className="text-[0.8rem] text-[#1F1F1F]">Jennifer W.</span>
              <Icon icon="mdi:check-circle" className="h-4 w-4 text-emerald-500" />
            </div>
          </MockRow>
          <MockRow i={1}>
            <p className="text-[0.66rem] font-medium text-[#8A8A8A]">{t("hiwMockKitchenSetting")}</p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <span className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#F51042] bg-[#F51042]/[0.05] text-[0.76rem] font-semibold text-[#F51042]">
                <Icon icon="mdi:home-outline" className="h-4 w-4" />
                {t("hiwMockHome")}
              </span>
              <span className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#2C2C2C]/10 text-[0.76rem] text-[#6B6B6B]">
                <Icon icon="mdi:office-building-outline" className="h-4 w-4" />
                {t("hiwMockCommercial")}
              </span>
            </div>
          </MockRow>
          <MockRow i={2} className="flex items-center gap-3 rounded-lg border border-[#2C2C2C]/10 px-3 py-2.5">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Icon icon="mdi:check" className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.8rem] text-[#1F1F1F]">{t("hiwMockLocalCooksQuestions")}</span>
          </MockRow>
        </div>
      </MockCard>
    );
  }

  if (path === "sell" && step === 1) {
    return (
      <MockCard>
        <MockHeader title={t("hiwMockMenu")} badge={<MockPill tone="green" icon="mdi:circle-medium">{t("hiwMockLive")}</MockPill>} />
        <div className="p-2">
          {MENU_SAMPLE.map((dish, i) => (
            <MockRow key={dish.name} i={i} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <img src={dish.image} alt="" className="h-11 w-11 flex-shrink-0 rounded-lg object-cover" loading="lazy" />
              <span className="min-w-0 flex-1 truncate text-[0.8rem] font-medium text-[#1F1F1F]">{dish.name}</span>
              <span className="text-[0.8rem] font-semibold tabular-nums text-[#1F1F1F]">{dish.price}</span>
            </MockRow>
          ))}
          <MockRow i={3} className="px-2 pb-1 pt-1">
            <span className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#F51042]/35 text-[0.76rem] font-semibold text-[#F51042]">
              <Icon icon="mdi:plus" className="h-4 w-4" />
              {t("hiwMockAddDish")}
            </span>
          </MockRow>
        </div>
      </MockCard>
    );
  }

  if (path === "sell" && step === 2) {
    const orders = [
      { amount: "$112.50", id: "#00198", state: "Out for delivery", dot: "bg-[#F51042]" },
      { amount: "$48.00", id: "#00197", state: "Paid", dot: "bg-emerald-500" },
    ];
    return (
      <div className="flex w-full max-w-[380px] flex-col gap-2.5">
        {orders.map((o, i) => (
          <MockRow key={o.id} i={i}>
            <div className="flex items-center gap-3 rounded-2xl border border-[#2C2C2C]/[0.07] bg-white px-3.5 py-3 shadow-[0_18px_36px_-24px_rgba(44,44,44,0.35)]">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#F51042]">
                <img src={logoWhite} alt="" className="h-5 w-5 object-contain" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.66rem] font-medium text-[#8A8A8A]">
                  {t("hiwMockNewOrder")} · <span className="tabular-nums">{o.id}</span>
                </p>
                <p className="text-[0.86rem] font-semibold tabular-nums text-[#1F1F1F]">{o.amount}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-[#6B6B6B]">
                <span className={cn("h-1.5 w-1.5 rounded-full", o.dot)} />
                {o.state}
              </span>
            </div>
          </MockRow>
        ))}
        <MockRow i={2}>
          <div className="rounded-2xl border border-[#2C2C2C]/[0.07] bg-white p-4 shadow-[0_18px_36px_-24px_rgba(44,44,44,0.35)]">
            <div className="flex items-center justify-between">
              <p className="text-[0.7rem] font-medium text-[#8A8A8A]">{t("hiwMockWeeklyPayout")}</p>
              <MockPill tone="green" icon="mdi:bank-outline">
                {new Intl.DateTimeFormat(i18n.resolvedLanguage || "en-CA", { weekday: "short" }).format(new Date(2025, 8, 26))}
              </MockPill>
            </div>
            <p className="mt-1 text-[1.5rem] font-bold leading-none tracking-[-0.02em] tabular-nums text-[#1F1F1F]">$1,036.40</p>
            <div className="mt-3 flex h-10 items-end gap-1.5">
              {[38, 52, 44, 70, 58, 84, 100].map((h, i) => (
                <motion.span
                  key={i}
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ duration: 0.6, delay: 0.5 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className={cn("flex-1 rounded-[3px]", i === 6 ? "bg-[#F51042]" : "bg-[#F51042]/15")}
                />
              ))}
            </div>
          </div>
        </MockRow>
      </div>
    );
  }

  if (path === "kitchen" && step === 0) {
    const kitchens = [
      { name: "Harbour Kitchen Hub", rate: "$24/hr", tags: ["Range", "Oven", "Cold storage"], image: harbourKitchenImage },
      { name: "Downtown Commissary", rate: "$220/day", tags: ["Walk-in", "Mixers", "Dry storage"], image: emptyKitchenImage },
    ];
    return (
      <MockCard>
        <MockHeader title={t("heroMiniNearby")} badge={<MockPill tone="neutral" icon="mdi:map-marker-outline">St. John&apos;s</MockPill>} />
        <div className="p-2">
          {kitchens.map((k, i) => (
            <MockRow key={k.name} i={i} className={cn("flex gap-3 rounded-xl p-2", i === 0 && "bg-[#FAFAF9]")}>
              <img src={k.image} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[0.82rem] font-semibold text-[#1F1F1F]">{k.name}</p>
                  <p className="flex-shrink-0 text-[0.78rem] font-bold tabular-nums text-[#1F1F1F]">{k.rate}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {k.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-[#2C2C2C]/10 bg-white px-2 py-0.5 text-[0.62rem] text-[#6B6B6B]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </MockRow>
          ))}
        </div>
      </MockCard>
    );
  }

  if (path === "kitchen" && step === 1) {
    return (
      <MockCard>
        <MockHeader title={t("hiwMockRequestTo", { kitchen: "Harbour Kitchen Hub" })} />
        <div className="space-y-2 p-4">
          {[t("hiwMockBusinessContact"), t("hiwMockKitchenQuestions")].map((label, i) => (
            <MockRow key={label} i={i} className="flex items-center gap-3 rounded-xl border border-[#2C2C2C]/[0.07] px-3 py-2.5">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Icon icon="mdi:check" className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.8rem] text-[#1F1F1F]">{label}</span>
            </MockRow>
          ))}
          <MockRow i={2} className="pt-2">
            <span className="flex h-10 items-center justify-center gap-2 rounded-full bg-emerald-50 text-[0.8rem] font-semibold text-emerald-700">
              <Icon icon="mdi:send-check-outline" className="h-4 w-4" />
              {t("hiwMockSent")}
            </span>
          </MockRow>
        </div>
      </MockCard>
    );
  }

  // Kitchen, step 3: booking a slot. Dates are drawn from a week in which the 25th is a
  // Thursday, so the day names agree with the "Thu 25 Sep" booking the hero shows.
  const locale = i18n.resolvedLanguage || "en-CA";
  const week = Array.from({ length: 7 }, (_, i) => new Date(2025, 8, 22 + i));
  const dayName = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return (
    <MockCard>
      <MockHeader title={t("hiwMockPickTime")} badge={<MockPill tone="green" icon="mdi:check">{t("hiwMockApproved")}</MockPill>} />
      <div className="p-4">
        <MockRow i={0} className="grid grid-cols-7 gap-1">
          {week.map((d) => {
            const selected = d.getDate() === 25;
            return (
              <span
                key={d.getDate()}
                className={cn(
                  "flex flex-col items-center rounded-xl py-1.5",
                  selected ? "bg-[#F51042] text-white shadow-[0_8px_16px_-8px_rgba(245,16,66,0.8)]" : "text-[#6B6B6B]",
                )}
              >
                <span className={cn("text-[0.58rem] font-medium uppercase", selected ? "text-white/80" : "text-[#9A9A9A]")}>
                  {dayName.format(d).replace(".", "")}
                </span>
                <span className="text-[0.86rem] font-semibold tabular-nums">{d.getDate()}</span>
              </span>
            );
          })}
        </MockRow>
        <div className="mt-3 space-y-2">
          <MockRow i={1} className="flex items-center justify-between rounded-xl border border-[#2C2C2C]/[0.07] px-3 py-2.5 text-[0.78rem] text-[#9A9A9A]">
            <span className="tabular-nums">9:00 AM to 1:00 PM</span>
          </MockRow>
          <MockRow i={2} className="flex items-center justify-between rounded-xl border border-[#F51042] bg-[#F51042]/[0.04] px-3 py-2.5">
            <span className="text-[0.78rem] font-semibold tabular-nums text-[#1F1F1F]">2:00 to 6:00 PM</span>
            <MockPill tone="green" icon="mdi:check">{t("heroMiniBooked")}</MockPill>
          </MockRow>
          <MockRow i={3} className="flex items-center gap-1.5 px-1 pt-1 text-[0.7rem] text-[#8A8A8A]">
            <Icon icon="mdi:map-marker-outline" className="h-3.5 w-3.5" />
            Harbour Kitchen Hub
          </MockRow>
        </div>
      </div>
    </MockCard>
  );
}

function HowItWorksSection({ onVisitMarketplace }: { onVisitMarketplace: () => void }) {
  const { t } = useTranslation("chef");
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const inView = useInView(panelRef, { margin: "-20% 0px -20% 0px" });

  const [path, setPath] = useState<HowPath>("sell");
  const [step, setStep] = useState(0);
  // Auto-advance until the visitor picks a step themselves, then hand over control.
  const [autoplay, setAutoplay] = useState(true);
  const playing = autoplay && inView && !reduceMotion;

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % 3), HOW_STEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, step, path]);

  const paths: Record<HowPath, { label: string; icon: string; steps: { title: string; desc: string }[] }> = {
    sell: {
      label: t("hiwTabSell"),
      icon: "mdi:storefront-outline",
      steps: [
        { title: t("hiwSell1Title"), desc: t("hiwSell1Desc") },
        { title: t("hiwSell2Title"), desc: t("hiwSell2Desc") },
        { title: t("hiwSell3Title"), desc: t("hiwSell3Desc") },
      ],
    },
    kitchen: {
      label: t("hiwTabKitchen"),
      icon: "mdi:silverware-fork-knife",
      steps: [
        { title: t("hiwKitchen1Title"), desc: t("hiwKitchen1Desc") },
        { title: t("hiwKitchen2Title"), desc: t("hiwKitchen2Desc") },
        { title: t("hiwKitchen3Title"), desc: t("hiwKitchen3Desc") },
      ],
    },
  };

  // Switching path starts that path's walkthrough from step 1. Only picking a step by hand
  // stops the timer, because that is the one choice the timer would otherwise undo.
  const choosePath = (next: HowPath) => {
    if (next === path) return;
    setPath(next);
    setStep(0);
    setAutoplay(true);
  };

  const chooseStep = (next: number) => {
    setAutoplay(false);
    setStep(next);
  };

  const guideItems = [
    { icon: "mdi:certificate-outline", title: t("kbFoodSafetyTitle"), desc: t("hiwGuideFoodSafety") },
    { icon: "mdi:office-building-outline", title: t("kbBizRegTitle"), desc: t("hiwGuideBizReg") },
    { icon: "mdi:shield-outline", title: t("kbRegulatoryTitle"), desc: t("hiwGuideRegulatory") },
    { icon: "mdi:file-certificate-outline", title: t("kbInsuranceTitle"), desc: t("hiwGuideLicensing") },
  ];

  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <section id="how-it-works" className="scroll-mt-24 bg-white px-4 py-20 sm:py-24 lg:py-28">
      <div className="mx-auto w-full max-w-6xl">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="mx-auto max-w-2xl text-center">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.7, ease }}
            className="text-[1.9rem] font-bold leading-[1.12] tracking-[-0.025em] text-[#1F1F1F] sm:text-[2.5rem] lg:text-[3rem]"
          >
            {t("hiwTitle")}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.6, delay: 0.12, ease }}
            className="mx-auto mt-5 max-w-[34rem] text-balance text-[1rem] leading-relaxed text-[#5F5F5F] sm:text-[1.1rem]"
          >
            {t("hiwSubhead")}
          </motion.p>
        </div>

        {/* ── Path toggle ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          transition={{ duration: 0.6, delay: 0.2, ease }}
          className="mt-9 flex justify-center sm:mt-10"
        >
          <div role="tablist" aria-label={t("hiwTitle")} className="inline-flex rounded-full bg-[#F4F2F0] p-1 ring-1 ring-inset ring-[#2C2C2C]/[0.04]">
            {(Object.keys(paths) as HowPath[]).map((key) => {
              const active = key === path;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="how-it-works-panel"
                  onClick={() => choosePath(key)}
                  className={cn(
                    "relative inline-flex h-10 items-center gap-2 rounded-full px-4 text-[0.86rem] font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] sm:h-11 sm:px-5 sm:text-[0.92rem]",
                    active ? "text-[#1F1F1F]" : "text-[#7A7A7A] hover:text-[#1F1F1F]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="how-path-pill"
                      className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgba(44,44,44,0.08),0_6px_16px_-6px_rgba(44,44,44,0.2)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon icon={paths[key].icon} className={cn("relative h-4 w-4", active && "text-[#F51042]")} />
                  <span className="relative whitespace-nowrap">{paths[key].label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ── Steps and the live preview ─────────────────────────────────────── */}
        <div
          ref={panelRef}
          id="how-it-works-panel"
          role="tabpanel"
          className="mt-10 grid grid-cols-[minmax(0,1fr)] items-center gap-8 sm:mt-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14"
        >
          <ol className="order-2 flex flex-col gap-1.5 lg:order-1">
            {paths[path].steps.map((s, i) => {
              const active = i === step;
              return (
                <li key={`${path}-${i}`}>
                  <button
                    type="button"
                    onClick={() => chooseStep(i)}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "group relative flex w-full gap-4 overflow-hidden rounded-2xl p-4 text-left transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] sm:p-5",
                      active ? "bg-[#FAFAF9] ring-1 ring-inset ring-[#2C2C2C]/[0.06]" : "hover:bg-[#FAFAF9]/70",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[0.8rem] font-bold tabular-nums transition-colors duration-300",
                        active ? "bg-[#F51042] text-white shadow-[0_6px_14px_-6px_rgba(245,16,66,0.8)]" : "bg-[#F4F2F0] text-[#8A8A8A]",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[1.05rem] font-semibold tracking-[-0.01em] transition-colors duration-300", active ? "text-[#1F1F1F]" : "text-[#6B6B6B]")}>
                        {s.title}
                      </span>
                      <span className={cn("mt-1 block text-pretty text-[0.9rem] leading-relaxed transition-colors duration-300", active ? "text-[#5F5F5F]" : "text-[#9A9A9A]")}>
                        {s.desc}
                      </span>
                    </span>
                    {active && (
                      <span className="absolute inset-x-5 bottom-0 h-[2px] overflow-hidden rounded-full bg-[#2C2C2C]/[0.06]">
                        <motion.span
                          key={`${path}-${step}-${playing}`}
                          className="block h-full origin-left rounded-full bg-[#F51042]"
                          initial={{ scaleX: playing ? 0 : 1 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: playing ? HOW_STEP_MS / 1000 : 0, ease: "linear" }}
                        />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          <div
            aria-hidden="true"
            className="relative order-1 flex h-[340px] items-center justify-center overflow-hidden rounded-[28px] bg-[#F6F5F3] px-5 sm:h-[400px] lg:order-2 lg:h-[440px]"
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(rgba(44,44,44,0.09) 1px, transparent 1px)",
                backgroundSize: "16px 16px",
                maskImage: "radial-gradient(ellipse 75% 70% at 50% 45%, #000 30%, transparent 85%)",
                WebkitMaskImage: "radial-gradient(ellipse 75% 70% at 50% 45%, #000 30%, transparent 85%)",
              }}
            />
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2"
              style={{ background: "radial-gradient(closest-side, rgba(245,16,66,0.10), rgba(245,16,66,0))" }}
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${path}-${step}`}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.4, ease }}
                className="relative flex w-full justify-center"
              >
                <StepMockup path={path} step={step} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ── The two ways to go deeper ──────────────────────────────────────── */}
        <div className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-5 sm:mt-20 md:grid-cols-2">
          <motion.div
            id="resources"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.7, ease }}
            className="flex scroll-mt-24 flex-col rounded-[28px] border border-[#2C2C2C]/[0.07] bg-white p-6 shadow-[0_1px_2px_rgba(44,44,44,0.04),0_24px_48px_-32px_rgba(44,44,44,0.3)] sm:p-8"
          >
            <p className="inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#F51042]">
              <Icon icon="mdi:book-open-page-variant-outline" className="h-4 w-4" />
              {t("hiwGuideEyebrow")}
            </p>
            <h3 className="mt-3 text-balance text-[1.45rem] font-bold leading-tight tracking-[-0.02em] text-[#1F1F1F] sm:text-[1.6rem]">
              {t("hiwGuideTitle")}
            </h3>
            <p className="mt-2 text-pretty text-[0.94rem] leading-relaxed text-[#5F5F5F]">{t("hiwGuideDesc")}</p>

            <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-4 sm:grid-cols-2">
              {guideItems.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#F51042]/[0.07] text-[#F51042]">
                    <Icon icon={item.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.88rem] font-semibold text-[#1F1F1F]">{item.title}</span>
                    <span className="mt-0.5 block text-[0.8rem] leading-snug text-[#7A7A7A]">{item.desc}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-8 pt-1 md:mt-auto md:pt-8">
              <Link
                href="/resources"
                className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#F51042] px-6 text-[0.92rem] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_22px_-10px_rgba(245,16,66,0.8)] transition-colors duration-300 hover:bg-[#E30D3C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2 sm:w-auto"
              >
                {t("hiwGuideCta")}
                <Icon icon="mdi:arrow-right" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.7, delay: 0.1, ease }}
            className="relative flex flex-col overflow-hidden rounded-[28px] bg-[#F51042] p-6 text-white shadow-[0_24px_48px_-28px_rgba(245,16,66,0.7)] sm:p-8"
          >
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(80% 70% at 0% 0%, rgba(255,255,255,0.22), rgba(255,255,255,0) 60%), radial-gradient(70% 60% at 100% 100%, rgba(150,0,30,0.45), rgba(150,0,30,0) 70%)",
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
                  backgroundSize: "40px 40px",
                  maskImage: "linear-gradient(to bottom, #000, transparent 75%)",
                  WebkitMaskImage: "linear-gradient(to bottom, #000, transparent 75%)",
                }}
              />
            </div>

            <div className="relative">
              <p className="inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/90">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                {t("hiwMarketEyebrow")}
              </p>
              <h3 className="mt-3 text-balance text-[1.45rem] font-bold leading-tight tracking-[-0.02em] sm:text-[1.6rem]">
                {t("hiwMarketTitle")}
              </h3>
              <p className="mt-2 max-w-[26rem] text-pretty text-[0.94rem] leading-relaxed text-white/85">{t("hiwMarketDesc")}</p>
            </div>

            {/* A glimpse of the marketplace: three dishes fanned out. */}
            <div aria-hidden="true" className="relative mx-auto mt-8 flex h-[150px] w-full max-w-[340px] items-end justify-center">
              {MENU_SAMPLE.map((dish, i) => (
                <div
                  key={dish.name}
                  className={cn(
                    "absolute bottom-0 w-[132px] overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_18px_36px_-16px_rgba(80,0,20,0.6)] transition-transform duration-500",
                    i === 0 && "left-[4%] -rotate-[8deg]",
                    i === 1 && "z-10 -translate-y-3",
                    i === 2 && "right-[4%] rotate-[8deg]",
                  )}
                >
                  <img src={dish.image} alt="" className="h-[84px] w-full rounded-xl object-cover" loading="lazy" />
                  <div className="px-1.5 pb-1 pt-1.5">
                    <p className="truncate text-[0.68rem] font-semibold text-[#1F1F1F]">{dish.name}</p>
                    <p className="text-[0.66rem] font-semibold tabular-nums text-[#F51042]">{dish.price}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="relative mt-8 md:mt-auto md:pt-8">
              <button
                type="button"
                onClick={onVisitMarketplace}
                className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-6 text-[0.92rem] font-semibold text-[#F51042] shadow-[0_10px_22px_-10px_rgba(80,0,20,0.6)] transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#F51042] sm:w-auto"
              >
                {t("hiwMarketCta")}
                <Icon icon="mdi:arrow-top-right" className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF AND CLOSE
// ═══════════════════════════════════════════════════════════════════════════════
// The chefs' words and the invitation to join, as one card: a slow, endless row of
// reviews on top, the ask on a red band beneath it. The row is the same four reviews
// twice over, so the loop has no seam; it pauses under the pointer so a quote can be read.
// ═══════════════════════════════════════════════════════════════════════════════

function ReviewCard({ text, name, business }: { text: string; name: string; business: string }) {
  return (
    <figure className="flex h-full w-[290px] flex-col rounded-[24px] border border-[#2C2C2C]/[0.09] bg-white p-6 shadow-[0_1px_2px_rgba(44,44,44,0.06),0_14px_30px_-14px_rgba(60,40,30,0.28)] sm:w-[380px] sm:p-7">
      <svg viewBox="0 0 48 36" className="h-5 w-7 flex-shrink-0" aria-hidden="true">
        <path
          fill="#F51042"
          d="M0 36V22.4C0 9.9 6.2 2.5 18.6 0l2 4.5C13.8 6.6 10.4 10.7 10 17h9.6v19H0Zm27.4 0V22.4C27.4 9.9 33.6 2.5 46 0l2 4.5c-6.8 2.1-10.2 6.2-10.6 12.5H47v19H27.4Z"
        />
      </svg>
      <blockquote className="mb-6 mt-4 text-pretty text-[0.95rem] leading-[1.65] text-[#2F2F2F] sm:text-[1rem]">{text}</blockquote>
      <figcaption className="mt-auto flex items-center gap-2 border-t border-[#2C2C2C]/[0.06] pt-4 text-[0.88rem]">
        <span className="font-semibold text-[#1F1F1F]">{name}</span>
        <span className="text-[#C4C4C4]" aria-hidden="true">·</span>
        <span className="truncate font-medium text-[#F51042]">{business}</span>
      </figcaption>
    </figure>
  );
}

function ChefProofSection({ onJoin }: { onJoin: () => void }) {
  const { t } = useTranslation("chef");

  const testimonials = [
    { text: t("testimonialDafna"), name: "Dafna", business: "Sababa Cafe NL" },
    { text: t("testimonialEmily"), name: "Emily", business: "The Waffle Lady" },
    { text: t("testimonialKanij"), name: "Kanij", business: "Misti Mountain" },
    { text: t("testimonialFardin"), name: "Fardin", business: "Alu Bhaja" },
  ];

  const guarantees = t("approved24hGuarantees")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const craftSentences = t("perfectingCraft").split(/(?<=[.!?])\s+/);

  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <section id="testimonials" className="scroll-mt-24 bg-white px-4 py-20 sm:py-24 lg:py-28">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.7, ease }}
            className="text-balance text-[1.9rem] font-bold leading-[1.15] tracking-[-0.025em] text-[#1F1F1F] sm:text-[2.5rem] lg:text-[3rem]"
          >
            {t("tstTitleStart")}{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span className="relative z-10 bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A] bg-clip-text text-transparent">
                {t("tstTitleEmphasis")}
              </span>
              <svg className="absolute -bottom-1.5 left-0 w-full md:-bottom-2" viewBox="0 0 300 12" fill="none" aria-hidden="true">
                <motion.path
                  d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8"
                  stroke="#F51042"
                  strokeOpacity="0.6"
                  strokeWidth="3"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  whileInView={{ pathLength: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, delay: 0.5, ease: [0.65, 0, 0.35, 1] }}
                />
              </svg>
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.6, delay: 0.12, ease }}
            className="mt-5 text-balance text-[1rem] leading-relaxed text-[#5F5F5F] sm:text-[1.1rem]"
          >
            {t("tstSubhead")}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          transition={{ duration: 0.8, delay: 0.15, ease }}
          className="relative mt-12 overflow-hidden rounded-[32px] border border-[#2C2C2C]/[0.07] bg-[#F3EFEA] shadow-[0_1px_2px_rgba(44,44,44,0.04),0_40px_80px_-40px_rgba(44,44,44,0.35)] sm:mt-14"
        >
          {/* ── Reviews ───────────────────────────────────────────────────── */}
          <div className="relative py-10 sm:py-12">
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
              style={{
                backgroundImage: "radial-gradient(rgba(44,44,44,0.07) 1px, transparent 1px)",
                backgroundSize: "18px 18px",
                maskImage: "radial-gradient(ellipse 70% 80% at 50% 50%, #000 20%, transparent 80%)",
                WebkitMaskImage: "radial-gradient(ellipse 70% 80% at 50% 50%, #000 20%, transparent 80%)",
              }}
            />
            <div
              className="chef-marquee-viewport relative overflow-hidden"
              style={{
                maskImage: "linear-gradient(to right, transparent, #000 7%, #000 93%, transparent)",
                WebkitMaskImage: "linear-gradient(to right, transparent, #000 7%, #000 93%, transparent)",
              }}
            >
              <ul className="chef-marquee flex w-max">
                {[0, 1].map((copy) =>
                  testimonials.map((q) => (
                    <li key={`${copy}-${q.name}`} aria-hidden={copy === 1} className="pr-5">
                      <ReviewCard {...q} />
                    </li>
                  )),
                )}
              </ul>
            </div>
          </div>

          {/* ── The ask ───────────────────────────────────────────────────── */}
          <div className="relative overflow-hidden bg-[#F51042] px-6 py-10 sm:px-12 sm:py-12 lg:px-14">
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(60% 120% at 0% 0%, rgba(255,255,255,0.2), rgba(255,255,255,0) 60%), radial-gradient(50% 120% at 100% 100%, rgba(150,0,30,0.4), rgba(150,0,30,0) 70%)",
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
                  backgroundSize: "48px 48px",
                  maskImage: "linear-gradient(to right, #000, transparent 70%)",
                  WebkitMaskImage: "linear-gradient(to right, #000, transparent 70%)",
                }}
              />
            </div>

            <div className="relative flex flex-col items-center gap-8 text-center lg:flex-row lg:items-center lg:justify-between lg:gap-12 lg:text-left">
              <div>
                <h3 className="text-[1.7rem] font-bold leading-[1.1] tracking-[-0.025em] text-white sm:text-[2.1rem] lg:text-[2.35rem]">
                  <span className="block">{t("passionToProfit")}</span>
                  <span className="block text-white/75">{t("onYourTerms")}</span>
                </h3>
                <p className="mt-4 text-[0.98rem] leading-relaxed text-white/85 sm:text-[1.05rem]">
                  {craftSentences.map((sentence, i) => (
                    <span key={i} className="block">
                      {sentence}
                    </span>
                  ))}
                </p>
              </div>

              <button
                type="button"
                onClick={onJoin}
                className="group inline-flex h-12 flex-shrink-0 items-center justify-center gap-2 rounded-full bg-white px-8 text-[1rem] font-semibold text-[#F51042] shadow-[0_16px_32px_-14px_rgba(80,0,20,0.7)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-14px_rgba(80,0,20,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#F51042] sm:h-14 sm:px-10 sm:text-[1.05rem]"
              >
                {t("joinLocalCooks")}
                <Icon icon="mdi:arrow-right" className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5" />
              </button>
            </div>

            {/* The three promises get their own row, aligned to the headline, rather than
                hanging off the button where they never lined up with anything. */}
            <div className="relative mt-8 border-t border-white/20 pt-6">
            <ul className="mx-auto flex w-fit flex-col items-start gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-8 lg:justify-start">
              {guarantees.map((item) => (
                <li key={item} className="inline-flex items-center gap-2 text-[0.88rem] font-medium text-white/90">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
                    <Icon icon="mdi:check" className="h-3.5 w-3.5 text-white" aria-hidden />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
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
            KITCHEN ACCESS
            The second half of the offer, straight after the selling story: a full-bleed brand
            band so the page has a strong beat between two white sections. Its edges are single
            shallow arcs rather than waves, and the texture is a white grid and two soft lights.
            The arcs are white cut-outs drawn inside the section, so the lights fade out beneath
            them instead of being clipped into straight edges at a section boundary.
            The cards show one published kitchen per location, the first three.
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="kitchen-access" className="relative scroll-mt-24 overflow-hidden bg-[#F51042] px-4 pb-28 pt-20 sm:pb-36 sm:pt-28 lg:pb-44 lg:pt-32">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <motion.div
              className="absolute left-[-18%] top-[4%] h-[520px] w-[520px] rounded-full md:h-[720px] md:w-[720px]"
              style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.16), rgba(255,255,255,0))" }}
              animate={{ x: [0, 40, 0], y: [0, 24, 0] }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute bottom-[6%] right-[-16%] h-[520px] w-[520px] rounded-full md:h-[720px] md:w-[720px]"
              style={{ background: "radial-gradient(closest-side, rgba(170,0,35,0.22), rgba(170,0,35,0))" }}
              animate={{ x: [0, -32, 0], y: [0, -20, 0] }}
              transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
            />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.09) 1px, transparent 1px)",
                backgroundSize: "64px 64px",
                backgroundPosition: "center top",
                maskImage: "radial-gradient(ellipse 70% 60% at 50% 20%, #000 20%, transparent 80%)",
                WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 20%, #000 20%, transparent 80%)",
              }}
            />
            <svg
              viewBox="0 0 1440 80"
              preserveAspectRatio="none"
              className="absolute inset-x-0 -top-px h-10 w-full sm:h-16 lg:h-20"
            >
              <path d="M0 0 H1440 V80 Q720 -40 0 80 Z" fill="#FFFFFF" />
            </svg>
            <svg
              viewBox="0 0 1440 80"
              preserveAspectRatio="none"
              className="absolute inset-x-0 -bottom-px h-10 w-full sm:h-16 lg:h-20"
            >
              <path d="M0 80 H1440 V0 Q720 120 0 0 Z" fill="#FFFFFF" />
            </svg>
          </div>

          <div className="relative z-10 mx-auto w-full max-w-6xl">
            <div className="mx-auto mb-10 max-w-3xl text-center sm:mb-12 lg:mb-14">
              <motion.h2
                className="text-balance text-[1.9rem] font-bold leading-[1.12] tracking-[-0.025em] text-white sm:text-[2.5rem] lg:text-[3rem]"
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "0px 0px -10% 0px" }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                {t("noKitchen")}{" "}
                <span className="relative inline-block whitespace-nowrap">
                  <span className="relative z-10">{t("noProblem")}</span>
                  <svg className="absolute -bottom-1.5 left-0 w-full md:-bottom-2" viewBox="0 0 300 12" fill="none" aria-hidden="true">
                    <motion.path
                      d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8"
                      stroke="rgba(255,255,255,0.7)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 0.5, ease: [0.65, 0, 0.35, 1] }}
                    />
                  </svg>
                </span>
              </motion.h2>

              <motion.p
                className="mx-auto mt-6 max-w-[38rem] text-pretty text-[1rem] leading-relaxed text-white/85 sm:text-[1.1rem]"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "0px 0px -10% 0px" }}
                transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              >
                {t("accessCommercialKitchens")}
              </motion.p>
            </div>

            {/* Cards: a swipeable row that peeks the next card on phones and tablets, three
                columns from `lg`. The row bleeds to the screen edge so the peek reads as more. */}
            {kitchensLoading || uniqueLocations.length > 0 ? (
              <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-6 pt-1 scrollbar-none sm:gap-5 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0">
                {kitchensLoading
                  ? [0, 1, 2].map((i) => (
                      <div
                        key={i}
                        aria-hidden="true"
                        className="w-[84%] flex-shrink-0 snap-start rounded-[26px] bg-white/95 p-2 sm:w-[46%] lg:w-auto"
                      >
                        <div className="aspect-[16/11] animate-pulse rounded-[20px] bg-[#F1EEEC]" />
                        <div className="space-y-2.5 px-3 pb-3 pt-4 sm:px-4">
                          <div className="h-4 w-2/3 animate-pulse rounded bg-[#F1EEEC]" />
                          <div className="h-3 w-5/6 animate-pulse rounded bg-[#F1EEEC]" />
                          <div className="h-3 w-1/2 animate-pulse rounded bg-[#F1EEEC]" />
                          <div className="!mt-5 h-11 animate-pulse rounded-full bg-[#F1EEEC]" />
                        </div>
                      </div>
                    ))
                  : uniqueLocations.slice(0, 3).map((loc: any, i: number) => (
                      <div key={loc.id} className="w-[84%] flex-shrink-0 snap-start sm:w-[46%] lg:w-auto">
                        <KitchenLocationCard location={loc} navigate={navigate} index={i} />
                      </div>
                    ))}
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="mx-auto max-w-md rounded-[26px] border border-white/25 bg-white/[0.12] px-8 py-10 text-center backdrop-blur-md"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20">
                  <Icon icon="mdi:office-building-outline" className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white">{t("partnerKitchensComingSoon")}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/80">{t("onboardingKitchens")}</p>
              </motion.div>
            )}

            {!kitchensLoading && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="mt-6 flex justify-center sm:mt-8 lg:mt-12"
              >
                <button
                  type="button"
                  onClick={handleBrowseKitchens}
                  className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-[0.95rem] font-semibold text-[#F51042] shadow-[0_14px_30px_-12px_rgba(80,0,20,0.6)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-12px_rgba(80,0,20,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#F51042]"
                >
                  {t("browseAllKitchens")}
                  <Icon icon="mdi:arrow-right" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </button>
              </motion.div>
            )}
          </div>
        </section>

        <HowItWorksSection onVisitMarketplace={() => window.open("https://localcook.shop/", "_blank")} />

        <ChefProofSection onJoin={handleGetStarted} />

        {/* ═══════════════════════════════════════════════════════════════════════
            FOR KITCHEN OWNERS
            One quiet line for a manager who lands on the chef page. It sits late, just before
            the FAQ, so it never interrupts the chef story, and it hands off to the kitchen site.
        ═══════════════════════════════════════════════════════════════════════ */}
        <section aria-labelledby="kitchen-owners-heading" className="px-4 pt-4 sm:pt-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto max-w-5xl overflow-hidden rounded-[24px] border border-[#F51042]/[0.12] bg-gradient-to-r from-[#FFF4F6] via-white to-[#FFF4F6] p-5 shadow-[0_16px_40px_-28px_rgba(245,16,66,0.45)] sm:p-6"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full"
              style={{ background: "radial-gradient(closest-side, rgba(245,16,66,0.12), rgba(245,16,66,0))" }}
            />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#F51042] shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_10px_20px_-10px_rgba(245,16,66,0.8)]">
                <Icon icon="mdi:storefront-outline" className="h-6 w-6 text-white" aria-hidden />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[#F51042]">
                  {t("forKitchenOwners")}
                </p>
                <h2
                  id="kitchen-owners-heading"
                  className="mt-1 text-balance text-[1.15rem] font-bold leading-snug tracking-[-0.015em] text-[#1F1F1F] sm:text-[1.25rem]"
                >
                  {t("turnDowntimeInto")} {t("revenueBadge")}
                </h2>
                <p className="mt-1 text-pretty text-[0.9rem] leading-relaxed text-[#5F5F5F]">
                  {t("dontLetKitchenSitEmpty")}
                </p>
              </div>

              <a
                href="https://kitchen.localcooks.ca"
                className="group inline-flex h-11 flex-shrink-0 items-center justify-center gap-2 rounded-full bg-[#F51042] px-6 text-[0.9rem] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_22px_-10px_rgba(245,16,66,0.8)] transition-colors duration-300 hover:bg-[#E30D3C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2"
              >
                {t("becomePartner")}
                <Icon icon="mdi:arrow-right" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </a>
            </div>
          </motion.div>
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
      </main>

      <Footer />
      <SellerJourneyDialog open={sellerJourneyOpen} onOpenChange={setSellerJourneyOpen} />
    </div>
  );
}
