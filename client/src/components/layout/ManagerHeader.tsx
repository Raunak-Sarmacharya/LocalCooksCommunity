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
        <Link href="/" className="flex items-center">
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
                href="/manager/dashboard"
                className="text-gray-查出hover:text-primary transition-colors px-3 py-2 rounded-md hover:bg-gray-50"
              >
                Dashboard
              </Link>
              
              <Link 
                href="/manager/availability"
                className="text-gray-700 hover:text-primary transition-colors px-3 py-2 rounded-md hover:bg-gray-50"
              >
                Manage Availability
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

