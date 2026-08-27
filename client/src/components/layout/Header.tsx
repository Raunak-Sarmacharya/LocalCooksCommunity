import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Check, ChevronDown, CookingPot, GraduationCap, LogOut, Menu, User, Warehouse, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { getSubdomainFromHostname } from "@shared/subdomain-utils";
import { parseLocationLocale } from "@/i18n/routing";
import { useTranslation } from "react-i18next";

// Helper to check if an application is active (not cancelled, rejected)
const isApplicationActive = (app: Application) => {
  return app.status !== 'cancelled' && app.status !== 'rejected';
};

// Helper to check if user has any active applications
const hasActiveApplication = (applications?: Application[]) => {
  if (!applications || applications.length === 0) return false;
  return applications.some(isApplicationActive);
};

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const firebaseAuth = useFirebaseAuth();
  const { t } = useTranslation("common");

  // Get current subdomain
  const currentSubdomain = useMemo(() => {
    if (typeof window !== 'undefined') {
      return getSubdomainFromHostname(window.location.hostname);
    }
    return null;
  }, []);

  // Check if Partner Login should be shown (only for kitchen.* subdomain, not chef.*)
  const showPartnerLogin = useMemo(() => {
    return currentSubdomain === 'kitchen';
  }, [currentSubdomain]);

  // Services: cross-subdomain audience links (full URLs — subdomain hops are hard navigations)
  // Derive sibling subdomains from the current origin so preview/staging environments keep working.
  const serviceUrls = useMemo(() => {
    try {
      const url = new URL(window.location.origin);
      let labels = url.hostname.split('.');
      // Strip a leading "www" so www.localcooks.ca maps to chef.localcooks.ca
      if (labels[0] === 'www') labels = labels.slice(1);
      const isLocalhost = labels[labels.length - 1] === 'localhost';
      const baseLabelCount = isLocalhost ? 1 : 2; // "localhost" vs "localcooks.ca"
      const apex = labels.length > baseLabelCount ? labels.slice(1).join('.') : labels.join('.');
      // Keep the port for local dev (e.g. localhost:5001 → chef.localhost:5001)
      const port = url.port ? `:${url.port}` : '';
      return {
        chef: `${url.protocol}//chef.${apex}${port}`,
        kitchen: `${url.protocol}//kitchen.${apex}${port}`,
      };
    } catch {
      return { chef: 'https://chef.localcooks.ca', kitchen: 'https://kitchen.localcooks.ca' };
    }
  }, []);

  // Use Firebase auth (session auth removed)
  const { user: firebaseUser } = useFirebaseAuth();

  const { data: profileUser } = useQuery({
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
            return null; // Not authenticated
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }

        const userData = await response.json();
        return userData;
      } catch (error) {
        logger.error('Header - Firebase auth error:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Use profileUser (from Firebase auth) as the primary user source
  const user = profileUser || firebaseAuth.user;

  const logout = async () => {
    // Firebase logout (session auth removed)
    logger.info('Performing Firebase logout...');
    firebaseAuth.logout();
  };

  // Debug logging for header state
  logger.info('Header component state:', {
    profileUser,
    firebaseUser: firebaseAuth.user,
    finalUser: user,
    userRole: user?.role
  });

  // Fetch applicant's applications if they are logged in
  const { data: applications } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async ({ queryKey }) => {
      if (!user || (!user.uid && !user.id)) {
        throw new Error("User not authenticated");
      }

      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("User not authenticated");
      }

      const token = await currentUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
      }

      const rawData = await response.json();

      // Convert snake_case to camelCase for database fields
      const normalizedData = rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        email: app.email,
        phone: app.phone,
        foodSafetyLicense: app.food_safety_license || app.foodSafetyLicense,
        foodEstablishmentCert: app.food_establishment_cert || app.foodEstablishmentCert,
        kitchenPreference: app.kitchen_preference || app.kitchenPreference,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt
      }));

      return normalizedData;
    },
    enabled: !!user && user.role === "applicant",
  });

  // No longer need these for Apply Now button
  // const activeApplication = hasActiveApplication(applications);
  // const showApplyButton = !user || (user.role === "applicant" && !activeApplication && location !== "/apply");

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const handleLogout = () => {
    logout();
  };

  const scrollToSection = useCallback((sectionId: string, event?: React.MouseEvent) => {
    event?.preventDefault();

    const scrollToElement = () => {
      const element = document.getElementById(sectionId);
      if (element) {
        // Use scrollIntoView - sections have scroll-mt-24 class for header offset
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        closeMenu();
        return true;
      }
      return false;
    };

    // Landing pages (main, chef, kitchen) render these sections inline.
    // Strip any locale prefix (/en-CA, /fr-CA, /uk) before deciding we're "home",
    // otherwise the locale-prefixed URL makes us navigate instead of scroll.
    const { pathWithoutLocale } = parseLocationLocale(location);
    if (pathWithoutLocale === "/") {
      // Update the URL hash without triggering a wouter navigation/re-render
      window.history.replaceState(window.history.state, "", `#${sectionId}`);

      // Try immediately
      if (scrollToElement()) return;

      // If not found, try with delays (for dynamic content)
      const delays = [100, 300, 500, 1000, 2000, 3500];
      delays.forEach((delay) => {
        setTimeout(scrollToElement, delay);
      });
      return;
    }

    // On a non-landing page: navigate to the landing root with the hash —
    // the landing page will scroll to the section once mounted
    setLocation(`/#${sectionId}`);
    // Also update the URL hash directly to ensure it survives the locale redirect
    window.location.hash = sectionId;
  }, [location, setLocation]);

  // Helper function to get dashboard link and text
  const getDashboardInfo = () => {
    const displayName = getUserDisplayName();
    if (user?.role === "admin") {
      return {
        href: "/admin",
        text: `${displayName}'s Admin Dashboard`
      };
    } else if (user?.role === "manager") {
      return {
        href: "/manager/dashboard",
        text: "Manager Dashboard"
      };
    } else {
      return {
        href: "/dashboard",
        text: `${displayName}'s Dashboard`
      };
    }
  };

  // Helper function to get user display name (first name only)
  const getUserDisplayName = () => {
    // Prioritize displayName/fullName from API, extract first name only
    if (user?.displayName || user?.fullName) {
      const fullName = user.displayName || user.fullName;
      return fullName.split(' ')[0]; // Return only first name
    }
    // If username is an email, extract the part before @, otherwise use username
    if (user?.username) {
      const username = user.username;
      if (username.includes('@')) {
        return username.split('@')[0];
      }
      return username;
    }
    return 'User';
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 mobile-safe-area transition-all duration-300 shadow-md border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 md:gap-4 transition-all duration-300 hover:scale-[1.02] group">
          <Logo variant="brand" className="h-8 sm:h-10 md:h-12 lg:h-14 w-auto transition-transform duration-300 group-hover:scale-110 flex-shrink-0" />
          <div className="flex flex-col justify-center min-w-0">
            <span className="font-logo text-lg sm:text-xl md:text-2xl lg:text-3xl leading-none text-[#F51042] tracking-tight font-normal truncate">
              LocalCooks
            </span>
            {currentSubdomain === 'chef' && (
              <span className="text-[9px] sm:text-[10px] md:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">{t("forChefs")}</span>
            )}
            {currentSubdomain === 'kitchen' && (
              <span className="text-[9px] sm:text-[10px] md:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">{t("forKitchens")}</span>
            )}
          </div>
        </Link>

        <nav className="hidden md:block">
          <ul className="flex space-x-1 items-center">
            <li>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1 text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042]/40"
                    aria-haspopup="menu"
                  >
                    {t("services")}
                    <ChevronDown className="h-4 w-4 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 p-2">
                  <DropdownMenuItem asChild>
                    <a
                      href={serviceUrls.chef}
                      className="flex items-start gap-3 py-2.5 px-2 cursor-pointer rounded-lg"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F51042]/10 text-[#F51042]">
                        <CookingPot className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium text-sm text-gray-900">
                          {t("servicesForCooks")}
                          {currentSubdomain === 'chef' && (
                            <Check className="h-3.5 w-3.5 text-[#F51042]" aria-label={t("services")} />
                          )}
                        </span>
                        <span className="block text-xs text-gray-500 mt-0.5">{t("servicesForCooksDesc")}</span>
                      </span>
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href={serviceUrls.kitchen}
                      className="flex items-start gap-3 py-2.5 px-2 cursor-pointer rounded-lg"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
                        <Warehouse className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium text-sm text-gray-900">
                          {t("servicesForKitchens")}
                          {currentSubdomain === 'kitchen' && (
                            <Check className="h-3.5 w-3.5 text-[#F51042]" aria-label={t("services")} />
                          )}
                        </span>
                        <span className="block text-xs text-gray-500 mt-0.5">{t("servicesForKitchensDesc")}</span>
                      </span>
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            <li>
              <a
                href="#how-it-works"
                className="text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80"
                onClick={(e) => scrollToSection("how-it-works", e)}
              >{t("howItWorks")}</a>
            </li>
            <li>
              <a
                href="#resources"
                className="text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80"
                onClick={(e) => scrollToSection("resources", e)}
              >{t("resources")}</a>
            </li>
            <li>
              <a
                href="#faq"
                className="text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80"
                onClick={(e) => scrollToSection("faq", e)}
              >{t("faq")}</a>
            </li>
            {user && user.role !== 'admin' && (user as any).isChef && (
              <li>
                <Link
                  href="/microlearning/overview"
                  className="flex items-center gap-2 hover:text-primary hover-text cursor-pointer px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium hover:bg-gray-50/80"
                >
                  <GraduationCap className="h-4 w-4" />{t("foodSafetyTraining")}</Link>
              </li>
            )}
            {!user && (
              <>
                <li>
                  <Button
                    asChild
                    variant="outline"
                    className="border-[#F51042] text-[#F51042] hover:bg-[#F51042] hover:text-white transition-all duration-300 rounded-lg font-medium shadow-sm hover:shadow-md ml-2"
                  >
                    <Link href={showPartnerLogin ? "/manager/login" : "/auth"}>
                      {showPartnerLogin ? t("partnerLoginRegister") : t("loginRegister")}
                    </Link>
                  </Button>
                </li>
              </>
            )}

            {user && (
              <>
                <li>
                  <Link
                    href={getDashboardInfo().href}
                    className="flex items-center gap-2 hover:text-primary hover-text cursor-pointer px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium hover:bg-gray-50/80"
                  >
                    <User className="h-4 w-4" />
                    {getDashboardInfo().text}
                  </Link>
                </li>
                <li>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLogout}
                    className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 rounded-lg font-medium shadow-sm hover:shadow-md transition-all duration-200 ml-2"
                  >
                    <LogOut className="h-4 w-4" />{t("logout")}</Button>
                </li>
              </>
            )}
          </ul>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          {user && (
            <>
              <Link
                href={getDashboardInfo().href}
                className="flex items-center gap-1 text-sm hover:text-primary hover-text px-2 py-1 rounded transition-colors"
              >
                <User className="h-4 w-4" />
                {getUserDisplayName()}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="p-1"
              >
                <LogOut className="h-4 w-4 text-red-600" />
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMenu}
            className="mobile-touch-target mobile-no-tap-highlight p-3 rounded-xl"
          >
            {isMenuOpen ? (
              <X className="h-5 w-5 sm:h-6 sm:w-6" />
            ) : (
              <Menu className="h-5 w-5 sm:h-6 sm:w-6" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-gray-200/50 shadow-xl mobile-momentum-scroll" style={{ backgroundColor: 'rgba(255, 255, 255, 0.98)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)' }}>
          <div className="container mx-auto px-4 sm:px-6 py-5">
            <ul className="space-y-3">
              <li>
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">{t("services")}</p>
                <a
                  href={serviceUrls.chef}
                  className="flex items-center gap-3 py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={closeMenu}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F51042]/10 text-[#F51042]">
                    <CookingPot className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="flex items-center gap-1.5 block text-sm font-medium text-gray-900">
                      {t("servicesForCooks")}
                      {currentSubdomain === 'chef' && <Check className="h-3.5 w-3.5 text-[#F51042]" />}
                    </span>
                    <span className="block text-xs text-gray-500">{t("servicesForCooksDesc")}</span>
                  </span>
                </a>
              </li>
              <li>
                <a
                  href={serviceUrls.kitchen}
                  className="flex items-center gap-3 py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={closeMenu}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
                    <Warehouse className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="flex items-center gap-1.5 block text-sm font-medium text-gray-900">
                      {t("servicesForKitchens")}
                      {currentSubdomain === 'kitchen' && <Check className="h-3.5 w-3.5 text-[#F51042]" />}
                    </span>
                    <span className="block text-xs text-gray-500">{t("servicesForKitchensDesc")}</span>
                  </span>
                </a>
              </li>
              <li role="separator" className="border-t border-gray-200/70 my-1" />
              <li>
                <a
                  href="#how-it-works"
                  className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={(e) => {
                    scrollToSection("how-it-works", e);
                    closeMenu();
                  }}
                >{t("howItWorks")}</a>
              </li>
              <li>
                <a
                  href="#resources"
                  className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={(e) => {
                    scrollToSection("resources", e);
                    closeMenu();
                  }}
                >{t("resources")}</a>
              </li>
              <li>
                <a
                  href="#faq"
                  className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={(e) => {
                    scrollToSection("faq", e);
                    closeMenu();
                  }}
                >{t("faq")}</a>
              </li>

              {user && (
                <>
                  {user.role !== 'admin' && (user as any).isChef && (
                    <li>
                      <Link
                        href="/microlearning"
                        className="flex items-center gap-2 py-2 hover:text-primary hover-text cursor-pointer"
                        onClick={closeMenu}
                      >
                        <GraduationCap className="h-4 w-4" />{t("foodSafetyTraining")}</Link>
                    </li>
                  )}
                  <li>
                    <Link
                      href={getDashboardInfo().href}
                      className="flex items-center gap-2 py-2 hover:text-primary hover-text cursor-pointer"
                      onClick={closeMenu}
                    >
                      <User className="h-4 w-4" />
                      {getUserDisplayName()}
                    </Link>
                  </li>
                  <li>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        handleLogout();
                        closeMenu();
                      }}
                      className="w-full gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                    >
                      <LogOut className="h-4 w-4" />{t("logout")}</Button>
                  </li>
                </>
              )}
              {!user && (
                <>
                  <li className="pt-2">
                    <Button
                      asChild
                      className="w-full bg-primary hover:bg-opacity-90 hover-standard text-white"
                    >
                      <Link href={showPartnerLogin ? "/manager/login" : "/auth"} onClick={closeMenu}>
                        {showPartnerLogin ? t("partnerLoginRegister") : t("loginRegister")}
                      </Link>
                    </Button>
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
      )}
    </header>
  );
}
