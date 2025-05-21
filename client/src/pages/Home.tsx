import { useEffect, useState } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import HeroSection from "@/components/home/HeroSection";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import BenefitsSection from "@/components/home/BenefitsSection";
import AboutSection from "@/components/home/AboutSection";
import CTASection from "@/components/home/CTASection";
import StatusEmailTest from "@/components/test/StatusEmailTest";
import { useAuth } from "@/hooks/use-auth";

export default function Home() {
  const { user } = useAuth();
  const [showTestTool, setShowTestTool] = useState(false);

  // Add automatic scroll to sections when hash URL changes
  const handleHashChange = () => {
    const hash = window.location.hash;
    if (hash) {
      const element = document.querySelector(hash);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  // Check for test mode in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const testMode = urlParams.get('test');
    if (testMode === 'email' && user?.role === 'admin') {
      setShowTestTool(true);
    }
  }, [user]);

  // Set up hash change event handler
  useEffect(() => {
    window.addEventListener('hashchange', handleHashChange);

    // Handle initial hash if present
    if (window.location.hash) {
      setTimeout(handleHashChange, 100);
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow">
        <HeroSection />
        <div id="how-it-works"><HowItWorksSection /></div>
        <div id="benefits"><BenefitsSection /></div>
        <div id="about"><AboutSection /></div>
        <CTASection />

        {/* Email Test Tool - Only visible for admins when ?test=email is in URL */}
        {showTestTool && (
          <div className="py-12 bg-gray-100 border-t border-gray-200">
            <div className="container mx-auto">
              <h2 className="text-2xl font-bold text-center mb-8">Email Notification Test Tool</h2>
              <StatusEmailTest />
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
