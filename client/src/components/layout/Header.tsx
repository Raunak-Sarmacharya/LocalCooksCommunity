import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { Building2, GraduationCap, LogOut, Menu, User, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { getSubdomainFromHostname } from "@shared/subdomain-utils";

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
        console.error('Header - Firebase auth error:', error);
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
    console.log('Performing Firebase logout...');
    firebaseAuth.logout();
  };
  
  // Debug logging for header state
  console.log('Header component state:', {
    profileUser,
    firebaseUser: firebaseAuth.user,
    finalUser: user,
    userRole: user?.role
  });

  // Fetch applicant's applications if they are logged in
  const { data: applications } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user || (!user.uid && !user.id)) {
        throw new Error("User not authenticated");
      }

      const headers: Record<string, string> = {
        'X-User-ID': (user.uid || user.id).toString()
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

    // If not on the homepage, navigate to homepage first with the hash
    if (location !== "/") {
      // Navigate to homepage with hash - Home component will handle scrolling
      setLocation(`/#${sectionId}`);
      // Also update the URL hash directly to ensure it's set
      window.location.hash = sectionId;
      return;
    }

    // If already on homepage, scroll to the section smoothly
    const scrollToElement = () => {
      const element = document.getElementById(sectionId) || document.querySelector(`#${sectionId}`);
      if (element) {
        // Use scrollIntoView - sections have scroll-mt-24 class for header offset
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        closeMenu();
        return true;
      }
      return false;
    };

    // Update URL hash
    window.location.hash = sectionId;

    // Try immediately
    if (scrollToElement()) return;

    // If not found, try with delays (for dynamic content)
    const delays = [100, 300, 500, 1000, 2000, 3500];
    delays.forEach((delay) => {
      setTimeout(() => {
        scrollToElement();
      }, delay);
    });
  }, [location, setLocation]);

  // Helper function to get dashboard link and text
  const getDashboardInfo = () => {
    if (user?.role === "admin") {
      return {
        href: "/admin",
        text: `${user.displayName || user.username || 'Admin'}'s Admin Dashboard`
      };
    } else if (user?.role === "manager") {
      return {
        href: "/manager/dashboard",
        text: "Manager Dashboard"
      };
    } else {
      return {
        href: "/dashboard",
        text: `${user?.displayName || user.username || 'User'}'s Dashboard`
      };
    }
  };

  // Helper function to get user display name
  const getUserDisplayName = () => {
    return user?.displayName || user?.username || 'User';
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 mobile-safe-area transition-all duration-300 shadow-md border-b border-gray-200/50" style={{ backgroundColor: 'rgba(255, 255, 255, 0.98)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)' }}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-3 sm:gap-4 transition-all duration-300 hover:scale-[1.02] group">
          <Logo variant="brand" className="h-10 sm:h-12 lg:h-14 w-auto transition-transform duration-300 group-hover:scale-110" />
          <div className="flex flex-col justify-center">
            <span className="font-logo text-xl sm:text-2xl lg:text-3xl leading-none text-[#F51042] tracking-tight font-normal">
              LocalCooks
            </span>
            {currentSubdomain === 'chef' && (
              <span className="text-[10px] sm:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">
                for chefs
              </span>
            )}
            {currentSubdomain === 'kitchen' && (
              <span className="text-[10px] sm:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">
                for kitchens
              </span>
            )}
          </div>
        </Link>

        <nav className="hidden md:block">
          <ul className="flex space-x-1 items-center">
            <li>
              <a
                href="#revenue-streams"
                className="text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80"
                onClick={(e) => scrollToSection("revenue-streams", e)}
              >
                Revenue Streams
              </a>
            </li>
            <li>
              <a
                href="#how-it-works"
                className="text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80"
                onClick={(e) => scrollToSection("how-it-works", e)}
              >
                How It Works
              </a>
            </li>
            <li>
              <a
                href="#everything-included"
                className="text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80"
                onClick={(e) => scrollToSection("everything-included", e)}
              >
                Everything Included
              </a>
            </li>
            <li>
              <a
                href="#faq"
                className="text-gray-700 hover:text-[#F51042] transition-all duration-200 cursor-pointer font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-50/80"
                onClick={(e) => scrollToSection("faq", e)}
              >
                FAQ
              </a>
            </li>
            {user && user.role !== 'admin' && (user as any).isChef && (
              <li>
                <Link 
                  href="/microlearning/overview" 
                  className="flex items-center gap-2 hover:text-primary hover-text cursor-pointer px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium hover:bg-gray-50/80"
                >
                  <GraduationCap className="h-4 w-4" />
                  Food Safety Training
                </Link>
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
                      {showPartnerLogin ? "Partner Login / Register" : "Login / Register"}
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
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
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
              <a
                href="#revenue-streams"
                className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                onClick={(e) => {
                  scrollToSection("revenue-streams", e);
                  closeMenu();
                }}
              >
                Revenue Streams
              </a>
            </li>
            <li>
              <a
                href="#how-it-works"
                className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                onClick={(e) => {
                  scrollToSection("how-it-works", e);
                  closeMenu();
                }}
              >
                How It Works
              </a>
            </li>
            <li>
              <a
                href="#everything-included"
                className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                onClick={(e) => {
                  scrollToSection("everything-included", e);
                  closeMenu();
                }}
              >
                Everything Included
              </a>
            </li>
            <li>
              <a
                href="#faq"
                className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                onClick={(e) => {
                  scrollToSection("faq", e);
                  closeMenu();
                }}
              >
                FAQ
              </a>
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
                      <GraduationCap className="h-4 w-4" />
                      Food Safety Training
                    </Link>
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
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
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
                      {showPartnerLogin ? "Partner Login / Register" : "Login / Register"}
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
