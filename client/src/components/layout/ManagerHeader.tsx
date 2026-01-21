import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useQuery } from "@tanstack/react-query";
import {
  LogOut, HelpCircle, Menu, X, ChevronDown, User, Settings,
  BookOpen, DollarSign, Building2, LayoutDashboard
} from "lucide-react";
import { Link } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";
import ManagerHelpCenter from "@/components/manager/ManagerHelpCenter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getUserInitials } from "@/lib/utils";

interface ManagerHeaderProps {
  sidebarWidth?: number;
}

export default function ManagerHeader({ sidebarWidth = 256 }: ManagerHeaderProps) {
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

  // Get user initials and photo URL
  const userDisplayName = user?.displayName || user?.fullName || null;
  const userEmail = user?.email || firebaseUser?.email || null;
  const userUsername = user?.username || null;
  const userPhotoURL = firebaseUser?.photoURL || null;
  const userInitials = getUserInitials(userDisplayName, userEmail, userUsername);

  return (
    <header className="bg-white border-b border-gray-300 fixed top-0 left-0 right-0 z-50 mobile-safe-area h-[var(--header-height)]">
      <div className="flex items-center w-full relative" style={{ minHeight: '100%' }}>
        {/* Logo centered above sidebar - FIXED width, does NOT change with sidebar */}
        <div
          className="hidden lg:flex absolute left-0 items-center justify-center pointer-events-none"
          style={{
            width: '256px', // Fixed at expanded sidebar width - does NOT change when sidebar collapses
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
                for kitchens
              </span>
            </div>
          </Link>
        </div>

        {/* Main Header Content - Right aligned, FIXED position - does NOT slide with sidebar */}
        <div
          className="flex-1 flex items-center justify-end px-3 sm:px-4 py-2 sm:py-3"
          style={{
            marginLeft: '256px', // Fixed margin - does NOT change when sidebar collapses
            minHeight: '100%',
          }}
        >
          {/* Mobile Logo */}
          <Link href="/" className="lg:hidden flex items-center gap-3 sm:gap-4 transition-all duration-300 hover:scale-[1.02] group mr-auto">
            <Logo variant="brand" className="h-9 sm:h-11 md:h-12 lg:h-12 w-auto transition-transform duration-300 group-hover:scale-110" />
            <div className="flex flex-col justify-center">
              <span className="font-logo text-lg sm:text-xl md:text-2xl lg:text-2xl leading-none text-[#F51042] tracking-tight font-normal">
                LocalCooks
              </span>
              <span className="text-[10px] sm:text-xs font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">
                for kitchens
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
                  Help
                </Button>

                {/* Profile Dropdown Menu */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-[#F51042]/20 focus:ring-offset-2 transition-all hover:opacity-90"
                      aria-label="User menu"
                    >
                      <Avatar className="h-9 w-9 border-2 border-gray-200 hover:border-[#F51042]/40 transition-colors">
                        <AvatarImage src={userPhotoURL || undefined} alt={userDisplayName || "User"} />
                        <AvatarFallback className="bg-gradient-to-br from-[#F51042] to-[#F51042]/80 text-white font-semibold text-sm">
                          {userInitials}
                        </AvatarFallback>
                      </Avatar>
                      <ChevronDown className="h-4 w-4 text-gray-600 hidden sm:block" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-72 bg-white border-gray-200 shadow-xl"
                  >
                    {/* User Info Section */}
                    <div className="px-4 py-5 text-center border-b border-gray-200">
                      <div className="flex justify-center mb-3">
                        <Avatar className="h-16 w-16 border-2 border-gray-200">
                          <AvatarImage src={userPhotoURL || undefined} alt={userDisplayName || "User"} />
                          <AvatarFallback className="bg-gradient-to-br from-[#F51042]/90 to-[#F51042]/70 text-white font-semibold text-lg">
                            {userInitials}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <p className="text-base font-semibold text-gray-900 mb-1">
                        {userDisplayName || "Manager"}
                      </p>
                      <p className="text-xs text-gray-500 break-all px-2">
                        {userEmail || ""}
                      </p>
                    </div>

                    {/* Manager Portal Options */}
                    <div className="py-1">
                      <DropdownMenuItem asChild className="text-gray-700 hover:text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:text-gray-900 cursor-pointer">
                        <Link href="/manager/booking-dashboard" className="flex items-center w-full">
                          <LayoutDashboard className="mr-3 h-4 w-4" />
                          <span>Dashboard</span>
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem asChild className="text-gray-700 hover:text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:text-gray-900 cursor-pointer">
                        <Link href="/manager/booking-dashboard?view=revenue" className="flex items-center w-full">
                          <DollarSign className="mr-3 h-4 w-4" />
                          <span>Revenue</span>
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem asChild className="text-gray-700 hover:text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:text-gray-900 cursor-pointer">
                        <Link href="/manager/booking-dashboard?view=bookings" className="flex items-center w-full">
                          <BookOpen className="mr-3 h-4 w-4" />
                          <span>Bookings</span>
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem asChild className="text-gray-700 hover:text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:text-gray-900 cursor-pointer">
                        <Link href="/manager/booking-dashboard?view=locations" className="flex items-center w-full">
                          <Building2 className="mr-3 h-4 w-4" />
                          <span>Locations</span>
                        </Link>
                      </DropdownMenuItem>
                    </div>

                    <DropdownMenuSeparator className="bg-gray-200" />

                    {/* Account Options */}
                    <div className="py-1">
                      <DropdownMenuItem asChild className="text-gray-700 hover:text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:text-gray-900 cursor-pointer">
                        <Link href="/manager/profile" className="flex items-center w-full">
                          <User className="mr-3 h-4 w-4" />
                          <span>Profile</span>
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem asChild className="text-gray-700 hover:text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:text-gray-900 cursor-pointer">
                        <Link href="/manager/profile" className="flex items-center w-full">
                          <Settings className="mr-3 h-4 w-4" />
                          <span>Settings</span>
                        </Link>
                      </DropdownMenuItem>
                    </div>

                    <DropdownMenuSeparator className="bg-gray-200" />

                    {/* Logout */}
                    <div className="py-1">
                      <DropdownMenuItem
                        onClick={handleLogout}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 focus:bg-red-50 focus:text-red-700 cursor-pointer"
                      >
                        <LogOut className="mr-3 h-4 w-4" />
                        <span>Log out</span>
                      </DropdownMenuItem>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </nav>

          {/* Mobile menu button */}
          <div className="md:hidden ml-auto">
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
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-gray-200 shadow-xl mobile-momentum-scroll bg-white">
          <div className="container mx-auto px-4 sm:px-6 py-5">
            <nav className="space-y-3">
              {user && (
                <>
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

                  {/* Mobile Profile Section */}
                  <div className="pt-2 border-t border-gray-200">
                    <div className="flex items-center gap-3 px-2 py-4 bg-gray-50 rounded-lg mb-2">
                      <Avatar className="h-12 w-12 border-2 border-gray-200">
                        <AvatarImage src={userPhotoURL || undefined} alt={userDisplayName || "User"} />
                        <AvatarFallback className="bg-gradient-to-br from-[#F51042]/90 to-[#F51042]/70 text-white font-semibold">
                          {userInitials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 mb-1">
                          {userDisplayName || "Manager"}
                        </p>
                        <p className="text-xs text-gray-500 break-all">
                          {userEmail || ""}
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/manager/booking-dashboard"
                      className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base flex items-center gap-2"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Dashboard
                    </Link>
                    <Link
                      href="/manager/booking-dashboard?view=revenue"
                      className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base flex items-center gap-2"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <DollarSign className="h-4 w-4" />
                      Revenue
                    </Link>
                    <Link
                      href="/manager/booking-dashboard?view=bookings"
                      className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base flex items-center gap-2"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <BookOpen className="h-4 w-4" />
                      Bookings
                    </Link>
                    <Link
                      href="/manager/booking-dashboard?view=locations"
                      className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base flex items-center gap-2"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <Building2 className="h-4 w-4" />
                      Locations
                    </Link>
                    <div className="border-t border-gray-200 my-2"></div>
                    <Link
                      href="/manager/profile"
                      className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base flex items-center gap-2"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <User className="h-4 w-4" />
                      Profile
                    </Link>
                    <Link
                      href="/manager/profile"
                      className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight text-base flex items-center gap-2"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                    <div className="border-t border-gray-200 my-2"></div>
                    <button
                      onClick={() => {
                        handleLogout();
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left py-3 px-2 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors mobile-touch-target mobile-no-tap-highlight text-base min-h-[44px] flex items-center gap-2"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out
                    </button>
                  </div>
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

