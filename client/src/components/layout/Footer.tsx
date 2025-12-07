import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { Building2, ChefHat, Heart, Mail, MapPin, Phone, Truck } from "lucide-react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { Link, useLocation } from "wouter";

export default function Footer() {
  const [location, navigate] = useLocation();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();

  const handleCTAClick = () => {
    navigate(getNavigationPath());
  };

  const handleDriverClick = () => {
    navigate('/driver-auth');
  };

  const handleAnchorClick = (anchor: string) => {
    if (location === '/') {
      // If we're on the homepage, scroll to the anchor
      const element = document.querySelector(anchor);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
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
    }
  };

  const getCTAButtonText = () => {
    return getButtonText("Join as a Cook");
  };

  const getApplyLinkText = () => {
    return getButtonText("Apply Now");
  };

  return (
    <footer className="bg-gradient-to-t from-[#1a1a1a] via-[#2C2C2C] to-[#1a1a1a] text-white pt-12 pb-8 px-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute top-20 left-20 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
      </div>
      
      <div className="container mx-auto max-w-7xl relative z-10">
        <div className="flex flex-col md:flex-row justify-between mb-8 pb-8 border-b border-white/20">
          <div className="mb-8 md:mb-0 md:w-1/3">
            <div className="mb-4">
              <Logo variant="white" className="h-16 w-auto" />
            </div>
            <p className="text-gray-300 mb-6 max-w-md text-sm md:text-base leading-relaxed">
              Connecting talented home chefs with hungry customers. We're building more than a platform – we're creating a community where cooks and customers connect directly.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleCTAClick}
                disabled={isLoading}
                variant="outline"
                className="rounded-xl border-white/30 bg-white/10 hover:bg-white/20 text-white btn-glow transition-all duration-300 hover:scale-105 hover:-translate-y-1 font-semibold py-3 px-6 text-sm shadow-lg hover:shadow-xl"
              >
                <ChefHat className="mr-2 h-4 w-4" />
                {isLoading ? "Loading..." : getCTAButtonText()}
              </Button>
              <Button
                onClick={handleDriverClick}
                variant="outline"
                className="rounded-xl border-blue-400/50 bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 hover:text-blue-100 btn-glow transition-all duration-300 hover:scale-105 hover:-translate-y-1 font-semibold py-3 px-6 text-sm shadow-lg hover:shadow-xl"
              >
                <Truck className="mr-2 h-4 w-4" />
                Join as Delivery Partner
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 md:gap-8 md:w-3/5">
            <div>
              <h3 className="text-xl md:text-2xl font-bold mb-4 text-[#F51042]">Contact Us</h3>
              <ul className="space-y-3">
                <li>
                  <a 
                    href="mailto:support@localcook.shop"
                    className="flex items-center gap-3 text-gray-300 hover:text-white transition-all duration-300 group"
                  >
                    <Mail className="h-5 w-5 text-[#F51042] group-hover:scale-110 transition-transform duration-300" />
                    <span className="text-sm md:text-base">support@localcook.shop</span>
                  </a>
                </li>
                <li>
                  <a 
                    href="tel:+17096892942"
                    className="flex items-center gap-3 text-gray-300 hover:text-white transition-all duration-300 group"
                  >
                    <Phone className="h-5 w-5 text-[#F51042] group-hover:scale-110 transition-transform duration-300" />
                    <span className="text-sm md:text-base">(709) 689-2942</span>
                  </a>
                </li>
                <li>
                  <div className="flex items-center gap-3 text-gray-300">
                    <MapPin className="h-5 w-5 text-[#F51042]" />
                    <span className="text-sm md:text-base">St. John's, NL, Canada</span>
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl md:text-2xl font-bold mb-4 text-[#F51042]">Quick Links</h3>
              <ul className="space-y-2">
                <li>
                  <button
                    onClick={() => handleAnchorClick('#how-it-works')}
                    className="text-gray-300 hover:text-white transition-all duration-300 text-sm md:text-base font-medium block w-full text-left py-2 hover:translate-x-2"
                  >
                    How It Works
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => handleAnchorClick('#benefits')}
                    className="text-gray-300 hover:text-white transition-all duration-300 text-sm md:text-base font-medium block w-full text-left py-2 hover:translate-x-2"
                  >
                    Benefits
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => handleAnchorClick('#about')}
                    className="text-gray-300 hover:text-white transition-all duration-300 text-sm md:text-base font-medium block w-full text-left py-2 hover:translate-x-2"
                  >
                    About Us
                  </button>
                </li>
                <li>
                  <button 
                    onClick={handleCTAClick}
                    disabled={isLoading}
                    className="text-gray-300 hover:text-white transition-all duration-300 text-sm md:text-base font-medium block w-full text-left py-2 hover:translate-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? "Loading..." : getApplyLinkText()}
                  </button>
                </li>
                <li>
                  <button 
                    onClick={handleDriverClick}
                    className="text-gray-300 hover:text-white transition-all duration-300 text-sm md:text-base font-medium block w-full text-left py-2 hover:translate-x-2"
                  >
                    Apply as Delivery Partner
                  </button>
                </li>
                <li>
                  <Link 
                    href="/manager/login"
                    className="text-gray-300 hover:text-white transition-all duration-300 text-sm md:text-base font-medium flex items-center gap-2 py-2 hover:translate-x-2"
                  >
                    <Building2 className="h-4 w-4 text-[#F51042]" />
                    Partner Login
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl md:text-2xl font-bold mb-4 text-[#F51042]">Connect</h3>
              <div className="flex space-x-3 mb-4">
                <a
                  href="https://www.facebook.com/LocalCooks"
                  className="bg-white/10 p-3 rounded-xl hover:bg-[#F51042] transition-all duration-300 hover:scale-110 hover:-translate-y-1"
                  aria-label="Facebook"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaFacebook className="h-5 w-5" />
                </a>
                <a
                  href="https://www.linkedin.com/company/local-cooks/"
                  className="bg-white/10 p-3 rounded-xl hover:bg-[#F51042] transition-all duration-300 hover:scale-110 hover:-translate-y-1"
                  aria-label="LinkedIn"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaLinkedin className="h-5 w-5" />
                </a>
              </div>
              <p className="text-sm md:text-base text-gray-400 leading-relaxed">
                Follow us on social media for updates and news.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center text-sm md:text-base text-gray-400 pt-6">
          <div className="flex flex-col md:flex-row items-center gap-4 mb-3 md:mb-0">
            <p className="font-medium">&copy; {new Date().getFullYear()} Local Cooks. All rights reserved.</p>
            <div className="flex gap-4">
              <Link 
                href="/terms" 
                className="text-gray-400 hover:text-white transition-all duration-300 hover:underline"
              >
                Terms & Conditions
              </Link>
              <Link 
                href="/privacy" 
                className="text-gray-400 hover:text-white transition-all duration-300 hover:underline"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
          <div className="flex">
            <span className="flex items-center text-sm md:text-base">
              Made with <Heart className="h-4 w-4 mx-1 text-[#F51042] animate-pulse" /> in St. John's, NL
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
