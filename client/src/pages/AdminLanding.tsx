import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";
import { Shield, Users, FileCheck, Settings, BarChart3, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function AdminLanding() {
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
        {/* Admin-Specific Hero Section */}
        <GradientHero variant="dark" className="pt-28 pb-8 md:pt-36 md:pb-16 px-4 text-white" showOrbs={false}>
          <div className="container mx-auto">
            <FadeInSection>
              <div className="max-w-4xl mx-auto text-center mb-16">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 rounded-full mb-8 backdrop-blur-sm">
                  <Shield className="h-10 w-10 text-white" />
                </div>
                <h1 className="text-4xl md:text-5xl font-bold mb-4">
                  Admin Dashboard
                </h1>
              <p className="text-xl text-gray-300 max-w-2xl mx-auto mb-8">
                Manage applications, users, locations, and system settings. Full control over the Local Cooks platform.
              </p>
              <Button
                size="lg"
                onClick={() => setLocation("/admin/login")}
                className="bg-white text-gray-900 hover:bg-gray-100 font-semibold py-6 px-8 text-lg flex items-center gap-2 mx-auto"
              >
                <Lock className="h-5 w-5" />
                  Sign In to Admin Dashboard
                </Button>
              </div>
            </FadeInSection>
          </div>
        </GradientHero>

        {/* Features Section */}
        <section id="features" className="py-12 md:py-16 px-4 bg-white">
          <div className="container mx-auto">
            <FadeInSection>
              <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">Admin Features</h2>
            </FadeInSection>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
              <FadeInSection delay={1}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                    <FileCheck className="h-6 w-6 text-blue-600" />
                  </div>
                  <CardTitle>Application Management</CardTitle>
                  <CardDescription>
                    Review and approve chef and delivery partner applications. Manage document verification.
                  </CardDescription>
                </CardHeader>
              </Card>
              </FadeInSection>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                    <Users className="h-6 w-6 text-green-600" />
                  </div>
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>
                    Manage all users, roles, and permissions. View user activity and account status.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                    <Settings className="h-6 w-6 text-purple-600" />
                  </div>
                  <CardTitle>Location Management</CardTitle>
                  <CardDescription>
                    Create and manage commercial kitchen locations. Configure settings and assign managers.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
                    <BarChart3 className="h-6 w-6 text-orange-600" />
                  </div>
                  <CardTitle>Analytics & Reports</CardTitle>
                  <CardDescription>
                    View platform statistics, booking trends, and generate reports for insights.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
                    <Shield className="h-6 w-6 text-red-600" />
                  </div>
                  <CardTitle>Security & Access</CardTitle>
                  <CardDescription>
                    Manage system security, access controls, and monitor platform activity.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
                    <Settings className="h-6 w-6 text-indigo-600" />
                  </div>
                  <CardTitle>System Settings</CardTitle>
                  <CardDescription>
                    Configure platform-wide settings, email templates, and system preferences.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-12 md:py-16 px-4 bg-gradient-to-r from-gray-900 to-gray-800 text-white">
          <div className="container mx-auto text-center">
            <FadeInSection>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Access Admin Dashboard</h2>
              <p className="text-xl mb-8 max-w-2xl mx-auto text-gray-300">
                Sign in to manage the Local Cooks platform and oversee all operations.
              </p>
              <Button
                size="lg"
                onClick={() => setLocation("/admin/login")}
                className="bg-white text-gray-900 hover:bg-gray-100 font-semibold py-6 px-8 text-lg flex items-center gap-2 mx-auto"
              >
                <Lock className="h-5 w-5" />
                Sign In to Admin Dashboard
              </Button>
            </FadeInSection>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

