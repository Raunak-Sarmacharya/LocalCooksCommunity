import { useEffect } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import HeroSection from "@/components/home/HeroSection";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import BenefitsSection from "@/components/home/BenefitsSection";
import AboutSection from "@/components/home/AboutSection";
import CTASection from "@/components/home/CTASection";

export default function Home() {
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
      </main>
      <Footer />
    </div>
  );
}
