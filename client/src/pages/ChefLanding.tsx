import { logger } from "@/lib/logger";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";
import { useFirebaseAuth } from "@/hooks/use-auth";
import CustomerSupportButton from "@/components/CustomerSupportButton";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
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
import { motion, AnimatePresence, useScroll, useTransform, MotionValue } from "framer-motion";
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
// ELEGANT SCROLL-LINKED PARALLAX SYSTEM (Inspired by donedrinks.com)
// ═══════════════════════════════════════════════════════════════════════════════
// Premium, sophisticated parallax with:
// - Clean vertical movement only (no rotation during scroll)
// - Carefully positioned icons that never overlap
// - Depth through size, opacity, and movement speed
// - Elegant, refined motion that feels premium
// ═══════════════════════════════════════════════════════════════════════════════

interface ParallaxIconProps {
  iconKey: string;
  // Position in viewport (percentage)
  position: { x: number; y: number };
  // Size in pixels - base size before depth scaling
  size: number;
  // Depth layer: 1=front (large, fast), 2=mid, 3=back (small, slow)
  depth: 1 | 2 | 3;
  // Static rotation in degrees (doesn't change during scroll)
  rotation: number;
  // Parallax scroll multiplier (higher = more movement)
  parallaxY: number;
  // Custom z-index override
  zIndex?: number;
  // Hide on certain breakpoints
  hideOn?: 'mobile' | 'tablet' | 'desktop';
  // Scroll progress from parent
  scrollYProgress: MotionValue<number>;
}

function ParallaxIcon({
  iconKey,
  position,
  size,
  depth,
  rotation,
  parallaxY,
  zIndex: customZIndex,
  hideOn,
  scrollYProgress,
}: ParallaxIconProps) {
  // Depth-based styling for visual hierarchy
  const depthConfig = {
    1: { opacity: 1, scale: 1, blur: 0, baseZ: 30, shadow: '0 20px 40px -8px rgba(0, 0, 0, 0.25)' },
    2: { opacity: 0.95, scale: 1, blur: 0, baseZ: 20, shadow: '0 16px 32px -6px rgba(0, 0, 0, 0.20)' },
    3: { opacity: 0.85, scale: 1, blur: 0, baseZ: 10, shadow: '0 12px 24px -4px rgba(0, 0, 0, 0.15)' },
  };

  const config = depthConfig[depth];
  const finalZ = customZIndex ?? config.baseZ;

  // Transform scroll progress to smooth vertical parallax movement
  // Elegant up/down movement like Done Drinks - no rotation
  const y = useTransform(scrollYProgress, [0, 1], [parallaxY, -parallaxY]);

  // Subtle scale breathing effect for depth
  const scale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [0.95, 1.02, 0.98]
  );

  // Hide breakpoint classes
  const hideClass = hideOn === 'mobile' ? 'hidden sm:block' :
    hideOn === 'tablet' ? 'block md:hidden lg:block' :
      hideOn === 'desktop' ? 'lg:hidden' : '';

  return (
    <motion.div
      className={`absolute pointer-events-none ${hideClass}`}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        y,
        scale,
        rotate: rotation, // Static rotation - elegant and stable
        zIndex: finalZ,
        opacity: config.opacity,
        filter: config.blur > 0 ? `blur(${config.blur}px)` : undefined,
        willChange: 'transform',
      }}
      initial={{ opacity: 0, scale: 0.7, y: 30 }}
      whileInView={{ opacity: config.opacity, scale: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
      viewport={{ once: true, margin: "-5%" }}
    >
      <div
        className="rounded-[22%] overflow-hidden flex items-center justify-center"
        style={{
          width: size,
          height: size,
          boxShadow: config.shadow,
          background: APP_ICONS[iconKey]?.bg || '#fff',
          transform: 'translateZ(0)',
        }}
      >
        {APP_ICONS[iconKey]?.imgSrc ? (
          <img src={APP_ICONS[iconKey].imgSrc} alt={iconKey} className={APP_ICONS[iconKey].imgClass || "w-full h-full object-cover"} />
        ) : (
          <Icon icon={APP_ICONS[iconKey]?.icon || 'mdi:help'} className="h-full w-full p-[18%]" style={{ color: APP_ICONS[iconKey]?.color || '#252832' }} aria-hidden />
        )}
      </div>
    </motion.div>
  );
}

