import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import FadeInSection from "@/components/ui/FadeInSection";
import { 
  Building2, Calendar, ArrowRight, CheckCircle2, Shield, 
  Clock, DollarSign, Zap, TrendingUp, Lock,
  CreditCard, Package, Wrench, Sparkles, HandCoins, HeartHandshake,
  Settings, Eye, BadgeCheck, Wallet, MessageCircle
} from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState, useRef, useCallback } from "react";
import { motion, useScroll, useTransform, MotionValue } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
import emptyKitchenImage from "@assets/emptykitchen.png";

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

      {/* Mobile Layout */}
      <div className="sm:hidden">
        <FloatingIcon
          Icon={DollarSign}
          position={{ x: 5, y: 8 }}
          size={36}
          depth={1}
          rotation={-10}
          parallaxY={50}
          color="#10B981"
          scrollYProgress={scrollYProgress}
        />
        <FloatingIcon
          Icon={TrendingUp}
          position={{ x: 82, y: 12 }}
          size={32}
          depth={1}
          rotation={7}
          parallaxY={45}
          color="#0D9488"
          scrollYProgress={scrollYProgress}
        />
        <FloatingIcon
          Icon={Calendar}
          position={{ x: 3, y: 50 }}
          size={28}
          depth={2}
          rotation={5}
          parallaxY={35}
          color="#F59E0B"
          scrollYProgress={scrollYProgress}
        />
        <FloatingIcon
          Icon={Package}
          position={{ x: 85, y: 55 }}
          size={26}
          depth={2}
          rotation={-6}
          parallaxY={30}
          color="#8B5CF6"
          scrollYProgress={scrollYProgress}
        />
      </div>
    </div>
  );
}


