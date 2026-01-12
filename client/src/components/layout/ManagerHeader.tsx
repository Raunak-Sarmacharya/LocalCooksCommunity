import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useQuery } from "@tanstack/react-query";
import { LogOut, HelpCircle, Menu, X } from "lucide-react";
import { Link } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";
import ManagerHelpCenter from "@/components/manager/ManagerHelpCenter";
import { AnimatePresence, motion } from "framer-motion";

interface ManagerHeaderProps {
  hideLogo?: boolean;
  sidebarWidth?: number;
}

export default function ManagerHeader({ hideLogo = false, sidebarWidth = 0 }: ManagerHeaderProps) {
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Use Firebase auth for managers (session auth removed)
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
        
        const userData = await response.json();
        return userData;
      } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Fetch manager's location(s) to get logo
  const { data: locations, isLoading: loadingLocations } = useQuery({
    queryKey: ["/api/manager/locations"],
    queryFn: async () => {
      try {
        // Get Firebase token for authentication
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) {
          console.error('No Firebase user available');
          return [];
        }
        
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/manager/locations", {
          credentials: "include",
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!response.ok) {
          console.error('Failed to fetch locations:', response.status);
          return [];
        }
        const data = await response.json();
        console.log('ManagerHeader - Fetched locations:', data);
        console.log('ManagerHeader - First location fields:', data[0] ? Object.keys(data[0]) : 'no locations');
        console.log('ManagerHeader - First location logoUrl:', data[0] ? (data[0] as any).logoUrl : 'no locations');
        console.log('ManagerHeader - First location logo_url:', data[0] ? (data[0] as any).logo_url : 'no locations');
        return data;
      } catch (error) {
        console.error('Error fetching locations:', error);
        return [];
      }
    },
    enabled: !!user && user.role === 'manager',
    retry: false,
    staleTime: 0, // Always refetch to get latest logo
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Get the first location's logo (managers typically have one location)
  const locationLogoUrl = locations && locations.length > 0 
    ? ((locations[0] as any).logoUrl || (locations[0] as any).logo_url || null)
    : null;
  
  console.log('ManagerHeader - locationLogoUrl:', locationLogoUrl);
  console.log('ManagerHeader - Full location object:', locations && locations.length > 0 ? locations[0] : 'no locations');
  
  const { logout } = useFirebaseAuth();
  
  const handleLogout = async () => {
    try {
      console.log('Performing manager logout...');
      
      // Use Firebase logout
      await logout();
      
      console.log('Manager logout successful, redirecting...');
      window.location.href = '/manager/login';
    } catch (error) {
      console.error('Manager logout failed:', error);
      // Still redirect even if logout fails
      window.location.href = '/manager/login';
    }
  };

  return (
    <header className="bg-white shadow-md fixed top-0 left-0 right-0 z-50 mobile-safe-area">
      <div className="flex items-center w-full">
        {/* Unified Logo Area - Only when sidebar is visible */}
        {hideLogo && sidebarWidth > 0 && (
          <div 
            className="hidden lg:flex items-center gap-2.5 px-4 py-2 sm:py-3 bg-white border-r border-gray-200 flex-shrink-0"
            style={{
              width: `${sidebarWidth}px`,
              transition: 'width 0.3s ease-out',
              minHeight: '100%',
            }}
          >
            <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80 flex-shrink-0">
              <Logo variant="brand" className="h-6 w-auto flex-shrink-0" />
              <AnimatePresence mode="wait">
                {sidebarWidth >= 256 && (
                  <motion.div
                    key="expanded-logo-text"
                    initial={{ opacity: 0, width: 0, marginLeft: -8 }}
                    animate={{ opacity: 1, width: 'auto', marginLeft: 0 }}
                    exit={{ opacity: 0, width: 0, marginLeft: -8 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    className="flex flex-col overflow-hidden"
                  >
                    <span className="font-logo text-base leading-none text-[#F51042] tracking-tight font-normal whitespace-nowrap">
                      LocalCooks
                    </span>
                    <span className="text-[9px] font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none whitespace-nowrap">
                      FOR KITCHENS
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </Link>
          </div>
        )}
        
        {/* Main Header Content */}
        <div 
          className="flex-1 container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex justify-between items-center"
        >
          {!hideLogo && (
            <Link href="/" className="flex items-center gap-3 sm:gap-4 transition-all duration-300 hover:scale-[1.02] group">
              <Logo variant="brand" className="h-10 sm:h-12 lg:h-14 w-auto transition-transform duration-300 group-hover:scale-110" />
              <div className="flex flex-col justify-center">
                <span className="font-logo text-xl sm:text-2xl lg:text-3xl leading-none text-[#F51042] tracking-tight font-normal">
                  LocalCooks
                </span>
                <span className="text-[10px] sm:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">
                  for kitchens
                </span>
              </div>
            </Link>
          )}

        <nav className="hidden md:flex items-center space-x-4">
          <Link 
            href="/"
            className="text-gray-700 hover:text-primary transition-colors px-3 py-2 rounded-md hover:bg-gray-50 text-sm sm:text-base"
          >
            Homepage
          </Link>
          
          {user && (
            <>
              <Link 
                href="/manager/booking-dashboard"
                className="text-gray-700 hover:text-primary transition-colors px-3 py-2 rounded-md hover:bg-gray-50 text-sm sm:text-base"
              >
                Booking Dashboard
              </Link>
              
              <Link 
                href="/manager/profile"
                className="text-gray-700 hover:text-primary transition-colors px-3 py-2 rounded-md hover:bg-gray-50 text-sm sm:text-base"
              >
                Profile
              </Link>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHelpCenter(true)}
                className="gap-2 text-sm sm:text-base"
              >
                <HelpCircle className="h-4 w-4" />
                Help
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 text-sm sm:text-base"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </>
          )}
        </nav>

        {/* Mobile menu button */}
        <div className="md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="mobile-touch-target mobile-no-tap-highlight p-3"
          >
            {isMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-gray-200 shadow-xl mobile-momentum-scroll bg-white">
          <div className="container mx-auto px-4 sm:px-6 py-5">
            <nav className="space-y-3">
              <Link 
                href="/"
                className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base"
                onClick={() => setIsMenuOpen(false)}
              >
                Homepage
              </Link>
              
              {user && (
                <>
                  <Link 
                    href="/manager/booking-dashboard"
                    className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Booking Dashboard
                  </Link>
                  
                  <Link 
                    href="/manager/profile"
                    className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Profile
                  </Link>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowHelpCenter(true);
                      setIsMenuOpen(false);
                    }}
                    className="w-full gap-2 justify-start text-base min-h-[44px]"
                  >
                    <HelpCircle className="h-4 w-4" />
                    Help
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      handleLogout();
                      setIsMenuOpen(false);
                    }}
                    className="w-full gap-2 justify-start border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 text-base min-h-[44px]"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
                </>
              )}
            </nav>
          </div>
        </div>
      )}

      <ManagerHelpCenter isOpen={showHelpCenter} onClose={() => setShowHelpCenter(false)} />
    </header>
  );
}