// Main container component that provides scroll context to all icons
// ELEGANT PARALLAX: Like donedrinks.com - smooth vertical movement, no rotation
function ScrollLinkedChaosIcons() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Track scroll progress of the entire chaos section
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"], // Track from when section enters to when it exits
  });

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-visible -m-2.5 sm:-m-10 p-2.5 sm:p-10"
      aria-hidden="true"
    >
      {/* ═══════════════════════════════════════════════════════════════════════
          DESKTOP LAYOUT - Asymmetric "controlled chaos" placement
          Left side: varied x positions to break the circular pattern
          Right side: already good asymmetry
          ═══════════════════════════════════════════════════════════════════════ */}

      {/* Instagram - Top left, near edge */}
      <ParallaxIcon
        iconKey="instagram"
        position={{ x: 5, y: 2 }}
        size={82}
        depth={1}
        rotation={-12}
        parallaxY={170}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* WhatsApp - Upper right, but lower than Instagram */}
      <ParallaxIcon
        iconKey="whatsapp"
        position={{ x: 83, y: 18 }}
        size={78}
        depth={1}
        rotation={8}
        parallaxY={155}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* Messenger - Left side, PULLED INWARD toward title */}
      <ParallaxIcon
        iconKey="messenger"
        position={{ x: 14, y: 32 }}
        size={68}
        depth={2}
        rotation={6}
        parallaxY={125}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* Gmail - Right side, middle-ish, pulled more inward */}
      <ParallaxIcon
        iconKey="gmail"
        position={{ x: 78, y: 52 }}
        size={72}
        depth={2}
        rotation={-5}
        parallaxY={135}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* Marketplace - Left side, KEPT OUTWARD for contrast */}
      <ParallaxIcon
        iconKey="marketplace"
        position={{ x: 2, y: 55 }}
        size={65}
        depth={2}
        rotation={-8}
        parallaxY={105}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* iOS Messages - Right side, higher than Gmail, different x */}
      <ParallaxIcon
        iconKey="iosMessages"
        position={{ x: 85, y: 72 }}
        size={60}
        depth={2}
        rotation={10}
        parallaxY={115}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* Truck - Bottom left, PULLED INWARD to break symmetry */}
      <ParallaxIcon
        iconKey="truck"
        position={{ x: 16, y: 78 }}
        size={58}
        depth={3}
        rotation={-4}
        parallaxY={65}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* Interac - Bottom right, asymmetric to Truck */}
      <ParallaxIcon
        iconKey="interac"
        position={{ x: 75, y: 92 }}
        size={54}
        depth={3}
        rotation={5}
        parallaxY={55}
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* ═══════════════════════════════════════════════════════════════════════
          MOBILE LAYOUT - Properly positioned icons that stay within bounds
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="sm:hidden">
        {/* Instagram - Top left, safely positioned */}
        <ParallaxIcon
          iconKey="instagram"
          position={{ x: 5, y: 8 }}
          size={36}
          depth={1}
          rotation={-10}
          parallaxY={60}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
        {/* WhatsApp - Top right, moved closer to edge */}
        <ParallaxIcon
          iconKey="whatsapp"
          position={{ x: 82, y: 12 }}
          size={34}
          depth={1}
          rotation={7}
          parallaxY={55}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
        {/* Messenger - Left side, moved closer to edge */}
        <ParallaxIcon
          iconKey="messenger"
          position={{ x: 3, y: 45 }}
          size={32}
          depth={2}
          rotation={5}
          parallaxY={45}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
        {/* Gmail - Right side, moved up and closer to edge */}
        <ParallaxIcon
          iconKey="gmail"
          position={{ x: 84, y: 42 }}
          size={30}
          depth={2}
          rotation={-6}
          parallaxY={40}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
        {/* Marketplace - Bottom left, moved closer to edge */}
        <ParallaxIcon
          iconKey="marketplace"
          position={{ x: 4, y: 75 }}
          size={28}
          depth={3}
          rotation={-7}
          parallaxY={30}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
        {/* iOS Messages - Bottom right, safely positioned */}
        <ParallaxIcon
          iconKey="iosMessages"
          position={{ x: 70, y: 80 }}
          size={26}
          depth={3}
          rotation={8}
          parallaxY={25}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
        {/* Truck - Bottom left area, added back */}
        <ParallaxIcon
          iconKey="truck"
          position={{ x: 12, y: 85 }}
          size={24}
          depth={3}
          rotation={-4}
          parallaxY={20}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
        {/* Interac - Bottom right, made more visible */}
        <ParallaxIcon
          iconKey="interac"
          position={{ x: 75, y: 90 }}
          size={28}
          depth={2}
          rotation={5}
          parallaxY={15}
          scrollYProgress={scrollYProgress}
          zIndex={5}
        />
      </div>
    </div>
  );
}

// Notification data for infinite feed
const chaosNotifications = [
  { id: 1, app: "Instagram", gradient: "from-[#833AB4] via-[#FD1D1D] to-[#F77737]", sender: "sarah_foodie", message: "Can I order 3 biryanis for tomo...", time: "now", iconType: "instagram" },
  { id: 2, app: "WhatsApp", gradient: "from-[#25D366] to-[#128C7E]", sender: "Mike Chen", message: "Did you get my e-transfer??", time: "now", iconType: "whatsapp" },
  { id: 3, app: "Phone", gradient: "from-[#34C759] to-[#30D158]", sender: "Missed Call", message: "+1 (709) 555-0142", time: "2m", iconType: "phone" },
  { id: 4, app: "Marketplace", gradient: "from-[#1877F2] to-[#0866FF]", sender: "FB Marketplace", message: "New inquiry: Is this still availabl...", time: "3m", iconType: "marketplace" },
  { id: 5, app: "WhatsApp", gradient: "from-[#25D366] to-[#128C7E]", sender: "Jennifer W", message: "Can you deliver to Mount Pearl?", time: "5m", iconType: "whatsapp" },
  { id: 6, app: "Interac", gradient: "from-[#FFB800] to-[#FF8C00]", sender: "INTERAC e-Transfer", message: "Pending: Accept $45.00 from...", time: "8m", iconType: "interac" },
  { id: 7, app: "Messenger", gradient: "from-[#00B2FF] to-[#006AFF]", sender: "David K", message: "What time can I pick up order?", time: "12m", iconType: "messenger" },
  { id: 8, app: "Instagram", gradient: "from-[#833AB4] via-[#FD1D1D] to-[#F77737]", sender: "foodie_lover", message: "Do you have any specials today?", time: "15m", iconType: "instagram" },
];

const localCooksNotifications = [
  { id: 1, amount: "$112.50", order: "#00198", type: "Delivery", headline: "Cha-ching!", subtext: "New order from Downtown" },
  { id: 2, amount: "$42.88", order: "#00197", type: "Pickup", headline: "Repeat customer!", subtext: "Mike ordered Butter Chicken again" },
  { id: 3, amount: "$78.33", order: "#00196", type: "Pickup", headline: "Pre-order confirmed", subtext: "Ready for pickup tomorrow 6PM" },
  { id: 4, amount: "$31.29", order: "#00195", type: "Delivery", headline: "$10 tip received!", subtext: "Thanks for the amazing food" },
  { id: 5, amount: "", order: "#00193", type: "Review", headline: "5★ review posted!", subtext: '"Best homemade biryani ever!"' },
  { id: 6, amount: "$54.25", order: "#00192", type: "Pickup", headline: "20 orders this week!", subtext: "You're trending in your area" },
  { id: 7, amount: "$123.75", order: "#00191", type: "Express", headline: "Express order!", subtext: "VIP customer — 30 min prep" },
];

