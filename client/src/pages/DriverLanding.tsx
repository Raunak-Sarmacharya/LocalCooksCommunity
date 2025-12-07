import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import Preloader from "@/components/ui/Preloader";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";
import { Truck, Clock, DollarSign, Route, MapPin, Shield } from "lucide-react";
import { useLocation } from "wouter";
import foodDeliveryImage from "@/assets/food-delivery.png";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

export default function DriverLanding() {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [showPreloader, setShowPreloader] = useState(true);

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
      navigate('/driver-auth');
    } else {
      navigate('/delivery-partner-apply');
    }
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
        {/* Driver-Specific Hero Section */}
        <GradientHero variant="cream" className="pt-28 pb-12 md:pt-36 md:pb-20 px-4 relative overflow-hidden">
          {/* Enhanced background decorative elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-20 left-10 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-10 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center space-y-8 md:space-y-10">
                <div className="space-y-3 md:space-y-4">
                  <h1 className="font-display text-[3.5rem] md:text-[5rem] lg:text-[6rem] text-[var(--color-primary)] leading-none mb-3 md:mb-4 drop-shadow-sm">
                    LocalCooks
                  </h1>
                  <p className="font-mono text-[11px] md:text-[12px] text-[var(--color-charcoal-light)] uppercase tracking-[0.5em] font-medium mb-6 md:mb-8">
                    Homemade with Love
                  </p>
                </div>
                <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-6 md:mb-8 text-[var(--color-text-primary)] font-sans max-w-5xl mx-auto leading-tight">
                  Become a Delivery Partner
                </h2>
                <p className="text-lg md:text-xl lg:text-2xl mb-8 md:mb-12 text-[var(--color-text-primary)]/90 leading-relaxed font-sans max-w-3xl mx-auto font-medium">
                  Join Local Cooks as a delivery partner and earn flexible income while connecting communities with fresh, homemade meals. Set your own schedule and start earning today.
                </p>
              
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-10 md:mb-12 max-w-5xl mx-auto">
                  <motion.div className="flex flex-col items-center gap-3 text-center group cursor-pointer" whileHover={{ scale: 1.05, y: -4 }} transition={{ type: "spring", stiffness: 300 }}>
                    <div className="p-3 md:p-4 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                      <Truck className="h-6 w-6 md:h-7 md:w-7 text-blue-600" />
                    </div>
                    <span className="text-xs md:text-sm font-semibold text-[var(--color-text-primary)]">Flexible delivery work</span>
                  </motion.div>
                  <motion.div className="flex flex-col items-center gap-3 text-center group cursor-pointer" whileHover={{ scale: 1.05, y: -4 }} transition={{ type: "spring", stiffness: 300 }}>
                    <div className="p-3 md:p-4 bg-gradient-to-br from-green-100 to-green-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                      <Clock className="h-6 w-6 md:h-7 md:w-7 text-green-600" />
                    </div>
                    <span className="text-xs md:text-sm font-semibold text-[var(--color-text-primary)]">Choose your hours</span>
                  </motion.div>
                  <motion.div className="flex flex-col items-center gap-3 text-center group cursor-pointer" whileHover={{ scale: 1.05, y: -4 }} transition={{ type: "spring", stiffness: 300 }}>
                    <div className="p-3 md:p-4 bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                      <Route className="h-6 w-6 md:h-7 md:w-7 text-yellow-600" />
                    </div>
                    <span className="text-xs md:text-sm font-semibold text-[var(--color-text-primary)]">Optimized routes</span>
                  </motion.div>
                  <motion.div className="flex flex-col items-center gap-3 text-center group cursor-pointer" whileHover={{ scale: 1.05, y: -4 }} transition={{ type: "spring", stiffness: 300 }}>
                    <div className="p-3 md:p-4 bg-gradient-to-br from-purple-100 to-purple-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                      <DollarSign className="h-6 w-6 md:h-7 md:w-7 text-purple-600" />
                    </div>
                    <span className="text-xs md:text-sm font-semibold text-[var(--color-text-primary)]">Competitive earnings</span>
                  </motion.div>
                </div>

                <div className="flex justify-center">
                  <Button
                    onClick={handleGetStarted}
                    size="lg"
                    className="bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-5 md:py-7 px-10 md:px-16 text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-1 transform"
                  >
                    {user ? 'Continue Application' : 'Apply as Delivery Partner'}
                  </Button>
                </div>
              </div>
            </FadeInSection>
          </div>
        </GradientHero>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-24 md:py-32 px-4 bg-gradient-to-b from-white via-gray-50 to-white relative overflow-hidden">
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-white text-center group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-20 h-20 bg-gradient-to-br from-[var(--color-primary)]/15 to-[var(--color-primary)]/5 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl font-bold text-[var(--color-primary)]">1</span>
                    </div>
                    <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors duration-300">Apply & Get Approved</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Submit your application with vehicle and license information. Get approved quickly.</p>
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
                    <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] group-hover:text-green-600 transition-colors duration-300">Accept Delivery Requests</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Receive delivery requests from chefs and accept the ones that fit your schedule.</p>
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
                    <CardTitle className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] group-hover:text-purple-600 transition-colors duration-300">Deliver & Earn</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Complete deliveries and earn money. Track your earnings and schedule in your dashboard.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section id="benefits" className="py-24 md:py-32 px-4 bg-gradient-to-b from-[var(--color-cream)]/30 via-white to-[var(--color-cream)]/20 relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-40 left-10 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-40 right-10 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-20">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Benefits
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">Why Become a Delivery Partner?</h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans max-w-3xl mx-auto leading-relaxed">
                  Flexible work that fits your schedule
                </p>
              </div>
            </FadeInSection>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <MapPin className="h-8 w-8 text-blue-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-blue-600 transition-colors duration-300">Work in Your Area</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Deliver in your local area and build relationships with your community.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Clock className="h-8 w-8 text-green-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-green-600 transition-colors duration-300">Flexible Schedule</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Choose when you want to work. Perfect for students, part-time workers, or anyone looking for extra income.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={2}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-yellow-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-yellow-100 to-yellow-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <DollarSign className="h-8 w-8 text-yellow-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-yellow-600 transition-colors duration-300">Competitive Pay</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Earn competitive rates for each delivery. The more you deliver, the more you earn.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={2}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-purple-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Route className="h-8 w-8 text-purple-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-purple-600 transition-colors duration-300">Optimized Routes</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Our system helps you find the most efficient routes to maximize your earnings.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={3}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-red-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-red-100 to-red-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Shield className="h-8 w-8 text-red-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-red-600 transition-colors duration-300">Safe & Secure</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">All deliveries are tracked and verified. Your safety is our priority.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={3}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-100 to-indigo-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Truck className="h-8 w-8 text-indigo-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-indigo-600 transition-colors duration-300">Easy to Start</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Simple application process. Get started in minutes and start earning right away.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 md:py-36 px-4 bg-gradient-to-br from-[var(--color-primary)] via-[#FF5470] to-[var(--color-primary)] text-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-white rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-white rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-4xl text-center relative z-10">
            <FadeInSection>
              <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-8 leading-tight text-shadow-lg">Ready to Start Delivering?</h2>
              <p className="text-xl md:text-2xl mb-10 max-w-3xl mx-auto font-sans opacity-95 leading-relaxed">
                {statsLoading ? (
                  "Join our delivery partner network and connect communities with fresh, homemade meals."
                ) : stats?.totalDeliveryPartners ? (
                  `Join ${stats.totalDeliveryPartners}+ delivery partners connecting communities with fresh, homemade meals.`
                ) : (
                  "Join our delivery partner network and connect communities with fresh, homemade meals."
                )}
              </p>
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-white text-[var(--color-primary)] hover:bg-gray-50 font-bold py-7 px-14 text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:-translate-y-2 transform"
              >
                {user ? 'Continue Application' : 'Apply Now'}
              </Button>
            </FadeInSection>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

