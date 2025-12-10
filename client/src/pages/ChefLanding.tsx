import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import FadeInSection from "@/components/ui/FadeInSection";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { 
  ChefHat, Clock, Users, Target, Utensils, 
  Building2, ArrowRight, CheckCircle2, Check, X, Sparkles,
  Heart, Rocket, Star, Zap, Shield, MessageCircle,
  CreditCard, Truck, Instagram, Phone, Calendar, ChevronLeft, ChevronRight
} from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, useScroll, useTransform, MotionValue } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
import chefImage from "@/assets/chef-cooking.png";
import logoWhite from "@assets/logo-white.png";

// Import actual app icon images
import instagramIcon from "@assets/instagram.png";
import gmailIcon from "@assets/gmail.png";
import messengerIcon from "@assets/messenger.png";
import whatsappIcon from "@assets/whatsapp.png";
import marketplaceIcon from "@assets/marketplace.png";
import iosMessagesIcon from "@assets/iosmessages.png";
import truckIcon from "@assets/truck.png";
import interacIcon from "@assets/Interac.svg";
import kitchenTableIcon from "@assets/kitchen-table.png";

// Icon image mapping for the chaos icons section
const APP_ICON_IMAGES: Record<string, string> = {
  instagram: instagramIcon,
  gmail: gmailIcon,
  messenger: messengerIcon,
  whatsapp: whatsappIcon,
  marketplace: marketplaceIcon,
  iosMessages: iosMessagesIcon,
  truck: truckIcon,
  interac: interacIcon,
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
  iconKey: keyof typeof APP_ICON_IMAGES;
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
    3: { opacity: 0.85, scale: 1, blur: 0.5, baseZ: 10, shadow: '0 12px 24px -4px rgba(0, 0, 0, 0.15)' },
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

  const iconSrc = APP_ICON_IMAGES[iconKey];

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
        className="rounded-[22%] overflow-hidden"
        style={{
          width: size,
          height: size,
          boxShadow: config.shadow,
          transform: 'translateZ(0)', // GPU acceleration
        }}
      >
        <img 
          src={iconSrc} 
          alt="" 
          className="w-full h-full object-cover"
          loading="lazy"
          draggable={false}
        />
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
      className="absolute inset-0 pointer-events-none"
      style={{ 
        // Allow icons to overflow into visible area - prevents cutoff
        overflow: 'visible',
        // Extra padding to ensure icons at edges aren't cut
        margin: '-40px',
        padding: '40px',
      }}
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
          MOBILE LAYOUT - Asymmetric chaos on smaller screens
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="sm:hidden">
        {/* Instagram - Top left, tight to corner */}
        <ParallaxIcon
          iconKey="instagram"
          position={{ x: -2, y: 5 }}
          size={50}
          depth={1}
          rotation={-10}
          parallaxY={85}
          scrollYProgress={scrollYProgress}
        />
        {/* WhatsApp - Top right, but lower than Instagram */}
        <ParallaxIcon
          iconKey="whatsapp"
          position={{ x: 78, y: 15 }}
          size={46}
          depth={1}
          rotation={7}
          parallaxY={80}
          scrollYProgress={scrollYProgress}
        />
        {/* Messenger - Left side, higher up */}
        <ParallaxIcon
          iconKey="messenger"
          position={{ x: 0, y: 38 }}
          size={42}
          depth={2}
          rotation={5}
          parallaxY={60}
          scrollYProgress={scrollYProgress}
        />
        {/* Gmail - Right side, lower than messenger's mirror position */}
        <ParallaxIcon
          iconKey="gmail"
          position={{ x: 80, y: 55 }}
          size={44}
          depth={2}
          rotation={-6}
          parallaxY={55}
          scrollYProgress={scrollYProgress}
        />
        {/* Marketplace - Bottom left area */}
        <ParallaxIcon
          iconKey="marketplace"
          position={{ x: 3, y: 72 }}
          size={40}
          depth={3}
          rotation={-7}
          parallaxY={40}
          scrollYProgress={scrollYProgress}
        />
        {/* iOS Messages - Bottom right, offset from marketplace */}
        <ParallaxIcon
          iconKey="iosMessages"
          position={{ x: 75, y: 82 }}
          size={38}
          depth={3}
          rotation={8}
          parallaxY={35}
          scrollYProgress={scrollYProgress}
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
  { id: 1, amount: "$112.50", order: "#00198", type: "Delivery" },
  { id: 2, amount: "$42.88", order: "#00197", type: "Pickup" },
  { id: 3, amount: "$78.33", order: "#00196", type: "Pickup" },
  { id: 4, amount: "$31.29", order: "#00195", type: "Delivery" },
  { id: 5, amount: "$67.50", order: "#00194", type: "Pickup" },
  { id: 6, amount: "$95.00", order: "#00193", type: "Delivery" },
  { id: 7, amount: "$54.25", order: "#00192", type: "Pickup" },
  { id: 8, amount: "$123.75", order: "#00191", type: "Delivery" },
];