// Chaos Notification Feed Component
function ChaosNotificationFeed() {
  const { t } = useTranslation("chef");
  const chaosNotifications = [
    { id: 1, app: "Instagram", gradient: "from-[#833AB4] via-[#FD1D1D] to-[#F77737]", sender: "sarah_foodie", message: t("notifSarahMsg"), time: t("timeNow"), iconType: "instagram" },
    { id: 2, app: "WhatsApp", gradient: "from-[#25D366] to-[#128C7E]", sender: "Mike Chen", message: t("notifMikeMsg"), time: t("timeNow"), iconType: "whatsapp" },
    { id: 3, app: "Phone", gradient: "from-[#34C759] to-[#30D158]", sender: t("notifMissedCall"), message: "+1 (709) 555-0142", time: "2m", iconType: "phone" },
    { id: 4, app: "Marketplace", gradient: "from-[#1877F2] to-[#0866FF]", sender: "FB Marketplace", message: t("notifMarketplaceMsg"), time: "3m", iconType: "marketplace" },
    { id: 5, app: "WhatsApp", gradient: "from-[#25D366] to-[#128C7E]", sender: "Jennifer W", message: t("notifJenniferMsg"), time: "5m", iconType: "whatsapp" },
    { id: 6, app: "Interac", gradient: "from-[#FFB800] to-[#FF8C00]", sender: "INTERAC e-Transfer", message: t("notifInteracMsg"), time: "8m", iconType: "interac" },
    { id: 7, app: "Messenger", gradient: "from-[#00B2FF] to-[#006AFF]", sender: "David K", message: t("notifDavidMsg"), time: "12m", iconType: "messenger" },
    { id: 8, app: "Instagram", gradient: "from-[#833AB4] via-[#FD1D1D] to-[#F77737]", sender: "foodie_lover", message: t("notifFoodieMsg"), time: "15m", iconType: "instagram" },
  ];
  const [visibleNotifs, setVisibleNotifs] = useState<Array<{ uid: number; data: typeof chaosNotifications[0] }>>([]);
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    // Initialize with first few notifications
    const initial = chaosNotifications.slice(0, 4).map((n, i) => ({ uid: i, data: n }));
    setVisibleNotifs(initial);
    setCounter(4);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleNotifs(prev => {
        // Add new notification at top
        const newNotif = {
          uid: counter,
          data: chaosNotifications[counter % chaosNotifications.length]
        };
        setCounter(c => c + 1);

        // Keep max 5 visible, remove from bottom
        const updated = [newNotif, ...prev].slice(0, 5);
        return updated;
      });
    }, 1800); // New notification every 1.8 seconds

    return () => clearInterval(interval);
  }, [counter]);

  const getIcon = (iconType: string) => {
    switch (iconType) {
      case 'instagram':
        return <Icon icon="mdi:instagram" className="h-4 w-4 text-white" aria-hidden />;
      case 'whatsapp':
        return <Icon icon="mdi:whatsapp" className="h-4 w-4 text-white" aria-hidden />;
      case 'phone':
        return <Icon icon="mdi:phone-outline" className="w-4 h-4 text-white" />;
      case 'marketplace':
        return <Icon icon="mdi:facebook" className="h-4 w-4 text-white" aria-hidden />;
      case 'interac':
        return <Icon icon="mdi:credit-card-outline" className="w-4 h-4 text-white" />;
      case 'messenger':
        return <Icon icon="mdi:facebook-messenger" className="h-4 w-4 text-white" aria-hidden />;
      default:
        return <Icon icon="mdi:phone-outline" className="w-4 h-4 text-white" />;
    }
  };

  return (
    <div className="absolute top-8 left-2 right-2 h-[340px] md:h-[380px] overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        {visibleNotifs.map((notif) => (
          <motion.div
            key={notif.uid}
            layout
            initial={{ opacity: 0, y: -50, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
            transition={{
              type: "spring",
              stiffness: 500,
              damping: 30,
              mass: 1
            }}
            className="mb-1.5"
          >
            <div className="bg-[#1C1C1E]/95 backdrop-blur-xl rounded-xl p-2">
              <div className="flex items-start gap-2">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${notif.data.gradient} flex items-center justify-center flex-shrink-0`}>
                  {getIcon(notif.data.iconType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-white/90">{notif.data.app}</span>
                    <span className="text-[9px] text-white/40">{notif.data.time}</span>
                  </div>
                  <p className="text-[12px] font-semibold text-white truncate">{notif.data.sender}</p>
                  <p className="text-[9px] text-white/60 truncate">{notif.data.message}</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
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

// LocalCooks Notification Feed Component
function LocalCooksNotificationFeed() {
  const { t } = useTranslation("chef");
  const localCooksNotifications = [
    { id: 1, amount: "$112.50", order: "#00198", type: "Delivery", headline: t("notifChaChing"), subtext: t("notifOrderDowntown") },
    { id: 2, amount: "$42.88", order: "#00197", type: "Pickup", headline: t("notifRepeatCustomer"), subtext: t("notifMikeOrderAgain") },
    { id: 3, amount: "$78.33", order: "#00196", type: "Pickup", headline: t("notifPreorderConfirmed"), subtext: t("notifReadyPickupTomorrow") },
    { id: 4, amount: "$31.29", order: "#00195", type: "Delivery", headline: t("notifTipReceived"), subtext: t("notifThanksFood") },
    { id: 5, amount: "", order: "#00193", type: "Review", headline: t("notifReviewPosted"), subtext: t("notifBestBiryani") },
    { id: 6, amount: "$54.25", order: "#00192", type: "Pickup", headline: t("notifTrendingWeek"), subtext: t("notifTrendingArea") },
    { id: 7, amount: "$123.75", order: "#00191", type: "Express", headline: t("notifExpressOrder"), subtext: t("notifVipPrep") },
  ];
  const [visibleNotifs, setVisibleNotifs] = useState<Array<{ uid: number; data: typeof localCooksNotifications[0] }>>([]);
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    // Initialize with first few notifications
    const initial = localCooksNotifications.slice(0, 4).map((n, i) => ({ uid: i, data: n }));
    setVisibleNotifs(initial);
    setCounter(4);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleNotifs(prev => {
        // Add new notification at top
        const newNotif = {
          uid: counter,
          data: localCooksNotifications[counter % localCooksNotifications.length]
        };
        setCounter(c => c + 1);

        // Keep max 5 visible, remove from bottom
        const updated = [newNotif, ...prev].slice(0, 5);
        return updated;
      });
    }, 1500); // New notification every 1.5 seconds (faster for LocalCooks!)

    return () => clearInterval(interval);
  }, [counter]);

  return (
    <div className="absolute top-8 left-2 right-2 h-[340px] md:h-[380px] overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        {visibleNotifs.map((notif) => (
          <motion.div
            key={notif.uid}
            layout
            initial={{ opacity: 0, y: -50, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
            transition={{
              type: "spring",
              stiffness: 500,
              damping: 30,
              mass: 1
            }}
            className="mb-1.5"
          >
            <div className="bg-gradient-to-r from-[#0D9488] to-[#14B8A6] rounded-xl p-2 shadow-lg">
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#F51042] flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <img src={logoWhite} alt="LocalCooks" className="w-5 h-5 object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white">LocalCooks</span>
                    <span className="text-[9px] text-white/70">{t("timeNow")}</span>
                  </div>
                  <p className="text-[12px] font-bold text-white">
                    {notif.data.headline}{notif.data.amount ? ` ${notif.data.amount}` : ""}
                  </p>
                  <p className="text-[9px] text-white/80">{notif.data.subtext}</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
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
 * The hero's product window.
 *
 * Built from UI rather than photography. A stock kitchen photo is not this product, and a real
 * screenshot would date the page within a release, but a still image of either kind cannot do
 * the one thing the product actually claims: an order arriving and a kitchen being booked at
 * the same moment. So the panel is animated, and both services live inside the single frame.
 *
 * Stripe is deliberately NOT repeated inside the panel. It belongs to the trust bar, and a
 * processor mark on every order row made the orders read as advertising rather than as orders.
 *
 * Nothing in here is a link. The whole panel is a picture of the product, so it carries
 * aria-hidden at the call site and every number in it is illustrative.
 */
function HeroShowcase() {
  const { t } = useTranslation("chef");

  // Two kitchens, not three. The third row was filler; cutting it buys the height for the
  // booking detail underneath without making the panel any taller.
  const kitchens = [
    { name: "Harbour Kitchen Hub", rate: "$24/hr", booked: false },
    { name: "Downtown Commissary", rate: "$220/day", booked: true },
  ];

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
    <div className="relative h-full">
      {/* A soft brand glow, so the window sits ON the page rather than being pasted on top of it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -bottom-12 -top-10"
        style={{
          background:
            "radial-gradient(58% 52% at 50% 42%, rgba(245,16,66,0.13) 0%, rgba(245,16,66,0) 72%)",
        }}
      />

      {/* The window itself never moves. It used to drift up and down forever, which reads as a
          decoration rather than as a product, and it fought the entry animation instead of
          following it. It arrives once, then holds still, and the edges answer the pointer. */}
      <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[#2C2C2C]/10 bg-white shadow-[0_36px_80px_-36px_rgba(44,44,44,0.5)] transition-[border-color,box-shadow] duration-500 hover:border-[#F51042]/35 hover:shadow-[0_40px_90px_-34px_rgba(245,16,66,0.40)]">
        {/* The top edge lights up on hover. One hairline, no movement. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-[#F51042]/70 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        />
        {/* Window bar: three dots and a live state. No title, because a title bar naming the
            product would repeat the wordmark the header is already showing. */}
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-[#2C2C2C]/8 bg-[#FCFCFC] px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-[#2C2C2C]/12" />
          <span className="h-2 w-2 rounded-full bg-[#2C2C2C]/12" />
          <span className="h-2 w-2 rounded-full bg-[#2C2C2C]/12" />
          <span className="ml-auto inline-flex items-center gap-1.5 text-[0.68rem] font-medium text-emerald-600">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {t("heroMiniLive")}
          </span>
        </div>

        {/* Two panes, one per service, so the window itself argues that both exist. The
            hairline between them is the grid gap showing through a tinted background. */}
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-px bg-[#2C2C2C]/8 sm:grid-cols-2">
          {/* ── Sell pane ───────────────────────────────────────────────────── */}
          <div className="flex flex-col bg-white p-4 [@media(max-height:810px)]:p-3">
            {/* Two columns. The revenue figure keeps its chart pulled in tight underneath it,
                and the best sellers take the width that used to sit empty to the right of a
                chart stretched across the whole pane. Each half is labelled by what it SHOWS,
                never by the service name: "Your storefront" here and "Your storefront" as the
                action heading was the same words twice. */}
            {/* The two halves stack below `sm`. Side by side on a phone each got roughly 140px,
                which is narrower than the revenue figure plus its trend can go, and because a
                flex row's min-content is the SUM of its items the pane ended up 58px wider than
                the viewport and the section clipped it. */}
            <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:gap-5">
              {/* Revenue, with the chart drawn in right under the figure. */}
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#9A9A9A]">
                  {t("heroMiniRevenue")}
                </p>

                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-[1.75rem] font-bold leading-none tracking-[-0.03em] text-[#2C2C2C] tabular-nums">
                    $4,286
                  </p>
                  <span className="inline-flex items-center gap-0.5 text-[0.7rem] font-semibold text-emerald-600">
                    <Icon icon="mdi:trending-up" className="h-3 w-3 flex-shrink-0" />
                    18%
                  </span>
                </div>

                {/* The chart draws itself in. That single gesture is what makes the panel read
                    as live rather than as a picture of a panel. */}
                <svg
                  viewBox="0 0 200 64"
                  className="mt-3 min-h-[2.5rem] w-full flex-1"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="lc-showcase-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F51042" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#F51042" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <motion.path
                    d="M0,50 L28,44 L56,47 L84,30 L112,36 L140,18 L168,24 L200,8"
                    fill="none"
                    stroke="#F51042"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.6, delay: 1, ease: "easeInOut" }}
                  />
                  <motion.path
                    d="M0,50 L28,44 L56,47 L84,30 L112,36 L140,18 L168,24 L200,8 L200,64 L0,64 Z"
                    fill="url(#lc-showcase-fill)"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.9, delay: 1.9 }}
                  />
                </svg>
              </div>

              {/* Best sellers. Deliberately plain: this sits beside an animated chart, and a
                  second set of animating bars meant two things competing for the same glance,
                  one after the other. A quiet ranked list reads faster and does not fight the
                  chart next to it. */}
              <div className="flex min-w-0 flex-1 flex-col border-t border-[#2C2C2C]/8 pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#9A9A9A]">
                  {t("revTopSellingItems")}
                </p>

                <ul className="mt-2.5 flex flex-col">
                  {topItems.map((item, i) => (
                    <li
                      key={item.name}
                      className={cn(
                        "flex items-baseline justify-between gap-3 py-2",
                        i > 0 && "border-t border-[#2C2C2C]/8",
                      )}
                    >
                      <span className="min-w-0 truncate text-[0.78rem] text-[#4A4A4A]">
                        {item.name}
                      </span>
                      <span className="flex-shrink-0 text-[0.78rem] font-semibold tabular-nums text-[#2C2C2C]">
                        {item.sold}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Orders, one line each now that the pane carries three sections instead of two.
                No processor mark on the rows: Stripe is the trust bar's job, and repeating it
                here made an order look like an advertisement. A status dot carries the same
                information and stays out of the way. */}
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {orders.map((o, i) => (
                <motion.div
                  key={o.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 1.5 + i * 0.16 }}
                  className="flex items-center gap-2 rounded-lg border border-[#2C2C2C]/8 bg-[#FAFAFA] px-2.5 py-2"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                      o.state === "Paid" ? "bg-emerald-500" : "bg-[#F51042]",
                    )}
                  />
                  <span className="flex-shrink-0 text-[0.74rem] font-semibold tabular-nums text-[#2C2C2C]">
                    {o.amount}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.66rem] tabular-nums text-[#9A9A9A]">
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
          </div>

          {/* ── Kitchen pane ────────────────────────────────────────────────── */}
          <div className="flex flex-col bg-white p-4 [@media(max-height:810px)]:p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#9A9A9A]">
              {t("heroMiniNearby")}
            </p>

            <div className="mt-2 flex flex-col">
              {kitchens.map((k, i) => (
                <motion.div
                  key={k.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 1.1 + i * 0.16 }}
                  className={cn(
                    "flex items-center gap-2.5 py-2",
                    i > 0 && "border-t border-[#2C2C2C]/8",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold text-[#2C2C2C]">
                    {k.name}
                  </span>
                  <span className="flex-shrink-0 text-[0.78rem] font-bold tabular-nums text-[#2C2C2C]">
                    {k.rate}
                  </span>
                  {/* Both badges are pinned to the same height, so the tick on "Booked" cannot
                      make it taller than "Book". One solid and one quiet: availability is then
                      readable before the label is. */}
                  <span
                    className={cn(
                      "inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[0.66rem] font-semibold",
                      k.booked
                        ? "border-[#2C2C2C]/10 bg-white text-[#8A8A8A]"
                        : "border-transparent bg-[#F51042]/[0.09] text-[#F51042]",
                    )}
                  >
                    {k.booked && <Icon icon="mdi:check" className="h-3 w-3 flex-shrink-0" />}
                    {k.booked ? t("heroMiniBooked") : t("heroMiniBook")}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* The booked kitchen's detail. The list is two rows precisely so this has room
                without the panel growing: a booking confirmation is the most persuasive thing
                this pane can show, and the space was previously an empty gap under a "By the
                hour or day" caption that the two rates already imply. */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.5 }}
              className="mt-3 rounded-xl border border-[#2C2C2C]/8 bg-[#FAFAFA] p-3"
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#9A9A9A]">
                {t("bdBookingDetails")}
              </p>

              <ul className="mt-2 flex flex-col gap-1.5">
                <li className="flex items-center gap-2">
                  <Icon
                    icon="mdi:calendar-blank-outline"
                    className="h-3.5 w-3.5 flex-shrink-0 text-[#A8A8A8]"
                  />
                  <span className="text-[0.74rem] font-semibold text-[#2C2C2C]">Thu 25 Sep</span>
                  <span className="text-[0.74rem] text-[#C4C4C4]">·</span>
                  <span className="text-[0.74rem] font-semibold text-[#2C2C2C]">2:00 to 6:00 PM</span>
                </li>
                <li className="flex items-center gap-2">
                  <Icon
                    icon="mdi:map-marker-outline"
                    className="h-3.5 w-3.5 flex-shrink-0 text-[#A8A8A8]"
                  />
                  <span className="min-w-0 truncate text-[0.74rem] text-[#5A5A5A]">
                    Downtown St. John&apos;s
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Icon icon="mdi:stove" className="h-3.5 w-3.5 flex-shrink-0 text-[#A8A8A8]" />
                  <span className="min-w-0 truncate text-[0.74rem] text-[#5A5A5A]">
                    Range, oven, walk-in cold storage
                  </span>
                </li>
              </ul>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
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

  // The two service blocks are deliberately thin: heading, one line, one button. The four
  // capability bullets that used to live here made each block taller than the product window
  // beside it, which stretched the window and left a dead gap inside it. The detail they
  // carried (payments, delivery, tracking, hourly rates) is now shown rather than listed, in
  // the panes of HeroShowcase.
  const trust = [t("heroTrustFee"), t("heroTrustKeep"), t("heroTrustPayouts")];

  // Armed only by ?negative=…; every branch exists so a check can be shown to FAIL.
  // `orphan` lengthens line 1 past the column width on purpose: the line must then WRAP, which
  // is what the harness's "headline line wrapped" assertion watches for. A short suffix would
  // not reproduce it, because each authored line is guaranteed a fresh start.
  const headlineLine1 =
    negative === "orphan"
      ? `${t("heroHeadlineLine1")} And a great deal more besides that`
      : t("heroHeadlineLine1");
  const headlineLine2 = t("heroHeadlineLine2");
  const subhead = negative === "claim" ? `${t("heroSubhead")} Guaranteed unlimited growth.` : t("heroSubhead");

  return (
    <section data-hero className="relative overflow-hidden">
      {/* ── Background ─────────────────────────────────────────────────────── */}
      {/* Near-white ground, matching the reference sites: the colour lives in the cards and the
          type, not in a wash behind them. The previous peach gradient plus a yellow and a red
          blob read as haze, and haze is what makes a hero look template-built. What is left is
          one very faint glow behind the heading, tight enough to read as light rather than fog. */}
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-white" />
        <div
          className="absolute left-1/2 top-0 h-[520px] w-[min(1040px,112%)] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, rgba(245,16,66,0.05) 0%, rgba(245,16,66,0) 62%)",
          }}
        />
      </div>

      {/* ── Layout ───────────────────────────────────────────────────────────────
          No forced min-height: the hero is exactly as tall as its content, so no viewport
          leaves a dead band under the fold.

          The vertical rhythm below is tuned so the two cards AND the trust bar clear the fold
          at 900px (a standard laptop). Measured before the tuning: the trust bar sat at
          y=1009 on a 900px viewport, i.e. the whole proof row was invisible without scrolling,
          which defeats the point of putting proof in a hero. Re-measure with
          `node dev/shot-chef-hero.mjs 1440x900` after any change to the spacing here. ───── */}
      {/* Negative-test only: a floating layer over the copy, so the "floating layer covers
          text" assertion can be shown to fail. Never rendered in the app. */}
      {negative === "overlap" && (
        <div
          data-float
          aria-hidden="true"
          className="absolute inset-x-6 top-[90px] z-30 h-[340px] rounded-3xl bg-[#F51042]/15"
        />
      )}

      <div
        data-hero-content
        className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-14 pt-[calc(var(--header-height)+1.25rem)] sm:px-6 sm:pb-16 lg:px-8 lg:pb-20 lg:pt-[calc(var(--header-height)+1.5rem)] [@media(max-height:810px)]:pt-[calc(var(--header-height)+0.5rem)]"
      >
        <div>
          {/* ── Heading block ────────────────────────────────────────────────────
              Centred, because both audience segments read the same line and neither should
              feel like the footnote. A left-aligned block would visually prioritise whatever
              sits beside it. */}
          <div className="mx-auto max-w-4xl text-center">
            {/* Brand eyebrow. The wordmark is deliberately NOT repeated here: the fixed header
                sits directly above the hero showing exactly the same lockup, so drawing it again
                at display size spends the fold on something the reader already knows. What is
                left is the one thing the header cannot say, which is who this page is for. */}
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="mb-4 flex items-center justify-center gap-3 sm:mb-5 [@media(max-height:810px)]:mb-2"
            >
              <span className="h-px w-8 bg-[#F51042]/45" aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6B4A4F] sm:text-[11px]">
                {t("heroEyebrow")}
              </span>
              <span className="h-px w-8 bg-[#F51042]/45" aria-hidden="true" />
            </motion.p>

            {/* Headline. Names the PLATFORM, never a person: "your food" or "your recipes" would
                speak only to the chef who sells and leave a caterer who needs production space
                with nothing. Both services are joined by "and" so neither reads as subordinate,
                and the harness fails the build if the heading addresses only one side.

                The two sentences are authored as two lines rather than left to wrap. One string
                broke after "Sell your food. Book a commercial" and stranded "kitchen." on line
                two at 390px, which is the exact orphan the reader notices. Breaking at the
                sentence boundary is the same break at every width, so the pairing survives. */}
            <motion.h1
              data-h="headline"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.18 }}
              className="text-[1.35rem] font-bold leading-[1.14] tracking-tight text-[#2C2C2C] sm:text-[1.95rem] md:text-[2.35rem] lg:text-[2.9rem] xl:text-[3.3rem] [@media(max-height:810px)]:text-[2.5rem]"
            >
              <span data-h="headline-line" className="block">
                {headlineLine1}
              </span>
              <span data-h="headline-line" className="block">
                {headlineLine2}
              </span>
            </motion.h1>

            <motion.p
              data-h="subhead"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.26 }}
              className="mx-auto mt-3 max-w-[34rem] text-pretty text-[0.95rem] leading-relaxed text-[#5A5A5A] sm:mt-4 sm:max-w-2xl sm:text-base lg:mt-3 lg:text-[1.08rem] [@media(max-height:810px)]:mt-2"
            >
              {subhead}
            </motion.p>
          </div>

          {/* ── The product window, then the two services ───────────────────────
              The panel runs full width across the top, then the two services sit side by side
              underneath as two plain blocks. This is the shape the reference sites use: a rich
              interface as the focal point, then the offers as text rather than a grid of equal
              cards. Two even cards is a comparison table, and a comparison table is the calmest
              shape there is. It can be perfectly correct and still have no pull.

              The services were briefly in a column beside the panel. The copy grew and that
              column reached ~490px, which forced the panel to stretch to match and left a dead
              band inside its left pane. A panel must keep its own height, so the blocks moved
              below it, where they also get a 590px measure instead of 490.

              Both blocks keep their `data-path` hooks and stay strictly separate: the sell
              block must never mention kitchens, because a cross-reference reads as a
              prerequisite and the harness fails the build on it. */}
          <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-7 sm:mt-9 lg:mt-5 lg:gap-7 [@media(max-height:810px)]:mt-3">
            {/* ── The product, as the hero visual ────────────────────────────── */}
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <HeroShowcase />
            </motion.div>

            {/* ── The two services, as two plain blocks ────────────────────────
                No card, no border, no icon tile: just a heading, a paragraph and its own
                button, which is how the reference sites present a feature. Each keeps its own
                action, so a chef who came for only one of them can act without reading the
                other. They stay side by side down to `sm`, where they stack. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-7 sm:grid-cols-2 lg:gap-10">
              {/* ── PATH 1 · SELL ────────────────────────────────────────────── */}
              <motion.div
                data-path="sell"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.42 }}
                className={cn(
                  "group flex flex-col",
                  negative === "truncate" && "w-[150px]",
                  negative === "overflow" && "w-[3000px]",
                )}
              >
                <h2
                  data-path-title
                  className="text-[1.15rem] font-bold leading-tight tracking-[-0.01em] text-[#2C2C2C] sm:text-[1.25rem]"
                >
                  {t("heroPathSellTitle")}
                </h2>

                <p
                  data-path-body
                  className="mt-2 flex-1 text-pretty text-[0.85rem] leading-relaxed text-[#5A5A5A]"
                >
                  {negative === "crossTalk"
                    ? `${t("heroPathSellBody")} Commercial kitchen space available.`
                    : t("heroPathSellBody")}
                </p>

                <button
                  type="button"
                  data-cta="path-sell"
                  onClick={onStartApplication}
                  className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-[#F51042] px-5 text-[0.9rem] font-bold text-white shadow-lg transition-all duration-300 hover:-translate-y-1 hover:bg-[#D90E3A] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2"
                >
                  <span className="truncate">{t("heroPathSellCta")}</span>
                  <Icon icon="mdi:arrow-right" className="ml-1.5 h-4 w-4 flex-shrink-0" />
                </button>
              </motion.div>

              {/* ── PATH 2 · BOOK A KITCHEN ──────────────────────────────────── */}
              <motion.div
                data-path="kitchen"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
                className="group flex flex-col"
              >
                <h2
                  data-path-title
                  className="text-[1.15rem] font-bold leading-tight tracking-[-0.01em] text-[#2C2C2C] sm:text-[1.25rem]"
                >
                  {t("heroPathKitchenTitle")}
                </h2>

                <p
                  data-path-body
                  className="mt-2 flex-1 text-pretty text-[0.85rem] leading-relaxed text-[#5A5A5A]"
                >
                  {t("heroPathKitchenBody")}
                </p>

                <button
                  type="button"
                  data-cta="path-kitchen"
                  onClick={() => onScrollToSection?.("kitchen-access")}
                  className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-[#F51042]/25 bg-white px-5 text-[0.9rem] font-bold text-[#F51042] shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[#F51042] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2"
                >
                  <span className="truncate">{t("heroPathKitchenCta")}</span>
                  <Icon icon="mdi:arrow-right" className="ml-1.5 h-4 w-4 flex-shrink-0" />
                </button>
              </motion.div>
            </div>
          </div>

          {/* Both, or either. Stated once, plainly, so neither card reads as step one of a
              sequence. Plain type now: the icon and the two flanking rules were more decoration
              competing with the two cards sitting directly above them. */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.52 }}
            className="mt-2 text-center text-[0.82rem] font-medium text-[#8A8A8A] sm:text-[0.85rem] [@media(max-height:810px)]:hidden"
          >
            {t("heroPathsNote")}
          </motion.p>

          {/* ── Trust bar ──────────────────────────────────────────────────────
              Led by the Stripe mark, because "payments" is the claim a chef is most sceptical
              of and a recognisable processor answers it faster than a sentence can. The Stripe
              purple is the documented brand token (tailwind.config.ts `stripe`), not an
              eyeballed hex. */}
          <motion.div
            data-fold="trust-bar"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.6 }}
            className="mt-3 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 border-t border-[#2C2C2C]/8 pt-4 [@media(max-height:810px)]:mt-2"
          >
            {/* Stripe keeps its mark and its brand colour: a recognisable processor answers
                "can I trust the payments" faster than a sentence can. The other three carry no
                icon at all. Four coloured badges in a row was the same tile pattern as the card
                headers, just smaller, and it made the row read as four separate claims instead
                of one line of evidence. */}
            <span className="flex items-center gap-2 text-[0.82rem] font-medium text-[#6B6B6B] sm:text-[0.85rem]">
              <SiStripe className="h-4 w-4 flex-shrink-0 text-stripe" aria-hidden />
              {t("heroTrustStripe")}
            </span>
            {trust.map((item, i) => (
              <span
                key={i}
                className="text-[0.82rem] font-medium text-[#6B6B6B] sm:text-[0.85rem]"
              >
                {item}
              </span>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Wave into the next section, kept so the page rhythm is unchanged. */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" preserveAspectRatio="none">
          <path d="M0 50L60 45C120 40 240 30 360 35C480 40 600 60 720 65C840 70 960 60 1080 50C1200 40 1320 30 1380 25L1440 20V100H0V50Z" fill="white" />
        </svg>
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
            "THE PROBLEM" SECTION - Award-Winning Floating Chaos Design
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="min-h-screen flex items-center py-8 md:py-12 px-4 bg-gradient-to-b from-white via-[#FAFAFA] to-white overflow-hidden relative">
          {/* Subtle ambient particles */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-gradient-radial from-[#F51042]/5 to-transparent rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-gradient-radial from-[#0D9488]/5 to-transparent rounded-full blur-3xl" />
          </div>

          <div className="container mx-auto max-w-7xl relative">

            {/* Headline with Floating Chaos Icons - Cinematic Parallax Design */}
            <FadeInSection>
              <div className="relative text-center mb-6 md:mb-10 min-h-[400px] md:min-h-[480px] lg:min-h-[520px] flex flex-col items-center justify-center">

                {/* ═══ SCROLL-LINKED PARALLAX CHAOS - donedrinks.com Style ═══ */}
                <ScrollLinkedChaosIcons />

                {/* ═══ MAIN TITLE - Centered with breathing room ═══ */}
                <div className="relative z-40 max-w-3xl mx-auto px-8 md:px-12">
                  <motion.h2
                    className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-[1.35] md:leading-tight mb-5 md:mb-6"
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.2 }}
                    viewport={{ once: true }}
                  >
                    {t("didntStartCooking")}{" "}
                    <span className="relative inline-block">
                      <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">{t("buriedInAdmin")}</span>
                      <motion.svg
                        className="absolute -bottom-1 md:-bottom-2 left-0 w-full"
                        viewBox="0 0 300 12"
                        fill="none"
                        initial={{ pathLength: 0, opacity: 0 }}
                        whileInView={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 1.2, delay: 0.8 }}
                        viewport={{ once: true }}
                      >
                        <motion.path
                          d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8"
                          stroke="url(#underlineGradient)"
                          strokeWidth="3"
                          strokeLinecap="round"
                          initial={{ pathLength: 0 }}
                          whileInView={{ pathLength: 1 }}
                          transition={{ duration: 1.2, delay: 0.8 }}
                          viewport={{ once: true }}
                        />
                        <defs>
                          <linearGradient id="underlineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#F51042" stopOpacity="0.5" />
                            <stop offset="50%" stopColor="#FF6B7A" stopOpacity="0.7" />
                            <stop offset="100%" stopColor="#F51042" stopOpacity="0.5" />
                          </linearGradient>
                        </defs>
                      </motion.svg>
                    </span>
                  </motion.h2>

                  <motion.p
                    className="text-sm md:text-base lg:text-lg text-[#4A5568] leading-relaxed font-medium"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.5 }}
                    viewport={{ once: true }}
                  >
                    {t("managingOrders")}{" "}
                    <span className="text-[#1A1A1A] font-bold">{t("allOnYourOwn")}</span>
                  </motion.p>

                  {/* Sound familiar? - Call to action */}
                  <motion.p
                    className="text-sm md:text-base lg:text-lg text-[#1A1A1A] font-semibold mt-6"
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.7 }}
                    viewport={{ once: true }}
                  >
                    {t("soundFamiliar")}
                  </motion.p>
                </div>
              </div>
            </FadeInSection>

            {/* Phone Comparison - Side by Side with Cinematic Fade Effects */}
            <div className="grid md:grid-cols-2 gap-6 lg:gap-20 max-w-5xl mx-auto items-center">

              {/* CHAOS Phone */}
              <FadeInSection delay={1}>
                <div className="relative">
                  {/* iPhone 15 Pro - Compact with Full Fade Effect */}
                  <div
                    className="relative mx-auto w-[220px] md:w-[240px]"
                    style={{
                      maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)'
                    }}
                  >
                    {/* Warm ambient glow */}
                    <div className="absolute -inset-4 bg-gradient-to-br from-[#F51042]/15 via-[#FF6B6B]/10 to-transparent rounded-[3rem] blur-2xl" />

                    {/* Phone Frame */}
                    <div className="relative bg-[#1D1D1F] rounded-[44px] p-[2px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)]">
                      <div className="bg-[#1D1D1F] rounded-[42px] p-2">
                        {/* Screen */}
                        <div className="bg-[#000000] rounded-[36px] overflow-hidden h-[400px] md:h-[440px] relative">
                          {/* Status Bar */}
                          <div className="relative z-10 px-5 pt-3 flex justify-between items-center text-[11px] text-white font-semibold">
                            <span>9:41</span>
                            <div className="flex items-center gap-1">
                              <Icon icon="mdi:wifi" className="h-3 w-4 text-white" aria-label="Wi-Fi" />
                              <Icon icon="mdi:battery" className="h-3 w-4 text-white" aria-label="Battery" />
                            </div>
                          </div>

                          {/* Animated Notification Feed - Chaos */}
                          <ChaosNotificationFeed />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Label */}
                  <div className="text-center mt-4">
                    <p className="text-sm font-bold text-[#1A1A1A]">{t("scatteredEverywhere")}</p>
                    <p className="text-xs text-[#64748B] mt-0.5">{t("fragmentedTools")}</p>
                  </div>
                </div>
              </FadeInSection>

              {/* LOCALCOOKS Phone */}
              <FadeInSection delay={2}>
                <div className="relative">
                  {/* iPhone 15 Pro - Compact with Full Fade Effect */}
                  <div
                    className="relative mx-auto w-[220px] md:w-[240px]"
                    style={{
                      maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)'
                    }}
                  >
                    {/* Teal ambient glow */}
                    <div className="absolute -inset-4 bg-gradient-to-br from-[#0D9488]/20 via-[#14B8A6]/15 to-transparent rounded-[3rem] blur-2xl" />

                    {/* Phone Frame */}
                    <div className="relative bg-[#1D1D1F] rounded-[44px] p-[2px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)]">
                      <div className="bg-[#1D1D1F] rounded-[42px] p-2">
                        {/* Screen */}
                        <div className="bg-gradient-to-b from-[#042F2E] to-[#000000] rounded-[36px] overflow-hidden h-[400px] md:h-[440px] relative">
                          {/* Status Bar */}
                          <div className="relative z-10 px-5 pt-3 flex justify-between items-center text-[11px] text-white font-semibold">
                            <span>9:41</span>
                            <div className="flex items-center gap-1">
                              <Icon icon="mdi:wifi" className="h-3 w-4 text-white" aria-label="Wi-Fi" />
                              <Icon icon="mdi:battery" className="h-3 w-5 text-white" aria-label="Battery" />
                            </div>
                          </div>

                          {/* Animated Notification Feed - LocalCooks */}
                          <LocalCooksNotificationFeed />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Label */}
                  <div className="text-center mt-4">
                    <p className="text-sm font-bold text-[#0D9488]">{t("poweredBy")} <span className="font-display text-sm text-[#F51042]">LocalCooks</span></p>
                    <p className="text-xs text-[#64748B] mt-0.5">{t("unifiedPlatform")}</p>
                  </div>
                </div>
              </FadeInSection>
            </div>
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
