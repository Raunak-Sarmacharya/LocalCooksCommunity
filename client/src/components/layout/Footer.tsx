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
    <footer ref={ref} className="relative overflow-hidden bg-[#0A0A0A] px-4 pb-20 pt-0 text-white sm:pb-8">
      {/* Elegant gradient accent line */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#F51042]/60 to-transparent" />

      <div className="container mx-auto max-w-6xl relative z-10 px-4 sm:px-6 lg:px-8 pt-10 lg:pt-12">
        {/* Main grid */}
        <div className="grid gap-10 pb-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:gap-12">

          {/* Brand column */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <Logo variant="white" className="h-8 w-auto opacity-90" />
              <span className="font-logo text-lg text-white/90 tracking-tight">LocalCooks</span>
            </div>
            <p className="max-w-xs text-[13px] leading-relaxed text-white/40">{t("connectingTalentedHomeChefs")}</p>

            {/* Social icons — compact, calm */}
            <div className="flex items-center gap-2 mt-5">
              <a
                href="https://www.facebook.com/LocalCooks"
                className="flex items-center justify-center w-8 h-8 rounded-md bg-white/[0.06] text-white/50 hover:bg-white/[0.12] hover:text-white transition-all duration-200"
                aria-label="Facebook"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FaFacebook className="h-3.5 w-3.5" />
              </a>
              <a
                href="https://www.linkedin.com/company/local-cooks/"
                className="flex items-center justify-center w-8 h-8 rounded-md bg-white/[0.06] text-white/50 hover:bg-white/[0.12] hover:text-white transition-all duration-200"
                aria-label="LinkedIn"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FaLinkedin className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Quick Links column */}
          <div>
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">{t("quickLinks")}</h3>
            <ul className="space-y-1">
              {isChefLanding ? (
                <>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#how-it-works')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("howItWorks")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#kitchen-access')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("kitchenAccess")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#testimonials')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("testimonials")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#faq')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("faq")}</button>
                  </li>
                  <li>
                    <Link
                      href="/resources"
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("resources")}</Link>
                  </li>
                  <li>
                    <button
                      onClick={handleCTAClick}
                      disabled={isLoading}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
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
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("revenueStreams")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#how-it-works')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("howItWorks")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#everything-included')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("everythingIncluded")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#faq')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("faq")}</button>
                  </li>
                  <li>
                    <Link
                      href="/resources"
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("resources")}</Link>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#how-it-works')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("howItWorks")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#benefits')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("benefits")}</button>
                  </li>
                  <li>
                    <button
                      onClick={() => handleAnchorClick('#about')}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5"
                    >{t("aboutUs")}</button>
                  </li>
                  <li>
                    <button
                      onClick={handleCTAClick}
                      disabled={isLoading}
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] block w-full text-left py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isLoading ? t("loading") : getApplyLinkText()}
                    </button>
                  </li>
                  <li>
                    <Link
                      href="/manager/login"
                      className="text-white/50 hover:text-white/90 transition-colors duration-200 text-[13px] flex items-center gap-1.5 py-1.5"
                    >
                      <Building2 className="h-3.5 w-3.5 text-[#F51042]/60 flex-shrink-0" />{t("partnerLogin")}
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </div>

          {/* Contact column */}
          <div>
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">{t("contactUs")}</h3>
            <ul className="space-y-2.5">
              <li>
                <a
                  href="mailto:support@localcook.shop"
                  className="flex items-center gap-2 text-white/50 hover:text-white/90 transition-colors duration-200 py-0.5"
                >
                  <Mail className="h-3.5 w-3.5 text-[#F51042]/50 flex-shrink-0" />
                  <span className="text-[13px] break-all">support@localcook.shop</span>
                </a>
              </li>
              <li>
                <a
                  href="tel:+17096318480"
                  className="flex items-center gap-2 text-white/50 hover:text-white/90 transition-colors duration-200 py-0.5"
                >
                  <Phone className="h-3.5 w-3.5 text-[#F51042]/50 flex-shrink-0" />
                  <span className="text-[13px]">+1 (709) 631-8480</span>
                </a>
              </li>
              <li>
                <div className="flex items-center gap-2 text-white/50 py-0.5">
                  <MapPin className="h-3.5 w-3.5 text-[#F51042]/50 flex-shrink-0" />
                  <span className="text-[13px]">{t("stJohns")}</span>
                </div>
              </li>
            </ul>
          </div>

          {/* Connect / Language column */}
          <div>
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">{t("connect")}</h3>
            <p className="text-[13px] text-white/40 leading-relaxed mb-4">{t("followUsOnSocialMedia")}</p>
            <LanguageSwitcher size="sm" variant="footer" />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/[0.06] pt-5">
          <div className="flex flex-col items-center justify-between gap-3 text-[11px] text-white/30 sm:flex-row">
            <p className="font-medium whitespace-nowrap">&copy; {new Date().getFullYear()} Local Cooks. {t("allRightsReserved")}</p>
            <div className="flex items-center gap-4">
              <a
                href="https://www.localcooks.ca/terms"
                className="hover:text-white/60 transition-colors duration-200 whitespace-nowrap"
                target="_blank"
                rel="noopener noreferrer"
              >{t("termsAndConditions")}</a>
              <a
                href="https://www.localcooks.ca/privacy"
                className="hover:text-white/60 transition-colors duration-200 whitespace-nowrap"
                target="_blank"
                rel="noopener noreferrer"
              >{t("privacyPolicy")}</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = "Footer";

export default Footer;
