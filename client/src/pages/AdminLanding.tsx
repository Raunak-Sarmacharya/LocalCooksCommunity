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
                  Admin Dashboard
                </h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)]/90 font-sans max-w-3xl mx-auto mb-10 leading-relaxed font-medium">
                  Manage applications, users, locations, and system settings. Full control over the Local Cooks platform.
                </p>
                <Button
                  size="lg"
                  onClick={() => setLocation("/admin/login")}
                  className="bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-6 md:py-7 px-12 md:px-16 text-lg md:text-xl rounded-xl flex items-center gap-2 mx-auto transition-all duration-300 shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-1 transform"
                >
                  <Lock className="h-5 w-5" />
                  Sign In to Admin Dashboard
                </Button>
              </div>
            </FadeInSection>
          </div>
        </GradientHero>

        {/* Features Section */}
        <section id="features" className="py-16 md:py-20 px-4 bg-gradient-to-b from-white via-gray-50 to-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-40 left-10 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
            <div className="absolute bottom-40 right-10 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-6xl relative z-10">
            <FadeInSection>
              <div className="text-center mb-12">
                <span className="inline-block text-[var(--color-primary)] font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-[var(--color-primary)]/10 rounded-full">
                  Admin Features
                </span>
                <h2 className="text-4xl md:text-6xl font-display text-[var(--color-primary)] mb-6">Admin Features</h2>
                <p className="text-xl md:text-2xl text-[var(--color-text-primary)] font-sans max-w-3xl mx-auto leading-relaxed">
                  Complete control over the Local Cooks platform
                </p>
              </div>
            </FadeInSection>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <FileCheck className="h-8 w-8 text-blue-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-blue-600 transition-colors duration-300">Application Management</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Review and approve chef and delivery partner applications. Manage document verification.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={1}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Users className="h-8 w-8 text-green-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-green-600 transition-colors duration-300">User Management</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Manage all users, roles, and permissions. View user activity and account status.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={2}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-purple-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Settings className="h-8 w-8 text-purple-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-purple-600 transition-colors duration-300">Location Management</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Create and manage commercial kitchen locations. Configure settings and assign managers.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={2}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-orange-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <BarChart3 className="h-8 w-8 text-orange-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-orange-600 transition-colors duration-300">Analytics & Reports</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">View platform statistics, booking trends, and generate reports for insights.</p>
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
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-red-600 transition-colors duration-300">Security & Access</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Manage system security, access controls, and monitor platform activity.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
              <FadeInSection delay={3}>
                <Card className="border border-gray-100 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <CardHeader className="relative z-10">
                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-100 to-indigo-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                      <Settings className="h-8 w-8 text-indigo-600" />
                    </div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-indigo-600 transition-colors duration-300">System Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[var(--color-text-primary)] font-sans relative z-10">
                    <p className="leading-relaxed text-base md:text-lg">Configure platform-wide settings, email templates, and system preferences.</p>
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 md:py-24 px-4 bg-gradient-to-br from-[var(--color-primary)] via-[#FF5470] to-[var(--color-primary)] text-white relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-20 left-20 w-96 h-96 bg-white rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-white rounded-full blur-3xl"></div>
          </div>
          
          <div className="container mx-auto max-w-4xl text-center relative z-10">
            <FadeInSection>
              <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-8 leading-tight text-shadow-lg">Access Admin Dashboard</h2>
              <p className="text-xl md:text-2xl mb-10 max-w-3xl mx-auto font-sans opacity-95 leading-relaxed">
                Sign in to manage the Local Cooks platform and oversee all operations.
              </p>
              <Button
                size="lg"
                onClick={() => setLocation("/admin/login")}
                className="bg-white text-[var(--color-primary)] hover:bg-gray-50 font-bold py-7 px-14 text-lg md:text-xl rounded-xl flex items-center gap-2 mx-auto transition-all duration-300 shadow-2xl hover:shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:-translate-y-2 transform"
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

