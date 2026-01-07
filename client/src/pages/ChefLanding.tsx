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
  CreditCard, Truck, Instagram, Phone, Calendar, ChevronLeft, ChevronRight,
  HeartHandshake, HandCoins
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
      text: "Local Cooks has been a great partner for Sababa Cafe NL. Orders are handled smoothly, delivery is reliable, and the platform helps us share fresh, homemade Middle Eastern food with more customers across the city.",
      name: "Dafna",
      role: "Sababa Cafe NL",
      color: "#fc7545", // Light Pink/Orange
      textColor: "#2C2C2C",
    },
    {
      text: "Local Cooks has been great at taking any suggestions to the site and implementing them as best they can. The delivery driver always shows up in a timely manner and my customers love to have the delivery option when they are not able to make it in to the market.",
      name: "Emily",
      role: "The Waffle Lady",
      color: "#06516D", // Royal Blue
      textColor: "#ffffff",
    },
    {
      text: "Many of our previous customers were unable to receive our sweets because we did not have a delivery system. The local cook delivery system has given us this opportunity at a low price. They don't just deliver, they also promote and support local chefs.",
      name: "Kanij",
      role: "Misti Mountain",
      color: "#30524e", // Dark Teal/Green
      textColor: "#ffffff",
    },
    {
      text: "Local Cooks makes it easy for people in St. John’s to get our loaded fries and bold global flavours every Friday. Preorders and delivery run smoothly, and they actively promote Alu Bhaja so more customers can discover our food.",
      name: "Fardin",
      role: "Alu Bhaja",
      color: "#ff8c42", // Orange
      textColor: "#2C2C2C",
    },
  ];

  return (
    <section id="testimonials" className="py-20 md:py-32 px-4 bg-white relative overflow-visible">
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

// Typewriter component - exact implementation from localcooks.ca
// Source: https://github.com/Raunak-Sarmacharya/LCLanding
// Modified: Fixed-width container locks word position, only cursor moves
function TypewriterText() {
  const words = ["Cooks", "Company", "Community"];
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [cursorX, setCursorX] = useState(0);

  const currentWord = words[currentWordIndex];
  const typingSpeed = 120;
  const deletingSpeed = 80;
  const pauseDuration = 2500;

  // Find longest word and measure its width
  const longestWord = words.reduce((a, b) => (a.length > b.length ? a : b));

  // Measure longest word to set fixed container width
  useEffect(() => {
    if (measureRef.current) {
      const width = measureRef.current.offsetWidth;
      setContainerWidth(width);
    }
  }, []);

  // Update cursor position as text changes - cursor moves, text stays fixed
  useEffect(() => {
    if (textRef.current) {
      requestAnimationFrame(() => {
        if (textRef.current) {
          const textWidth = textRef.current.offsetWidth;
          setCursorX(textWidth);
        }
      });
    }
  }, [currentText]);

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
    <span className="inline-flex items-baseline text-3xl md:text-4xl lg:text-5xl">
      {/* Hidden element to measure longest word width */}
      <span
        ref={measureRef}
        className="font-logo absolute opacity-0 pointer-events-none whitespace-nowrap"
        style={{ 
          fontFamily: "'Lobster', cursive",
          visibility: 'hidden',
          fontSize: 'inherit'
        }}
      >
        {longestWord}
      </span>
      
      <span 
        className="font-logo text-white whitespace-nowrap" 
        style={{ fontFamily: "'Lobster', cursive" }}
      >
        Local
      </span>
      <span 
        className="relative ml-3 md:ml-4 inline-block whitespace-nowrap"
        style={{ 
          width: containerWidth > 0 ? `${containerWidth + 20}px` : 'auto',
          textAlign: 'left',
          minWidth: containerWidth > 0 ? `${containerWidth + 20}px` : 'auto'
        }}
      >
        <span
          ref={textRef}
          className="font-logo inline-block text-white whitespace-nowrap"
          style={{ 
            fontFamily: "'Lobster', cursive"
          }}
        >
          {currentText}
        </span>
        <span 
          className="typewriter-cursor absolute top-0"
          style={{
            backgroundColor: 'white',
            left: `${cursorX}px`,
            marginLeft: '4px',
            height: '1em'
          }}
        />
      </span>
    </span>
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
        // Log the actual data received from API (works in production too)
        console.log("[ChefLanding] API Response - Locations data:", data);
        if (Array.isArray(data) && data.length > 0) {
          console.log("[ChefLanding] First location sample:", {
            id: data[0].id,
            name: data[0].name,
            featuredKitchenImage: data[0].featuredKitchenImage,
            logoUrl: data[0].logoUrl
          });
        }
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
    if (!locations || locations.length === 0) {
      console.log("[ChefLanding] No locations data available");
      return [];
    }
    // Locations already come with normalized URLs from the API
    const mapped = locations.map((loc: any) => {
      // Use featuredKitchenImage from actual kitchens for the main card image
      const mainImage = loc.featuredKitchenImage || null;
      
      // Always log in production to debug
      console.log(`[ChefLanding] Processing Location ${loc.id} (${loc.name}):`, {
        featuredKitchenImage: loc.featuredKitchenImage,
        mainImage: mainImage,
        logoUrl: loc.logoUrl,
        hasMainImage: !!mainImage
      });
      
      return {
        id: loc.id,
        name: loc.name,
        address: loc.address || "",
        logoUrl: loc.logoUrl || null,
        featuredKitchenImage: loc.featuredKitchenImage || null,
        mainImage: mainImage, // Combined image for display
        kitchenCount: loc.kitchenCount || 1
      };
    });
    console.log(`[ChefLanding] Processed ${mapped.length} locations`);
    return mapped;
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
            {/* Mobile-only "Monetize Your Cooking" pill - appears above image on mobile */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-6 block lg:hidden"
            >
              <div className="relative inline-flex items-center gap-2 bg-[#F51042] text-white px-4 py-2 rounded-full border border-[#F51042]/30">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent"></div>
                <HandCoins className="h-3.5 w-3.5 relative z-10" />
                <span className="font-semibold text-xs tracking-wide relative z-10">Monetize Your Cooking</span>
              </div>
            </motion.div>

            <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center min-h-[calc(100vh-200px)]">
              
              {/* Left Content Column */}
              <div className="order-2 lg:order-1">
                {/* Trial Badge - Desktop only */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="mb-8 hidden lg:block"
                >
                  <div className="relative inline-flex items-center gap-2 bg-[#F51042] text-white px-4 py-2 rounded-full shadow-xl shadow-[#F51042]/40 border border-[#F51042]/30">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent"></div>
                    <HandCoins className="h-3.5 w-3.5 relative z-10" />
                    <span className="font-semibold text-xs tracking-wide relative z-10">Monetize Your Cooking</span>
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
                  <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#2C2C2C] leading-[1.15] mb-6">
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
                  <p className="text-sm md:text-base lg:text-lg text-[#6B6B6B] leading-relaxed max-w-lg">
                    <span className="block mb-3">
                      Your passion deserves a platform that keeps up.
                    </span>
                    <span className="block">
                      We handle regulatory guidance, kitchen access, order management, payments, delivery logistics, and fuel your growth — so you can focus entirely on creating exceptional food.
                    </span>
                  </p>
                </motion.div>

                {/* CTA Buttons */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.7 }}
                  className="flex flex-row gap-2 md:gap-4 mb-10"
                >
                  <Button
                    onClick={handleGetStarted}
                    size="lg"
                    className="group relative bg-[#F51042] hover:bg-[#D90E3A] text-white font-bold py-4 px-4 md:py-7 md:px-12 text-xs md:text-lg rounded-full transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-[#F51042]/30 hover:-translate-y-1 overflow-hidden flex-1"
                  >
                    <span className="relative z-10 flex items-center justify-center">
                      Start Your Journey
                    <ArrowRight className="ml-1 md:ml-2 h-3.5 w-3.5 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
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
                    className="border-2 border-[#2C2C2C]/20 text-[#2C2C2C] hover:border-[#F51042] hover:text-[#F51042] hover:bg-[#F51042]/5 font-semibold py-4 px-4 md:py-7 md:px-10 text-xs md:text-lg rounded-full transition-all duration-300 flex-1"
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
                  className="flex flex-nowrap md:flex-wrap gap-x-2 md:gap-x-6 gap-y-3"
                >
                  {[
                    { icon: CheckCircle2, text: "Approved in 24 hours" },
                    { icon: Shield, text: "No upfront costs" },
                    { icon: HeartHandshake, text: "Dedicated support every step" }
                  ].map((item, i) => (
                    <motion.span 
                      key={i}
                      className="flex items-center gap-1 md:gap-2 text-[#6B6B6B] text-[10px] md:text-sm whitespace-nowrap flex-shrink-0"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 1 + (i * 0.1) }}
                    >
                      <item.icon className="h-3 w-3 md:h-4 md:w-4 text-emerald-500 flex-shrink-0" />
                      <span className="leading-tight">{item.text}</span>
                    </motion.span>
                  ))}
                </motion.div>
              </div>

              {/* Right Image Column */}
              <div className="order-1 lg:order-2 relative overflow-visible">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: 50 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
                  className="relative overflow-visible"
                >
                  {/* Decorative background shapes */}
                  <div className="absolute -inset-4 bg-gradient-to-br from-[#F51042]/10 via-[#FFE8DD]/50 to-[#FFD700]/20 rounded-[2.5rem] transform rotate-3" />
                  <div className="absolute -inset-4 bg-gradient-to-tr from-[#FFE8DD]/80 to-white/60 rounded-[2.5rem] transform -rotate-2" />
                  
                  {/* Main Image Container */}
                  <div className="relative rounded-[2rem] overflow-visible shadow-2xl shadow-[#F51042]/10 w-full">
                    <div className="relative rounded-[2rem] overflow-hidden w-full">
                      <img 
                        src={chefImage} 
                        alt="Professional home chef cooking with passion" 
                        className="w-full h-auto object-cover aspect-[4/3]"
                      />
                      
                      {/* Gradient Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    </div>
                    
                    {/* Trial Card - Centered Bottom, Partially Inside/Outside */}
                    <motion.div
                      initial={{ opacity: 0, y: 20, x: '-50%' }}
                      animate={{ opacity: 1, y: '30%', x: '-50%' }}
                      transition={{ duration: 0.7, delay: 1.2, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute bottom-0 left-1/2 bg-white rounded-xl lg:rounded-2xl px-2.5 py-2 lg:px-4 lg:py-3 shadow-[0_8px_32px_rgba(0,0,0,0.12)] ring-1 ring-slate-900/5 z-20 w-[calc(100%-2rem)] max-w-[18rem] lg:max-w-[28rem]"
                    >
                      <div className="flex items-center justify-between gap-2 lg:gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-[8px] lg:text-[9px] font-semibold text-slate-500 uppercase tracking-[0.15em] leading-none mb-0.5 lg:mb-1">During Trial</p>
                          <p className="text-sm lg:text-base font-bold text-slate-950 leading-tight mb-1 lg:mb-1.5">0% Platform Fee</p>
                          <div className="flex items-center gap-2 lg:gap-4">
                            <div className="flex items-center gap-0.5 lg:gap-1">
                              <div className="w-0.5 h-0.5 lg:w-1 lg:h-1 rounded-full bg-slate-400"></div>
                              <span className="text-[9px] lg:text-[10px] font-semibold text-slate-700">Zero barriers</span>
                            </div>
                            <div className="flex items-center gap-0.5 lg:gap-1">
                              <div className="w-0.5 h-0.5 lg:w-1 lg:h-1 rounded-full bg-slate-400"></div>
                              <span className="text-[9px] lg:text-[10px] font-semibold text-slate-700">Zero waiting</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right pl-2 lg:pl-4 border-l border-slate-200">
                          <p className="text-[8px] lg:text-[9px] font-semibold text-slate-500 uppercase tracking-[0.15em] leading-none mb-0.5 lg:mb-1">You Keep</p>
                          <p className="text-lg lg:text-xl font-bold text-[#F51042] leading-tight">100%</p>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                
                {/* Premium Floating Cards - Positioned to overlap frame significantly */}
                
                {/* Premium Floating Tag - Top Right: "Built for Chefs. Powered by community." */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.6, delay: 1.4, type: "spring", stiffness: 200 }}
                  className="absolute top-0 -right-3 lg:top-4 lg:-right-6 bg-white/95 backdrop-blur-md rounded-xl lg:rounded-2xl shadow-2xl px-2 py-1.5 lg:px-4 lg:py-3 border border-slate-200/50 z-20"
                  style={{ transform: 'translateY(-20%)' }}
                >
                    <div className="flex items-center gap-1.5 lg:gap-2.5">
                      <div className="w-6 h-6 lg:w-9 lg:h-9 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-lg lg:rounded-xl flex items-center justify-center shadow-lg shadow-teal-500/30 flex-shrink-0">
                        <Heart className="h-3.5 w-3.5 lg:h-5 lg:w-5 text-white" />
                      </div>
                    <div>
                      <p className="text-[8px] lg:text-[10px] font-medium text-slate-600 uppercase tracking-wide leading-tight">Built for Chefs</p>
                      <p className="text-[10px] lg:text-xs font-bold text-slate-900 leading-tight">Powered by community</p>
                    </div>
                  </div>
                </motion.div>

                {/* Premium Floating Tag - Top Left: "Fast approval" */}
                <motion.div
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, delay: 1.6, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-0 -left-3 lg:top-8 lg:-left-10 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                  style={{ transform: 'translateY(-30%)' }}
                >
                  <div className="flex items-center gap-1.5 lg:gap-2">
                    <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-slate-700 to-slate-800 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                      <Zap className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                    </div>
                    <span className="text-[10px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">Fast approval</span>
                  </div>
                </motion.div>

                {/* Premium Floating Tag - Middle Right: "Join chefs who've already launched" */}
                <motion.div
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, delay: 1.8, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-[32%] -right-3 lg:top-[28%] lg:-right-12 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                >
                  <div className="flex items-center gap-1.5 lg:gap-2">
                    <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-slate-700 to-slate-800 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                      <Rocket className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                    </div>
                    <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">Join chefs who've already launched</span>
                  </div>
                </motion.div>

                {/* Premium Floating Tag - Middle Left: "More time cooking, less time managing" */}
                <motion.div
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, delay: 2.0, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-[40%] -left-3 lg:top-[38%] lg:-left-10 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                >
                  <div className="flex items-center gap-1.5 lg:gap-2">
                    <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                      <Clock className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                    </div>
                    <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">More time cooking, less time managing</span>
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
                    className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-[1.35] md:leading-tight mb-5 md:mb-6"
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
                    className="text-sm md:text-base lg:text-lg text-[#4A5568] leading-relaxed font-medium"
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
                    className="text-sm md:text-base lg:text-lg text-[#1A1A1A] font-semibold mt-6"
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.7 }}
                    viewport={{ once: true }}
                  >
                    Sound familiar? Stop juggling. Start creating.
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
                    <p className="text-xs text-[#64748B] mt-0.5">Fragmented tools. Disconnected workflows.</p>
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
                    <p className="text-sm font-bold text-[#0D9488]">Powered by <span className="font-display text-sm text-[#F51042]">LocalCooks</span></p>
                    <p className="text-xs text-[#64748B] mt-0.5">One unified platform. Seamless operations.</p>
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
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-tight mb-4"
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
                
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="text-[#6B6B6B] text-sm md:text-base lg:text-lg"
                >
                  Join passionate chefs earning real money doing what they love.
                </motion.p>
              </div>
            </FadeInSection>

            {/* Steps - 3 Column Grid with White Cards */}
            <div className="grid md:grid-cols-3 gap-4 md:gap-6 lg:gap-8 mb-12 md:mb-16">
              
              {/* Step 1 - Apply (Coral/Red accent) */}
              <FadeInSection delay={1}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="group h-full"
                >
                  <div className="relative h-full bg-white rounded-2xl p-5 md:p-6 lg:p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100">
                    {/* Step Number Badge */}
                    <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-5">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-[#F51042] to-[#FF6B7A] flex items-center justify-center shadow-md shadow-[#F51042]/20 group-hover:scale-110 transition-transform duration-300">
                        <span className="text-white font-bold text-xs md:text-sm">1</span>
                      </div>
                      <span className="font-mono text-xs md:text-[10px] uppercase tracking-[0.15em] text-[#F51042]/60">Step One</span>
                    </div>
                    
                    <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C] mb-1">Apply</h3>
                    <p className="text-xs md:text-sm font-medium text-[#F51042] mb-2 md:mb-3">Less than 5 minutes</p>
                    
                    <p className="text-[#6B6B6B] leading-relaxed text-xs md:text-sm">
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
                  <div className="relative h-full bg-white rounded-2xl p-5 md:p-6 lg:p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100">
                    {/* Step Number Badge */}
                    <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-5">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-[#0D9488] to-[#14B8A6] flex items-center justify-center shadow-md shadow-[#0D9488]/20 group-hover:scale-110 transition-transform duration-300">
                        <span className="text-white font-bold text-xs md:text-sm">2</span>
                      </div>
                      <span className="font-mono text-xs md:text-[10px] uppercase tracking-[0.15em] text-[#0D9488]/60">Step Two</span>
                    </div>
                    
                    <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C] mb-1">We Get You Live</h3>
                    <p className="text-xs md:text-sm font-medium text-[#0D9488] mb-2 md:mb-3">Approved in 24 hours</p>
                    
                    <p className="text-[#6B6B6B] leading-relaxed text-xs md:text-sm">
                    We review your application against regulatory standards and connect you with everything you need to launch. Documentation ready or not, we've got you covered.
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
                  <div className="relative h-full bg-white rounded-2xl p-5 md:p-6 lg:p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100">
                    {/* Step Number Badge */}
                    <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-5">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-[#F59E0B] to-[#FBBF24] flex items-center justify-center shadow-md shadow-[#F59E0B]/20 group-hover:scale-110 transition-transform duration-300">
                        <span className="text-white font-bold text-xs md:text-sm">3</span>
                      </div>
                      <span className="font-mono text-xs md:text-[10px] uppercase tracking-[0.15em] text-[#F59E0B]/60">Step Three</span>
                    </div>
                    
                    <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C] mb-1">Build Your Menu & Sell</h3>
                    <p className="text-xs md:text-sm font-medium text-[#F59E0B] mb-2 md:mb-3">Start earning today</p>
                    
                    <p className="text-[#6B6B6B] leading-relaxed text-xs md:text-sm">
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
              <div className="mb-10 md:mb-12">
                <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                  <h3 className="text-base md:text-lg lg:text-xl font-bold text-[#2C2C2C]">What You Get</h3>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                </div>
                
                <div className="grid grid-cols-3 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
                  {[
                    { text: "Sell from home or a commercial kitchen — pick what works for you.", icon: Building2, borderColor: "border-[#F51042]/20", iconColor: "text-[#F51042]" },
                    { text: "We handle the complexity — regulations, certifications, partnerships taken care of.", icon: Shield, borderColor: "border-[#0D9488]/20", iconColor: "text-[#0D9488]" },
                    { text: "Smart tools that grow with you — built for chefs, shaped by your needs, evolving constantly.", icon: Sparkles, borderColor: "border-[#8B5CF6]/20", iconColor: "text-[#8B5CF6]" },
                    { text: "You stay in control — your schedule, your recipes, your profit margins.", icon: Zap, borderColor: "border-[#F59E0B]/20", iconColor: "text-[#F59E0B]" },
                    { text: "Money flows weekly — fast payouts, direct to your bank.", icon: CreditCard, borderColor: "border-[#F51042]/20", iconColor: "text-[#F51042]" },
                    { text: "Real support behind you — actual people who want you to win.", icon: Heart, borderColor: "border-[#0D9488]/20", iconColor: "text-[#0D9488]" },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      whileHover={{ y: -2, scale: 1.01 }}
                      className="group"
                    >
                      <div className={`h-full bg-white rounded-lg md:rounded-xl p-2.5 md:p-4 border ${item.borderColor} hover:shadow-md transition-all duration-300`}>
                        <div className="flex flex-col items-center text-center gap-1.5 md:flex-row md:items-start md:text-left md:gap-2.5">
                          <div className="flex-shrink-0">
                            <item.icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${item.iconColor}`} />
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

            {/* CTA Section */}
            <FadeInSection>
              <div className="text-center">
                <p className="text-sm md:text-base lg:text-lg font-semibold text-[#2C2C2C] mb-4 md:mb-6">Ready?</p>
                
                <Button 
                  onClick={handleGetStarted} 
                  className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-bold py-4 px-4 md:py-6 md:px-12 text-xs md:text-lg rounded-full shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                >
                  <span className="flex items-center justify-center">
                    Start Your Application
                    <ArrowRight className="ml-1.5 md:ml-2 h-3.5 w-3.5 md:h-5 md:w-5" />
                  </span>
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
        <section id="kitchen-access" className="relative py-20 md:py-28 px-4 overflow-hidden bg-[#F51042]">
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
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                  className="mb-4"
                >
                  <span className="inline-flex items-center gap-2 font-mono text-xs md:text-xs uppercase tracking-[0.3em] text-white/90 px-4 py-2 bg-white/15 backdrop-blur-md rounded-full border border-white/20">
                    <Building2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
                    Kitchen Access
                  </span>
                </motion.div>
                
                <motion.h2 
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight mb-4"
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
                  className="text-sm md:text-base lg:text-lg text-white/85 leading-relaxed max-w-5xl mx-auto"
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
                  <FadeInSection key={loc.id} delay={Math.min(i % 4, 3) as 0 | 1 | 2 | 3}>
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
                          {(() => {
                            // Get the image URL, filtering out empty strings
                            const imageUrl = (loc.mainImage || loc.featuredKitchenImage || '').trim();
                            const hasValidImage = imageUrl && imageUrl.length > 0;
                            
                            if (!hasValidImage) {
                              console.warn(`[ChefLanding] No valid image URL for ${loc.name}:`, {
                                mainImage: loc.mainImage,
                                featuredKitchenImage: loc.featuredKitchenImage
                              });
                            }
                            
                            return hasValidImage ? (
                              <>
                                <img 
                                  src={imageUrl}
                                  alt={loc.name}
                                  className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
                                  onError={(e) => {
                                    // If image fails to load, hide it and show placeholder
                                    console.error(`[ChefLanding] ❌ Image failed to load for ${loc.name}:`, {
                                      imageUrl,
                                      mainImage: loc.mainImage,
                                      featuredKitchenImage: loc.featuredKitchenImage,
                                      allLocationData: loc
                                    });
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    const parent = target.parentElement;
                                    if (parent) {
                                      const placeholder = parent.querySelector('.image-placeholder') as HTMLElement;
                                      if (placeholder) placeholder.style.display = 'flex';
                                    }
                                  }}
                                  onLoad={() => {
                                    // Always log successful image load (works in production)
                                    console.log(`[ChefLanding] ✅ Image loaded successfully for ${loc.name}:`, imageUrl);
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
                            ) : null;
                          })()}
                          {!loc.mainImage && !loc.featuredKitchenImage && (
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
                            className="w-full bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold rounded-lg py-2.5 text-sm transition-all duration-300 group/btn"
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
              <FadeInSection delay={1}>
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
                          <h3 className="text-lg md:text-xl font-bold text-[#1A1A1A] mb-0.5">{item.title}</h3>
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
                    <img 
                      src={kitchenTableIcon} 
                      alt="Kitchen" 
                      className="w-12 h-12 object-contain"
                    />
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B] block mb-1">
                        For Kitchen Owners
                      </span>
                      <h3 className="text-lg md:text-xl lg:text-2xl font-bold text-[#1A1A1A] leading-tight">
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
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-3">
                    {/* Reliable Weekly Revenue Card */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#4A90A4] to-[#2D6A7A] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <CreditCard className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Reliable Income
                        </span>
                        <h4 className="text-base font-bold leading-tight mb-2">
                          Weekly Revenue
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          Forget chasing invoices. We process payments automatically and deposit them directly to your bank account every week. Predictable cash flow, zero administrative headaches.
                        </p>
                      </div>
                    </motion.div>

                    {/* Zero Risk, Total Compliance Card - Rich Violet (complementary to coral) */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#7C5295] to-[#5D3D70] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Shield className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Zero Risk
                        </span>
                        <h4 className="text-base font-bold leading-tight mb-2">
                          Total Compliance
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          Every chef on our platform is verified and certified. We enforce provincial food safety standards so your license—and your reputation—are never at risk.
                        </p>
                      </div>
                    </motion.div>

                    {/* Intelligent Hourly Management Card */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#0D9488] to-[#0F766E] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Calendar className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Automated
                        </span>
                        <h4 className="text-base font-bold leading-tight mb-2">
                          Booking Management
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          Our automated booking engine handles the logistics. You set the available slots; our system fills them. Real-time syncing means no double-bookings, ever.
                        </p>
                      </div>
                    </motion.div>

                    {/* Your Kitchen, Your Rules Card */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#F5A623] to-[#E8940D] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Zap className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Your Control
                        </span>
                        <h4 className="text-base font-bold leading-tight mb-2">
                          Your Rules
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          Maintain complete operational sovereignty. You determine the hourly rate, the specific equipment access, and the house rules.
                        </p>
                      </div>
                    </motion.div>

                    {/* Frictionless Flexibility Card */}
                    <motion.div 
                      className="relative bg-gradient-to-br from-[#2D3E50] to-[#1A2530] rounded-xl p-4 text-white overflow-hidden min-h-[160px]"
                      whileHover={{ scale: 1.02, y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Background Icon */}
                      <Clock className="absolute -bottom-2 -right-2 h-20 w-20 text-white/10" />
                      
                      <div className="relative z-10">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/70 block mb-2">
                          Flexible
                        </span>
                        <h4 className="text-base font-bold leading-tight mb-2">
                          Frictionless Flexibility
                        </h4>
                        <p className="text-xs text-white/80 leading-relaxed">
                          No long-term contracts. No exclusivity clauses. Cancel or pause your listing instantly. You remain the owner; we just bring the revenue.
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
                        onClick={() => window.location.href = 'mailto:admin@localcook.shop?subject=Kitchen Partnership Inquiry'}
                        className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold py-2.5 px-6 rounded-full text-sm transition-all duration-300 group"
                      >
                        Become a Partner
                        <ArrowRight className="ml-1.5 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={() => window.location.href = 'https://kitchen.localcooks.ca'}
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
            FAQ
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="faq" className="py-20 md:py-28 px-4 bg-white">
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
                  { q: "How do I get paid and how much do I keep?", a: "You keep 100% of your earnings during the trial period—we only deduct Stripe's payment processing fee (2.9% + $0.30 per transaction). Payments hit your bank account every week via direct deposit. No waiting around. No complicated calculations. You cook, customers order, money arrives." },
                  { q: "What does Local Cooks handle for me?", a: "You focus on what you do best—cooking. We handle everything else. We manage customer orders, process payments securely, coordinate delivery logistics, provide ongoing platform support, and guide you through food safety regulations and certification requirements. We also partner you with verified commercial kitchens if you need them—hourly rentals, no long-term commitments. Think of us as your business operations team. You run the kitchen. We run the rest." },
                  { q: "How long does approval take?", a: "Most approvals happen within 24 hours. We review your food handler certification, verify your kitchen access, and get you live fast—so you can start earning as soon as possible. Your dedicated onboarding specialist will guide you through the process step-by-step and answer any questions along the way." },
                  { q: "Do I need a commercial kitchen?", a: "No. You can cook from your licensed home kitchen or rent one of our partner commercial kitchens by the hour. Choose what works for you—no long-term commitments, no hidden fees. We'll guide you through the certification requirements for your setup and help you understand local food safety regulations so you launch with confidence." },
                  { q: "What happens during the trial?", a: "Your trial is your risk-free window to test the platform without any pressure. You keep 100% of your sales (minus Stripe's processing fee only—zero platform fees). No contracts. No commitments. No strings attached. Use this time to build your menu, connect with your first customers, understand how the platform works, and see if it's the right fit for your culinary business. If it's not, walk away anytime with no penalties." },
                  { q: "Can I do this part-time?", a: "Yes. Set your own hours, take orders when you want, and pause your availability anytime. Local Cooks works around your schedule—whether you're doing this full-time or alongside other work. Many of our chefs use Local Cooks as a side income stream or test their menu before going full-time. It's completely flexible." },
                  { q: "Can I leave anytime?", a: "Yes. No contracts. No penalties. No minimum commitment. Pause your profile, take a break, or delete it entirely—your choice, anytime. Your culinary business is yours to control." },
                  { q: "Can I set my own menu and prices?", a: "Completely. You have full control over your menu, pricing, and availability. Add dishes, remove dishes, adjust prices, update descriptions—all on your terms. Change things anytime based on what your customers love, what's in season, or what you feel like cooking." },
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
                >
                  From Passion to Profit.
                  <br />
                  <span className="relative inline-block">
                    <span className="text-white/95">On Your Terms.</span>
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
              <motion.p 
                className="text-base md:text-lg lg:text-xl text-white/90 mb-5 md:mb-6 max-w-4xl mx-auto leading-tight font-medium md:whitespace-nowrap md:overflow-hidden md:text-ellipsis"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                You've spent years perfecting your craft. You deserve to keep the rewards.
              </motion.p>

              {/* Brand Statement - Single line on desktop */}
              <motion.p 
                className="text-sm md:text-base lg:text-lg text-white/85 mb-6 md:mb-8 max-w-5xl mx-auto leading-tight md:whitespace-nowrap md:overflow-hidden md:text-ellipsis"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                LocalCooks is the platform built for passionate chefs—where your cooking becomes your income.
              </motion.p>

              {/* Three Truths Section - Centered */}
              <motion.div 
                className="mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <p className="text-xs md:text-sm text-white/75 mb-4 font-medium tracking-wider uppercase">
                  We built LocalCooks around three simple truths:
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
                  className="bg-white text-[#F51042] hover:bg-gray-100 font-bold py-6 px-12 text-lg md:text-xl rounded-full shadow-2xl hover:shadow-white/30 hover:-translate-y-1 transition-all"
                >
                  Join LocalCooks
                  <ArrowRight className="ml-3 h-5 w-5 md:h-6 md:w-6" />
                </Button>
                <p className="text-white/70 mt-5 text-xs md:text-sm">
                  Approved in 24 hours • Keep 100% during trial • No contracts
                </p>
              </motion.div>
            </FadeInSection>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
