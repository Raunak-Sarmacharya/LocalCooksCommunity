import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle, Menu, X } from "lucide-react";
import { Link } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";
import ManagerHelpCenter from "@/components/manager/ManagerHelpCenter";
import NotificationCenter from "@/components/manager/NotificationCenter";
import { useTranslation } from "react-i18next";

interface ManagerHeaderProps {
  sidebarWidth?: number;
}

export default function ManagerHeader({ sidebarWidth = 256 }: ManagerHeaderProps) {
  const { t } = useTranslation("manager");
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user: firebaseUser } = useFirebaseAuth();

  const { data: user } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          if (response.status === 401) {
            return null;
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }

        return response.json();
      } catch (error) {
        logger.error('Error fetching user profile:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return (
    <header className="fixed top-0 left-0 right-0 z-50 mobile-safe-area h-[var(--header-height)] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center w-full relative" style={{ minHeight: '100%' }}>
        <div
          className="hidden lg:flex absolute left-0 items-center justify-center pointer-events-none"
          style={{
            width: '256px',
            height: '100%',
            zIndex: 10,
            top: 0,
            bottom: 0,
          }}
        >
          <Link href="/" className="flex items-center gap-3 sm:gap-4 transition-all duration-300 hover:scale-[1.02] group pointer-events-auto">
            <Logo variant="brand" className="h-9 sm:h-11 md:h-12 lg:h-12 w-auto transition-transform duration-300 group-hover:scale-110" />
            <div className="flex flex-col justify-center">
              <span className="font-logo text-lg sm:text-xl md:text-2xl lg:text-2xl leading-none text-[#F51042] tracking-tight font-normal">
                LocalCooks
              </span>
              <span className="text-[10px] sm:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">
                {t("shellForKitchens")}
              </span>
            </div>
          </Link>
        </div>

        <div
          className="flex-1 flex items-center justify-end px-3 sm:px-4 py-2 sm:py-3"
          style={{
            marginLeft: '256px',
            minHeight: '100%',
          }}
        >
          <Link href="/" className="lg:hidden flex items-center gap-3 sm:gap-4 transition-all duration-300 hover:scale-[1.02] group mr-auto">
            <Logo variant="brand" className="h-9 sm:h-11 md:h-12 lg:h-12 w-auto transition-transform duration-300 group-hover:scale-110" />
            <div className="flex flex-col justify-center">
              <span className="font-logo text-lg sm:text-xl md:text-2xl lg:text-2xl leading-none text-[#F51042] tracking-tight font-normal">
                LocalCooks
              </span>
              <span className="text-[10px] sm:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">
                {t("shellForKitchens")}
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center space-x-4 ml-auto">
            {user && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHelpCenter(true)}
                  className="gap-2 text-sm sm:text-base"
                >
                  <HelpCircle className="h-4 w-4" />
                  {t("shellHelp")}
                </Button>
                <NotificationCenter />
              </>
            )}
          </nav>

          <div className="md:hidden ml-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="mobile-touch-target mobile-no-tap-highlight p-3"
              aria-label={isMenuOpen ? t("closeMenu", { ns: "common" }) : t("openMenu", { ns: "common" })}
            >
              {isMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden border-t border-gray-200 shadow-xl mobile-momentum-scroll bg-white">
          <div className="container mx-auto px-4 sm:px-6 py-5">
            <nav className="space-y-3">
              {user && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowHelpCenter(true);
                      setIsMenuOpen(false);
                    }}
                    className="flex-1 gap-2 justify-start text-base min-h-[44px]"
                  >
                    <HelpCircle className="h-4 w-4" />
                    {t("shellHelp")}
                  </Button>
                  <NotificationCenter />
                </div>
              )}
            </nav>
          </div>
        </div>
      )}

      <ManagerHelpCenter isOpen={showHelpCenter} onClose={() => setShowHelpCenter(false)} />
    </header>
  );
}
