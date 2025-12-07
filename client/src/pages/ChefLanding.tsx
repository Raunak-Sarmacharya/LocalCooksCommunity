import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import Preloader from "@/components/ui/Preloader";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";
import { 
  ChefHat, Clock, DollarSign, Users, Target, Utensils, FileCheck, 
  Building2, Calendar, ArrowRight, CheckCircle2, X, TrendingUp,
  MessageSquare, Shield, Heart, Leaf, Globe, Quote, Mail
} from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";

export default function ChefLanding() {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [showPreloader, setShowPreloader] = useState(true);

  // Fetch real kitchens data
  const { data: kitchens = [], isLoading: kitchensLoading } = useQuery({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) throw new Error("Failed to fetch kitchens");
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Extract unique locations from kitchens
  const uniqueLocations = useMemo(() => {
    const locationMap = new Map();
    kitchens.forEach((kitchen: any) => {
      const locationId = kitchen.locationId || kitchen.location_id;
      if (locationId && !locationMap.has(locationId)) {
        locationMap.set(locationId, {
          id: locationId,
          name: kitchen.locationName || "Unknown Location",
          address: kitchen.locationAddress || "",
        });
      }
    });
    return Array.from(locationMap.values());
  }, [kitchens]);

  // Fetch real platform statistics
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/public/stats"],
    queryFn: async () => {
      const response = await fetch("/api/public/stats");
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

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

  const handleGetStarted = () => {
    if (!user) {
      navigate('/auth');
    } else {
      navigate('/apply');
    }
  };

  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement newsletter signup
    alert("Thank you for signing up! Check your email for the First 30 Days playbook.");
    setEmail("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      {showPreloader && (
        <Preloader
          onComplete={() => setShowPreloader(false)}
          duration={3000}
        />
      )}
      <Header />
      <main className="flex-grow">
        {/* HERO SECTION */}
        <GradientHero variant="cream" className="pt-32 pb-20 md:pt-40 md:pb-32 px-4 relative overflow-hidden">
          {/* Enhanced background decorative elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-20 left-10 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-10 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-5xl text-center relative z-10">
            <FadeInSection>
              <div className="space-y-8 md:space-y-10 mb-12">
                <div className="space-y-3 md:space-y-4">
                  <h1 className="font-display text-[3.5rem] md:text-[5rem] lg:text-[6rem] text-[var(--color-primary)] leading-none drop-shadow-sm">
                    LocalCooks
                  </h1>
                  <p className="font-mono text-[11px] md:text-[12px] text-[var(--color-charcoal-light)] uppercase tracking-[0.5em] font-medium">
                    Homemade with Love
                  </p>
                </div>
                <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold text-[var(--color-text-primary)] font-sans max-w-5xl mx-auto leading-tight">
                  Your Cooking Speaks for Itself.
                  <br />
                  <span className="text-[var(--color-primary)]">Everything Else Shouldn't.</span>
                </h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)]/90 font-sans max-w-3xl mx-auto leading-relaxed font-medium">
                  Turn your culinary passion into a sustainable business. We handle the logistics. You focus on what you do best.
                </p>
              </div>
            </FadeInSection>

            <FadeInSection delay={1}>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
                <Button
                  onClick={handleGetStarted}
                  size="lg"
                  className="bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-6 px-12 text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-1 transform"
                >
                  Start Your Application
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="border-2 border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 font-bold py-6 px-12 text-lg md:text-xl rounded-xl transition-all duration-300 hover:scale-105"
                  onClick={() => {
                    document.getElementById('benefits')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Learn More
                </Button>
              </div>
              <p className="text-base md:text-lg text-[var(--color-charcoal-light)] font-sans font-medium">
                Approved in 24 hours • Keep 100% during trial
              </p>
            </FadeInSection>
          </div>
        </GradientHero>

        {/* BENEFITS SECTION */}
        <section id="benefits" className="py-20 md:py-28 px-4 bg-gradient-to-b from-white via-gray-50 to-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-40 left-10 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-40 right-10 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-20">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-3 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Why Choose Us
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">Why Local Cooks Works</h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans max-w-3xl mx-auto leading-relaxed">
                  Everything you need to build a successful culinary business, without the overhead.
                </p>
              </div>
            </FadeInSection>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {/* Benefit 1 */}
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  {/* Decorative gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="pb-4 relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-[var(--color-primary)]/15 to-[var(--color-primary)]/5 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Target className="h-8 w-8 text-[var(--color-primary)]" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors duration-300">Focus on Cooking</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">
                      We handle customer support, payment processing, and delivery logistics. You spend your time doing what you love—cooking.
                    </p>
                  </CardContent>
                </Card>
              </FadeInSection>

              {/* Benefit 2 */}
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="pb-4 relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <DollarSign className="h-8 w-8 text-green-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-green-600 transition-colors duration-300">Keep 100% During Trial</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed mb-3 text-base md:text-lg">
                      Zero platform fees during trial. Keep everything you earn (only standard payment processing applies).
                    </p>
                    <p className="text-sm md:text-base text-[var(--color-charcoal-light)]">
                      After trial: 80-85% to you, still better than traditional platforms.
                    </p>
                  </CardContent>
                </Card>
              </FadeInSection>

              {/* Benefit 3 */}
              <FadeInSection delay={2}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="pb-4 relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-orange-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Utensils className="h-8 w-8 text-orange-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-orange-600 transition-colors duration-300">Your Menu, Your Brand</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">
                      Build your menu, set your prices, and create your brand. You're not executing someone else's vision—you're building your own.
                    </p>
                  </CardContent>
                </Card>
              </FadeInSection>

              {/* Benefit 4 */}
              <FadeInSection delay={2}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="pb-4 relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-purple-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <FileCheck className="h-8 w-8 text-purple-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-purple-600 transition-colors duration-300">Affordable Kitchen Access</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">
                      Access certified commercial kitchens by the hour. Start small, scale as you grow. No huge upfront costs.
                    </p>
                  </CardContent>
                </Card>
              </FadeInSection>

              {/* Benefit 5 */}
              <FadeInSection delay={3}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-pink-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="pb-4 relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-pink-100 to-pink-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Users className="h-8 w-8 text-pink-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-pink-600 transition-colors duration-300">Own Your Customer Base</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">
                      Build your brand and own your customer relationships. Your profile, your story, your business.
                    </p>
                  </CardContent>
                </Card>
              </FadeInSection>

              {/* Benefit 6 */}
              <FadeInSection delay={3}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="pb-4 relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-100 to-indigo-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Heart className="h-8 w-8 text-indigo-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-indigo-600 transition-colors duration-300">Chef Community</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">
                      Join a private community of chefs. Learn, share, and grow together with mentorship and support.
                    </p>
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* TRIAL PHASE HIGHLIGHT */}
        <section className="py-24 md:py-32 px-4 bg-gradient-to-br from-[var(--color-cream)]/50 via-white to-[var(--color-cream)]/30 relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-4xl text-center relative z-10">
            <FadeInSection>
              <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                Trial Benefits
              </span>
              <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-8">Keep 100% During Trial</h2>
              <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans mb-12 max-w-3xl mx-auto leading-relaxed font-medium">
                We handle everything—customer support, payments, delivery logistics. You keep 100% of your earnings (only standard payment processing applies).
              </p>
              <div className="bg-white p-10 md:p-12 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl mx-auto relative overflow-hidden group">
                {/* Decorative gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <div className="space-y-5 text-left relative z-10">
                  <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-green-50/50 transition-colors duration-300">
                    <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    </div>
                    <span className="text-lg md:text-xl text-[var(--color-text-primary)] font-sans font-medium">0% platform fees during trial</span>
                  </div>
                  <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-green-50/50 transition-colors duration-300">
                    <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    </div>
                    <span className="text-lg md:text-xl text-[var(--color-text-primary)] font-sans font-medium">Only 2.9% + 30¢ payment processing</span>
                  </div>
                  <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-green-50/50 transition-colors duration-300">
                    <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    </div>
                    <span className="text-lg md:text-xl text-[var(--color-text-primary)] font-sans font-medium">No minimum order volume</span>
                  </div>
                  <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-green-50/50 transition-colors duration-300">
                    <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    </div>
                    <span className="text-lg md:text-xl text-[var(--color-text-primary)] font-sans font-medium">Free to leave anytime</span>
                  </div>
                </div>
              </div>
            </FadeInSection>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-gray-50 to-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-40 left-10 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-40 right-10 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-20">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Simple Process
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">How It Works</h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans max-w-3xl mx-auto leading-relaxed">
                  Get started in three simple steps
                </p>
              </div>
            </FadeInSection>
            <div className="grid md:grid-cols-3 gap-8 md:gap-10">
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-white text-center group relative overflow-hidden">
                  {/* Decorative gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-20 h-20 bg-gradient-to-br from-[var(--color-primary)]/15 to-[var(--color-primary)]/5 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl font-bold text-[var(--color-primary)]">1</span>
                    </div>
                    <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors duration-300">Apply in 15 Minutes</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Share your story, upload photos, and tell us about your cuisine. Get approved in 24 hours.</p>
                  </CardContent>
                </Card>
              </FadeInSection>

              <FadeInSection delay={2}>
                <Card className="border border-gray-100 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-white text-center group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-20 h-20 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl font-bold text-green-600">2</span>
                    </div>
                    <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] group-hover:text-green-600 transition-colors duration-300">Build Your Menu</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Create your menu with beautiful photos, set your prices, and showcase your unique culinary style.</p>
                  </CardContent>
                </Card>
              </FadeInSection>

              <FadeInSection delay={3}>
                <Card className="border border-gray-100 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-white text-center group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-20 h-20 bg-gradient-to-br from-purple-100 to-purple-50 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl font-bold text-purple-600">3</span>
                    </div>
                    <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] group-hover:text-purple-600 transition-colors duration-300">Start Earning</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Orders come in, you cook, and money goes directly to your account. Keep 100% during trial.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* COMPARISON SECTION */}
        <section className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-[var(--color-cream)]/20 to-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-5xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-16">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Compare
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">
                  From Chaos to Clarity
                </h2>
              </div>
            </FadeInSection>
            <div className="grid md:grid-cols-3 gap-8 md:gap-10">
              <FadeInSection delay={1}>
                <Card className="border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-red-50/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)]">Restaurant Life</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-[var(--color-text-primary)] font-sans relative z-10">
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-red-50/50 transition-colors duration-300">
                      <X className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg">14-16 hour shifts</p>
                    </div>
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-red-50/50 transition-colors duration-300">
                      <X className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg">No menu autonomy</p>
                    </div>
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-red-50/50 transition-colors duration-300">
                      <X className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg">Building someone else's brand</p>
                    </div>
                  </CardContent>
                </Card>
              </FadeInSection>

              <FadeInSection delay={2}>
                <Card className="border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-50/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)]">Marketplace Chaos</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-[var(--color-text-primary)] font-sans relative z-10">
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-orange-50/50 transition-colors duration-300">
                      <X className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg">30+ WhatsApp chats daily</p>
                    </div>
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-orange-50/50 transition-colors duration-300">
                      <X className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg">Payment coordination chaos</p>
                    </div>
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-orange-50/50 transition-colors duration-300">
                      <X className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg">No data or tracking</p>
                    </div>
                  </CardContent>
                </Card>
              </FadeInSection>

              <FadeInSection delay={3}>
                <Card className="border-2 border-[var(--color-primary)]/40 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-gradient-to-br from-[var(--color-cream)]/40 via-white to-[var(--color-cream)]/20 group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-primary)]">Local Cooks</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-[var(--color-text-primary)] font-sans relative z-10">
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-green-50/50 transition-colors duration-300">
                      <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg font-medium">Keep 100% during trial</p>
                    </div>
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-green-50/50 transition-colors duration-300">
                      <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg font-medium">Your menu, your brand</p>
                    </div>
                    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-green-50/50 transition-colors duration-300">
                      <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
                      <p className="text-base md:text-lg font-medium">We handle the logistics</p>
                    </div>
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* EARNINGS SECTION */}
        <section id="earnings" className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-gray-50 to-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-40 left-10 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-40 right-10 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-5xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-20">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Earnings Breakdown
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">Transparent Earnings</h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans max-w-3xl mx-auto leading-relaxed">
                  Keep 100% during trial. After that, 80-85% to you—still better than traditional platforms.
                </p>
              </div>
            </FadeInSection>
            <div className="grid md:grid-cols-2 gap-8 md:gap-10">
              <FadeInSection delay={1}>
                <Card className="border-2 border-green-300 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-gradient-to-br from-green-50 via-white to-green-50/30 group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-green-100/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <CardTitle className="text-2xl md:text-3xl font-bold text-green-700">Trial Phase</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-[var(--color-text-primary)] font-sans relative z-10">
                    <div className="flex justify-between items-center py-3 border-b border-gray-200">
                      <span className="text-base md:text-lg font-medium">Order Value</span>
                      <span className="font-bold text-lg md:text-xl">$30</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-gray-200">
                      <span className="text-base md:text-lg">Payment Processing</span>
                      <span className="text-base md:text-lg">-$1.17</span>
                    </div>
                    <div className="flex justify-between items-center pt-4 bg-green-50/50 rounded-xl p-4 mt-4">
                      <span className="font-bold text-lg md:text-xl">You Keep</span>
                      <span className="font-bold text-3xl md:text-4xl text-green-600">$28.83</span>
                    </div>
                    <p className="text-base md:text-lg text-green-700 font-semibold mt-4 bg-green-100/50 rounded-lg p-3 text-center">0% platform fees during trial</p>
                  </CardContent>
                </Card>
              </FadeInSection>

              <FadeInSection delay={2}>
                <Card className="border border-gray-200 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)]">After Trial</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-[var(--color-text-primary)] font-sans relative z-10">
                    <div className="flex justify-between items-center py-3 border-b border-gray-200">
                      <span className="text-base md:text-lg font-medium">Order Value</span>
                      <span className="font-bold text-lg md:text-xl">$30</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-gray-200">
                      <span className="text-base md:text-lg">Platform Fee (15-20%)</span>
                      <span className="text-base md:text-lg">-$4.50</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-gray-200">
                      <span className="text-base md:text-lg">Payment Processing</span>
                      <span className="text-base md:text-lg">-$1.17</span>
                    </div>
                    <div className="flex justify-between items-center pt-4 bg-gray-50 rounded-xl p-4 mt-4">
                      <span className="font-bold text-lg md:text-xl">You Keep</span>
                      <span className="font-bold text-3xl md:text-4xl text-green-600">$16.33</span>
                    </div>
                    <p className="text-base md:text-lg text-[var(--color-charcoal-light)] font-medium mt-4 bg-gray-100/50 rounded-lg p-3 text-center">80-85% to you, still better than DoorDash/UberEats</p>
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* KITCHEN MARKETPLACE SECTION */}
        <section className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-[var(--color-cream)]/20 to-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-16">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Kitchen Access
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">No Kitchen? No Problem.</h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans max-w-3xl mx-auto leading-relaxed">
                  Access certified commercial kitchens by the hour. Start small, scale as you grow.
                </p>
              </div>
            </FadeInSection>

            {kitchensLoading ? (
              <div className="text-center mb-12">
                <p className="text-lg md:text-xl text-[var(--color-text-primary)] font-sans">Loading locations...</p>
              </div>
            ) : uniqueLocations.length > 0 ? (
              <div className={uniqueLocations.length < 3 
                ? `flex flex-wrap justify-center gap-8 mb-16` 
                : `grid md:grid-cols-3 gap-8 mb-16`}>
                {uniqueLocations.slice(0, 3).map((location: any) => (
                  <FadeInSection key={location.id} delay={1}>
                    <Card className={`border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden ${uniqueLocations.length < 3 ? 'w-full max-w-sm' : ''}`}>
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      
                      <CardHeader className="relative z-10">
                        <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                          <Building2 className="h-8 w-8 text-blue-600" />
                        </div>
                        <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-blue-600 transition-colors duration-300">{location.name}</CardTitle>
                        <CardDescription className="text-base md:text-lg text-[var(--color-text-primary)] font-sans">
                          {location.address ? `📍 ${location.address}` : ""}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="relative z-10">
                        <p className="text-base md:text-lg text-[var(--color-text-primary)] font-sans mb-6 leading-relaxed">
                          Access certified commercial kitchens at this location by the hour.
                        </p>
                        <Button 
                          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1 transform" 
                          onClick={() => navigate('/portal/book')}
                        >
                          Browse Kitchens
                        </Button>
                      </CardContent>
                    </Card>
                  </FadeInSection>
                ))}
              </div>
            ) : (
              <div className="text-center mb-16">
                <Button 
                  size="lg" 
                  onClick={() => navigate('/portal/book')}
                  className="bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-6 px-12 text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-1 transform"
                >
                  <Building2 className="h-6 w-6 mr-2" />
                  Browse Available Locations
                </Button>
              </div>
            )}

            <FadeInSection delay={2}>
              <Card className="border border-gray-100 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-gradient-to-br from-blue-50/50 via-white to-blue-50/30 group relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-100/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <CardHeader className="relative z-10">
                  <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] group-hover:text-blue-600 transition-colors duration-300">Own a Commercial Kitchen?</CardTitle>
                </CardHeader>
                <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                  <p className="mb-6 leading-relaxed text-base md:text-lg">
                    Partner with Local Cooks and monetize your empty kitchen hours. List your kitchen, set your price, and get paid weekly.
                  </p>
                  <Button 
                    onClick={() => navigate('/portal/book')}
                    className="bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1 transform"
                  >
                    List Your Kitchen
                  </Button>
                </CardContent>
              </Card>
            </FadeInSection>
          </div>
        </section>

        {/* CTA SECTION */}
        <section className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-gray-50 to-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-4xl text-center relative z-10">
            <FadeInSection>
              <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-8">
                Ready to Start Your Culinary Journey?
              </h2>
              <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans mb-10 max-w-3xl mx-auto leading-relaxed font-medium">
                Join chefs from across Newfoundland who are building their culinary businesses on Local Cooks.
              </p>
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-7 px-14 text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-2 transform"
              >
                Start Your Application
              </Button>
            </FadeInSection>
          </div>
        </section>

        {/* FAQ SECTION */}
        <section className="py-24 md:py-32 px-4 bg-gradient-to-b from-[var(--color-cream)]/30 via-white to-[var(--color-cream)]/20 relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-4xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-16">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Questions
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">
                  Frequently Asked Questions
                </h2>
              </div>
            </FadeInSection>
            
            <FadeInSection delay={1}>
              <Accordion type="single" collapsible className="w-full space-y-4">
                <AccordionItem value="item-1" className="border border-gray-100 rounded-2xl bg-white px-6 md:px-8 shadow-lg hover:shadow-xl transition-all duration-300 border-b-0 group">
                  <AccordionTrigger className="text-left text-xl md:text-2xl font-bold text-[var(--color-text-primary)] py-6 md:py-8 hover:no-underline group-hover:text-[var(--color-primary)] transition-colors duration-300">
                    How long does approval take?
                  </AccordionTrigger>
                  <AccordionContent className="text-[var(--color-text-primary)] font-sans pb-6 md:pb-8 text-base md:text-lg leading-relaxed">
                    <p>15 minutes to apply. 24 hours to hear back. Most chefs are approved and live on the same day.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-2" className="border border-gray-100 rounded-2xl bg-white px-6 md:px-8 shadow-lg hover:shadow-xl transition-all duration-300 border-b-0 group">
                  <AccordionTrigger className="text-left text-xl md:text-2xl font-bold text-[var(--color-text-primary)] py-6 md:py-8 hover:no-underline group-hover:text-[var(--color-primary)] transition-colors duration-300">
                    Do I need a commercial kitchen already?
                  </AccordionTrigger>
                  <AccordionContent className="text-[var(--color-text-primary)] font-sans pb-6 md:pb-8 text-base md:text-lg leading-relaxed">
                    <p>No. Use our Kitchen Marketplace to access certified commercial kitchens by the hour. Start small, scale as you grow.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-3" className="border border-gray-100 rounded-2xl bg-white px-6 md:px-8 shadow-lg hover:shadow-xl transition-all duration-300 border-b-0 group">
                  <AccordionTrigger className="text-left text-xl md:text-2xl font-bold text-[var(--color-text-primary)] py-6 md:py-8 hover:no-underline group-hover:text-[var(--color-primary)] transition-colors duration-300">
                    What happens during trial phase?
                  </AccordionTrigger>
                  <AccordionContent className="text-[var(--color-text-primary)] font-sans pb-6 md:pb-8 text-base md:text-lg leading-relaxed">
                    <p>You keep 100% of your sales (only standard payment processing applies). We handle everything else—customer support, payments, delivery logistics.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-4" className="border border-gray-100 rounded-2xl bg-white px-6 md:px-8 shadow-lg hover:shadow-xl transition-all duration-300 border-b-0 group">
                  <AccordionTrigger className="text-left text-xl md:text-2xl font-bold text-[var(--color-text-primary)] py-6 md:py-8 hover:no-underline group-hover:text-[var(--color-primary)] transition-colors duration-300">
                    Can I quit my restaurant job?
                  </AccordionTrigger>
                  <AccordionContent className="text-[var(--color-text-primary)] font-sans pb-6 md:pb-8 text-base md:text-lg leading-relaxed">
                    <p>Yes, but strategically. Most chefs start part-time while keeping their day job, then transition to full-time as their business grows.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-5" className="border border-gray-100 rounded-2xl bg-white px-6 md:px-8 shadow-lg hover:shadow-xl transition-all duration-300 border-b-0 group">
                  <AccordionTrigger className="text-left text-xl md:text-2xl font-bold text-[var(--color-text-primary)] py-6 md:py-8 hover:no-underline group-hover:text-[var(--color-primary)] transition-colors duration-300">
                    Will this replace Facebook Marketplace?
                  </AccordionTrigger>
                  <AccordionContent className="text-[var(--color-text-primary)] font-sans pb-6 md:pb-8 text-base md:text-lg leading-relaxed">
                    <p>No. It complements it. Use social media for discovery, Local Cooks for professional operations, payments, and customer management.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-6" className="border border-gray-100 rounded-2xl bg-white px-6 md:px-8 shadow-lg hover:shadow-xl transition-all duration-300 border-b-0 group">
                  <AccordionTrigger className="text-left text-xl md:text-2xl font-bold text-[var(--color-text-primary)] py-6 md:py-8 hover:no-underline group-hover:text-[var(--color-primary)] transition-colors duration-300">
                    Can I quit anytime?
                  </AccordionTrigger>
                  <AccordionContent className="text-[var(--color-text-primary)] font-sans pb-6 md:pb-8 text-base md:text-lg leading-relaxed">
                    <p>Yes. No contracts, no commitments, no penalties. You're an independent operator, free to leave or pause anytime.</p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </FadeInSection>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="py-24 md:py-36 px-4 bg-gradient-to-br from-[var(--color-primary)] via-[#FF5470] to-[var(--color-primary)] text-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-white rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-white rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-4xl text-center relative z-10">
            <FadeInSection>
              <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-8 leading-tight text-shadow-lg">
                Your Skill Deserves Better.
                <br />
                Your Life Deserves Better.
                <br />
                <span className="text-white/95">It's Time.</span>
              </h2>
              <p className="text-xl md:text-2xl mb-10 max-w-3xl mx-auto font-sans opacity-95 leading-relaxed">
                Turn your culinary passion into a sustainable business. Cook with freedom. Earn what you're worth. Build something that's yours.
              </p>
              <div className="space-y-6">
                <Button
                  onClick={handleGetStarted}
                  size="lg"
                  className="bg-white text-[var(--color-primary)] hover:bg-gray-50 font-bold py-7 px-14 text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:-translate-y-2 transform"
                >
                  Start Your Application Now
                </Button>
                <p className="text-base md:text-lg opacity-90 font-sans font-medium">
                  Approved in 24 hours • Keep 100% during trial
                </p>
              </div>
            </FadeInSection>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
