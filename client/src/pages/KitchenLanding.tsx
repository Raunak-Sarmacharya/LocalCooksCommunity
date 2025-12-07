import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Calendar, Lock, ArrowRight, Settings, Users } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

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

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow">
        {/* Kitchen-Specific Hero Section */}
        <section className="pt-28 pb-8 md:pt-36 md:pb-16 px-4 bg-gradient-to-br from-blue-50 via-white to-indigo-50">
          <div className="container mx-auto">
            <div className="max-w-4xl mx-auto text-center mb-16">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-8">
                <Building2 className="h-10 w-10 text-blue-600" />
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
                Commercial Kitchen Booking Platform
              </h1>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
                Find and book commercial kitchens for your culinary business. Perfect for chefs, caterers, and food entrepreneurs.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  size="lg"
                  onClick={() => setLocation("/portal/book")}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
                >
                  <Calendar className="h-5 w-5" />
                  Browse Available Kitchens
                  <ArrowRight className="h-5 w-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setLocation("/portal/register")}
                  className="flex items-center gap-2"
                >
                  <Lock className="h-5 w-5" />
                  Register as Portal User
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-12 md:py-16 px-4 bg-white">
          <div className="container mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">How It Works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                    <span className="text-blue-600 font-bold text-xl">1</span>
                  </div>
                  <CardTitle>Choose a Location</CardTitle>
                  <CardDescription>
                    Browse available commercial kitchen locations in your area and find the perfect space for your needs.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                    <span className="text-green-600 font-bold text-xl">2</span>
                  </div>
                  <CardTitle>Select Date & Time</CardTitle>
                  <CardDescription>
                    Choose a kitchen, date, and available time slot that works for your schedule.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                    <span className="text-purple-600 font-bold text-xl">3</span>
                  </div>
                  <CardTitle>Submit Booking</CardTitle>
                  <CardDescription>
                    Fill in your details and submit your booking request. The kitchen manager will confirm your booking.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="benefits" className="py-12 md:py-16 px-4 bg-light-gray">
          <div className="container mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">Why Book With Us?</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                    <Calendar className="h-6 w-6 text-green-600" />
                  </div>
                  <CardTitle>Flexible Booking</CardTitle>
                  <CardDescription>
                    Book commercial kitchens by the hour or day. Choose from multiple locations and time slots.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                    <Building2 className="h-6 w-6 text-purple-600" />
                  </div>
                  <CardTitle>Professional Kitchens</CardTitle>
                  <CardDescription>
                    Access fully equipped commercial kitchens with all the tools and space you need for your culinary business.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                  <CardTitle>Easy Management</CardTitle>
                  <CardDescription>
                    Manage all your bookings in one place. View history, upcoming bookings, and manage your account.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
                    <Settings className="h-6 w-6 text-orange-600" />
                  </div>
                  <CardTitle>Transparent Pricing</CardTitle>
                  <CardDescription>
                    Clear pricing with no hidden fees. See exactly what you'll pay before booking.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-12 md:py-16 px-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
          <div className="container mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Book a Kitchen?</h2>
            <p className="text-xl mb-8 max-w-2xl mx-auto">
              Start booking commercial kitchens today and take your culinary business to the next level.
            </p>
            <Button
              size="lg"
              onClick={() => setLocation("/portal/book")}
              className="bg-white text-blue-600 hover:bg-blue-50 font-semibold py-6 px-8 text-lg flex items-center gap-2 mx-auto"
            >
              <Calendar className="h-5 w-5" />
              Browse Available Kitchens
              <ArrowRight className="h-5 w-5" />
            </Button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

