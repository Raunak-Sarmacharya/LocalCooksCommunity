import { useTranslation } from "react-i18next";
import Logo from "@/components/ui/logo";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { Building2, Mail, MapPin, Phone } from "lucide-react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { Link, useLocation } from "wouter";
import { useMemo, forwardRef } from "react";
import { getSubdomainFromHostname } from "@shared/subdomain-utils";
import { parseLocationLocale } from "@/i18n/routing";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

const Footer = forwardRef<HTMLElement>((props, ref) => {
  const [location, navigate] = useLocation();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();
  const { t } = useTranslation("common");

  // Get current subdomain
  const currentSubdomain = useMemo(() => {
    if (typeof window !== 'undefined') {
      return getSubdomainFromHostname(window.location.hostname);
    }
    return null;
  }, []);

  // Check if we're on specific landing pages (ignore locale prefixes like /en-CA)
  const { pathWithoutLocale } = parseLocationLocale(location);
  const isLandingRoot = pathWithoutLocale === '/';
  const isChefLanding = currentSubdomain === 'chef' && isLandingRoot;
  const isKitchenLanding = currentSubdomain === 'kitchen' && isLandingRoot;

  const handleCTAClick = () => {
    navigate(getNavigationPath());
  };

  const handleAnchorClick = (anchor: string) => {
    if (isLandingRoot) {
      // On the landing page — scroll directly (sections are rendered inline)
      const element = document.querySelector(anchor);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    // If we're on a different page, navigate to homepage first
    navigate('/');
    // Wait for navigation to complete, then scroll
    setTimeout(() => {
      const element = document.querySelector(anchor);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // If element not found immediately, try again after a short delay
        setTimeout(() => {
          const retryElement = document.querySelector(anchor);
          if (retryElement) {
            retryElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);
      }
    }, 200);
  };

  const getApplyLinkText = () => {
    return getButtonText(t("applyNow"));
  };

  return (
    <footer ref={ref} className="relative overflow-hidden border-t-4 border-[#F51042] bg-[#101010] px-4 pb-24 pt-10 text-white sm:pb-8 lg:pt-12">
      {/* Decorative background elements */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
        <div className="absolute -left-32 -top-40 size-[28rem] rounded-full bg-brand-primary blur-3xl"></div>
        <div className="absolute -bottom-52 right-0 size-96 rounded-full bg-gold blur-3xl"></div>
      </div>

      <div className="container mx-auto max-w-7xl relative z-10 px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 border-b border-white/10 pb-9 lg:grid-cols-[0.9fr_2fr] lg:gap-20">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:p-6">
            <div className="mb-4">
              <Logo variant="white" className="h-11 w-auto sm:h-12" />
            </div>
            <p className="max-w-sm text-sm leading-6 text-white/60">{t("connectingTalentedHomeChefs")}</p>
          </div>

          <div className="grid grid-cols-1 gap-8 py-2 sm:grid-cols-3 lg:gap-12">
            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">{t("contactUs")}</h3>
              <ul className="space-y-3">
                <li>
                  <a
                    href="mailto:support@localcook.shop"
                    className="flex items-center gap-3 text-gray-300 hover:text-white transition-all duration-300 group mobile-touch-target py-1"
                  >
                    <Mail className="h-5 w-5 text-brand-primary group-hover:scale-110 transition-transform duration-300 flex-shrink-0" />
                    <span className="text-sm sm:text-base break-all">support@localcook.shop</span>
                  </a>
                </li>
                <li>
                  <a
                    href="tel:+17096318480"
                    className="flex items-center gap-3 text-gray-300 hover:text-white transition-all duration-300 group mobile-touch-target py-1"
                  >
                    <Phone className="h-5 w-5 text-brand-primary group-hover:scale-110 transition-transform duration-300 flex-shrink-0" />
                    <span className="text-sm sm:text-base">+1 (709) 631-8480</span>
                  </a>
                </li>
                <li>
                  <div className="flex items-center gap-3 text-gray-300 py-1">
                    <MapPin className="h-5 w-5 text-brand-primary flex-shrink-0" />
                    <span className="text-sm sm:text-base">{t("stJohns")}</span>
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">{t("quickLinks")}</h3>
              <ul className="space-y-2">
                {isChefLanding ? (
                  <>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#how-it-works')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("howItWorks")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#kitchen-access')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("kitchenAccess")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#testimonials')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("testimonials")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#faq')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("faq")}</button>
                    </li>
                    <li>
                      <Link
                        href="/resources"
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("resources")}</Link>
                    </li>
                    <li>
                      <button
                        onClick={handleCTAClick}
                        disabled={isLoading}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 disabled:opacity-50 disabled:cursor-not-allowed mobile-touch-target"
                      >
                        {isLoading ? t("loading") : getApplyLinkText()}
                      </button>
                    </li>
                  </>
                ) : isKitchenLanding ? (
                  <>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#revenue-streams')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("revenueStreams")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#how-it-works')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("howItWorks")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#everything-included')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("everythingIncluded")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#faq')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("faq")}</button>
                    </li>
                    <li>
                      <Link
                        href="/resources"
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("resources")}</Link>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#how-it-works')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("howItWorks")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#benefits')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("benefits")}</button>
                    </li>
                    <li>
                      <button
                        onClick={() => handleAnchorClick('#about')}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >{t("aboutUs")}</button>
                    </li>
                    <li>
                      <button
                        onClick={handleCTAClick}
                        disabled={isLoading}
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium block w-full text-left py-2.5 sm:py-2 hover:translate-x-2 disabled:opacity-50 disabled:cursor-not-allowed mobile-touch-target"
                      >
                        {isLoading ? t("loading") : getApplyLinkText()}
                      </button>
                    </li>
                    <li>
                      <Link
                        href="/manager/login"
                        className="text-gray-300 hover:text-white transition-all duration-300 text-sm sm:text-base font-medium flex items-center gap-2 py-2.5 sm:py-2 hover:translate-x-2 mobile-touch-target"
                      >
                        <Building2 className="h-4 w-4 text-brand-primary flex-shrink-0" />{t("partnerLogin")}</Link>
                    </li>
                  </>
                )}
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">{t("connect")}</h3>
              <div className="flex space-x-3 mb-4">
                <a
                  href="https://www.facebook.com/LocalCooks"
                  className="bg-white/10 p-3 rounded-xl hover:bg-brand-primary transition-all duration-300 hover:scale-110 hover:-translate-y-1 mobile-touch-target"
                  aria-label="Facebook"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaFacebook className="h-5 w-5" />
                </a>
                <a
                  href="https://www.linkedin.com/company/local-cooks/"
                  className="bg-white/10 p-3 rounded-xl hover:bg-brand-primary transition-all duration-300 hover:scale-110 hover:-translate-y-1 mobile-touch-target"
                  aria-label="LinkedIn"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaLinkedin className="h-5 w-5" />
                </a>
              </div>
              <p className="text-sm md:text-base text-gray-400 leading-relaxed">{t("followUsOnSocialMedia")}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 pt-6 text-xs text-white/45 sm:flex-row">
          <div className="flex items-center w-full sm:w-auto justify-center sm:justify-start">
            <LanguageSwitcher size="sm" variant="footer" />
          </div>
          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 sm:gap-3 text-center">
            <p className="font-medium whitespace-nowrap">&copy; {new Date().getFullYear()} Local Cooks. {t("allRightsReserved")}</p>
            <span className="text-gray-600 hidden sm:inline">|</span>
            <a
              href="https://www.localcooks.ca/terms"
              className="text-gray-400 hover:text-white transition-colors duration-300 hover:underline whitespace-nowrap"
              target="_blank"
              rel="noopener noreferrer"
            >{t("termsAndConditions")}</a>
            <span className="text-gray-600 hidden sm:inline">|</span>
            <a
              href="https://www.localcooks.ca/privacy"
              className="text-gray-400 hover:text-white transition-colors duration-300 hover:underline whitespace-nowrap"
              target="_blank"
              rel="noopener noreferrer"
            >{t("privacyPolicy")}</a>
          </div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = "Footer";

export default Footer;
