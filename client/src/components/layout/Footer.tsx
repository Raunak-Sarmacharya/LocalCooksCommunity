import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { Building2, ChefHat, Heart, Mail, MapPin, Phone, Truck } from "lucide-react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { Link, useLocation } from "wouter";

export default function Footer() {
  const [, navigate] = useLocation();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();

  const handleCTAClick = () => {
    navigate(getNavigationPath());
  };

  const handleDriverClick = () => {
    navigate('/driver-auth');
  };

  const getCTAButtonText = () => {
    return getButtonText("Join as a Cook");
  };

  const getApplyLinkText = () => {
    return getButtonText("Apply Now");
  };

  return (
    <footer className="bg-gradient-to-t from-slate-900 via-slate-800 to-slate-900 text-white pt-12 pb-6 px-4">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row justify-between mb-8 pb-8 border-b border-white/10">
          <div className="mb-8 md:mb-0 md:w-1/3">
            <div className="mb-5">
              <Logo variant="white" className="h-14 w-auto" />
            </div>
            <p className="text-gray-300 mb-6 max-w-md">
              Connecting talented home chefs with hungry customers. We're building more than a platform – we're creating a community where cooks and customers connect directly.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleCTAClick}
                disabled={isLoading}
                variant="outline"
                className="rounded-full border-white/20 bg-white/5 hover:bg-white/10 hover-standard text-white btn-glow"
              >
                <ChefHat className="mr-2 h-4 w-4" />
                {isLoading ? "Loading..." : getCTAButtonText()}
              </Button>
              <Button
                onClick={handleDriverClick}
                variant="outline"
                className="rounded-full border-blue-400/50 bg-blue-500/10 hover:bg-blue-500/20 hover-standard text-blue-300 hover:text-blue-100 btn-glow"
              >
                <Truck className="mr-2 h-4 w-4" />
                Join as Delivery Partner
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 md:w-3/5">
            <div>
              <h3 className="text-lg font-bold mb-4 text-primary">Contact Us</h3>
              <ul className="space-y-3">
                <li className="flex items-center gap-2 text-gray-300 hover:text-white hover-text">
                  <Mail className="h-4 w-4 text-primary" />
                  <span>support@localcook.shop</span>
                </li>
                <li className="flex items-center gap-2 text-gray-300 hover:text-white hover-text">
                  <Phone className="h-4 w-4 text-primary" />
                  <span>(709) 689-2942</span>
                </li>
                <li className="flex items-center gap-2 text-gray-300 hover:text-white hover-text">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span>St. John's, NL, Canada</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-bold mb-4 text-primary">Quick Links</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/#how-it-works" className="text-gray-300 hover:text-white hover-text">
                    How It Works
                  </Link>
                </li>
                <li>
                  <Link href="/#benefits" className="text-gray-300 hover:text-white hover-text">
                    Benefits
                  </Link>
                </li>
                <li>
                  <Link href="/#about" className="text-gray-300 hover:text-white hover-text">
                    About Us
                  </Link>
                </li>
                <li>
                  <button 
                    onClick={handleCTAClick}
                    disabled={isLoading}
                    className="text-gray-300 hover:text-white hover-text cursor-pointer bg-transparent border-none p-0 text-left"
                  >
                    {isLoading ? "Loading..." : getApplyLinkText()}
                  </button>
                </li>
                <li>
                  <button 
                    onClick={handleDriverClick}
                    className="text-gray-300 hover:text-white hover-text cursor-pointer bg-transparent border-none p-0 text-left"
                  >
                    Apply as Delivery Partner
                  </button>
                </li>
                <li>
                  <Link 
                    href="/manager/login"
                    className="text-gray-300 hover:text-white hover-text flex items-center gap-2"
                  >
                    <Building2 className="h-4 w-4 text-primary" />
                    Partner Login
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-bold mb-4 text-primary">Connect</h3>
              <div className="flex space-x-4 mb-6">
                <a
                  href="https://www.facebook.com/LocalCooks"
                  className="bg-white/10 p-2 rounded-full hover:bg-primary/80 hover-standard transition-transform duration-300 hover:scale-110"
                  aria-label="Facebook"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaFacebook className="h-5 w-5" />
                </a>
                <a
                  href="https://www.linkedin.com/company/local-cooks/"
                  className="bg-white/10 p-2 rounded-full hover:bg-primary/80 hover-standard transition-transform duration-300 hover:scale-110"
                  aria-label="LinkedIn"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaLinkedin className="h-5 w-5" />
                </a>
              </div>
              <p className="text-sm text-gray-400">
                Follow us on social media for updates and news.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-400">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <p>&copy; {new Date().getFullYear()} Local Cooks. All rights reserved.</p>
            <div className="flex gap-4">
              <Link href="/terms" className="text-gray-400 hover:text-white hover-text">
                Terms & Conditions
              </Link>
              <Link href="/privacy" className="text-gray-400 hover:text-white hover-text">
                Privacy Policy
              </Link>
            </div>
          </div>
          <div className="flex mt-4 md:mt-0">
            <span className="flex items-center">
              Made with <Heart className="h-3 w-3 mx-1 text-primary" /> in St. John's, NL
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
