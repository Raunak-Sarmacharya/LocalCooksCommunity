import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, LogOut, Menu, User, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useLocation } from "wouter";

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
  
  // Always check for session-based auth, not just for admin routes
  const { data: sessionUser } = useQuery({
    queryKey: ["/api/user-session"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated via session
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return {
          ...userData,
          authMethod: 'session'
        };
      } catch (error) {
        return null;
      }
    },
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    // Always enable session check - admins need to be authenticated everywhere
    enabled: true
  });

  // Properly combine Firebase and session auth - prioritize Firebase for regular users, session for admins
  const user = sessionUser?.role === 'admin' ? sessionUser : (firebaseAuth.user || sessionUser);
  
  const logout = async () => {
    if (sessionUser) {
      // Session logout
      try {
        console.log('Performing session logout...');
        
        // SECURITY FIX: Clear localStorage and cache for session logout too
        localStorage.clear();
        console.log('🧹 SESSION LOGOUT: Cleared all localStorage data');
        
        await fetch('/api/logout', {
          method: 'POST',
          credentials: 'include'
        });
        console.log('Session logout successful, redirecting...');
        window.location.href = '/';
      } catch (error) {
        console.error('Session logout failed:', error);
        firebaseAuth.logout();
      }
    } else {
      // Firebase logout (firebase logout function already handles clearing)
      console.log('Performing Firebase logout...');
      firebaseAuth.logout();
    }
  };
  
  // Debug logging for header state
  console.log('Header component state:', {
    sessionUser,
    firebaseUser: firebaseAuth.user,
    finalUser: user,
    userRole: user?.role
  });

  // Fetch applicant's applications if they are logged in
  const { data: applications } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid) {
        throw new Error("User not authenticated");
      }

      const headers: Record<string, string> = {
        'X-User-ID': user.uid.toString()
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
      setLocation(`/#${sectionId}`);
      return;
    }

    // If already on homepage, scroll to the section smoothly
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      closeMenu();
    }
  }, [location, setLocation]);

  // Helper function to get dashboard link and text
  const getDashboardInfo = () => {
    if (user?.role === "admin") {
      return {
        href: "/admin",
        text: `${user.displayName || user.username || 'Admin'}'s Admin Dashboard`
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
    <header className="bg-white shadow-md fixed top-0 left-0 right-0 z-50">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <Link href="/" className="flex items-center">
          <Logo className="h-16 w-auto" />
        </Link>

        <nav className="hidden md:block">
          <ul className="flex space-x-6 items-center">
            <li>
              <a
                href="#how-it-works"
                className="hover:text-primary hover-text cursor-pointer"
                onClick={(e) => scrollToSection("how-it-works", e)}
              >
                How It Works
              </a>
            </li>
            <li>
              <a
                href="#benefits"
                className="hover:text-primary hover-text cursor-pointer"
                onClick={(e) => scrollToSection("benefits", e)}
              >
                Benefits
              </a>
            </li>
            <li>
              <a
                href="#about"
                className="hover:text-primary hover-text cursor-pointer"
                onClick={(e) => scrollToSection("about", e)}
              >
                About Us
              </a>
            </li>
            {user && (
              <li>
                <Link 
                  href="/microlearning/overview" 
                  className="flex items-center gap-2 hover:text-primary hover-text cursor-pointer px-3 py-2 rounded-md transition-colors"
                >
                  <GraduationCap className="h-4 w-4" />
                  Food Safety Training
                </Link>
              </li>
            )}
            {!user && (
              <li>
                <Button
                  asChild
                  variant="outline"
                  className="border-primary text-primary hover:bg-primary hover:text-white hover-standard"
                >
                  <Link href="/auth">Login / Register</Link>
                </Button>
              </li>
            )}

            {user && (
              <>
                <li>
                  <Link 
                    href={getDashboardInfo().href}
                    className="flex items-center gap-2 hover:text-primary hover-text cursor-pointer px-3 py-2 rounded-md transition-colors"
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
                    className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
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
          >
            {isMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-white p-4 shadow-md">
          <ul className="space-y-3">
            <li>
              <a
                href="#how-it-works"
                className="block py-2 hover:text-primary hover-text cursor-pointer"
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
                href="#benefits"
                className="block py-2 hover:text-primary hover-text cursor-pointer"
                onClick={(e) => {
                  scrollToSection("benefits", e);
                  closeMenu();
                }}
              >
                Benefits
              </a>
            </li>
            <li>
              <a
                href="#about"
                className="block py-2 hover:text-primary hover-text cursor-pointer"
                onClick={(e) => {
                  scrollToSection("about", e);
                  closeMenu();
                }}
              >
                About Us
              </a>
            </li>
            {user && (
              <>
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
              <li className="pt-2">
                <Button
                  asChild
                  className="w-full bg-primary hover:bg-opacity-90 hover-standard text-white"
                >
                  <Link href="/auth" onClick={closeMenu}>Login / Register</Link>
                </Button>
              </li>
            )}
          </ul>
        </div>
      )}
    </header>
  );
}