// Testimonial Carousel for Kitchen Owners
function KitchenTestimonialCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    loop: true, 
    align: "start",
    duration: 25,
    dragFree: false,
    containScroll: "trimSnaps"
  });

  useEffect(() => {
    if (!emblaApi) return;
    const scrollInterval = setInterval(() => {
      if (emblaApi.canScrollNext()) {
        emblaApi.scrollNext();
      } else {
        emblaApi.scrollTo(0);
      }
    }, 4000);
    return () => clearInterval(scrollInterval);
  }, [emblaApi]);

  const testimonials = [
    {
      text: "Our community kitchen was sitting empty most afternoons. Within weeks of listing on LocalCooks, we're generating $600/month in passive income. The platform handles everything—we just approve bookings.",
      name: "Sarah M.",
      role: "Community Kitchen Director",
      color: "#0D9488",
      textColor: "#ffffff",
    },
    {
      text: "I was skeptical about renting to unknown chefs. The verification process gave me complete peace of mind. 50+ bookings later, zero issues. This is the easiest income we've ever made.",
      name: "James K.",
      role: "Church Kitchen Manager",
      color: "#7C5295",
      textColor: "#ffffff",
    },
    {
      text: "Before LocalCooks: 30% kitchen utilization. After: 85%. The automated booking system means I spend maybe 5 minutes per rental. It's truly passive income.",
      name: "Maria A.",
      role: "Restaurant Owner",
      color: "#F59E0B",
      textColor: "#2C2C2C",
    },
    {
      text: "Our freezer space was costing us money sitting empty. Now it generates $400/month. Equipment rentals add another $200. Why didn't I do this sooner?",
      name: "David L.",
      role: "Catering Company Owner",
      color: "#3B82F6",
      textColor: "#ffffff",
    },
  ];

  return (
    <section className="py-20 md:py-32 px-4 bg-white relative overflow-visible">
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
              Kitchen Owners{" "}
              <span className="relative inline-block">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500">
                  Love the Results
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
                    stroke="#10B981"
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
                      <div className="absolute top-2 left-2 sm:top-3 sm:left-3 md:top-4 md:left-4">
                        <span 
                          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-serif leading-none"
                          style={{ 
                            color: testimonial.textColor === "#ffffff"
                              ? "rgba(255, 255, 255, 0.3)"
                              : "rgba(255, 255, 255, 0.4)",
                            fontFamily: "'Georgia', 'Times New Roman', serif",
                            lineHeight: "1",
                          }}
                        >
                          &ldquo;
                        </span>
                      </div>

                      <div className="relative z-10 pt-6 sm:pt-8 md:pt-10 lg:pt-12">
                        <p
                          className="text-sm sm:text-base md:text-base lg:text-lg font-sans leading-relaxed mb-3 sm:mb-4 md:mb-5"
                          style={{ color: testimonial.textColor }}
                        >
                          {testimonial.text}
                        </p>

                        <div
                          className="h-px mb-2 sm:mb-3 md:mb-4"
                          style={{
                            backgroundColor: testimonial.textColor === "#ffffff" 
                              ? "rgba(255, 255, 255, 0.3)" 
                              : "rgba(44, 44, 44, 0.2)",
                          }}
                        />

                        <div>
                          <p
                            className="font-bold text-xs sm:text-sm md:text-base lg:text-lg mb-0.5 sm:mb-1"
                            style={{ color: testimonial.textColor }}
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

// Typewriter component for kitchen types
function KitchenTypewriter() {
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
      
      <span className="font-logo text-white whitespace-nowrap" style={{ fontFamily: "'Lobster', cursive" }}>
        Real
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
  const [, setLocation] = useLocation();

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
    window.location.href = 'mailto:admin@localcook.shop?subject=Kitchen Partnership - List My Kitchen';
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-grow">
        {/* ═══════════════════════════════════════════════════════════════════════
            HERO SECTION - Premium Split-Screen Design for Kitchen Owners
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="relative min-h-screen flex items-center overflow-hidden">
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

          <div className="container mx-auto max-w-7xl px-4 pt-28 pb-16 relative z-10">
            {/* Mobile-only Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-6 block lg:hidden"
            >
              <div className="relative inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-4 py-2 rounded-full border border-emerald-500/30">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent"></div>
                <HandCoins className="h-3.5 w-3.5 relative z-10" />
                <span className="font-semibold text-xs tracking-wide relative z-10">Turn Idle Hours Into Income</span>
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
                  <div className="relative inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-4 py-2 rounded-full shadow-xl shadow-emerald-500/40 border border-emerald-500/30">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent"></div>
                    <HandCoins className="h-3.5 w-3.5 relative z-10" />
                    <span className="font-semibold text-xs tracking-wide relative z-10">Turn Idle Hours Into Income</span>
                  </div>
                </motion.div>

                {/* Brand Identity */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.3 }}
                >
                  <h1 className="font-logo text-[3.5rem] md:text-[5rem] lg:text-[6rem] text-emerald-600 leading-none mb-4 md:mb-5 tracking-tight">
                    LocalCooks
                  </h1>
                  <p className="font-mono text-[10px] md:text-[11px] text-[#4A6A5F] uppercase tracking-[0.4em] mb-8">
                    For Kitchen Owners Who Dream Bigger
                  </p>
                </motion.div>

                {/* Main Headline with Loss Aversion Psychology */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.5 }}
                  className="mb-8"
                >
                  <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#2C2C2C] leading-[1.15] mb-6">
                    Stop Leaving Money
                    <br />
                    <span className="relative inline-block">
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500">
                        On the Table.
                      </span>
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
                          stroke="#10B981" 
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
                    <span className="block mb-3 font-semibold text-[#2C2C2C]">
                      Your kitchen has untapped earning potential.
                    </span>
                    <span className="block">
                      Rent your underutilized hours, storage, and equipment to verified local chefs. 
                      Generate $300–$1,000/month passively while supporting the growing local food community.
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
                    className="group relative bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-teal-500 hover:to-emerald-600 text-white font-bold py-4 px-4 md:py-7 md:px-12 text-xs md:text-lg rounded-full transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-emerald-500/30 hover:-translate-y-1 overflow-hidden flex-1"
                  >
                    <span className="relative z-10 flex items-center justify-center">
                      List Your Kitchen Now
                      <ArrowRight className="ml-1 md:ml-2 h-3.5 w-3.5 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="border-2 border-[#2C2C2C]/20 text-[#2C2C2C] hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 font-semibold py-4 px-4 md:py-7 md:px-10 text-xs md:text-lg rounded-full transition-all duration-300 flex-1"
                    onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    See How It Works
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
                    { icon: CheckCircle2, text: "0% Platform Fee During Trial" },
                    { icon: Shield, text: "Verified Renters Only" },
                    { icon: HeartHandshake, text: "Full Insurance Coverage" }
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

              {/* Right Image Column - Kitchen with Floating Benefit Cards */}
              <div className="order-1 lg:order-2 relative overflow-visible">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: 50 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
                  className="relative overflow-visible"
                >
                  {/* Decorative background shapes */}
                  <div className="absolute -inset-4 bg-gradient-to-br from-emerald-500/10 via-teal-100/50 to-emerald-200/20 rounded-[2.5rem] transform rotate-3" />
                  <div className="absolute -inset-4 bg-gradient-to-tr from-teal-100/80 to-white/60 rounded-[2.5rem] transform -rotate-2" />
                  
                  {/* Main Image Container */}
                  <div className="relative rounded-[2rem] overflow-visible shadow-2xl shadow-emerald-500/10 w-full">
                    <div className="relative rounded-[2rem] overflow-hidden w-full">
                      <img 
                        src={emptyKitchenImage} 
                        alt="Professional commercial kitchen ready for rental" 
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
                              <div className="w-0.5 h-0.5 lg:w-1 lg:h-1 rounded-full bg-emerald-500"></div>
                              <span className="text-[9px] lg:text-[10px] font-semibold text-slate-700">100% yours</span>
                            </div>
                            <div className="flex items-center gap-0.5 lg:gap-1">
                              <div className="w-0.5 h-0.5 lg:w-1 lg:h-1 rounded-full bg-emerald-500"></div>
                              <span className="text-[9px] lg:text-[10px] font-semibold text-slate-700">Zero risk</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right pl-2 lg:pl-4 border-l border-slate-200">
                          <p className="text-[8px] lg:text-[9px] font-semibold text-slate-500 uppercase tracking-[0.15em] leading-none mb-0.5 lg:mb-1">You Keep</p>
                          <p className="text-lg lg:text-xl font-bold text-emerald-600 leading-tight">100%</p>
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
                      <div className="w-6 h-6 lg:w-9 lg:h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg lg:rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30 flex-shrink-0">
                        <DollarSign className="h-3.5 w-3.5 lg:h-5 lg:w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-[8px] lg:text-[10px] font-medium text-slate-600 uppercase tracking-wide leading-tight">Earn While You Sleep</p>
                        <p className="text-[10px] lg:text-xs font-bold text-slate-900 leading-tight">$300–$1,000/month</p>
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
                      <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-violet-500 to-purple-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <Calendar className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                      </div>
                      <span className="text-[10px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">Automated booking system</span>
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
                      <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <BadgeCheck className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">Every renter verified & insured</span>
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
                      <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-amber-500 to-orange-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <Wallet className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">Weekly direct deposits</span>
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
                      <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-rose-500 to-pink-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <Settings className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">Your rules, your rates, your schedule</span>
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
                      <div className="w-4 h-4 lg:w-6 lg:h-6 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-md lg:rounded-lg flex items-center justify-center flex-shrink-0">
                        <TrendingUp className="h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 text-white" />
                      </div>
                      <span className="text-[9px] lg:text-xs font-semibold text-slate-900 tracking-tight whitespace-nowrap">Hours + Storage + Equipment</span>
                    </div>
                  </motion.div>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════ WAVE DIVIDER ══════ */}
        <div className="relative w-full overflow-hidden" style={{ height: '80px', marginTop: '-1px' }}>
          <svg 
            viewBox="0 0 1440 320" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            className="absolute top-0 w-full"
            style={{ height: '80px', minWidth: '100%' }}
            preserveAspectRatio="none"
          >
            <path 
              fill="#10B981" 
              fillOpacity="0.08" 
              d="M0,96L48,106.7C96,117,192,139,288,149.3C384,160,480,160,576,138.7C672,117,768,75,864,64C960,53,1056,75,1152,96C1248,117,1344,139,1392,149.3L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            THE PROBLEM - Lost Revenue Section with Floating Icons
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="relative py-20 md:py-28 px-4 bg-gradient-to-b from-emerald-50/50 via-white to-white overflow-hidden">
          <ScrollLinkedRevenueIcons />
          
          <div className="container mx-auto max-w-4xl relative z-10">
            <FadeInSection>
              <div className="text-center">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-emerald-600 mb-4 px-4 py-2 bg-emerald-100 rounded-full">
                  The Opportunity You're Missing
                </span>
                
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-2xl md:text-3xl lg:text-4xl font-bold text-[#1A1A1A] leading-tight mb-6"
                >
                  Every empty hour is{" "}
                  <span className="relative inline-block">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 via-red-500 to-rose-600">
                      money walking out the door.
                    </span>
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
                  <p className="text-lg md:text-xl text-[#6B6B6B] leading-relaxed mb-8">
                    That cold storage sitting quiet overnight? <span className="font-semibold text-[#2C2C2C]">Lost revenue.</span>
                    <br />
                    Equipment collecting dust? <span className="font-semibold text-[#2C2C2C]">Depreciating assets.</span>
                    <br />
                    Empty afternoon shifts? <span className="font-semibold text-[#2C2C2C]">Missed income.</span>
                  </p>
                  
                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-4 md:gap-8 mt-12">
                    {[
                      { stat: "40%", label: "Average Kitchen Utilization", subtext: "(Before LocalCooks)" },
                      { stat: "$500+", label: "Monthly Lost Revenue", subtext: "From idle hours alone" },
                      { stat: "85%", label: "Avg. Utilization After", subtext: "(With LocalCooks)" },
                    ].map((item, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, delay: 0.4 + (i * 0.1) }}
                        className="text-center"
                      >
                        <p className="text-3xl md:text-4xl lg:text-5xl font-black text-emerald-600 mb-2">{item.stat}</p>
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
        <section id="revenue-streams" className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-slate-50/50 to-white relative overflow-hidden">
          {/* Subtle background decoration */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 right-0 w-[600px] h-[600px] bg-gradient-radial from-emerald-100/40 to-transparent rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 left-0 w-[500px] h-[500px] bg-gradient-radial from-teal-100/30 to-transparent rounded-full blur-3xl" />
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            {/* Section Header */}
            <FadeInSection>
              <div className="text-center mb-16 md:mb-20">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200/60 rounded-full px-4 py-2 mb-6"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-700 font-medium">
                    Revenue Streams
                  </span>
                </motion.div>
                
                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 leading-tight mb-6"
                >
                  Multiple Revenue Streams.
                  <br />
                  <span className="relative inline-block mt-2">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500">
                      One Dashboard.
                    </span>
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
                        stroke="url(#gradient-underline)"
                        strokeWidth="3" 
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        transition={{ duration: 1.2, delay: 0.6 }}
                        viewport={{ once: true }}
                      />
                      <defs>
                        <linearGradient id="gradient-underline" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#10B981" />
                          <stop offset="50%" stopColor="#14B8A6" />
                          <stop offset="100%" stopColor="#10B981" />
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
                  className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed"
                >
                  Maximize every dollar of kitchen potential with diverse, flexible earning opportunities.
                </motion.p>
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
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative h-full bg-white rounded-3xl border border-slate-200/80 p-8 md:p-10 shadow-[0_4px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(16,185,129,0.15)] hover:border-emerald-200/60 transition-all duration-500 overflow-hidden">
                    {/* Decorative gradient orb */}
                    <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-emerald-400/20 to-teal-400/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                    
                    {/* Icon */}
                    <div className="relative mb-6">
                      <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/25 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                        <Clock className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="relative">
                      <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-3 group-hover:text-emerald-700 transition-colors duration-300">
                        Hourly Kitchen Rentals
                      </h3>
                      
                      <div className="inline-flex items-center gap-2 bg-emerald-50 rounded-full px-4 py-1.5 mb-5">
                        <span className="text-sm font-semibold text-emerald-700">
                          Typical range: $40–$80/hour
                        </span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-base">
                        Fill your calendar with chefs, bakers, and caterers who book flexible blocks of time. Hourly rentals are the fastest, easiest way to turn quiet hours into predictable income—without changing how you already operate.
                      </p>
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
                      <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-3 group-hover:text-violet-700 transition-colors duration-300">
                        Storage That Pays
                      </h3>
                      
                      <div className="inline-flex items-center gap-2 bg-violet-50 rounded-full px-4 py-1.5 mb-5">
                        <span className="text-sm font-semibold text-violet-700">
                          Typical range: $100–$300/month
                        </span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-base">
                        Monetize every shelf, fridge, and freezer door. Offer dry, cold, or freezer storage as add-ons or standalone plans so food businesses can scale production, while your underused storage becomes a steady monthly revenue line.
                      </p>
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
                      <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-3 group-hover:text-amber-700 transition-colors duration-300">
                        Equipment Rental
                      </h3>
                      
                      <div className="inline-flex items-center gap-2 bg-amber-50 rounded-full px-4 py-1.5 mb-5">
                        <span className="text-sm font-semibold text-amber-700">
                          Typical add-ons: $5–$15/booking
                        </span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-base">
                        Your blast chillers, commercial mixers, and specialty tools are assets—not just overhead. Bundle them into kitchen bookings or charge per use so every piece of gear helps pay for itself faster.
                      </p>
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
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/15 to-teal-500/15 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative h-full bg-white rounded-3xl border border-slate-200/80 p-8 md:p-10 shadow-[0_4px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(16,185,129,0.15)] hover:border-emerald-200/60 transition-all duration-500 overflow-hidden">
                    {/* Decorative elements */}
                    <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-emerald-400/20 to-teal-400/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                    <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-emerald-500/5 to-transparent" />
                    
                    {/* Sparkle decoration */}
                    <div className="absolute top-6 right-6">
                      <Sparkles className="h-6 w-6 text-emerald-400/60" />
                    </div>
                    
                    {/* Icon */}
                    <div className="relative mb-6">
                      <div className="w-14 h-14 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                        <Zap className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="relative">
                      <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-3">
                        Custom Programs & Premium Uses
                      </h3>
                      
                      <div className="inline-flex items-center gap-2 bg-emerald-50 rounded-full px-4 py-1.5 mb-5 border border-emerald-100">
                        <span className="text-sm font-medium text-emerald-700">
                          From monthly memberships to events and pop-ups – fully tailored
                        </span>
                      </div>
                      
                      <p className="text-slate-600 leading-relaxed text-base">
                        When your space has more potential than a simple hourly rate, we help you tap into it. Offer fixed monthly memberships for serious food businesses, premium-priced workshops and events, or bespoke packages for pop-ups and catering teams. If you can imagine the use case, we can help you price it, structure it, and get it booked.
                      </p>
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
              fill="#0D9488" 
              fillOpacity="1" 
              d="M0,160L48,170.7C96,181,192,203,288,192C384,181,480,139,576,128C672,117,768,139,864,154.7C960,171,1056,181,1152,165.3C1248,149,1344,107,1392,85.3L1440,64L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            HOW IT WORKS - From Idle Space to Active Revenue
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="how-it-works" className="py-20 md:py-28 px-4 bg-teal-600 text-white relative overflow-hidden">
          {/* Background decorations */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-20 w-96 h-96 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-white rounded-full blur-3xl" />
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-12 md:mb-16">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-white/80 mb-4 px-4 py-2 bg-white/10 rounded-full">
                  List Your Kitchen Today
                </span>
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                  From Idle Space to Active Revenue in{" "}
                  <span className="relative inline-block">
                    <span className="text-white">3 Steps.</span>
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
                <p className="text-base md:text-lg text-white/80 max-w-3xl mx-auto leading-relaxed">
                  We've stripped away the complexity of commercial leasing. No contracts to chase, no insurance headaches, no admin burden—just a simple platform that works for you.
                </p>
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
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-4xl font-black text-white/30">01</span>
                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-3">List in 15 Minutes.<br/ > Get Your Kitchen Live in 24 hrs.</h3>
                  <p className="text-white/80 leading-relaxed text-sm md:text-base">
                    Upload photos, define your rules, and set the hours you don’t use. Our team reviews your kitchen details and documentation to ensure everything needed to host professional chefs is in place, then gets your listing live quickly so you can start accepting bookings with confidence.
                  </p>
                </motion.div>
              </FadeInSection>

              {/* Step 02 */}
              <FadeInSection delay={1}>
                <motion.div
                  className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-white/20 h-full min-h-[260px]"
                  whileHover={{ y: -4, backgroundColor: "rgba(255,255,255,0.15)" }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-4xl font-black text-white/30">02</span>
                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                      <Shield className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-3">Approve Verified Chefs.<br /> Platform Does the Rest.</h3>
                  <div className="space-y-3 text-sm md:text-base text-white/80 leading-relaxed">
                    <p>
                      Qualified chefs request to book your kitchen. Every renter comes pre-screened with proof of food handler certification, business registration, and appropriate liability coverage in place.
                    </p>
                    <p>
                      Review their credentials on the platform. Approve the ones that fit your schedule. Done.
                    </p>
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
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-4xl font-black text-white/30">03</span>
                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                      <Wallet className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-3">  Earn on Autopilot.<br />
                  Weekly Payouts, Zero Admin.</h3>
                  <p className="text-white/80 leading-relaxed text-sm md:text-base">
                    Chefs book your space, arrive fully verified, and the platform handles confirmations, reminders, and payments in the background. Your revenue lands in your bank account every week, with a clear dashboard showing exactly who booked and how much you earned—no spreadsheets, no chasing, no confusion.
                  </p>
                </motion.div>
              </FadeInSection>
            </div>

          </div>
        </section>

        {/* ══════ WAVE DIVIDER ══════ */}
        <div className="relative w-full overflow-hidden bg-teal-600" style={{ height: '100px' }}>
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
        <section id="everything-included" className="relative py-24 md:py-32 px-4 bg-white overflow-hidden">
          {/* Sophisticated background elements */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Gradient mesh background */}
            <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-gradient-radial from-emerald-100/60 via-emerald-50/30 to-transparent rounded-full blur-3xl" />
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
                    <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 rounded-full blur-sm opacity-40 animate-pulse" />
                    <div className="relative inline-flex items-center gap-3 bg-white border border-emerald-200 rounded-full px-5 py-2.5 shadow-lg shadow-emerald-500/10">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                        </span>
                      </div>
                      <span className="font-semibold text-sm tracking-wide text-emerald-700">
                        Everything Included in Your Partnership
                      </span>
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
                    <span className="block">Everything You Need to</span>
                    <span className="relative inline-block mt-2">
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500">
                        Host with Confidence
                      </span>
                      {/* Animated underline */}
                      <motion.div 
                        className="absolute -bottom-2 left-0 right-0 h-1 md:h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 rounded-full"
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
                  className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed mt-6"
                >
                  Smart automation. Pre-verified professionals. Ironclad protection.
                  <br className="hidden md:block" />
                  <span className="font-medium text-slate-700">Your business, simplified.</span>
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
                  <div className="absolute -inset-0.5 bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-cyan-500/20 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  
                  <div className="relative bg-gradient-to-br from-white via-white to-emerald-50/30 rounded-[2rem] border border-slate-200/80 p-8 md:p-10 shadow-[0_8px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_rgba(16,185,129,0.12)] transition-all duration-500">
                    {/* Column header with icon */}
                    <div className="flex items-center gap-4 mb-8">
                      <div className="relative">
                        <div className="absolute -inset-2 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-2xl blur-lg" />
                        <div className="relative w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
                          <Zap className="h-7 w-7 text-white" />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xl md:text-2xl font-bold text-slate-900">Automated Platform</h3>
                        <p className="text-sm text-slate-500 font-medium">Set it once, earn forever</p>
                      </div>
                    </div>
                    
                    {/* Features list with premium styling */}
                    <div className="space-y-6">
                      {[
                        {
                          icon: Calendar,
                          title: "Smart Scheduling & Calendar Sync",
                          description: "Your available hours sync automatically. Chefs book in real-time. No double bookings. No manual updates.",
                          gradient: "from-violet-500 to-purple-600"
                        },
                        {
                          icon: MessageCircle,
                          title: "Automated Reminders & Communications",
                          description: "Booking confirmations, 48 & 24-hour reminders, direct messaging—all handled. You stay informed without chasing anyone.",
                          gradient: "from-blue-500 to-indigo-600"
                        },
                        {
                          icon: CreditCard,
                          title: "Weekly Payouts, Zero Chasing",
                          description: "Revenue deposits directly to your bank weekly. Transparent dashboard shows every dollar earned. No invoices to send.",
                          gradient: "from-emerald-500 to-teal-600"
                        },
                        {
                          icon: Settings,
                          title: "Custom Solutions for Custom Needs",
                          description: "Monthly memberships, equipment add-ons, workshops, events—we customize the platform to fit exactly how you monetize.",
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
                              <h4 className="font-semibold text-slate-900 text-base md:text-lg mb-1 group-hover/item:text-emerald-700 transition-colors">
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
                        <h3 className="text-xl md:text-2xl font-bold text-slate-900">Verified & Protected</h3>
                        <p className="text-sm text-slate-500 font-medium">Sleep soundly, every rental</p>
                      </div>
                    </div>
                    
                    {/* Features list with premium styling */}
                    <div className="space-y-6">
                      {[
                        {
                          icon: BadgeCheck,
                          title: "Pre-Verified Professionals",
                          description: "Every renter arrives with food handler certification, business registration, and liability coverage already confirmed.",
                          gradient: "from-blue-500 to-cyan-600"
                        },
                        {
                          icon: Eye,
                          title: "Full Transparency Before Every Booking",
                          description: "See all credentials before you approve—certs, licenses, coverage. Approve or decline in seconds. You're in complete control.",
                          gradient: "from-teal-500 to-emerald-600"
                        },
                        {
                          icon: Lock,
                          title: "Coverage Confirmed, Risk Managed",
                          description: "Appropriate coverage is verified and documented upfront. You're never wondering if protection is in place.",
                          gradient: "from-rose-500 to-pink-600"
                        },
                        {
                          icon: HeartHandshake,
                          title: "24/7 Local Support",
                          description: "Real humans handle questions, disputes, or emergencies. We've got your back so you never manage issues alone.",
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
                  <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 rounded-3xl blur-lg opacity-30" />
                  
                  <div className="relative bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-600 rounded-3xl p-8 md:p-10 overflow-hidden">
                    {/* Decorative elements */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />
                    
                    <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="text-center md:text-left">
                        <h3 className="text-xl md:text-2xl lg:text-3xl font-bold text-white mb-2">
                          Ready to turn idle hours into income?
                        </h3>
                        <p className="text-white/80 text-sm md:text-base">
                          Join kitchen owners earning $300–$1,000/month • 0% platform fee during trial
                        </p>
                      </div>
                      <Button
                        onClick={() => window.location.href = 'mailto:admin@localcook.shop?subject=Kitchen Partnership - List My Kitchen'}
                        size="lg"
                        className="bg-white text-emerald-600 hover:bg-gray-100 font-bold py-6 px-10 text-base md:text-lg rounded-full shadow-2xl hover:shadow-white/30 hover:-translate-y-1 transition-all whitespace-nowrap"
                      >
                        List Your Kitchen
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
            TESTIMONIALS CAROUSEL
        ═══════════════════════════════════════════════════════════════════════ */}
        <KitchenTestimonialCarousel />

        {/* ═══════════════════════════════════════════════════════════════════════
            FAQ SECTION
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="faq" className="py-20 md:py-28 px-4 bg-gray-50">
          <div className="container mx-auto max-w-3xl">
            <FadeInSection>
              <div className="text-center mb-12">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-emerald-600 mb-4 px-4 py-2 bg-emerald-100 rounded-full">
                  Questions
                </span>
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1A1A1A]">FAQ</h2>
              </div>
            </FadeInSection>

            <FadeInSection delay={1}>
              <Accordion type="single" collapsible className="space-y-3">
                {[
                  { 
                    q: "How much can I really earn?", 
                    a: "Most kitchen owners earn $300–$1,000/month from 10–20 hours of rentals. Our top 10% earn $2,000+/month by combining hourly rentals + storage + equipment. During our trial period, you keep 100% of your earnings with zero platform fees." 
                  },
                  { 
                    q: "What if someone damages my equipment?", 
                    a: "Every renter is verified and must sign a liability agreement. We provide comprehensive insurance coverage for all your equipment. Our platform has processed 500+ bookings with zero unresolved disputes." 
                  },
                  { 
                    q: "How fast can I start earning?", 
                    a: "You can be live and booked within 48 hours. Most new kitchens get their first booking within 2 weeks. Some book within days." 
                  },
                  { 
                    q: "Isn't this a lot of work?", 
                    a: "No. We handle: scheduling, payments, renter vetting, compliance, support. You just accept bookings and provide access. It takes about 5 minutes per rental on average." 
                  },
                  { 
                    q: "What if I'm not sure about my pricing?", 
                    a: "We provide market data for your area, competitor analysis, and a smart pricing tool. You set your own rates. Most kitchens start at $50–70/hour and adjust based on demand." 
                  },
                  { 
                    q: "Can I pause or stop anytime?", 
                    a: "Yes. No contracts. No penalties. No minimum commitment. Pause your listing, take a break, or remove it entirely—your choice, anytime. Your kitchen is yours to control." 
                  },
                  { 
                    q: "What types of kitchens qualify?", 
                    a: "Commercial kitchens, restaurant kitchens, community center kitchens, church kitchens, catering facilities, and food production spaces. If it's licensed for commercial food preparation, it qualifies." 
                  },
                  { 
                    q: "What about during the trial period?", 
                    a: "During our trial, you keep 100% of your earnings with zero platform fees. It's a risk-free way to test the platform and see if it works for your kitchen. No commitment required." 
                  },
                ].map((item, i) => (
                  <AccordionItem key={i} value={`item-${i}`} className="border border-gray-200 rounded-xl bg-white px-6 shadow-sm">
                    <AccordionTrigger className="text-left text-lg font-semibold text-[#2C2C2C] py-5 hover:no-underline hover:text-emerald-600">
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
            FINAL CTA SECTION
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="relative py-16 md:py-24 px-4 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-teal-500 to-emerald-600" />
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-10 left-10 w-96 h-96 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-10 w-80 h-80 bg-white rounded-full blur-3xl" />
          </div>
          
          <div className="container mx-auto max-w-5xl text-center relative z-10">
            <FadeInSection>
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
                  Transform Wasted Hours
                  <br />
                  <span className="relative inline-block">
                    <span className="text-white/95">Into Real Revenue.</span>
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

              <motion.p 
                className="text-base md:text-lg lg:text-xl text-white/90 mb-5 md:mb-6 max-w-3xl mx-auto leading-relaxed font-medium"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                Your kitchen already has everything it needs to generate passive income. 
                All it's missing is renters—and we bring those to you.
              </motion.p>

              <motion.div 
                className="mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <p className="text-xs md:text-sm text-white/75 mb-4 font-medium tracking-wider uppercase">
                  What kitchen owners discover with LocalCooks:
                </p>
                <div className="flex justify-center items-center">
                  <KitchenTypewriter />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
              >
                <Button
                  onClick={handleListKitchen}
                  size="lg"
                  className="bg-white text-emerald-600 hover:bg-gray-100 font-bold py-6 px-12 text-lg md:text-xl rounded-full shadow-2xl hover:shadow-white/30 hover:-translate-y-1 transition-all"
                >
                  List Your Kitchen Now
                  <ArrowRight className="ml-3 h-5 w-5 md:h-6 md:w-6" />
                </Button>
                <p className="text-white/70 mt-5 text-xs md:text-sm">
                  0% platform fee during trial • 100% of earnings are yours • No contracts
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
