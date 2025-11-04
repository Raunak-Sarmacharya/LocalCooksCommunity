import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Link } from "wouter";

export default function ManagerHeader() {
  // Check for session-based auth (managers use session auth)
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
            return null;
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
    enabled: true
  });

  const user = sessionUser;

  // Fetch manager's location(s) to get logo
  const { data: locations, isLoading: loadingLocations } = useQuery({
    queryKey: ["/api/manager/locations"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/manager/locations", {
          credentials: "include",
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
  
  const handleLogout = async () => {
    try {
      console.log('Performing manager logout...');
      
      // Clear localStorage
      localStorage.clear();
      console.log('Cleared all localStorage data');
      
      // Call logout endpoint
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      console.log('Manager logout successful, redirecting...');
      window.location.href = '/';
    } catch (error) {
      console.error('Manager logout failed:', error);
      // Still redirect even if logout fails
      window.location.href = '/';
    }
  };

  return (
    <header className="bg-white shadow-md fixed top-0 left-0 right-0 z-50 mobile-safe-area">
      <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-3">
          {locationLogoUrl && locationLogoUrl.trim() !== '' ? (
            <div className="flex items-center gap-2 sm:gap-3">
              <img 
                src={locationLogoUrl} 
                alt="Location logo" 
                className="h-8 sm:h-10 lg:h-12 w-auto object-contain max-h-12"
                onError={(e) => {
                  console.error('Failed to load location logo:', locationLogoUrl);
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                onLoad={() => {
                  console.log('Location logo loaded successfully:', locationLogoUrl);
                }}
              />
              <div className="flex items-center gap-1 sm:gap-2 text-gray-400">
                <span className="text-xs sm:text-sm">×</span>
              </div>
              <Logo className="h-10 sm:h-12 lg:h-14 w-auto" />
            </div>
          ) : (
            <Logo className="h-12 sm:h-14 lg:h-16 w-auto" />
          )}
        </Link>

        <nav className="flex items-center space-x-4">
          <Link 
            href="/"
            className="text-gray-700 hover:text-primary transition-colors px-3 py-2 rounded-md hover:bg-gray-50"
          >
            Homepage
          </Link>
          
          {user && (
            <>
              <Link 
                href="/manager/booking-dashboard"
                className="text-gray-700 hover:text-primary transition-colors px-3 py-2 rounded-md hover:bg-gray-50"
              >
                Booking Dashboard
              </Link>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

