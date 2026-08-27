import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";
import TermsContent from "@/components/legal/TermsContent";
import TermsContent_fr from "@/components/legal/TermsContent_fr";
import TermsContent_uk from "@/components/legal/TermsContent_uk";
import { motion } from "framer-motion";
import { useEffect, Suspense } from "react";
import { useTranslation } from "react-i18next";

export default function Terms() {
  const { i18n } = useTranslation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const renderContent = () => {
    if (i18n.language.startsWith('fr')) return <TermsContent_fr />;
    if (i18n.language.startsWith('uk')) return <TermsContent_uk />;
    return <TermsContent />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <SEOHead
        title="Terms of Service"
        description="LocalCooks platform terms of service. Review the terms and conditions for using LocalCooks commercial kitchen booking, chef services, and payment processing."
        canonicalUrl="/terms"
        breadcrumbs={[
          { name: "LocalCooks", url: "https://www.localcooks.ca/" },
          { name: "Terms of Service", url: "https://chef.localcooks.ca/terms" },
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
              LOCAL COOKS PLATFORM TERMS OF SERVICE
            </h1>

            <Suspense fallback={<div>Loading terms of service...</div>}>
              {renderContent()}
            </Suspense>
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
}