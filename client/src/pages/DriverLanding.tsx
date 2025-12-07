import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";
import { Truck, Clock, DollarSign, Route, MapPin, Shield } from "lucide-react";
import { useLocation } from "wouter";
import foodDeliveryImage from "@/assets/food-delivery.png";
import { useQuery } from "@tanstack/react-query";

export default function DriverLanding() {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();

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
      <Header />
      <main className="flex-grow">
        {/* Driver-Specific Hero Section */}
        <GradientHero variant="cool" className="pt-28 pb-8 md:pt-36 md:pb-16 px-4">
          <div className="container mx-auto grid md:grid-cols-2 gap-6 md:gap-8 items-center">
            <FadeInSection>
              <div className="space-y-4 md:space-y-6">
                <h1 className="text-3xl md:text-5xl font-bold mb-1 md:mb-2">
                  Become a <span className="font-logo text-primary">Delivery Partner</span>
                </h1>
              <h2 className="text-lg md:text-2xl font-semibold mb-3 md:mb-4 text-gray-700">
                Connecting Communities Through Fast Delivery
              </h2>
              <p className="text-base md:text-lg mb-4 md:mb-6 text-gray-600 leading-relaxed">
                Join Local Cooks as a delivery partner and earn flexible income while connecting communities with fresh, homemade meals. Set your own schedule and start earning today.
              </p>
              
              <div className="grid grid-cols-2 gap-3 md:gap-4 mb-6 md:mb-8">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 md:p-2 bg-blue-100 rounded-full">
                    <Truck className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                  </div>
                  <span className="text-xs md:text-sm font-medium">Flexible delivery work</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 md:p-2 bg-green-100 rounded-full">
                    <Clock className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                  </div>
                  <span className="text-xs md:text-sm font-medium">Choose your hours</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 md:p-2 bg-yellow-100 rounded-full">
                    <Route className="h-4 w-4 md:h-5 md:w-5 text-yellow-600" />
                  </div>
                  <span className="text-xs md:text-sm font-medium">Optimized routes</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 md:p-2 bg-purple-100 rounded-full">
                    <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                  </div>
                  <span className="text-xs md:text-sm font-medium">Competitive earnings</span>
                </div>
              </div>

                <Button
                  onClick={handleGetStarted}
                  size="lg"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-6 px-8 text-lg btn-glow"
                >
                  {user ? 'Continue Application' : 'Apply as Delivery Partner'}
                </Button>
              </div>
            </FadeInSection>
            <FadeInSection delay={1}>
              <div className="hidden md:block">
                <img
                  src={foodDeliveryImage}
                  alt="Food delivery"
                  className="w-full h-auto rounded-lg shadow-xl"
                />
              </div>
            </FadeInSection>
          </div>
        </GradientHero>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-12 md:py-16 px-4 bg-white">
          <div className="container mx-auto">
            <FadeInSection>
              <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">How It Works</h2>
            </FadeInSection>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <FadeInSection delay={1}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                    <span className="text-blue-600 font-bold text-xl">1</span>
                  </div>
                  <CardTitle>Apply & Get Approved</CardTitle>
                  <CardDescription>
                    Submit your application with vehicle and license information. Get approved quickly.
                  </CardDescription>
                </CardHeader>
              </Card>
              </FadeInSection>
              <FadeInSection delay={2}>
                <Card className="border-2 card-hover">
                  <CardHeader>
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                      <span className="text-green-600 font-bold text-xl">2</span>
                    </div>
                    <CardTitle>Accept Delivery Requests</CardTitle>
                    <CardDescription>
                      Receive delivery requests from chefs and accept the ones that fit your schedule.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </FadeInSection>
              <FadeInSection delay={3}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                    <span className="text-purple-600 font-bold text-xl">3</span>
                  </div>
                  <CardTitle>Deliver & Earn</CardTitle>
                  <CardDescription>
                    Complete deliveries and earn money. Track your earnings and schedule in your dashboard.
                  </CardDescription>
                </CardHeader>
              </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section id="benefits" className="py-12 md:py-16 px-4 bg-light-gray">
          <div className="container mx-auto">
            <FadeInSection>
              <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">Why Become a Delivery Partner?</h2>
            </FadeInSection>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FadeInSection delay={1}>
                <Card className="card-hover">
                <CardHeader>
                  <MapPin className="h-8 w-8 text-blue-600 mb-3" />
                  <CardTitle>Work in Your Area</CardTitle>
                  <CardDescription>
                    Deliver in your local area and build relationships with your community.
                  </CardDescription>
                </CardHeader>
              </Card>
              </FadeInSection>
              <Card>
                <CardHeader>
                  <Clock className="h-8 w-8 text-green-600 mb-3" />
                  <CardTitle>Flexible Schedule</CardTitle>
                  <CardDescription>
                    Choose when you want to work. Perfect for students, part-time workers, or anyone looking for extra income.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <DollarSign className="h-8 w-8 text-yellow-600 mb-3" />
                  <CardTitle>Competitive Pay</CardTitle>
                  <CardDescription>
                    Earn competitive rates for each delivery. The more you deliver, the more you earn.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <Route className="h-8 w-8 text-purple-600 mb-3" />
                  <CardTitle>Optimized Routes</CardTitle>
                  <CardDescription>
                    Our system helps you find the most efficient routes to maximize your earnings.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <Shield className="h-8 w-8 text-red-600 mb-3" />
                  <CardTitle>Safe & Secure</CardTitle>
                  <CardDescription>
                    All deliveries are tracked and verified. Your safety is our priority.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <Truck className="h-8 w-8 text-indigo-600 mb-3" />
                  <CardTitle>Easy to Start</CardTitle>
                  <CardDescription>
                    Simple application process. Get started in minutes and start earning right away.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-12 md:py-16 px-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
          <div className="container mx-auto text-center">
            <FadeInSection>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Start Delivering?</h2>
            <p className="text-xl mb-8 max-w-2xl mx-auto">
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
                className="bg-white text-blue-600 hover:bg-blue-50 font-semibold py-6 px-8 text-lg btn-glow"
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

