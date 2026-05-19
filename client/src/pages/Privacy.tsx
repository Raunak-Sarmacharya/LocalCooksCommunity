import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";
import PrivacyContent from "@/components/legal/PrivacyContent";
import { motion } from "framer-motion";
import { useEffect } from "react";

export default function Privacy() {
  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <SEOHead
        title="Privacy Policy"
        description="LocalCooks privacy policy. Learn how we collect, use, and protect your personal information on our commercial kitchen booking and chef services platform."
        canonicalUrl="/privacy"
        breadcrumbs={[
          { name: "LocalCooks", url: "https://www.localcooks.ca/" },
          { name: "Privacy Policy", url: "https://chef.localcooks.ca/privacy" },
        ]}
      />
      <Header />
      <main className="flex-grow pt-28 pb-16">
        <motion.div
          className="container mx-auto px-4 max-w-4xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="bg-white rounded-lg shadow-lg p-8 md:p-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-8 text-center text-gray-900">
              Privacy Policy
            </h1>
            
            <PrivacyContent />

          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 