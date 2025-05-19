import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, User, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Application } from "@shared/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Logo from "@/components/ui/logo";

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
  const { user, logoutMutation } = useAuth();

  // Fetch applicant's applications if they are logged in
  const { data: applications } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user?.id) {
        throw new Error("User not authenticated");
      }

      const headers: Record<string, string> = {
        'X-User-ID': user.id.toString()
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
    logoutMutation.mutate();
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
              <li>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <User className="h-4 w-4" />
                      {user.username}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {user.role === "admin" ? (
                      <DropdownMenuItem asChild>
                        <Link href="/admin">Admin Dashboard</Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem asChild>
                        <Link href="/dashboard">My Applications</Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="gap-2">
                      <LogOut className="h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )}
          </ul>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <User className="h-4 w-4 mr-1" />
                  {user.username}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {user.role === "admin" ? (
                  <DropdownMenuItem asChild>
                    <Link href="/admin">Admin Dashboard</Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard">My Applications</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="gap-2">
                  <LogOut className="h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
