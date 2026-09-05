import { useTranslation } from "react-i18next";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";
import CustomerSupportButton from "@/components/CustomerSupportButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import FadeInSection from "@/components/ui/FadeInSection";
import { 
  Building2, Calendar, ArrowRight, CheckCircle2, Shield, 
  Clock, DollarSign, Zap, TrendingUp, Lock,
  CreditCard, Package, Wrench, HandCoins, HeartHandshake,
  Settings, Eye, BadgeCheck, Wallet, MessageCircle, Scale, ClipboardCheck
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState, useRef, useCallback } from "react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { landingListKitchenPath } from "@/lib/landing-cta";
import { motion, useScroll, useTransform, MotionValue } from "framer-motion";
import { SmartImage } from "@/components/ui/smart-image";
import emptyKitchenImage from "@assets/emptykitchen.png";
import DashboardIcon from "../../../attached_assets/Dashboard.svg";
import BookingIcon from "../../../attached_assets/Booking_k.svg";
import EarnIcon from "../../../attached_assets/Earn_K.svg";
import HoursEquipmentIcon from "../../../attached_assets/HoursEquipment_K.svg";
import RulesIcon from "../../../attached_assets/Rules_K.svg";
import VerifiedIcon from "../../../attached_assets/Verified_K.svg";
import WeeklyDepositIcon from "../../../attached_assets/WeekyDeposit_K.svg";

// ═══════════════════════════════════════════════════════════════════════════════
// KITCHEN LANDING PAGE - Award-Winning Design for Kitchen Owners
// Inspired by Airbnb, The Food Corridor, and top marketplace platforms
// ═══════════════════════════════════════════════════════════════════════════════

// Floating revenue icons for parallax effect
interface FloatingIconProps {
  Icon: React.ElementType;
  position: { x: number; y: number };
  size: number;
  depth: 1 | 2 | 3;
  rotation: number;
  parallaxY: number;
  color: string;
  scrollYProgress: MotionValue<number>;
  hideOn?: 'mobile' | 'tablet' | 'desktop';
}

function FloatingIcon({
  Icon,
  position,
  size,
  depth,
  rotation,
  parallaxY,
  color,
  scrollYProgress,
  hideOn,
}: FloatingIconProps) {
  const depthConfig = {
    1: { opacity: 0.9, scale: 1, baseZ: 30 },
    2: { opacity: 0.7, scale: 1, baseZ: 20 },
    3: { opacity: 0.5, scale: 1, baseZ: 10 },
  };

  const config = depthConfig[depth];
  const y = useTransform(scrollYProgress, [0, 1], [parallaxY, -parallaxY]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1.02, 0.98]);

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
        rotate: rotation,
        zIndex: config.baseZ,
        opacity: config.opacity,
        willChange: 'transform',
      }}
      initial={{ opacity: 0, scale: 0.7, y: 30 }}
      whileInView={{ opacity: config.opacity, scale: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
      viewport={{ once: true, margin: "-5%" }}
    >
      <div
        className="rounded-2xl p-3 shadow-lg"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          transform: 'translateZ(0)',
        }}
      >
        <Icon className="w-full h-full text-white" />
      </div>
    </motion.div>
  );
}

