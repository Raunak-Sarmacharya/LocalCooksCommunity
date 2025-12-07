import AboutSection from "@/components/home/AboutSection";
import BenefitsSection from "@/components/home/BenefitsSection";
import CTASection from "@/components/home/CTASection";
import HeroSection from "@/components/home/HeroSection";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import Preloader from "@/components/ui/Preloader";
import StatusEmailTest from "@/components/test/StatusEmailTest";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";

export default function Home() {
  const { user } = useFirebaseAuth();
  const [showTestTool, setShowTestTool] = useState(false);
  const [showPreloader, setShowPreloader] = useState(true);
  const [location] = useLocation();

  // Scroll to section with proper timing
  const scrollToHash = useCallback((hash: string) => {
    if (!hash) return;
    
    const scrollToElement = () => {
      const element = document.querySelector(hash);
      if (element) {
        // Use scrollIntoView - sections have scroll-mt-24 class for header offset
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    };

    // Try immediately
    if (scrollToElement()) return;

    // If not found, try with delays (for dynamic content)
    const delays = [100, 300, 500, 1000];
    delays.forEach((delay) => {
      setTimeout(() => {
        scrollToElement();
      }, delay);
    });
  }, []);

  // Check for test mode in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const testMode = urlParams.get('test');
    if (testMode === 'email' && user?.role === 'admin') {
      setShowTestTool(true);
    }
  }, [user]);

  // Handle hash when component mounts or location changes
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      // Wait for preloader to finish if it's showing
      const delay = showPreloader ? 3500 : 100;
      setTimeout(() => {
        scrollToHash(hash);
      }, delay);
    }
  }, [location, showPreloader, scrollToHash]);

  // Also handle hash after preloader completes
  useEffect(() => {
    if (!showPreloader && window.location.hash) {
      // Small delay to ensure DOM is fully rendered
      setTimeout(() => {
        scrollToHash(window.location.hash);
      }, 200);
    }
  }, [showPreloader, scrollToHash]);

  // Set up hash change event handler
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash) {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          scrollToHash(hash);
        }, 100);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [scrollToHash]);

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
        <HeroSection />
        <HowItWorksSection />
        <BenefitsSection />
        <AboutSection />
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