// Chaos Notification Feed Component
function ChaosNotificationFeed() {
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
    switch(iconType) {
      case 'instagram':
        return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.254 1.216.598 1.772 1.153a4.908 4.908 0 0 1 1.153 1.772c.247.637.415 1.363.465 2.428.047 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 0 1-1.153 1.772 4.915 4.915 0 0 1-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.047-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 0 1-1.772-1.153 4.904 4.904 0 0 1-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 0 1 1.153-1.772A4.897 4.897 0 0 1 5.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.013 9.283 2 12 2zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6.5-.25a1.25 1.25 0 0 0-2.5 0 1.25 1.25 0 0 0 2.5 0zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>;
      case 'whatsapp':
        return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>;
      case 'phone':
        return <Phone className="w-4 h-4 text-white" />;
      case 'marketplace':
        return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M12.001 2C17.523 2 22 6.478 22 12.001C22 17.523 17.523 22 12.001 22C6.478 22 2 17.523 2 12.001C2 6.478 6.478 2 12.001 2Z"/></svg>;
      case 'interac':
        return <CreditCard className="w-4 h-4 text-white" />;
      case 'messenger':
        return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.13.26.35.27.57l.05 1.78c.04.57.61.94 1.13.71l1.98-.87c.17-.08.36-.1.55-.06.91.25 1.87.38 2.88.38 5.64 0 10-4.13 10-9.7C22 6.13 17.64 2 12 2z"/></svg>;
      default:
        return <Phone className="w-4 h-4 text-white" />;
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
                  <p className="text-[11px] font-semibold text-white truncate">{notif.data.sender}</p>
                  <p className="text-[10px] text-white/60 truncate">{notif.data.message}</p>
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
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "start" });

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
      text: "LocalCooks gave me the freedom to focus on what I love—cooking. No more juggling DMs and payments. Everything is in one place, and I'm making real money doing what I'm passionate about.",
      name: "Sarah Martinez",
      role: "Specializes in authentic Mexican cuisine",
      color: "#fc7545", // Light Pink/Orange
      textColor: "#2C2C2C",
    },
    {
      text: "The kitchen access feature is a game-changer. I don't have a commercial kitchen, but I can book certified spaces by the hour. It's flexible, affordable, and perfect for scaling my business.",
      name: "James Chen",
      role: "Asian fusion chef",
      color: "#3a61ae", // Royal Blue
      textColor: "#ffffff",
    },
    {
      text: "I've tried other platforms, but LocalCooks actually cares about chefs. The support is real, the payments are fast, and I keep 100% during the trial. This is how it should be.",
      name: "Maria Rodriguez",
      role: "Mediterranean cuisine specialist",
      color: "#30524e", // Dark Teal/Green
      textColor: "#ffffff",
    },
    {
      text: "Starting part-time was the best decision. I can cook when I want, set my own prices, and build my brand. The community of chefs here is incredible—we support each other.",
      name: "David Thompson",
      role: "BBQ and comfort food expert",
      color: "#ff8c42", // Orange
      textColor: "#2C2C2C",
    },
    {
      text: "The approval process was so fast—approved in 24 hours! And the platform handles everything: orders, payments, delivery coordination. I just focus on creating amazing food.",
      name: "Emily Park",
      role: "Korean and Japanese fusion",
      color: "#ffffff", // White
      textColor: "#2C2C2C",
    },
    {
      text: "I love that I own my customers. It's my profile, my story, my regulars. LocalCooks gives me the tools to build a real business, not just be another vendor on a marketplace.",
      name: "Michael O'Brien",
      role: "Irish and British comfort food",
      color: "#fc7545", // Light Pink/Orange
      textColor: "#2C2C2C",
    },
  ];

  return (
    <section id="benefits" className="py-20 md:py-32 px-4 bg-white relative overflow-visible">
      <div className="container mx-auto max-w-7xl">
        <FadeInSection>
          <div className="text-center mb-12 md:mb-16">
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-4xl md:text-5xl lg:text-6xl font-bold text-[#1A1A1A] leading-tight"
            >
              Some kind words from our{" "}
              <span className="relative inline-block">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">
                  chefs
                </span>
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
        <div className="relative px-4 md:px-8 lg:px-12 py-8 md:py-12">
          <div className="overflow-hidden" ref={emblaRef}>
            <div className="flex">
              {testimonials.map((testimonial, index) => (
                <div
                  key={index}
                  className="flex-[0_0_33.333%] min-w-0 w-full sm:w-[33.333%] px-1.5 md:px-2"
                >
                  <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="h-full py-4 md:py-6"
                  >
                    <div
                      className="relative rounded-2xl p-5 md:p-6 h-full shadow-xl"
                      style={{
                        backgroundColor: testimonial.color,
                        transform: `rotate(${index % 2 === 0 ? '-1.5deg' : '1.5deg'}) translateZ(0)`,
                        zIndex: 10 - (index % 3),
                      }}
                    >
                      {/* Elegant Quotation Mark */}
                      <div className="absolute top-3 left-3 md:top-4 md:left-4">
                        <span 
                          className="text-6xl md:text-7xl lg:text-8xl font-serif leading-none"
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
                      <div className="relative z-10 pt-8 md:pt-10 lg:pt-12">
                        {/* Testimonial Text */}
                        <p
                          className="text-sm md:text-base font-sans leading-relaxed mb-4 md:mb-5"
                          style={{
                            color: testimonial.textColor,
                          }}
                        >
                          {testimonial.text}
                        </p>

                        {/* Horizontal Line */}
                        <div
                          className="h-px mb-3 md:mb-4"
                          style={{
                            backgroundColor: testimonial.textColor === "#ffffff" 
                              ? "rgba(255, 255, 255, 0.3)" 
                              : "rgba(44, 44, 44, 0.2)",
                          }}
                        />

                        {/* Chef Name and Role */}
                        <div>
                          <p
                            className="font-bold text-xs md:text-sm lg:text-base mb-1"
                            style={{
                              color: testimonial.textColor,
                            }}
                          >
                            {testimonial.name}
                          </p>
                          <p
                            className="text-xs md:text-sm"
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
                  </motion.div>
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
                    <span className="text-[9px] text-white/70">now</span>
                  </div>
                  <p className="text-[12px] font-bold text-white">Cha-ching! {notif.data.amount}</p>
                  <p className="text-[10px] text-white/80">{notif.data.type} order {notif.data.order}</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default function ChefLanding() {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();

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
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error("Error fetching locations:", error);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // Use locations data directly (same structure as preview page)
  const uniqueLocations = useMemo(() => {
    if (!locations || locations.length === 0) return [];
    // Locations already come with normalized URLs from the API
    return locations.map((loc: any) => ({
      id: loc.id,
      name: loc.name,
      address: loc.address || "",
      brandImageUrl: loc.brandImageUrl || loc.featuredKitchenImage || null,
      logoUrl: loc.logoUrl || null,
      featuredKitchenImage: loc.featuredKitchenImage || loc.brandImageUrl || null,
      kitchenCount: loc.kitchenCount || 1
    }));
  }, [locations]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash) {
        document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    if (window.location.hash) setTimeout(handleHashChange, 100);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleGetStarted = () => navigate(user ? '/apply' : '/auth');

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-grow">
        {/* ═══════════════════════════════════════════════════════════════════════
            HERO SECTION - Premium Split-Screen Design
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="relative min-h-screen flex items-center overflow-hidden">
          {/* Sophisticated Background */}
          <div className="absolute inset-0">
            {/* Warm gradient base */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#FFF8F5] via-[#FFFAF8] to-white" />
            
            {/* Large accent gradient */}
            <motion.div 
              className="absolute -top-[20%] -right-[10%] w-[800px] h-[800px] rounded-full"
              style={{ background: "radial-gradient(circle, rgba(245,16,66,0.08) 0%, transparent 70%)" }}
              animate={{ 
                scale: [1, 1.1, 1],
                opacity: [0.6, 0.8, 0.6]
              }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            
            {/* Golden accent */}
            <motion.div 
              className="absolute bottom-[10%] left-[5%] w-[500px] h-[500px] rounded-full"
              style={{ background: "radial-gradient(circle, rgba(255,215,0,0.12) 0%, transparent 70%)" }}
              animate={{ 
                scale: [1, 1.05, 1],
                x: [0, 20, 0]
              }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Subtle pattern overlay */}
            <div className="absolute inset-0 opacity-[0.015]" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }} />
          </div>

          <div className="container mx-auto max-w-7xl px-4 pt-28 pb-16 relative z-10">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center min-h-[calc(100vh-200px)]">
              
              {/* Left Content Column */}
              <div className="order-2 lg:order-1">
                {/* Trial Badge */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="mb-8"
                >
                  <div className="inline-flex items-center gap-2.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white px-5 py-2.5 rounded-full shadow-lg shadow-emerald-500/25">
                    <motion.div
                      animate={{ rotate: [0, 15, -15, 0] }}
                      transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                    >
                      <Sparkles className="h-4 w-4" />
                    </motion.div>
                    <span className="font-semibold text-sm tracking-wide">Keep 100% of Your Earnings</span>
                </div>
                </motion.div>

                {/* Brand Identity */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.3 }}
                >
                  <h1 className="font-logo text-[3.5rem] md:text-[5rem] lg:text-[6rem] text-[#F51042] leading-none mb-4 md:mb-5 tracking-tight">
                  LocalCooks
                </h1>
                  <p className="font-mono text-[10px] md:text-[11px] text-[#6B4A4F] uppercase tracking-[0.4em] mb-8">
                    For Chefs Who Dream Bigger
                </p>
                </motion.div>

                {/* Main Headline */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.5 }}
                  className="mb-8"
                >
                  <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#2C2C2C] leading-[1.15] mb-6">
                    Turn Your Kitchen
                  <br />
                    <span className="relative inline-block">
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">
                        Into a Business
                      </span>
                      <motion.svg 
                        className="absolute -bottom-2 left-0 w-full" 
                        viewBox="0 0 300 12" 
                        fill="none"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 1, delay: 1.2 }}
                      >
                        <motion.path 
                          d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8" 
                          stroke="#F51042" 
                          strokeWidth="3" 
                          strokeLinecap="round"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 1, delay: 1.2 }}
                        />
                      </motion.svg>
                  </span>
                </h2>
                  <p className="text-lg md:text-xl text-[#6B6B6B] leading-relaxed max-w-lg">
                    You focus on creating incredible food. We handle orders, payments, delivery, and growing your customer base.
                  </p>
                </motion.div>

                {/* CTA Buttons */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.7 }}
                  className="flex flex-col sm:flex-row gap-4 mb-10"
                >
                  <Button
                    onClick={handleGetStarted}
                    size="lg"
                    className="group relative bg-[#F51042] hover:bg-[#D90E3A] text-white font-bold py-7 px-12 text-lg rounded-full transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-[#F51042]/30 hover:-translate-y-1 overflow-hidden"
                  >
                    <span className="relative z-10 flex items-center">
                      Start Your Journey
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                    <motion.div 
                      className="absolute inset-0 bg-gradient-to-r from-[#D90E3A] to-[#F51042]"
                      initial={{ x: "100%" }}
                      whileHover={{ x: 0 }}
                      transition={{ duration: 0.3 }}
                    />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="border-2 border-[#2C2C2C]/20 text-[#2C2C2C] hover:border-[#F51042] hover:text-[#F51042] hover:bg-[#F51042]/5 font-semibold py-7 px-10 text-lg rounded-full transition-all duration-300"
                    onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    How It Works
                  </Button>
                </motion.div>

                {/* Trust Indicators */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.9 }}
                  className="flex flex-wrap gap-x-6 gap-y-3"
                >
                  {[
                    { icon: CheckCircle2, text: "Approved in 24 hours" },
                    { icon: Shield, text: "No upfront costs" },
                    { icon: Star, text: "5-star support" }
                  ].map((item, i) => (
                    <motion.span 
                      key={i}
                      className="flex items-center gap-2 text-[#6B6B6B] text-sm"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 1 + (i * 0.1) }}
                    >
                      <item.icon className="h-4 w-4 text-emerald-500" />
                      <span>{item.text}</span>
                    </motion.span>
                  ))}
                </motion.div>
              </div>

              {/* Right Image Column */}
              <div className="order-1 lg:order-2 relative">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: 50 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
                  className="relative"
                >
                  {/* Decorative background shapes */}
                  <div className="absolute -inset-4 bg-gradient-to-br from-[#F51042]/10 via-[#FFE8DD]/50 to-[#FFD700]/20 rounded-[2.5rem] transform rotate-3" />
                  <div className="absolute -inset-4 bg-gradient-to-tr from-[#FFE8DD]/80 to-white/60 rounded-[2.5rem] transform -rotate-2" />
                  
                  {/* Main Image Container */}
                  <div className="relative rounded-[2rem] overflow-hidden shadow-2xl shadow-[#F51042]/10">
                    <img 
                      src={chefImage} 
                      alt="Professional home chef cooking with passion" 
                      className="w-full h-auto object-cover aspect-[4/3]"
                    />
                    
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    
                    {/* Floating Stats Card */}
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: 1.2 }}
                      className="absolute bottom-6 left-6 right-6 bg-white/95 backdrop-blur-md rounded-2xl p-5 shadow-xl"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-[#F51042] to-[#FF6B7A] rounded-full flex items-center justify-center">
                            <ChefHat className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <p className="text-sm text-[#6B6B6B]">During Trial</p>
                            <p className="text-xl font-bold text-[#2C2C2C]">0% Platform Fee</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-[#6B6B6B]">You Keep</p>
                          <p className="text-2xl font-bold text-emerald-500">100%</p>
                        </div>
                      </div>
                    </motion.div>
                </div>
                
                  {/* Floating Badge - Top Right */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: 1.4, type: "spring", stiffness: 200 }}
                    className="absolute -top-4 -right-4 bg-white rounded-2xl shadow-xl px-4 py-3 border border-[#F51042]/10"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-[#FFE8DD] rounded-full flex items-center justify-center">
                        <Heart className="h-4 w-4 text-[#F51042]" />
                      </div>
                      <div>
                        <p className="text-xs text-[#6B6B6B]">Made with</p>
                        <p className="text-sm font-bold text-[#2C2C2C]">Love & Passion</p>
                      </div>
                    </div>
                  </motion.div>

                  {/* Floating Badge - Left */}
                  <motion.div
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: 1.6 }}
                    className="absolute top-1/3 -left-6 bg-white rounded-xl shadow-lg px-3 py-2 border border-emerald-100"
                  >
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-semibold text-[#2C2C2C]">Fast Approval</span>
                    </div>
                  </motion.div>
                </motion.div>
                </div>
            </div>
          </div>

          {/* Elegant Wave Divider */}
          <div className="absolute bottom-0 left-0 right-0">
            <svg viewBox="0 0 1440 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" preserveAspectRatio="none">
              <path d="M0 50L60 45C120 40 240 30 360 35C480 40 600 60 720 65C840 70 960 60 1080 50C1200 40 1320 30 1380 25L1440 20V100H0V50Z" fill="white"/>
            </svg>
          </div>
        </section>

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
                    className="text-[1.4rem] sm:text-2xl md:text-3xl lg:text-4xl xl:text-[2.5rem] font-bold text-[#1A1A1A] leading-[1.35] md:leading-tight mb-5 md:mb-6"
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.2 }}
                    viewport={{ once: true }}
                  >
                    You didn't start cooking to spend your days{" "}
                    <span className="relative inline-block">
                      <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">buried in admin work.</span>
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
                    className="text-base sm:text-lg md:text-xl lg:text-2xl text-[#4A5568] leading-relaxed font-medium"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.5 }}
                    viewport={{ once: true }}
                  >
                    Yet somehow, you're managing orders, responding to messages, and organizing pickups —{" "}
                    <span className="text-[#1A1A1A] font-bold">all on your own.</span>
                  </motion.p>
                  
                  {/* Sound familiar? - Call to action */}
                  <motion.p
                    className="text-lg md:text-xl text-[#1A1A1A] font-semibold mt-6"
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.7 }}
                    viewport={{ once: true }}
                  >
                    Sound familiar?
                  </motion.p>
                </div>
              </div>
            </FadeInSection>

            {/* Phone Comparison - Side by Side with Cinematic Fade Effects */}
            <div className="grid md:grid-cols-2 gap-6 lg:gap-20 max-w-5xl mx-auto items-center">
              
              {/* CHAOS Phone */}
              <FadeInSection delay={0.3}>
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
                              <svg className="w-4 h-3" viewBox="0 0 18 12" fill="white"><path d="M1 4.5l2 2c2.5-2.5 6.5-2.5 9 0l2-2C10.5 1 4.5 1 1 4.5zm4 4l3 3 3-3c-1.5-1.5-4.5-1.5-6 0z"/></svg>
                              <svg className="w-4 h-3" viewBox="0 0 17 11" fill="white"><path d="M15.5 4.5h-14C.67 4.5 0 5.17 0 6v3.5c0 .83.67 1.5 1.5 1.5h14c.83 0 1.5-.67 1.5-1.5V6c0-.83-.67-1.5-1.5-1.5z"/></svg>
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
                    <p className="text-sm font-bold text-[#1A1A1A]">Scattered everywhere</p>
                    <p className="text-xs text-[#64748B] mt-0.5">6 apps. Endless context switching.</p>
                  </div>
                </div>
              </FadeInSection>
              
              {/* LOCALCOOKS Phone */}
              <FadeInSection delay={0.5}>
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
                              <svg className="w-4 h-3" viewBox="0 0 18 12" fill="white"><path d="M1 4.5l2 2c2.5-2.5 6.5-2.5 9 0l2-2C10.5 1 4.5 1 1 4.5zm4 4l3 3 3-3c-1.5-1.5-4.5-1.5-6 0z"/></svg>
                              <div className="w-5 h-[9px] rounded-[2px] border border-white/80 relative">
                                <div className="absolute inset-[1px] bg-[#34C759] rounded-[1px]" />
                              </div>
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
                    <p className="text-sm font-bold text-[#0D9488]">Powered by LocalCooks</p>
                    <p className="text-xs text-[#64748B] mt-0.5">One app. Instant payments. Peace of mind.</p>
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
        <section id="how-it-works" className="py-20 md:py-28 px-4 bg-white">
          <div className="container mx-auto max-w-6xl">
            {/* Section Header */}
            <FadeInSection>
              <div className="text-center mb-16">
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                  className="text-[#6B6B6B] text-base md:text-lg mb-4"
                >
                  Join passionate home cooks earning real money doing what they love.
                </motion.p>
                
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-4xl md:text-5xl lg:text-6xl font-bold text-[#1A1A1A] leading-tight"
                >
                  Three Simple{" "}
                  <span className="relative inline-block">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A]">
                      Steps
                    </span>
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

            {/* Steps - 3 Column Grid with White Cards */}
            <div className="grid md:grid-cols-3 gap-6 lg:gap-8 mb-16">
              
              {/* Step 1 - Apply (Coral/Red accent) */}
              <FadeInSection delay={1}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="group h-full"
                >
                  <div className="relative h-full bg-white rounded-2xl p-6 lg:p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100">
                    {/* Step Number Badge */}
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F51042] to-[#FF6B7A] flex items-center justify-center shadow-md shadow-[#F51042]/20 group-hover:scale-110 transition-transform duration-300">
                        <span className="text-white font-bold text-sm">1</span>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#F51042]/60">Step One</span>
                    </div>
                    
                    <h3 className="text-2xl font-bold text-[#2C2C2C] mb-1">Apply</h3>
                    <p className="text-sm font-medium text-[#F51042] mb-3">Less than 5 minutes</p>
                    
                    <p className="text-[#6B6B6B] leading-relaxed text-sm">
                      Tell us about your cooking. Where would you prepare meals—your home kitchen or a commercial kitchen? Answer a few quick questions about regulations and certifications. That's all we need to get started.
                    </p>
                    
                    {/* Decorative accent */}
                    <div className="absolute bottom-0 left-0 w-16 h-16 bg-gradient-to-tr from-[#F51042]/5 to-transparent rounded-br-2xl rounded-tl-[60px]" />
                  </div>
                </motion.div>
              </FadeInSection>

              {/* Step 2 - We Approve You (Teal accent - complementary to coral) */}
              <FadeInSection delay={2}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="group h-full"
                >
                  <div className="relative h-full bg-white rounded-2xl p-6 lg:p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100">
                    {/* Step Number Badge */}
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0D9488] to-[#14B8A6] flex items-center justify-center shadow-md shadow-[#0D9488]/20 group-hover:scale-110 transition-transform duration-300">
                        <span className="text-white font-bold text-sm">2</span>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#0D9488]/60">Step Two</span>
                    </div>
                    
                    <h3 className="text-2xl font-bold text-[#2C2C2C] mb-1">We Get You Live</h3>
                    <p className="text-sm font-medium text-[#0D9488] mb-3">Approved in 24 hours</p>
                    
                    <p className="text-[#6B6B6B] leading-relaxed text-sm">
                      We review your application and connect with you to help with any regulatory requirements. Already have your documentation ready? You're set. Need guidance? We walk you through it. Either way, you'll be ready to launch.
                    </p>
                    
                    {/* Decorative accent */}
                    <div className="absolute bottom-0 left-0 w-16 h-16 bg-gradient-to-tr from-[#0D9488]/5 to-transparent rounded-br-2xl rounded-tl-[60px]" />
                  </div>
                </motion.div>
              </FadeInSection>

              {/* Step 3 - Menu. Price. Sell. (Amber/Gold accent - warm complement) */}
              <FadeInSection delay={3}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="group h-full"
                >
                  <div className="relative h-full bg-white rounded-2xl p-6 lg:p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100">
                    {/* Step Number Badge */}
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F59E0B] to-[#FBBF24] flex items-center justify-center shadow-md shadow-[#F59E0B]/20 group-hover:scale-110 transition-transform duration-300">
                        <span className="text-white font-bold text-sm">3</span>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#F59E0B]/60">Step Three</span>
                    </div>
                    
                    <h3 className="text-2xl font-bold text-[#2C2C2C] mb-1">Build Your Menu & Sell</h3>
                    <p className="text-sm font-medium text-[#F59E0B] mb-3">Start earning today</p>
                    
                    <p className="text-[#6B6B6B] leading-relaxed text-sm">
                      Create your menu, set your prices, start accepting orders. Payment deposits straight to your bank. Scale from one order to hundreds—it's all in your hands.
                    </p>
                    
                    {/* Decorative accent */}
                    <div className="absolute bottom-0 left-0 w-16 h-16 bg-gradient-to-tr from-[#F59E0B]/5 to-transparent rounded-br-2xl rounded-tl-[60px]" />
                  </div>
                </motion.div>
              </FadeInSection>
            </div>

            {/* What You Get - Compact Bento Grid */}
            <FadeInSection>
              <div className="mb-12">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                  <h3 className="text-xl font-bold text-[#2C2C2C]">What You Get</h3>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {[
                    { text: "Sell from home or a commercial kitchen — your choice", icon: Building2, borderColor: "border-[#F51042]/20", iconColor: "text-[#F51042]" },
                    { text: "We handle compliance — regulations, certifications, partnerships", icon: Shield, borderColor: "border-[#0D9488]/20", iconColor: "text-[#0D9488]" },
                    { text: "Full control — your hours, your menu, your prices", icon: Zap, borderColor: "border-[#F59E0B]/20", iconColor: "text-[#F59E0B]" },
                    { text: "Direct payments — weekly payouts to your bank", icon: CreditCard, borderColor: "border-[#F51042]/20", iconColor: "text-[#F51042]" },
                    { text: "Real support — actual people who help you succeed", icon: Heart, borderColor: "border-[#0D9488]/20", iconColor: "text-[#0D9488]" },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      whileHover={{ y: -2, scale: 1.01 }}
                      className="group"
                    >
                      <div className={`h-full bg-white rounded-xl p-4 border ${item.borderColor} hover:shadow-md transition-all duration-300`}>
                        <div className="flex items-start gap-2.5">
                          <div className="flex-shrink-0 mt-0.5">
                            <item.icon className={`h-4 w-4 ${item.iconColor}`} />
                          </div>
                          <p className="text-[#4A5568] text-xs leading-relaxed">
                            {item.text}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </FadeInSection>

            {/* CTA Section */}
            <FadeInSection>
              <div className="text-center">
                <p className="text-lg font-semibold text-[#2C2C2C] mb-6">Ready?</p>
                
                <Button 
                  onClick={handleGetStarted} 
                  className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-bold py-6 px-12 text-lg rounded-full shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                >
                  Start Your Application
                  <ArrowRight className="ml-2 h-5 w-5" />
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
        <div className="relative w-full overflow-hidden" style={{ height: '100px', marginBottom: '-2px' }}>
          <svg 
            viewBox="0 0 1440 100" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            className="absolute bottom-0 w-full"
            style={{ height: '100px', minWidth: '100%' }}
            preserveAspectRatio="none"
          >
            <path 
              d="M0,40 C150,80 350,0 600,50 C850,100 1050,20 1200,60 C1350,100 1440,40 1440,40 L1440,100 L0,100 Z" 
              fill="#F51042"
            />
            <path 
              d="M0,60 C200,100 400,20 650,70 C900,120 1100,40 1250,80 C1400,120 1440,60 1440,60 L1440,100 L0,100 Z" 
              fill="#E8103A"
              opacity="0.7"
            />
          </svg>
        </div>

        {/* ══════ MAIN KITCHEN ACCESS SECTION - Bold Primary Background ══════ */}
        <section className="relative py-20 md:py-28 px-4 overflow-hidden bg-gradient-to-br from-[#F51042] via-[#E8103A] to-[#D90935]">
          {/* Animated Background Effects */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
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
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                  className="mb-4"
                >
                  <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-white/90 px-4 py-2 bg-white/15 backdrop-blur-md rounded-full border border-white/20">
                    <Building2 className="h-4 w-4" />
                    Kitchen Access
                  </span>
                </motion.div>
                
                <motion.h2 
                  className="text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight mb-4"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                >
                  No Kitchen?{" "}
                  <span className="relative inline-block">
                    <span className="relative z-10">No Problem.</span>
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
                  className="text-lg md:text-xl text-white/85 leading-relaxed max-w-2xl mx-auto"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  Access certified commercial kitchens by the hour. Start small, scale as you grow.
                </motion.p>
              </div>
            </FadeInSection>

            {/* Kitchen Location Cards - White Cards on Red Background */}
            {!kitchensLoading && uniqueLocations.length > 0 ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
                {uniqueLocations.slice(0, 6).map((loc: any, i: number) => (
                  <FadeInSection key={loc.id} delay={i * 0.1 + 0.2}>
                    <motion.div 
                      className="group h-full"
                      initial={{ opacity: 0, y: 30 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      whileHover={{ y: -8 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    >
                      <Card className="h-full border-0 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 bg-white overflow-hidden">
                        {/* Kitchen Image */}
                        <div className="relative h-44 overflow-hidden">
                          {(loc.brandImageUrl || loc.featuredKitchenImage) ? (
                            <>
                              <img 
                                src={loc.brandImageUrl || loc.featuredKitchenImage || ''}
                                alt={loc.name}
                                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
                                onError={(e) => {
                                  // If image fails to load, hide it and show placeholder
                                  console.error(`[ChefLanding] Image failed to load:`, loc.brandImageUrl || loc.featuredKitchenImage);
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  const parent = target.parentElement;
                                  if (parent) {
                                    const placeholder = parent.querySelector('.image-placeholder') as HTMLElement;
                                    if (placeholder) placeholder.style.display = 'flex';
                                  }
                                }}
                                onLoad={() => {
                                  // Debug: log successful image load
                                  if (process.env.NODE_ENV === 'development') {
                                    console.log(`[ChefLanding] Image loaded successfully:`, loc.brandImageUrl || loc.featuredKitchenImage);
                                  }
                                }}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                              {/* Placeholder that shows if image fails to load */}
                              <div className="image-placeholder absolute inset-0 bg-gradient-to-br from-[#FFE8DD] via-[#FFF0EB] to-white flex items-center justify-center" style={{ display: 'none' }}>
                                <div className="w-16 h-16 bg-gradient-to-br from-[#F51042]/15 to-[#FF6B6B]/10 rounded-xl flex items-center justify-center">
                                  <Building2 className="h-8 w-8 text-[#F51042]" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-[#FFE8DD] via-[#FFF0EB] to-white flex items-center justify-center">
                              <div className="w-16 h-16 bg-gradient-to-br from-[#F51042]/15 to-[#FF6B6B]/10 rounded-xl flex items-center justify-center">
                                <Building2 className="h-8 w-8 text-[#F51042]" />
                              </div>
                            </div>
                          )}
                          
                          {/* Kitchen count badge */}
                          {loc.kitchenCount > 1 && (
                            <div className="absolute top-3 right-3 bg-white rounded-full px-3 py-1 shadow-md">
                              <span className="text-xs font-bold text-[#F51042]">{loc.kitchenCount} Kitchens</span>
                            </div>
                          )}
                          
                          {/* Logo overlay */}
                          {loc.logoUrl && (
                            <div className="absolute top-3 left-3">
                              <img 
                                src={loc.logoUrl} 
                                alt={`${loc.name} logo`}
                                className="h-10 w-auto object-contain bg-white rounded-lg p-1.5 shadow-md"
                                onError={(e) => {
                                  // If logo fails to load, hide it
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                          
                          {/* Status badge */}
                          <div className="absolute bottom-3 left-3">
                            <span className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                              Available
                            </span>
                          </div>
                        </div>
                        
                        {/* Content */}
                        <div className="p-5">
                          <h3 className="text-lg font-bold text-[#1A1A1A] mb-1 group-hover:text-[#F51042] transition-colors">
                            {loc.name}
                          </h3>
                          {loc.address && (
                            <p className="text-sm text-[#6B6B6B] flex items-start gap-1.5 mb-4">
                              <span className="text-[#F51042]">📍</span>
                              <span className="leading-relaxed line-clamp-2">{loc.address}</span>
                            </p>
                          )}
                          
                          <Button 
                            className="w-full bg-[#1A1A1A] hover:bg-[#F51042] text-white font-semibold rounded-lg py-2.5 text-sm transition-all duration-300 group/btn"
                            onClick={() => navigate(`/kitchen-preview/${loc.id}`)}
                          >
                            <Calendar className="mr-1.5 h-4 w-4" />
                            View Availability
                            <ArrowRight className="ml-1.5 h-4 w-4 group-hover/btn:translate-x-0.5 transition-transform" />
                          </Button>
                        </div>
                      </Card>
                    </motion.div>
                  </FadeInSection>
                ))}
              </div>
            ) : !kitchensLoading ? (
              /* Placeholder - Coming Soon Cards */
              <FadeInSection delay={0.3}>
                <div className="grid md:grid-cols-3 gap-6 mb-16">
                  {[
                    { title: "Downtown Kitchen", area: "St. John's Downtown" },
                    { title: "East End Kitchen", area: "East End, St. John's" },
                    { title: "West Side Kitchen", area: "West Side, St. John's" }
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      whileHover={{ y: -4 }}
                    >
                      <Card className="h-64 border-0 rounded-2xl shadow-lg bg-white overflow-hidden">
                        <div className="h-36 bg-gradient-to-br from-[#FFE8DD] via-[#FFF5F0] to-white flex items-center justify-center relative">
                          <div className="w-14 h-14 bg-gradient-to-br from-[#F51042]/15 to-[#FF6B6B]/10 rounded-xl flex items-center justify-center">
                            <Building2 className="h-7 w-7 text-[#F51042]" />
                          </div>
                          <div className="absolute top-3 right-3 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full">
                            Coming Soon
                          </div>
                        </div>
                        <div className="p-4">
                          <h3 className="text-base font-bold text-[#1A1A1A] mb-0.5">{item.title}</h3>
                          <p className="text-sm text-[#6B6B6B] flex items-center gap-1.5">
                            <span className="text-[#F51042]">📍</span>
                            {item.area}
                          </p>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </FadeInSection>
            ) : null}

            {/* Partner CTA - Container Card with Bento Grid Inside */}
            <FadeInSection delay={0.4}>
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
                    <img 
                      src={kitchenTableIcon} 
                      alt="Kitchen" 
                      className="w-12 h-12 object-contain"
                    />
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B] block mb-1">
                        For Kitchen Owners
                      </span>
                      <h3 className="text-xl md:text-2xl font-bold text-[#1A1A1A] leading-tight">
                        Turn Downtime Into{" "}
                        <span className="relative inline-block">
                          <span className="text-[#F51042]">Revenue</span>
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
                  
                  <p className="text-sm text-[#6B6B6B] mb-4 max-w-xl">
                    Don't let your kitchen sit empty. Rent your underutilized hours to vetted local chefs.
                  </p>

                  {/* Bento Grid - Award-Winning Card Design with Background Icons */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Weekly Payouts Card */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#4A90A4] to-[#2D6A7A] rounded-xl p-4 text-white overflow-hidden min-h-[140px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <CreditCard className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Reliable Income
                        </span>
                        <h4 className="text-xl font-bold leading-tight mb-2">
                          Weekly Payouts
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          Get paid every week directly to your account. No waiting.
                        </p>
                      </div>
                    </motion.div>

                    {/* Verified Chefs Card - Rich Violet (complementary to coral) */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#7C5295] to-[#5D3D70] rounded-xl p-4 text-white overflow-hidden min-h-[140px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Shield className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Verified
                        </span>
                        <h4 className="text-xl font-bold leading-tight mb-2">
                          Food Safety
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          All chefs are certified and follow strict standards.
                        </p>
                      </div>
                    </motion.div>

                    {/* Total Control Card */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#F5A623] to-[#E8940D] rounded-xl p-4 text-white overflow-hidden min-h-[140px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Zap className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Your Space
                        </span>
                        <h4 className="text-xl font-bold leading-tight mb-2">
                          Total Control
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          Set your own hours, pricing, and kitchen rules.
                        </p>
                      </div>
                    </motion.div>

                    {/* No Contracts Card */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#2D3E50] to-[#1A2530] rounded-xl p-4 text-white overflow-hidden min-h-[140px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Clock className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Flexible
                        </span>
                        <h4 className="text-xl font-bold leading-tight mb-2">
                          No Contracts
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          Cancel anytime. No long-term commitments required.
                        </p>
                      </div>
                    </motion.div>
                  </div>
                </div>

                {/* Bottom Lip with Buttons */}
                <div className="bg-[#FAFAFA] border-t border-gray-100 px-4 md:px-6 py-4">
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <p className="text-sm text-[#6B6B6B] hidden sm:block">
                      Join kitchen partners earning passive income
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button 
                        onClick={() => window.location.href = 'mailto:partner@localcooks.ca?subject=Kitchen Partnership Inquiry'}
                        className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold py-2.5 px-6 rounded-full text-sm transition-all duration-300 group"
                      >
                        Become a Partner
                        <ArrowRight className="ml-1.5 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={() => window.location.href = 'https://kitchens.localcooks.ca'}
                        className="border border-[#2C2C2C]/20 text-[#2C2C2C] hover:border-[#F51042] hover:text-[#F51042] font-semibold py-2.5 px-6 rounded-full text-sm transition-all duration-300"
                      >
                        Learn More
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </FadeInSection>
          </div>
        </section>

        {/* ══════ BOTTOM WAVE DIVIDER - Primary Red to Light ══════ */}
        <div className="relative w-full overflow-hidden" style={{ height: '100px', marginTop: '-2px' }}>
          <svg 
            viewBox="0 0 1440 100" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            className="absolute top-0 w-full"
            style={{ height: '100px', minWidth: '100%' }}
            preserveAspectRatio="none"
          >
            <path 
              d="M0,60 C150,20 350,100 600,50 C850,0 1050,80 1200,40 C1350,0 1440,60 1440,60 L1440,0 L0,0 Z" 
              fill="#E8103A"
              opacity="0.7"
            />
            <path 
              d="M0,40 C200,0 400,80 650,30 C900,-20 1100,60 1250,20 C1400,-20 1440,40 1440,40 L1440,0 L0,0 Z" 
              fill="#F51042"
            />
          </svg>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            TESTIMONIALS CAROUSEL - Thrive Childcare Centers Style
        ═══════════════════════════════════════════════════════════════════════ */}
        <TestimonialCarouselSection />

        {/* ═══════════════════════════════════════════════════════════════════════
            TRIAL BANNER - Strong Emphasis
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="py-16 px-4 bg-gradient-to-r from-emerald-500 via-green-500 to-emerald-500 text-white">
          <div className="container mx-auto max-w-4xl text-center">
            <FadeInSection>
              <div className="flex items-center justify-center gap-3 mb-4">
                <Sparkles className="h-8 w-8" />
                <h3 className="text-3xl md:text-4xl font-bold">We're in Trial Mode</h3>
                <Sparkles className="h-8 w-8" />
              </div>
              <p className="text-xl md:text-2xl mb-8 opacity-95">
                Join now and <span className="font-bold underline">keep 100% of your sales</span>. 
                <br className="hidden md:block" />
                We only charge standard payment processing — no platform fees.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <div className="flex items-center gap-2 bg-white/20 backdrop-blur px-5 py-3 rounded-full">
                  <Zap className="h-5 w-5" />
                  <span className="font-semibold">0% Platform Fees</span>
                </div>
                <div className="flex items-center gap-2 bg-white/20 backdrop-blur px-5 py-3 rounded-full">
                  <Shield className="h-5 w-5" />
                  <span className="font-semibold">Full Support Included</span>
                </div>
                <div className="flex items-center gap-2 bg-white/20 backdrop-blur px-5 py-3 rounded-full">
                  <Rocket className="h-5 w-5" />
                  <span className="font-semibold">Perfect Time to Start</span>
                </div>
              </div>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            FAQ
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="py-20 md:py-28 px-4 bg-white">
          <div className="container mx-auto max-w-3xl">
            <FadeInSection>
              <div className="text-center mb-12">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-[#F51042] mb-4 px-4 py-2 bg-[#F51042]/10 rounded-full">
                  Questions
                </span>
                <h2 className="font-display text-4xl md:text-5xl text-[#F51042]">FAQ</h2>
              </div>
            </FadeInSection>

            <FadeInSection delay={1}>
              <Accordion type="single" collapsible className="space-y-3">
                {[
                  { q: "How long does approval take?", a: "15 minutes to apply. 24 hours to hear back. Most chefs are approved and live the same day." },
                  { q: "What happens during trial?", a: "You keep 100% of sales. Only standard payment processing (2.9% + 30¢) applies—no platform fees. Full support included." },
                  { q: "Do I need a commercial kitchen?", a: "No! Access certified kitchens by the hour through our marketplace. Pay only for what you use." },
                  { q: "Can I do this part-time?", a: "Absolutely. Set your own availability. Many chefs start alongside their day job and scale up gradually." },
                  { q: "Can I leave anytime?", a: "Yes. No contracts, no commitments. You're an independent business owner." },
                  { q: "How do I get paid?", a: "Secure payments via Stripe go directly to your bank. Weekly automatic payouts." },
                ].map((item, i) => (
                  <AccordionItem key={i} value={`item-${i}`} className="border border-gray-100 rounded-xl bg-white px-6 shadow-sm">
                    <AccordionTrigger className="text-left text-lg font-semibold text-[#2C2C2C] py-5 hover:no-underline hover:text-[#F51042]">
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
        <section className="relative py-24 md:py-32 px-4 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#F51042] via-[#E8103A] to-[#D90935]" />
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-10 left-10 w-96 h-96 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-10 w-80 h-80 bg-white rounded-full blur-3xl" />
          </div>
          
          <div className="container mx-auto max-w-3xl text-center relative z-10">
            <FadeInSection>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
                Your Cooking Deserves
                <br />
                <span className="text-white/90">More Than This.</span>
              </h2>
              <p className="text-xl text-white/90 mb-10 max-w-xl mx-auto">
                Stop juggling DMs. Stop chasing payments. Start building your culinary business the right way.
              </p>
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-white text-[#F51042] hover:bg-gray-100 font-bold py-7 px-14 text-xl rounded-full shadow-2xl hover:shadow-white/30 hover:-translate-y-1 transition-all"
              >
                Apply as Chef
                <ArrowRight className="ml-3 h-6 w-6" />
              </Button>
              <p className="text-white/70 mt-6 text-sm">
                Approved in 24 hours • Keep 100% during trial • No contracts
              </p>
            </FadeInSection>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