// Scroll-linked floating icons for the pain point section
function ScrollLinkedRevenueIcons() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  return (
    <div 
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-visible -m-2.5 sm:-m-10 p-2.5 sm:p-10"
      aria-hidden="true"
    >
      {/* Desktop Layout */}
      <FloatingIcon
        Icon={DollarSign}
        position={{ x: 5, y: 5 }}
        size={72}
        depth={1}
        rotation={-12}
        parallaxY={150}
        color="#10B981"
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />
      <FloatingIcon
        Icon={TrendingUp}
        position={{ x: 85, y: 15 }}
        size={68}
        depth={1}
        rotation={8}
        parallaxY={130}
        color="#0D9488"
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />
      <FloatingIcon
        Icon={Calendar}
        position={{ x: 12, y: 45 }}
        size={58}
        depth={2}
        rotation={6}
        parallaxY={100}
        color="#F59E0B"
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />
      <FloatingIcon
        Icon={Package}
        position={{ x: 80, y: 55 }}
        size={62}
        depth={2}
        rotation={-5}
        parallaxY={110}
        color="#8B5CF6"
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />
      <FloatingIcon
        Icon={Wrench}
        position={{ x: 3, y: 75 }}
        size={54}
        depth={3}
        rotation={-8}
        parallaxY={80}
        color="#EC4899"
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />
      <FloatingIcon
        Icon={CreditCard}
        position={{ x: 88, y: 82 }}
        size={50}
        depth={3}
        rotation={10}
        parallaxY={70}
        color="#3B82F6"
        scrollYProgress={scrollYProgress}
        hideOn="mobile"
      />

      {/* Mobile Layout - lighter, edge-positioned icons to avoid overlap */}
      <div className="sm:hidden">
        <FloatingIcon
          Icon={DollarSign}
          position={{ x: 6, y: 4 }}
          size={42}
          depth={1}
          rotation={-10}
          parallaxY={45}
          color="#10B981"
          scrollYProgress={scrollYProgress}
        />
        <FloatingIcon
          Icon={TrendingUp}
          position={{ x: 86, y: 18 }}
          size={38}
          depth={1}
          rotation={6}
          parallaxY={40}
          color="#0D9488"
          scrollYProgress={scrollYProgress}
        />
        <FloatingIcon
          Icon={Calendar}
          position={{ x: 4, y: 72 }}
          size={38}
          depth={2}
          rotation={4}
          parallaxY={35}
          color="#F59E0B"
          scrollYProgress={scrollYProgress}
        />
        <FloatingIcon
          Icon={Package}
          position={{ x: 88, y: 64 }}
          size={34}
          depth={2}
          rotation={-5}
          parallaxY={30}
          color="#8B5CF6"
          scrollYProgress={scrollYProgress}
        />
      </div>
    </div>
  );
}
// Typewriter component for kitchen types
function KitchenTypewriter() {
  const { t } = useTranslation("kitchen");
  const words = ["Revenue", "Freedom", "Impact"];
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
  const longestWord = words.reduce((a, b) => (a.length > b.length ? a : b));

  useEffect(() => {
    if (measureRef.current) {
      const width = measureRef.current.offsetWidth;
      setContainerWidth(width);
    }
  }, []);

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
      if (currentText.length < currentWord.length) {
        setCurrentText(currentWord.slice(0, currentText.length + 1));
      } else {
        setIsPaused(true);
        setTimeout(() => {
          setIsPaused(false);
          setIsDeleting(true);
        }, pauseDuration);
      }
    } else {
      if (currentText.length > 0) {
        setCurrentText(currentWord.slice(0, currentText.length - 1));
      } else {
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
      <span
        ref={measureRef}
        className="font-logo absolute opacity-0 pointer-events-none whitespace-nowrap"
        style={{ fontFamily: "'Lobster', cursive", visibility: 'hidden', fontSize: 'inherit' }}
      >
        {longestWord}
      </span>
      
      <span className="font-logo text-white whitespace-nowrap" style={{ fontFamily: "'Lobster', cursive" }}>{t("real")}</span>
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
          style={{ fontFamily: "'Lobster', cursive" }}
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

export default function KitchenLanding() {
  const { t } = useTranslation("kitchen");
  const { user } = useFirebaseAuth();
  const [, setLocation] = useLocation();

  const revenueSectionRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress: revenueScrollY } = useScroll({
    target: revenueSectionRef,
    offset: ["start end", "end start"],
  });
  const dashboardParallaxY = useTransform(revenueScrollY, [0, 1], [30, -20]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash) {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    if (window.location.hash) {
      setTimeout(handleHashChange, 100);
    }
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleListKitchen = () => {
    setLocation(landingListKitchenPath(user));
  };

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <SEOHead
        title={t("seoKitchenTitle")}
        description={t("listYourCommercialKitchenSeo")}
        canonicalUrl="/"
        keywords={[
          "list commercial kitchen", "kitchen rental income", "rent out kitchen St Johns",
          "commercial kitchen marketplace", "kitchen sharing platform", "idle kitchen revenue",
          "kitchen booking platform", "commissary kitchen NL", "commercial kitchen Newfoundland",
          "kitchen owner income", "localcooks kitchen", "rent kitchen space",
        ]}
        showLocalBusiness
        breadcrumbs={[
          { name: "LocalCooks", url: "https://www.localcooks.ca/" },
          { name: t("breadcrumbKitchenOwners"), url: "https://kitchen.localcooks.ca/" },
        ]}
        faq={[
          { question: t("kitchenFaqQ1"), answer: t("kitchenFaqA1") },
          { question: t("kitchenFaqQ2"), answer: t("kitchenFaqA2") },
          { question: t("kitchenFaqQ3"), answer: t("kitchenFaqA3") },
          { question: t("kitchenFaqQ4"), answer: t("kitchenFaqA4") },
        ]}
        siteNavigation={[
          { name: t("kitchenNavList"), description: t("kitchenNavListDesc"), url: "https://kitchen.localcooks.ca/" },
          { name: t("kitchenNavChefs"), description: t("kitchenNavChefsDesc"), url: "https://chef.localcooks.ca/" },
          { name: t("kitchenNavBook"), description: t("kitchenNavBookDesc"), url: "https://chef.localcooks.ca/book-kitchen" },
          { name: t("kitchenNavOrder"), description: t("kitchenNavOrderDesc"), url: "https://localcook.shop/" },
          { name: t("kitchenNavBlog"), description: t("kitchenNavBlogDesc"), url: "https://www.localcooks.ca/blog" },
          { name: t("kitchenNavContact"), description: t("kitchenNavContactDesc"), url: "https://www.localcooks.ca/contact" },
        ]}
      />
      <CustomerSupportButton />
      <Header />
      
      <main className="flex-grow">
        {/* ═══════════════════════════════════════════════════════════════════════
            HERO SECTION - Premium Split-Screen Design for Kitchen Owners
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="overview" className="relative min-h-screen flex items-center overflow-hidden">
          {/* Sophisticated Background */}
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-br from-[#F0FDF9] via-[#F5FFFC] to-white" />
            
            <motion.div 
              className="absolute -top-[20%] -right-[10%] w-[800px] h-[800px] rounded-full"
              style={{ background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)" }}
              animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.8, 0.6] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            
            <motion.div 
              className="absolute bottom-[10%] left-[5%] w-[500px] h-[500px] rounded-full"
              style={{ background: "radial-gradient(circle, rgba(13,148,136,0.12) 0%, transparent 70%)" }}
              animate={{ scale: [1, 1.05, 1], x: [0, 20, 0] }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            />

            <div className="absolute inset-0 opacity-[0.015]" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }} />
          </div>

          <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 md:pt-28 pb-12 sm:pb-14 md:pb-16 relative z-10">
            {/* Mobile-only Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-6 block lg:hidden"
            >
              <div className="relative inline-flex items-center gap-2 bg-gradient-to-r from-[#F51042] to-rose-500 text-white px-4 py-2 rounded-full border border-[#F51042]/30">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent"></div>
                <HandCoins className="h-3.5 w-3.5 relative z-10" />
                <span className="font-semibold text-xs tracking-wide relative z-10">{t("turnIdleHoursIntoIncome")}</span>
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
                  <div className="relative inline-flex items-center gap-2 bg-gradient-to-r from-[#F51042] to-rose-500 text-white px-4 py-2 rounded-full shadow-xl shadow-[#F51042]/40 border border-[#F51042]/30">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent"></div>
                    <HandCoins className="h-3.5 w-3.5 relative z-10" />
                    <span className="font-semibold text-xs tracking-wide relative z-10">{t("turnIdleHoursIntoIncome")}</span>
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
                  <p className="font-mono text-[10px] md:text-[11px] text-[#4A6A5F] uppercase tracking-[0.4em] mb-8">{t("forKitchenOwnersDreamBigger")}</p>
                </motion.div>

                {/* Main Headline with Loss Aversion Psychology */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.5 }}
                  className="mb-8"
                >
                  <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#2C2C2C] leading-[1.15] mb-6">{t("stopLeavingMoney")}<br />
                    <span className="relative inline-block">
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-rose-500 to-[#F51042]">{t("onTheTable")}</span>
                      <motion.svg 
                        className="absolute -bottom-2 left-0 w-full" 
                        viewBox="0 0 250 12" 
                        fill="none"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 1, delay: 1.2 }}
                      >
                        <motion.path 
                          d="M2 8C40 3 80 3 125 6C170 9 210 5 248 8" 
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
                    <span className="block mb-3 font-semibold text-[#2C2C2C]">{t("untappedEarningPotential")}</span>
                    <span className="block">
                      Rent your underutilized hours, storage, and equipment to verified local chefs. 
                      Generate $500+ /month passively while supporting the growing local food community.
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
                    onClick={handleListKitchen}
                    size="lg"
                    className="group relative bg-gradient-to-r from-[#F51042] to-rose-500 hover:from-rose-500 hover:to-[#F51042] text-white font-bold py-3 sm:py-4 md:py-7 px-4 sm:px-6 md:px-12 text-xs sm:text-sm md:text-lg rounded-full transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-[#F51042]/40 hover:-translate-y-1 overflow-hidden flex-1 min-h-[44px] sm:min-h-[48px]"
                  >
                    <span className="relative z-10 flex items-center justify-center">{t("getStarted")}<ArrowRight className="ml-1 md:ml-2 h-3.5 w-3.5 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="border-2 border-[#2C2C2C]/20 text-[#2C2C2C] hover:border-[#F51042] hover:text-[#F51042] hover:bg-rose-50 font-semibold py-3 sm:py-4 md:py-7 px-4 sm:px-6 md:px-10 text-xs sm:text-sm md:text-lg rounded-full transition-all duration-300 flex-1 min-h-[44px] sm:min-h-[48px]"
                    onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                  >{t("seeHowItWorks")}</Button>
                </motion.div>

                {/* Trust Indicators */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.9 }}
                  className="flex flex-nowrap md:flex-wrap gap-x-2 md:gap-x-6 gap-y-3"
                >
                  {[
                    { icon: CheckCircle2, text: t("zeroPlatformFeeTrial") },
                    { icon: Shield, text: t("verifiedRentersOnly") },
                    { icon: HeartHandshake, text: t("fullInsuranceCoverage") }
                  ].map((item, i) => (
                    <motion.span 
                      key={i}
                      className="flex items-center gap-1 md:gap-2 text-[#6B6B6B] text-[10px] md:text-sm whitespace-nowrap flex-shrink-0"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 1 + (i * 0.1) }}
                    >
                      <item.icon className="h-3 w-3 md:h-4 md:w-4 text-[#F51042] flex-shrink-0" />
                      <span className="leading-tight">{item.text}</span>
                    </motion.span>
                  ))}
                </motion.div>
              </div>

              {/* Right Image Column - Kitchen with Floating Benefit Cards */}
              <div className="order-1 lg:order-2 relative overflow-visible">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: 50 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
                  className="relative overflow-visible"
                >
                  {/* Decorative background shapes */}
                  <div className="absolute -inset-4 bg-gradient-to-br from-rose-100/30 via-rose-50/40 to-rose-100/10 rounded-[2.5rem] transform rotate-3" />
                  <div className="absolute -inset-4 bg-gradient-to-tr from-rose-50/90 to-white/70 rounded-[2.5rem] transform -rotate-2" />
                  
                  {/* Main Image Container */}
                  <div className="relative rounded-[2rem] overflow-visible shadow-2xl shadow-rose-400/20 w-full">
                    <div className="relative rounded-[2rem] overflow-hidden w-full">
                      <SmartImage 
                        src={emptyKitchenImage} 
                        alt={t("altKitchenRental")} 
                        className="w-full h-auto object-cover aspect-[4/3]"
                        loading="eager"
                        fetchPriority="high"
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
                          <p className="text-[8px] lg:text-[9px] font-semibold text-slate-500 uppercase tracking-[0.15em] leading-none mb-0.5 lg:mb-1">{t("duringTrial")}</p>
                          <p className="text-sm lg:text-base font-bold text-slate-950 leading-tight mb-1 lg:mb-1.5">{t("zeroPlatformFee")}</p>
                          <div className="flex items-center gap-2 lg:gap-4">
                            <div className="flex items-center gap-0.5 lg:gap-1">
                              <div className="w-0.5 h-0.5 lg:w-1 lg:h-1 rounded-full bg-[#F51042]"></div>
                              <span className="text-[9px] lg:text-[10px] font-semibold text-slate-700">{t("hundredYours")}</span>
                            </div>
                            <div className="flex items-center gap-0.5 lg:gap-1">
                              <div className="w-0.5 h-0.5 lg:w-1 lg:h-1 rounded-full bg-[#F51042]"></div>
                              <span className="text-[9px] lg:text-[10px] font-semibold text-slate-700">{t("zeroRisk")}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right pl-2 lg:pl-4 border-l border-slate-200">
                          <p className="text-[8px] lg:text-[9px] font-semibold text-slate-500 uppercase tracking-[0.15em] leading-none mb-0.5 lg:mb-1">{t("youKeep")}</p>
                          <p className="text-lg lg:text-xl font-bold text-[#F51042] leading-tight">100%</p>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                
                  {/* Premium Floating Benefit Cards */}
                  
                  {/* Top Right: Passive Income */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, delay: 1.4, type: "spring", stiffness: 200 }}
                    className="absolute top-0 -right-3 lg:top-4 lg:-right-6 bg-white/95 backdrop-blur-md rounded-xl lg:rounded-2xl shadow-2xl px-2 py-1.5 lg:px-4 lg:py-3 border border-slate-200/50 z-20"
                    style={{ transform: 'translateY(-20%)' }}
                  >
                    <div className="flex items-center gap-1.5 lg:gap-2.5">
                      <div className="w-8 h-8 lg:w-11 lg:h-11 bg-gradient-to-br from-[#F51042] to-rose-500 rounded-lg lg:rounded-xl flex items-center justify-center shadow-lg shadow-[#F51042]/30 flex-shrink-0">
                        <img
                          src={EarnIcon}
                          alt={t("altEarnAway")}
                          className="h-6 w-6 lg:h-8 lg:w-8 object-contain"
                        />
                      </div>
                      <div>
                        <p className="text-[8px] lg:text-[10px] font-medium text-slate-600 uppercase tracking-wide leading-tight">{t("earnWhileAway")}</p>
                        <p className="text-[10px] lg:text-xs font-bold text-slate-900 leading-tight">{t("fiveHundredPlusPerMonth")}</p>
                      </div>
                    </div>
                  </motion.div>

                  {/* Top Left: Automated Bookings */}
                  <motion.div
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6, delay: 1.6, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute top-0 -left-3 lg:top-8 lg:-left-10 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                    style={{ transform: 'translateY(-30%)' }}
                  >
                    <div className="flex items-center gap-1.5 lg:gap-2">
                      <div className="w-5 h-5 lg:w-7 lg:h-7 bg-gradient-to-br from-violet-500 to-purple-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <img
                          src={BookingIcon}
                          alt={t("altAutoBooking")}
                          className="h-4 w-4 lg:h-5 lg:w-5 object-contain"
                        />
                      </div>
                      <span className="text-[10px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">{t("automatedBooking")}</span>
                    </div>
                  </motion.div>

                  {/* Middle Right: Verified Chefs */}
                  <motion.div
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6, delay: 1.8, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute top-[32%] -right-3 lg:top-[28%] lg:-right-12 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                  >
                    <div className="flex items-center gap-1.5 lg:gap-2">
                      <div className="w-5 h-5 lg:w-7 lg:h-7 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <img
                          src={VerifiedIcon}
                          alt={t("altVerifiedChefs")}
                          className="h-4 w-4 lg:h-5 lg:w-5 object-contain"
                        />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">{t("everyRenterVerified")}</span>
                    </div>
                  </motion.div>

                  {/* Middle Left: Weekly Payments */}
                  <motion.div
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6, delay: 2.0, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute top-[40%] -left-3 lg:top-[38%] lg:-left-10 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                  >
                    <div className="flex items-center gap-1.5 lg:gap-2">
                      <div className="w-6 h-6 lg:w-8 lg:h-8 bg-gradient-to-br from-amber-500 to-orange-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <img
                          src={WeeklyDepositIcon}
                          alt={t("altWeeklyDeposits")}
                          className="h-5 w-5 lg:h-6 lg:w-6 object-contain"
                        />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">{t("weeklyDeposits")}</span>
                    </div>
                  </motion.div>

                  {/* Bottom Right: Full Control */}
                  <motion.div
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6, delay: 2.2, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute top-[58%] -right-3 lg:top-[55%] lg:-right-8 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                  >
                    <div className="flex items-center gap-1.5 lg:gap-2">
                      <div className="w-5 h-5 lg:w-7 lg:h-7 bg-gradient-to-br from-rose-500 to-pink-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <img
                          src={RulesIcon}
                          alt={t("altRulesSchedule")}
                          className="h-4 w-4 lg:h-5 lg:w-5 object-contain"
                        />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">{t("yourRulesRates")}</span>
                    </div>
                  </motion.div>

                  {/* Bottom Left: Multiple Revenue Streams */}
                  <motion.div
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6, delay: 2.4, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute top-[65%] -left-3 lg:top-[62%] lg:-left-6 bg-white rounded-lg lg:rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-1.5 lg:px-3.5 lg:py-2.5 border border-slate-200/60 ring-1 ring-slate-900/5 z-20"
                  >
                    <div className="flex items-center gap-1.5 lg:gap-2">
                      <div className="w-6 h-6 lg:w-8 lg:h-8 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <img
                          src={HoursEquipmentIcon}
                          alt={t("altHoursStorage")}
                          className="h-5 w-5 lg:h-6 lg:w-6 object-contain"
                        />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">{t("hoursStorageEquip")}</span>
                    </div>
                  </motion.div>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            THE PROBLEM - Lost Revenue Section with Floating Icons
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="lost-revenue" className="relative scroll-mt-24 py-20 md:py-28 px-4 bg-gradient-to-b from-rose-50/40 via-white to-white overflow-hidden">
          <ScrollLinkedRevenueIcons />
          
          <div className="container mx-auto max-w-4xl relative z-10">
            <FadeInSection>
              <div className="text-center">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-[#F51042] mb-4 px-4 py-2 bg-rose-100 rounded-full">{t("opportunityMissing")}</span>
                
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-tight mb-6"
                >
                  {t("everyEmptyHourIs")}{" "}
                  <span className="relative inline-block">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 via-red-500 to-rose-600">{t("moneyWalkingOut")}</span>
                    <motion.svg 
                      className="absolute -bottom-1 md:-bottom-2 left-0 w-full" 
                      viewBox="0 0 400 12" 
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1.2, delay: 0.6 }}
                      viewport={{ once: true }}
                    >
                      <motion.path 
                        d="M2 8C60 3 140 3 200 6C260 9 340 5 398 8" 
                        stroke="#F43F5E"
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
                
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                  className="max-w-2xl mx-auto"
                >
                  <p className="text-sm md:text-base lg:text-lg text-[#6B6B6B] leading-relaxed mb-8">
                    {t("coldStorageQuestion")}{" "}
                    <span className="font-semibold text-[#2C2C2C] block sm:inline whitespace-nowrap">{t("lostRevenue")}</span>
                    <br />
                    {t("equipmentDustQuestion")}{" "}
                    <span className="font-semibold text-[#2C2C2C] block sm:inline whitespace-nowrap">{t("depreciatingAssets")}</span>
                    <br />
                    {t("emptyAfternoonQuestion")}{" "}
                    <span className="font-semibold text-[#2C2C2C] block sm:inline whitespace-nowrap">{t("missedIncome")}</span>
                  </p>
                  
                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-4 md:gap-8 mt-12">
                    {[
                      { stat: "40%", label: t("avgUtilization"), subtext: t("beforeLocalCooks") },
                      { stat: "$500+", label: t("monthlyLostRevenue"), subtext: t("fromIdleHoursAlone") },
                      { stat: "85%", label: t("avgUtilizationAfter"), subtext: t("withLocalCooks") },
                    ].map((item, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, delay: 0.4 + (i * 0.1) }}
                        className="text-center"
                      >
                        <p className="text-3xl md:text-4xl lg:text-5xl font-black text-[#F51042] mb-2">{item.stat}</p>
                        <p className="text-xs md:text-sm font-semibold text-[#2C2C2C] mb-1">{item.label}</p>
                        <p className="text-[10px] md:text-xs text-[#6B6B6B]">{item.subtext}</p>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              </div>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            REVENUE STREAMS - Premium Bento Grid Design
        ═══════════════════════════════════════════════════════════════════════ */}
        <section
          id="revenue-streams"
          ref={revenueSectionRef}
          className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-slate-50/50 to-white relative overflow-hidden"
        >
          {/* Subtle background decoration */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 right-0 w-[600px] h-[600px] bg-gradient-radial from-rose-100/50 to-transparent rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 left-0 w-[500px] h-[500px] bg-gradient-radial from-teal-100/30 to-transparent rounded-full blur-3xl" />
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            {/* Section Header */}
            <FadeInSection>
              <div className="mb-16 md:mb-20">
                <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-8">
                  <div className="text-center md:text-left max-w-2xl">
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.5 }}
                      className="inline-flex items-center gap-2 bg-rose-50 border border-rose-200/60 rounded-full px-4 py-2 mb-6"
                    >
                      <div className="w-2 h-2 rounded-full bg-[#F51042] animate-pulse" />
                      <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#F51042] font-medium">{t("revenueStreams")}</span>
                    </motion.div>
                    
                    <motion.h2
                      initial={{ opacity: 0, y: 30 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.7, delay: 0.1 }}
                      className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 leading-tight mb-4"
                    >{t("multipleRevenueStreams")}<br />
                      <span className="relative inline-block mt-2">
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-rose-500 to-[#F51042]">{t("oneDashboard")}</span>
                        <motion.svg 
                          className="absolute -bottom-2 left-0 w-full" 
                          viewBox="0 0 280 12" 
                          fill="none"
                          initial={{ pathLength: 0, opacity: 0 }}
                          whileInView={{ pathLength: 1, opacity: 1 }}
                          transition={{ duration: 1.2, delay: 0.6 }}
                          viewport={{ once: true }}
                        >
                          <motion.path 
                            d="M2 8C45 3 90 3 140 6C190 9 235 5 278 8" 
                            stroke="url(#gradient-underline-kitchen)"
                            strokeWidth="3" 
                            strokeLinecap="round"
                            initial={{ pathLength: 0 }}
                            whileInView={{ pathLength: 1 }}
                            transition={{ duration: 1.2, delay: 0.6 }}
                            viewport={{ once: true }}
                          />
                          <defs>
                        <linearGradient id="gradient-underline-kitchen" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#F51042" />
                          <stop offset="50%" stopColor="#FB7185" />
                          <stop offset="100%" stopColor="#F51042" />
                            </linearGradient>
                          </defs>
                        </motion.svg>
                      </span>
                    </motion.h2>
                    
                    <motion.p 
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.2 }}
                      className="text-sm md:text-base lg:text-lg text-slate-600 leading-relaxed"
                    >{t("maximizeEveryDollar")}</motion.p>
                  </div>

                  {/* Dashboard Illustration */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: 10 }}
                    whileInView={{ opacity: 1, scale: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                    style={{ y: dashboardParallaxY }}
                    className="hidden md:block flex-shrink-0"
                  >
                    <div className="relative">
                    <div className="absolute -inset-10 bg-gradient-to-br from-[#F51042]/20 via-rose-400/15 to-rose-300/20 rounded-full blur-3xl" />
                      <SmartImage
                        src={DashboardIcon}
                        alt={t("altRevenueDashboard")}
                        className="relative w-64 lg:w-80 h-auto object-contain drop-shadow-[0_18px_40px_rgba(15,118,110,0.25)]"
                      />
                    </div>
                  </motion.div>
                </div>
              </div>
            </FadeInSection>

            {/* Premium Bento Grid - 2x2 Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 lg:gap-8">
              
              {/* Card 1: Hourly Kitchen Rentals */}
              <FadeInSection delay={0}>
                <motion.div
                  className="group relative h-full"
                  whileHover={{ y: -8 }}
                  transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-[#F51042]/20 to-rose-400/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative h-full bg-white rounded-3xl border border-slate-200/80 p-8 md:p-10 shadow-[0_4px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(245,16,66,0.2)] hover:border-rose-200/60 transition-all duration-500 overflow-hidden">
                    {/* Decorative gradient orb */}
                    <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-[#F51042]/20 to-rose-400/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                    
                    {/* Icon */}
                    <div className="relative mb-6">
                      <div className="w-14 h-14 bg-gradient-to-br from-[#F51042] to-rose-500 rounded-2xl flex items-center justify-center shadow-lg shadow-[#F51042]/25 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                        <Clock className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="relative">
                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-slate-900 mb-3 group-hover:text-[#F51042] transition-colors duration-300">{t("hourlyRentals")}</h3>
                      
                      <div className="inline-flex items-center gap-2 bg-rose-50 rounded-full px-4 py-1.5 mb-5">
                        <span className="text-xs md:text-sm font-semibold text-[#F51042]">{t("typicalRangeHourly")}</span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-xs md:text-sm">{t("fillYourCalendar")}</p>
                    </div>
                  </div>
                </motion.div>
              </FadeInSection>
              
              {/* Card 2: Storage That Pays */}
              <FadeInSection delay={1}>
                <motion.div
                  className="group relative h-full"
                  whileHover={{ y: -8 }}
                  transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/20 to-purple-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative h-full bg-white rounded-3xl border border-slate-200/80 p-8 md:p-10 shadow-[0_4px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(139,92,246,0.15)] hover:border-violet-200/60 transition-all duration-500 overflow-hidden">
                    {/* Decorative gradient orb */}
                    <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-violet-400/20 to-purple-400/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                    
                    {/* Icon */}
                    <div className="relative mb-6">
                      <div className="w-14 h-14 bg-gradient-to-br from-violet-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/25 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                        <Package className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="relative">
                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-slate-900 mb-3 group-hover:text-violet-700 transition-colors duration-300">{t("storageThatPays")}</h3>
                      
                      <div className="inline-flex items-center gap-2 bg-violet-50 rounded-full px-4 py-1.5 mb-5">
                        <span className="text-xs md:text-sm font-semibold text-violet-700">{t("typicalRangeStorage")}</span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-xs md:text-sm">{t("monetizeEveryShelf")}</p>
                    </div>
                  </div>
                </motion.div>
              </FadeInSection>
              
              {/* Card 3: Equipment Rental */}
              <FadeInSection delay={2}>
                <motion.div
                  className="group relative h-full"
                  whileHover={{ y: -8 }}
                  transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative h-full bg-white rounded-3xl border border-slate-200/80 p-8 md:p-10 shadow-[0_4px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(245,158,11,0.15)] hover:border-amber-200/60 transition-all duration-500 overflow-hidden">
                    {/* Decorative gradient orb */}
                    <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-amber-400/20 to-orange-400/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                    
                    {/* Icon */}
                    <div className="relative mb-6">
                      <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/25 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                        <Wrench className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="relative">
                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-slate-900 mb-3 group-hover:text-amber-700 transition-colors duration-300">{t("equipmentRental")}</h3>
                      
                      <div className="inline-flex items-center gap-2 bg-amber-50 rounded-full px-4 py-1.5 mb-5">
                        <span className="text-xs md:text-sm font-semibold text-amber-700">{t("typicalAddonsEquip")}</span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-xs md:text-sm">{t("blastChillersAssets")}</p>
                    </div>
                  </div>
                </motion.div>
              </FadeInSection>
              
              {/* Card 4: Custom Programs & Premium Uses */}
              <FadeInSection delay={3}>
                <motion.div
                  className="group relative h-full"
                  whileHover={{ y: -8 }}
                  transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-[#F51042]/18 to-rose-400/18 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative h-full bg-white rounded-3xl border border-slate-200/80 p-8 md:p-10 shadow-[0_4px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(245,16,66,0.18)] hover:border-rose-200/60 transition-all duration-500 overflow-hidden">
                    {/* Decorative elements */}
                    <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-[#F51042]/20 to-rose-400/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                    
                    {/* Icon */}
                    <div className="relative mb-6">
                      <div className="w-14 h-14 bg-gradient-to-br from-rose-400 to-[#F51042] rounded-2xl flex items-center justify-center shadow-lg shadow-[#F51042]/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                        <Zap className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="relative">
                      <h3 className="text-base md:text-lg lg:text-xl font-bold text-slate-900 mb-3">{t("customPrograms")}</h3>
                      
                      <div className="inline-flex items-center gap-2 bg-rose-50 rounded-full px-4 py-1.5 mb-5 border border-rose-100">
                        <span className="text-xs md:text-sm font-medium text-[#F51042]">{t("monthlyMemberships")}</span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-xs md:text-sm">{t("whenYourSpaceHasMore")}</p>
                    </div>
                  </div>
                </motion.div>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* ══════ WAVE DIVIDER ══════ */}
        <div className="relative w-full overflow-hidden" style={{ height: '100px', marginTop: '-1px' }}>
          <svg 
            viewBox="0 0 1440 320" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            className="absolute top-0 w-full"
            style={{ height: '100px', minWidth: '100%' }}
            preserveAspectRatio="none"
          >
            <path 
              fill="#F51042" 
              fillOpacity="1" 
              d="M0,160L48,170.7C96,181,192,203,288,192C384,181,480,139,576,128C672,117,768,139,864,154.7C960,171,1056,181,1152,165.3C1248,149,1344,107,1392,85.3L1440,64L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            HOW IT WORKS - From Idle Space to Active Revenue
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="how-it-works" className="scroll-mt-24 py-20 md:py-28 px-4 bg-[#F51042] text-white relative overflow-hidden">
          {/* Background decorations */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-20 w-96 h-96 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-white rounded-full blur-3xl" />
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-12 md:mb-16">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-white/80 mb-4 px-4 py-2 bg-white/10 rounded-full">{t("listKitchenToday")}</span>
                <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-4">
                  {t("idleSpaceToRevenueIn")}{" "}
                  <span className="relative inline-block">
                    <span className="text-white">{t("threeSteps")}</span>
                    <motion.svg 
                      className="absolute -bottom-2 left-0 w-full" 
                      viewBox="0 0 400 12" 
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1.2, delay: 0.6 }}
                      viewport={{ once: true }}
                    >
                      <motion.path 
                        d="M2 8C60 3 140 3 200 6C260 9 340 5 398 8" 
                        stroke="rgba(255,255,255,0.6)"
                        strokeWidth="3" 
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        transition={{ duration: 1.2, delay: 0.6 }}
                        viewport={{ once: true }}
                      />
                    </motion.svg>
                  </span>
                </h2>
                <p className="text-sm md:text-base lg:text-lg text-white/80 max-w-3xl mx-auto leading-relaxed">{t("strippedAwayComplexity")}</p>
              </div>
            </FadeInSection>

            {/* Steps */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-16">
              {/* Step 01 */}
              <FadeInSection delay={0}>
                <motion.div
                  className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-white/20 h-full min-h-[260px]"
                  whileHover={{ y: -4, backgroundColor: "rgba(255,255,255,0.15)" }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-4xl font-black text-white/40">01</span>
                  </div>
                  <h3 className="text-base md:text-lg lg:text-xl font-bold mb-3">{t("listIn15Mins")}<br/ >{t("getLiveIn24h")}</h3>
                  <p className="text-white/80 leading-relaxed text-xs md:text-sm">{t("uploadPhotosRules")}</p>
                </motion.div>
              </FadeInSection>

              {/* Step 02 */}
              <FadeInSection delay={1}>
                <motion.div
                  className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-white/20 h-full min-h-[260px]"
                  whileHover={{ y: -4, backgroundColor: "rgba(255,255,255,0.15)" }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-4xl font-black text-white/40">02</span>
                  </div>
                  <h3 className="text-base md:text-lg lg:text-xl font-bold mb-3">{t("approveVerifiedChefs")}<br />{t("platformDoesTheRest")}</h3>
                  <div className="space-y-3 text-white/80 leading-relaxed">
                    <p className="text-xs md:text-sm">{t("qualifiedChefsRequest")}</p>
                    <p className="text-xs md:text-sm">{t("browseProfilesApprove")}</p>
                  </div>
                </motion.div>
              </FadeInSection>

              {/* Step 03 */}
              <FadeInSection delay={2}>
                <motion.div
                  className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-white/20 h-full min-h-[260px]"
                  whileHover={{ y: -4, backgroundColor: "rgba(255,255,255,0.15)" }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-4xl font-black text-white/40">03</span>
                  </div>
                  <h3 className="text-base md:text-lg lg:text-xl font-bold mb-3">{t("earnOnAutopilot")}<br />{t("weeklyPayoutsZeroAdmin")}</h3>
                  <p className="text-white/80 leading-relaxed text-xs md:text-sm">{t("chefsBookArrive")}</p>
                </motion.div>
              </FadeInSection>
            </div>

          </div>
        </section>

        {/* ══════ WAVE DIVIDER ══════ */}
        <div className="relative w-full overflow-hidden bg-[#F51042]" style={{ height: '100px' }}>
          <svg 
            viewBox="0 0 1440 320" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            className="absolute bottom-0 w-full"
            style={{ height: '100px', minWidth: '100%' }}
            preserveAspectRatio="none"
          >
            <path 
              fill="#ffffff" 
              fillOpacity="1" 
              d="M0,64L48,80C96,96,192,128,288,128C384,128,480,96,576,90.7C672,85,768,107,864,128C960,149,1056,171,1152,165.3C1248,160,1344,128,1392,112L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            EVERYTHING YOU NEED SECTION - Premium Standalone Design
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="everything-included" className="relative scroll-mt-24 py-24 md:py-32 px-4 bg-white overflow-hidden">
          {/* Sophisticated background elements */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Gradient mesh background */}
            <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-gradient-radial from-rose-100/60 via-rose-50/30 to-transparent rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-gradient-radial from-teal-100/50 via-cyan-50/20 to-transparent rounded-full blur-3xl" />
            <div className="absolute top-1/2 left-0 w-[400px] h-[400px] bg-gradient-radial from-violet-100/30 to-transparent rounded-full blur-2xl" />
            
            {/* Subtle grid pattern */}
            <div className="absolute inset-0 opacity-[0.02]" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }} />
          </div>

          <div className="container mx-auto max-w-7xl relative z-10">
            {/* Section Header - Premium Design */}
            <FadeInSection>
              <div className="text-center mb-16 md:mb-20">
                {/* Floating badge with glow effect */}
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                  className="inline-block mb-8"
                >
                  <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-[#F51042] via-rose-400 to-pink-400 rounded-full blur-sm opacity-40 animate-pulse" />
                    <div className="relative inline-flex items-center gap-3 bg-white border border-rose-200 rounded-full px-5 py-2.5 shadow-lg shadow-rose-400/20">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F51042]/70 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#F51042]" />
                        </span>
                      </div>
                      <span className="font-semibold text-sm tracking-wide text-[#F51042]">{t("everythingIncluded")}</span>
                    </div>
                  </div>
                </motion.div>
                
                {/* Main headline with creative typography */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="relative"
                >
                  <h2 className="text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-slate-900 leading-[1.1] mb-6">
                    <span className="block">{t("everythingYouNeedTo")}</span>
                    <span className="relative inline-block mt-2">
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#F51042] via-rose-500 to-[#F51042]">{t("hostWithConfidence")}</span>
                      {/* Animated underline */}
                      <motion.div 
                        className="absolute -bottom-2 left-0 right-0 h-1 md:h-1.5 bg-gradient-to-r from-[#F51042] via-rose-400 to-[#F51042] rounded-full"
                        initial={{ scaleX: 0, originX: 0 }}
                        whileInView={{ scaleX: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                      />
                    </span>
                  </h2>
                </motion.div>
                
                <motion.p 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="text-sm md:text-base lg:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed mt-6"
                >{t("smartAutomation")}<br className="hidden md:block" />
                  <span className="font-medium text-slate-700">{t("businessSimplified")}</span>
                </motion.p>
              </div>
            </FadeInSection>

            {/* Premium Two-Column Feature Layout */}
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
              
              {/* Left Column: Automated Platform Features */}
              <FadeInSection delay={0}>
                <motion.div
                  initial={{ opacity: 0, x: -30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7 }}
                  className="relative group"
                >
                  {/* Card glow effect on hover */}
                  <div className="absolute -inset-0.5 bg-gradient-to-br from-[#F51042]/20 via-rose-400/10 to-rose-300/20 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  
                  <div className="relative bg-gradient-to-br from-white via-white to-rose-50/40 rounded-[2rem] border border-slate-200/80 p-8 md:p-10 shadow-[0_8px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(245,16,66,0.16)] transition-all duration-500">
                    {/* Column header with icon */}
                    <div className="flex items-center gap-4 mb-8">
                      <div className="relative">
                        <div className="absolute -inset-2 bg-gradient-to-br from-[#F51042]/20 to-rose-500/20 rounded-2xl blur-lg" />
                        <div className="relative w-14 h-14 bg-gradient-to-br from-[#F51042] to-rose-500 rounded-2xl flex items-center justify-center shadow-lg shadow-[#F51042]/30">
                          <Zap className="h-7 w-7 text-white" />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xl md:text-2xl font-bold text-slate-900">{t("automatedPlatform")}</h3>
                        <p className="text-sm text-slate-500 font-medium">{t("setItOnce")}</p>
                      </div>
                    </div>
                    
                    {/* Features list with premium styling */}
                    <div className="space-y-6">
                      {[
                        {
                          icon: Calendar,
                          title: t("featSmartScheduling"),
                          description: t("featSmartSchedulingDesc"),
                          gradient: "from-violet-500 to-purple-600"
                        },
                        {
                          icon: MessageCircle,
                          title: t("featReminders"),
                          description: t("featRemindersDesc"),
                          gradient: "from-blue-500 to-indigo-600"
                        },
                        {
                          icon: CreditCard,
                          title: t("featWeeklyPayouts"),
                          description: t("featWeeklyPayoutsDesc"),
                          gradient: "from-[#F51042] to-rose-500"
                        },
                        {
                          icon: Settings,
                          title: t("featCustomSolutions"),
                          description: t("featCustomSolutionsDesc"),
                          gradient: "from-amber-500 to-orange-600"
                        }
                      ].map((feature, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 20 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.5, delay: 0.1 * i }}
                          className="group/item relative"
                        >
                          <div className="flex gap-4">
                            <div className="flex-shrink-0">
                              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg transform group-hover/item:scale-110 group-hover/item:rotate-3 transition-all duration-300`}>
                                <feature.icon className="h-5 w-5 text-white" />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-slate-900 text-base md:text-lg mb-1 group-hover/item:text-[#F51042] transition-colors">
                                {feature.title}
                              </h4>
                              <p className="text-sm text-slate-600 leading-relaxed">
                                {feature.description}
                              </p>
                            </div>
                          </div>
                          {i < 3 && (
                            <div className="ml-[3.25rem] mt-6 h-px bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </FadeInSection>

              {/* Right Column: Verified Professionals & Safety */}
              <FadeInSection delay={1}>
                <motion.div
                  initial={{ opacity: 0, x: 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7 }}
                  className="relative group"
                >
                  {/* Card glow effect on hover */}
                  <div className="absolute -inset-0.5 bg-gradient-to-br from-violet-500/20 via-purple-500/10 to-pink-500/20 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  
                  <div className="relative bg-gradient-to-br from-white via-white to-violet-50/30 rounded-[2rem] border border-slate-200/80 p-8 md:p-10 shadow-[0_8px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(139,92,246,0.12)] transition-all duration-500">
                    {/* Column header with icon */}
                    <div className="flex items-center gap-4 mb-8">
                      <div className="relative">
                        <div className="absolute -inset-2 bg-gradient-to-br from-violet-500/20 to-purple-500/20 rounded-2xl blur-lg" />
                        <div className="relative w-14 h-14 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/30">
                          <Shield className="h-7 w-7 text-white" />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xl md:text-2xl font-bold text-slate-900">{t("verifiedProtected")}</h3>
                        <p className="text-sm text-slate-500 font-medium">{t("sleepSoundly")}</p>
                      </div>
                    </div>
                    
                    {/* Features list with premium styling */}
                    <div className="space-y-6">
                      {[
                        {
                          icon: BadgeCheck,
                          title: t("featPreVerified"),
                          description: t("featPreVerifiedDesc"),
                          gradient: "from-blue-500 to-cyan-600"
                        },
                        {
                          icon: Eye,
                          title: t("featFullTransparency"),
                          description: t("featFullTransparencyDesc"),
                          gradient: "from-rose-500 to-[#F51042]"
                        },
                        {
                          icon: Lock,
                          title: t("featCoverageConfirmed"),
                          description: t("featCoverageConfirmedDesc"),
                          gradient: "from-rose-500 to-pink-600"
                        },
                        {
                          icon: HeartHandshake,
                          title: t("featLocalSupport"),
                          description: t("featLocalSupportDesc"),
                          gradient: "from-violet-500 to-purple-600"
                        }
                      ].map((feature, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 20 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.5, delay: 0.1 * i + 0.2 }}
                          className="group/item relative"
                        >
                          <div className="flex gap-4">
                            <div className="flex-shrink-0">
                              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg transform group-hover/item:scale-110 group-hover/item:rotate-3 transition-all duration-300`}>
                                <feature.icon className="h-5 w-5 text-white" />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-slate-900 text-base md:text-lg mb-1 group-hover/item:text-violet-700 transition-colors">
                                {feature.title}
                              </h4>
                              <p className="text-sm text-slate-600 leading-relaxed">
                                {feature.description}
                              </p>
                            </div>
                          </div>
                          {i < 3 && (
                            <div className="ml-[3.25rem] mt-6 h-px bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </FadeInSection>
            </div>

            {/* Bottom CTA Banner - Premium Floating Card */}
            <FadeInSection delay={2}>
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: 0.3 }}
                className="mt-16 md:mt-20"
              >
                <div className="relative">
                  {/* Glow effect */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-[#F51042] via-rose-500 to-pink-400 rounded-3xl blur-lg opacity-30" />
                  
                  <div className="relative bg-gradient-to-r from-[#F51042] via-rose-500 to-[#F51042] rounded-3xl p-8 md:p-10 overflow-hidden">
                    {/* Decorative elements */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />
                    
                    <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="text-center md:text-left">
                        <h3 className="text-xl md:text-2xl lg:text-3xl font-bold text-white mb-2">{t("readyToTurnIdle")}</h3>
                        <p className="text-white/80 text-sm md:text-base">{t("joinKitchenOwners")}</p>
                      </div>
                      <Button
                        onClick={() => window.location.href = 'mailto:admin@localcook.shop?subject=Kitchen Partnership - List My Kitchen'}
                        size="lg"
                        className="bg-white text-[#F51042] hover:bg-gray-100 font-bold py-6 px-10 text-base md:text-lg rounded-full shadow-2xl hover:shadow-white/30 hover:-translate-y-1 transition-all whitespace-nowrap"
                      >
                        {t("listYourKitchenWord")}
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            RESOURCES — Preview section linking to full Kitchen Resources page
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="resources" className="scroll-mt-24 py-20 md:py-28 px-4 bg-white relative overflow-hidden">
          {/* Subtle decorative elements */}
          <div className="absolute top-0 left-0 w-96 h-96 rounded-full opacity-[0.03]" style={{ background: "radial-gradient(circle, #F51042 0%, transparent 70%)" }} />
          <div className="absolute bottom-0 right-0 w-72 h-72 rounded-full opacity-[0.04]" style={{ background: "radial-gradient(circle, #10B981 0%, transparent 70%)" }} />

          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-16">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-[#F51042] mb-4 px-4 py-2 bg-rose-100 rounded-full">
                  {t("knowledgeBase")}
                </span>
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-tight mb-4"
                >
                  {t("runYourKitchen")}{" "}
                  <span className="relative inline-block">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 via-red-500 to-rose-600">{t("withConfidence")}</span>
                    <motion.svg
                      className="absolute -bottom-1 md:-bottom-2 left-0 w-full"
                      viewBox="0 0 350 12"
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1.2, delay: 0.6 }}
                      viewport={{ once: true }}
                    >
                      <motion.path
                        d="M2 8C50 3 120 3 175 6C230 9 300 5 348 8"
                        stroke="#F43F5E"
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
                <p className="text-[#6B6B6B] text-base md:text-lg max-w-2xl mx-auto leading-relaxed">{t("fromLicensingToRisk")}</p>
              </div>
            </FadeInSection>

            <FadeInSection delay={1}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
                {[
                  {
                    icon: Scale,
                    title: t("kbLegalTitle"),
                    description: t("kbLegalDesc"),
                    color: "bg-blue-50 text-blue-600",
                  },
                  {
                    icon: Shield,
                    title: t("kbInsuranceTitle"),
                    description: t("kbInsuranceDesc"),
                    color: "bg-emerald-50 text-emerald-600",
                  },
                  {
                    icon: ClipboardCheck,
                    title: t("kbRiskTitle"),
                    description: t("kbRiskDesc"),
                    color: "bg-amber-50 text-amber-600",
                  },
                  {
                    icon: DollarSign,
                    title: t("kbPricingTitle"),
                    description: t("kbPricingDesc"),
                    color: "bg-purple-50 text-purple-600",
                  },
                ].map((item, i) => (
                  <Card key={i} className="group border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-300 bg-white">
                    <CardContent className="p-6">
                      <div className={`w-10 h-10 rounded-lg ${item.color} flex items-center justify-center mb-4`}>
                        <item.icon className="h-5 w-5" />
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
                      className="bg-[#F51042] hover:bg-[#D90935] text-white font-semibold py-6 px-10 text-base rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    >
                      {t("exploreResourceGuide")}
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs text-[#6B6B6B]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    15-minute read
                  </span>
                </div>
              </div>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            FAQ SECTION
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="faq" className="scroll-mt-24 py-12 sm:py-16 md:py-20 lg:py-28 px-4 sm:px-6 bg-gray-50">
          <div className="container mx-auto max-w-3xl">
            <FadeInSection>
              <div className="text-center mb-12">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-[#F51042] mb-4 px-4 py-2 bg-rose-100 rounded-full">
                  Questions
                </span>
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1A1A1A]">{t("faqWord")}</h2>
              </div>
            </FadeInSection>

            <FadeInSection delay={1}>
              <Accordion type="single" collapsible className="space-y-3">
                {[
                  { q: t("kFaqQ1"), a: t("kFaqA1") },
                  { q: t("kFaqQ2"), a: t("kFaqA2") },
                  { q: t("kFaqQ3"), a: t("kFaqA3") },
                  { q: t("kFaqQ4"), a: t("kFaqA4") },
                  { q: t("kFaqQ5"), a: t("kFaqA5") },
                  { q: t("kFaqQ6"), a: t("kFaqA6") },
                  { q: t("kFaqQ7"), a: t("kFaqA7") },
                  { q: t("kFaqQ8"), a: t("kFaqA8") },
                ].map((item, i) => (
                  <AccordionItem key={i} value={`item-${i}`} className="border border-gray-200 rounded-xl bg-white px-6 shadow-sm">
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

      </main>

      <Footer />
    </div>
  );
}
