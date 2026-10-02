import { useTranslation } from "react-i18next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import KitchenHero from "@/components/kitchen-landing/KitchenHero";
import KitchenOpportunity from "@/components/kitchen-landing/KitchenOpportunity";
import KitchenGettingStarted from "@/components/kitchen-landing/KitchenGettingStarted";
import KitchenEarningControl from "@/components/kitchen-landing/KitchenEarningControl";
import SEOHead from "@/components/SEO/SEOHead";
import CustomerSupportButton from "@/components/CustomerSupportButton";
import KitchenHostNextSteps, { kitchenHostFaqs } from "@/components/kitchen-landing/KitchenHostNextSteps";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { landingListKitchenPath } from "@/lib/landing-cta";

export default function KitchenLanding() {
  const { t } = useTranslation("kitchen");
  const { user } = useFirebaseAuth();
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

  const handleListKitchen = () => {
    setLocation(landingListKitchenPath(user));
  };

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <SEOHead
        title={t("seoKitchenTitle")}
        description={t("listYourCommercialKitchenSeo")}
        canonicalUrl="/"
        keywords={[
          "list commercial kitchen", "kitchen rental income", "rent out kitchen St Johns",
          "commercial kitchen marketplace", "kitchen sharing platform", "idle kitchen revenue",
          "kitchen booking platform", "commissary kitchen NL", "commercial kitchen Newfoundland",
          "kitchen owner income", "localcooks kitchen", "rent kitchen space",
        ]}
        showLocalBusiness
        breadcrumbs={[
          { name: "LocalCooks", url: "https://www.localcooks.ca/" },
          { name: t("breadcrumbKitchenOwners"), url: "https://kitchen.localcooks.ca/" },
        ]}
        faq={kitchenHostFaqs.map(({ question, answer }) => ({ question: t(question), answer: t(answer) }))}
        siteNavigation={[
          { name: t("kitchenNavList"), description: t("kitchenNavListDesc"), url: "https://kitchen.localcooks.ca/" },
          { name: t("kitchenNavChefs"), description: t("kitchenNavChefsDesc"), url: "https://chef.localcooks.ca/" },
          { name: t("kitchenNavBook"), description: t("kitchenNavBookDesc"), url: "https://chef.localcooks.ca/book-kitchen" },
          { name: t("kitchenNavOrder"), description: t("kitchenNavOrderDesc"), url: "https://localcook.shop/" },
          { name: t("kitchenNavBlog"), description: t("kitchenNavBlogDesc"), url: "https://www.localcooks.ca/blog" },
          { name: t("kitchenNavContact"), description: t("kitchenNavContactDesc"), url: "https://www.localcooks.ca/contact" },
        ]}
      />
      <CustomerSupportButton />
      <Header hideHowItWorks kitchenHostLinks />
      
      <main className="flex-grow">
        <KitchenHero
          onStart={handleListKitchen}
          onHowItWorks={() => document.getElementById('how-it-works')?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          })}
        />

        <KitchenOpportunity onStart={handleListKitchen} />

        <KitchenGettingStarted />

        <KitchenEarningControl onStart={handleListKitchen} />

        <KitchenHostNextSteps onStart={handleListKitchen} />
      </main>
      <Footer />
    </div>
  );
}
