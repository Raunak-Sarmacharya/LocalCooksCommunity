import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useQuery } from "@tanstack/react-query";
import { LogOut, HelpCircle } from "lucide-react";
import { Link } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";
import ManagerHelpCenter from "@/components/manager/ManagerHelpCenter";

export default function ManagerHeader() {
  const [showHelpCenter, setShowHelpCenter] = useState(false);
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
      <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-3">
          <Logo className="h-12 sm:h-14 lg:h-16 w-auto" />
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
                onClick={() => setShowHelpCenter(true)}
                className="gap-2"
              >
                <HelpCircle className="h-4 w-4" />
                Help
              </Button>
              
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
      <ManagerHelpCenter isOpen={showHelpCenter} onClose={() => setShowHelpCenter(false)} />
    </header>
  );
}

