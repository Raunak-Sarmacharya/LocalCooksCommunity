import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import Preloader from "@/components/ui/Preloader";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import FadeInSection from "@/components/ui/FadeInSection";
import { 
  ChefHat, Clock, Users, Target, Utensils, 
  Building2, ArrowRight, CheckCircle2, X, Sparkles,
  Heart, Rocket, Star, Zap, Shield, MessageCircle,
  CreditCard, Truck, Instagram, Phone, Calendar
} from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import chefImage from "@/assets/chef-cooking.png";
import logoWhite from "@assets/logo-white.png";

export default function ChefLanding() {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [showPreloader, setShowPreloader] = useState(true);

  // Fetch real kitchens data
  const { data: kitchens = [], isLoading: kitchensLoading } = useQuery({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/public/kitchens", {
          method: "GET",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (error) {
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const uniqueLocations = useMemo(() => {
    if (!kitchens || kitchens.length === 0) return [];
    const locationMap = new Map();
    kitchens.forEach((kitchen: any) => {
      const locationId = kitchen.locationId || kitchen.location_id;
      const locationName = kitchen.locationName || kitchen.location_name;
      const locationAddress = kitchen.locationAddress || kitchen.location_address;
      if (locationId && locationName && !locationMap.has(locationId)) {
        locationMap.set(locationId, { id: locationId, name: locationName, address: locationAddress || "" });
      }
    });
    return Array.from(locationMap.values());
  }, [kitchens]);

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
      {showPreloader && <Preloader onComplete={() => setShowPreloader(false)} duration={2500} />}
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
            "THE PROBLEM" SECTION - Final Polished Version
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="py-24 md:py-36 px-4 bg-gradient-to-b from-white via-[#FAFAFA] to-white overflow-hidden relative">
          <div className="container mx-auto max-w-6xl relative">
            
            {/* Headline */}
            <FadeInSection>
              <div className="text-center mb-16 md:mb-24">
                <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-[#1A1A1A] leading-tight mb-8 max-w-4xl mx-auto">
                  You didn't start cooking to become a{" "}
                  <span className="relative inline-block">
                    <span className="relative z-10">full-time receptionist</span>
                    <motion.svg 
                      className="absolute -bottom-2 left-0 w-full" 
                      viewBox="0 0 300 12" 
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1, delay: 0.5 }}
                      viewport={{ once: true }}
                    >
                      <motion.path 
                        d="M2 8C50 3 100 3 150 6C200 9 250 5 298 8" 
                        stroke="#F51042" 
                        strokeWidth="3" 
                        strokeLinecap="round"
                        strokeOpacity="0.3"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        transition={{ duration: 1, delay: 0.5 }}
                        viewport={{ once: true }}
                      />
                    </motion.svg>
                  </span>
                </h2>
                
                <p className="text-lg md:text-xl text-[#64748B] max-w-2xl mx-auto mb-12 leading-relaxed">
                  Yet here you are — juggling messages, chasing payments, coordinating pickups.
                  <br className="hidden md:block" />
                  <span className="font-medium text-[#1A1A1A]">Sound familiar?</span>
                </p>
                
                {/* Your Workflow - Premium Design */}
                <div className="inline-flex flex-col items-center">
                  <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#94A3B8] mb-4">Your current workflow</span>
                  <div className="flex flex-wrap justify-center items-center gap-2 md:gap-3">
                    {[
                      { 
                        name: "Instagram", 
                        bg: "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737]",
                        icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.254 1.216.598 1.772 1.153a4.908 4.908 0 0 1 1.153 1.772c.247.637.415 1.363.465 2.428.047 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 0 1-1.153 1.772 4.915 4.915 0 0 1-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.047-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 0 1-1.772-1.153 4.904 4.904 0 0 1-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 0 1 1.153-1.772A4.897 4.897 0 0 1 5.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.013 9.283 2 12 2zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6.5-.25a1.25 1.25 0 0 0-2.5 0 1.25 1.25 0 0 0 2.5 0zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>
                      },
                      { 
                        name: "WhatsApp", 
                        bg: "bg-[#25D366]",
                        icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                      },
                      { 
                        name: "Messenger", 
                        bg: "bg-gradient-to-br from-[#00B2FF] to-[#006AFF]",
                        icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.13.26.35.27.57l.05 1.78c.04.57.61.94 1.13.71l1.98-.87c.17-.08.36-.1.55-.06.91.25 1.87.38 2.88.38 5.64 0 10-4.13 10-9.7C22 6.13 17.64 2 12 2zm1.04 13.04l-2.55-2.73L5.17 15.1l5.87-6.23 2.55 2.73 5.27-2.78-5.82 6.22z"/></svg>
                      },
                      { 
                        name: "Facebook", 
                        bg: "bg-[#1877F2]",
                        icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                      },
                      { 
                        name: "Calls", 
                        bg: "bg-[#1A1A1A]",
                        icon: <Phone className="w-4 h-4 text-white" />
                      },
                      { 
                        name: "E-Transfer", 
                        bg: "bg-gradient-to-br from-[#F59E0B] to-[#D97706]",
                        icon: <CreditCard className="w-4 h-4 text-white" />
                      },
                    ].map((app, i) => (
                      <motion.div 
                        key={i}
                        className={`inline-flex items-center gap-2 px-4 py-2 ${app.bg} rounded-full shadow-lg text-white text-sm font-medium`}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: i * 0.08 }}
                        viewport={{ once: true }}
                      >
                        {app.icon}
                        <span>{app.name}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </FadeInSection>

            {/* Phone Comparison - Side by Side */}
            <div className="grid md:grid-cols-2 gap-12 lg:gap-24 max-w-5xl mx-auto items-start">
              
              {/* CHAOS Phone */}
              <FadeInSection delay={1}>
                <div className="relative">
                  {/* iPhone 15 Pro */}
                  <div className="relative mx-auto w-[280px] md:w-[290px]">
                    {/* Warm ambient glow - Complements #F51042 */}
                    <div className="absolute -inset-6 bg-gradient-to-br from-[#F51042]/20 via-[#FF6B6B]/15 to-[#FFA07A]/20 rounded-[3.5rem] blur-3xl" />
                    
                    {/* Phone Frame */}
                    <div className="relative bg-[#1D1D1F] rounded-[52px] p-[2px] shadow-[0_25px_80px_-15px_rgba(0,0,0,0.4)]">
                      <div className="bg-[#1D1D1F] rounded-[50px] p-2.5">
                        {/* Screen */}
                        <div className="bg-[#000000] rounded-[42px] overflow-hidden aspect-[9/19.5] relative">
                          
                          {/* Dynamic Island */}
                          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[100px] h-[34px] bg-black rounded-full z-20 border border-[#1D1D1F]" />
                          
                          {/* Status Bar */}
                          <div className="relative z-10 px-7 pt-4 flex justify-between items-center text-[13px] text-white font-semibold">
                            <span>9:41</span>
                            <div className="flex items-center gap-1.5">
                              <svg className="w-[18px] h-[12px]" viewBox="0 0 18 12" fill="white"><path d="M1 4.5l2 2c2.5-2.5 6.5-2.5 9 0l2-2C10.5 1 4.5 1 1 4.5zm4 4l3 3 3-3c-1.5-1.5-4.5-1.5-6 0z"/></svg>
                              <svg className="w-[17px] h-[11px]" viewBox="0 0 17 11" fill="white"><path d="M15.5 4.5h-14C.67 4.5 0 5.17 0 6v3.5c0 .83.67 1.5 1.5 1.5h14c.83 0 1.5-.67 1.5-1.5V6c0-.83-.67-1.5-1.5-1.5z"/></svg>
                            </div>
                          </div>
                          
                          {/* Notifications */}
                          <div className="absolute top-16 left-2.5 right-2.5 space-y-2">
                            {[
                              { 
                                app: "Instagram",
                                icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white"><path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.254 1.216.598 1.772 1.153a4.908 4.908 0 0 1 1.153 1.772c.247.637.415 1.363.465 2.428.047 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 0 1-1.153 1.772 4.915 4.915 0 0 1-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.047-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 0 1-1.772-1.153 4.904 4.904 0 0 1-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 0 1 1.153-1.772A4.897 4.897 0 0 1 5.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.013 9.283 2 12 2zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6.5-.25a1.25 1.25 0 0 0-2.5 0 1.25 1.25 0 0 0 2.5 0zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>,
                                gradient: "from-[#833AB4] via-[#FD1D1D] to-[#F77737]",
                                sender: "sarah_foodie",
                                message: "Can I order 3 biryanis for tomorrow?",
                                time: "now",
                                delay: 0
                              },
                              { 
                                app: "WhatsApp",
                                icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>,
                                gradient: "from-[#25D366] to-[#128C7E]",
                                sender: "Mike Chen",
                                message: "Did you get my e-transfer??",
                                time: "now",
                                delay: 0.25
                              },
                              { 
                                app: "Phone",
                                icon: <Phone className="w-5 h-5 text-white" />,
                                gradient: "from-[#34C759] to-[#30D158]",
                                sender: "Missed Call",
                                message: "+1 (709) 555-0142",
                                time: "2m",
                                delay: 0.5
                              },
                              { 
                                app: "Marketplace",
                                icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white"><path d="M12.001 2C17.523 2 22 6.478 22 12.001C22 17.523 17.523 22 12.001 22C6.478 22 2 17.523 2 12.001C2 6.478 6.478 2 12.001 2ZM8.823 15.343L7.075 10.566L7.022 10.555C6.775 10.515 6.5 10.5 6.5 10.5L5.5 10.473V9.5H8.5L9.193 11.458L9.883 9.5H11.5V10.473L10.62 10.555L12 14.5L13.38 10.555L12.5 10.473V9.5H15.5L15.64 11.458L16.5 10.473V9.5H18.5V10.555L17.5 10.566L15.177 15.343H13.89L12 11.458L10.11 15.343H8.823Z"/></svg>,
                                gradient: "from-[#1877F2] to-[#0866FF]",
                                sender: "FB Marketplace",
                                message: "New inquiry: Is this still available?",
                                time: "3m",
                                delay: 0.75
                              },
                              { 
                                app: "WhatsApp",
                                icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>,
                                gradient: "from-[#25D366] to-[#128C7E]",
                                sender: "Jennifer W",
                                message: "Can you deliver to Mount Pearl?",
                                time: "5m",
                                delay: 1.0
                              },
                              { 
                                app: "Interac",
                                icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white"><path d="M21 8V6c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v2h18zm0 2H3v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-8zM6 16h2v2H6v-2zm4 0h8v2h-8v-2z"/></svg>,
                                gradient: "from-[#FFB800] to-[#FF8C00]",
                                sender: "INTERAC e-Transfer",
                                message: "Pending: Accept $45.00 from...",
                                time: "8m",
                                delay: 1.25
                              },
                            ].map((notif, i) => (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -60 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.4, delay: notif.delay, ease: "easeOut" }}
                                viewport={{ once: false, amount: 0.3 }}
                                className="bg-[#1C1C1E]/98 backdrop-blur-xl rounded-2xl p-2.5"
                              >
                                <div className="flex items-start gap-2.5">
                                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${notif.gradient} flex items-center justify-center flex-shrink-0`}>
                                    {notif.icon}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[12px] font-semibold text-white/90">{notif.app}</span>
                                      <span className="text-[11px] text-white/40">{notif.time}</span>
                                    </div>
                                    <p className="text-[13px] font-semibold text-white truncate">{notif.sender}</p>
                                    <p className="text-[12px] text-white/60 truncate">{notif.message}</p>
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Buttons */}
                    <div className="absolute right-[-2px] top-[140px] w-[3px] h-[60px] bg-[#2C2C2E] rounded-l" />
                    <div className="absolute left-[-2px] top-[120px] w-[3px] h-[30px] bg-[#2C2C2E] rounded-r" />
                    <div className="absolute left-[-2px] top-[160px] w-[3px] h-[55px] bg-[#2C2C2E] rounded-r" />
                  </div>
                  
                  {/* Label */}
                  <div className="text-center mt-8">
                    <p className="text-lg font-bold text-[#1A1A1A]">Scattered everywhere</p>
                    <p className="text-sm text-[#64748B] mt-1">6 apps. Endless context switching.</p>
                  </div>
                </div>
              </FadeInSection>
              
              {/* LOCALCOOKS Phone */}
              <FadeInSection delay={2}>
                <div className="relative">
                  {/* iPhone 15 Pro */}
                  <div className="relative mx-auto w-[280px] md:w-[290px]">
                    {/* Teal ambient glow - Complementary to #F51042 */}
                    <div className="absolute -inset-6 bg-gradient-to-br from-[#0D9488]/25 via-[#14B8A6]/20 to-[#2DD4BF]/15 rounded-[3.5rem] blur-3xl" />
                    
                    {/* Phone Frame */}
                    <div className="relative bg-[#1D1D1F] rounded-[52px] p-[2px] shadow-[0_25px_80px_-15px_rgba(0,0,0,0.4)]">
                      <div className="bg-[#1D1D1F] rounded-[50px] p-2.5">
                        {/* Screen */}
                        <div className="bg-gradient-to-b from-[#042F2E] to-[#000000] rounded-[42px] overflow-hidden aspect-[9/19.5] relative">
                          
                          {/* Dynamic Island */}
                          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[100px] h-[34px] bg-black rounded-full z-20 border border-[#1D1D1F]" />
                          
                          {/* Status Bar */}
                          <div className="relative z-10 px-7 pt-4 flex justify-between items-center text-[13px] text-white font-semibold">
                            <span>9:41</span>
                            <div className="flex items-center gap-1.5">
                              <svg className="w-[18px] h-[12px]" viewBox="0 0 18 12" fill="white"><path d="M1 4.5l2 2c2.5-2.5 6.5-2.5 9 0l2-2C10.5 1 4.5 1 1 4.5zm4 4l3 3 3-3c-1.5-1.5-4.5-1.5-6 0z"/></svg>
                              <div className="w-[22px] h-[11px] rounded-[3px] border border-white/80 relative">
                                <div className="absolute inset-[2px] bg-[#34C759] rounded-[1px]" />
                              </div>
                            </div>
                          </div>
                          
                          {/* Notifications */}
                          <div className="absolute top-16 left-2.5 right-2.5 space-y-2">
                            {[
                              { amount: "$112.50", order: "#00198", type: "Delivery", delay: 0 },
                              { amount: "$42.88", order: "#00197", type: "Pickup", delay: 0.3 },
                              { amount: "$78.33", order: "#00196", type: "Pickup", delay: 0.6 },
                              { amount: "$31.29", order: "#00195", type: "Delivery", delay: 0.9 },
                              { amount: "$67.50", order: "#00194", type: "Pickup", delay: 1.2 },
                              { amount: "$55.00", order: "#00193", type: "Delivery", delay: 1.5 },
                            ].map((notif, i) => (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, x: 60 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.4, delay: notif.delay, ease: "easeOut" }}
                                viewport={{ once: false, amount: 0.3 }}
                                className="bg-gradient-to-r from-[#0D9488] to-[#14B8A6] rounded-2xl p-2.5 shadow-lg"
                              >
                                <div className="flex items-start gap-2.5">
                                  {/* LocalCooks Logo */}
                                  <div className="w-10 h-10 rounded-xl bg-[#F51042] flex items-center justify-center flex-shrink-0 overflow-hidden">
                                    <img src={logoWhite} alt="LocalCooks" className="w-7 h-7 object-contain" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[12px] font-bold text-white">LocalCooks</span>
                                      <span className="text-[11px] text-white/70">now</span>
                                    </div>
                                    <p className="text-[14px] font-bold text-white">Cha-ching! {notif.amount}</p>
                                    <p className="text-[12px] text-white/80">{notif.type} order {notif.order}</p>
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Buttons */}
                    <div className="absolute right-[-2px] top-[140px] w-[3px] h-[60px] bg-[#2C2C2E] rounded-l" />
                    <div className="absolute left-[-2px] top-[120px] w-[3px] h-[30px] bg-[#2C2C2E] rounded-r" />
                    <div className="absolute left-[-2px] top-[160px] w-[3px] h-[55px] bg-[#2C2C2E] rounded-r" />
                  </div>
                  
                  {/* Label */}
                  <div className="text-center mt-8">
                    <p className="text-lg font-bold text-[#0D9488]">Powered by LocalCooks</p>
                    <p className="text-sm text-[#64748B] mt-1">One app. Instant payments. Peace of mind.</p>
                  </div>
                </div>
              </FadeInSection>
            </div>
            
            {/* Bottom CTA */}
            <FadeInSection delay={3}>
              <div className="text-center mt-20 md:mt-28">
                <p className="text-xl md:text-2xl font-semibold text-[#1A1A1A] mb-2">
                  Stop juggling. Start cooking.
                </p>
                <p className="text-base text-[#64748B] mb-8 max-w-md mx-auto">
                  Let us handle the business side while you focus on what you love.
                </p>
                <Button
                  onClick={handleGetStarted}
                  className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-bold py-6 px-14 text-lg rounded-full shadow-xl hover:shadow-2xl hover:shadow-[#F51042]/25 transition-all duration-300 hover:-translate-y-1"
                >
                  Start Your Chef Journey
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </FadeInSection>
          </div>
        </section>

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
            WHY LOCAL COOKS - Benefits Grid
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="benefits" className="py-20 md:py-28 px-4 bg-[#FAFAFA]">
          <div className="container mx-auto max-w-6xl">
            <FadeInSection>
              <div className="text-center mb-16">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-[#F51042] mb-4 px-4 py-2 bg-[#F51042]/10 rounded-full">
                  Why Chefs Love Us
                </span>
                <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-[#F51042] mb-4">
                  Everything You Need
                </h2>
                <p className="text-lg md:text-xl text-[#6B6B6B] max-w-2xl mx-auto">
                  To build a real culinary business, without the chaos
                </p>
              </div>
            </FadeInSection>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { icon: Target, title: "Focus on Cooking", desc: "We handle payments, support, and delivery. You do what you love.", color: "from-[#F51042]/10 to-[#F51042]/5", iconColor: "text-[#F51042]" },
                { icon: Utensils, title: "Your Menu, Your Rules", desc: "Cook what you're passionate about. Set your prices. Build your brand.", color: "from-orange-100 to-orange-50", iconColor: "text-orange-600" },
                { icon: Building2, title: "Kitchen Access", desc: "No commercial kitchen? Book certified spaces by the hour.", color: "from-purple-100 to-purple-50", iconColor: "text-purple-600" },
                { icon: Users, title: "Own Your Customers", desc: "Build real relationships. Your profile, your story, your regulars.", color: "from-pink-100 to-pink-50", iconColor: "text-pink-600" },
                { icon: Heart, title: "Chef Community", desc: "Join fellow chefs. Share tips, get mentorship, grow together.", color: "from-indigo-100 to-indigo-50", iconColor: "text-indigo-600" },
                { icon: Clock, title: "Flexible Schedule", desc: "Cook when you want. Start part-time. Scale at your pace.", color: "from-teal-100 to-teal-50", iconColor: "text-teal-600" },
              ].map((item, i) => (
                <FadeInSection key={i} delay={i < 3 ? 1 : 2}>
                  <Card className="group h-full border-0 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 bg-white hover:-translate-y-1">
                    <CardHeader className="pb-2">
                      <div className={`w-14 h-14 bg-gradient-to-br ${item.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                        <item.icon className={`h-7 w-7 ${item.iconColor}`} />
                      </div>
                      <CardTitle className="text-xl font-bold text-[#2C2C2C]">{item.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-[#6B6B6B] leading-relaxed">{item.desc}</p>
                    </CardContent>
                  </Card>
                </FadeInSection>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            HOW IT WORKS - Simple Steps
        ═══════════════════════════════════════════════════════════════════════ */}
        <section id="how-it-works" className="py-20 md:py-28 px-4 bg-white">
          <div className="container mx-auto max-w-5xl">
            <FadeInSection>
              <div className="text-center mb-16">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-[#F51042] mb-4 px-4 py-2 bg-[#F51042]/10 rounded-full">
                  Getting Started
                </span>
                <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-[#F51042] mb-4">
                  Three Simple Steps
                </h2>
                <p className="text-lg text-[#6B6B6B]">From application to your first order</p>
              </div>
            </FadeInSection>

            <div className="grid md:grid-cols-3 gap-8 md:gap-12">
              {[
                { num: "1", title: "Apply", desc: "15 minutes. Share your story, upload food photos, tell us about your cuisine.", color: "#F51042" },
                { num: "2", title: "Set Up", desc: "Create your menu, set prices, and customize your chef profile.", color: "#10B981" },
                { num: "3", title: "Start Cooking", desc: "Orders come in, you cook, money goes to your account. Simple.", color: "#8B5CF6" },
              ].map((step, i) => (
                <FadeInSection key={i} delay={i + 1}>
                  <div className="text-center">
                    <div className="relative inline-flex items-center justify-center w-24 h-24 mb-6 mx-auto">
                      <div className="absolute inset-0 rounded-full opacity-20" style={{ backgroundColor: step.color }} />
                      <span className="text-4xl font-bold" style={{ color: step.color }}>{step.num}</span>
                    </div>
                    <h3 className="text-2xl font-bold text-[#2C2C2C] mb-3">{step.title}</h3>
                    <p className="text-[#6B6B6B] leading-relaxed">{step.desc}</p>
                  </div>
                </FadeInSection>
              ))}
            </div>

            <FadeInSection delay={3}>
              <div className="text-center mt-12">
                <Button onClick={handleGetStarted} className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-bold py-6 px-12 text-lg rounded-full shadow-lg hover:shadow-xl transition-all">
                  Start Your Application
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </FadeInSection>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════════
            KITCHEN ACCESS
        ═══════════════════════════════════════════════════════════════════════ */}
        <section className="py-20 md:py-28 px-4 bg-gradient-to-b from-[#FFF5F0] to-white">
          <div className="container mx-auto max-w-5xl">
            <FadeInSection>
              <div className="text-center mb-12">
                <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-[#F51042] mb-4 px-4 py-2 bg-[#F51042]/10 rounded-full">
                  Kitchen Access
                </span>
                <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-[#F51042] mb-4">
                  No Kitchen? No Problem.
                </h2>
                <p className="text-lg text-[#6B6B6B] max-w-2xl mx-auto">
                  Access certified commercial kitchens by the hour. Start small, scale as you grow.
                </p>
              </div>
            </FadeInSection>

            {!kitchensLoading && uniqueLocations.length > 0 && (
              <div className="grid md:grid-cols-3 gap-6 mb-12">
                {uniqueLocations.slice(0, 3).map((loc: any, i: number) => (
                  <FadeInSection key={loc.id} delay={i + 1}>
                    <Card className="border-0 rounded-2xl shadow-md hover:shadow-lg transition-all bg-white">
                      <CardHeader>
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-3">
                          <Building2 className="h-6 w-6 text-blue-600" />
                        </div>
                        <CardTitle className="text-lg font-bold text-[#2C2C2C]">{loc.name}</CardTitle>
                        {loc.address && <p className="text-sm text-[#6B6B6B]">📍 {loc.address}</p>}
                      </CardHeader>
                      <CardContent>
                        <Button variant="outline" className="w-full" onClick={() => navigate('/portal/book')}>
                          View Availability
                        </Button>
                      </CardContent>
                    </Card>
                  </FadeInSection>
                ))}
              </div>
            )}

            <FadeInSection delay={2}>
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-8 md:p-12 text-center border border-blue-100">
                <Building2 className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-[#2C2C2C] mb-3">Own a Commercial Kitchen?</h3>
                <p className="text-[#6B6B6B] mb-6 max-w-lg mx-auto">
                  Monetize your empty hours. Partner with Local Cooks and get paid weekly.
                </p>
                <Button onClick={() => navigate('/portal/book')} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-full">
                  List Your Kitchen
                </Button>
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
