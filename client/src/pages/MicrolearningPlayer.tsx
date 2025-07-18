import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import MicrolearningModule from '@/components/microlearning/MicrolearningModule';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Home } from 'lucide-react';
import React from 'react';
import { Link, useLocation } from 'wouter';

export default function MicrolearningPlayer() {
  const { user: firebaseUser, loading: firebaseLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  // Check for session-based auth (for admin users)
  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
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
  });

  // Combine authentication - prioritize session for admin, Firebase for regular users
  const user = sessionUser?.role === 'admin' ? sessionUser : (firebaseUser || sessionUser);
  const loading = firebaseLoading || sessionLoading;

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Redirecting to login...</div>
      </div>
    ); // Will redirect to login
  }

  const handleComplete = () => {
    // Navigate to success page or dashboard after completion
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow pt-20 md:pt-24 pb-12">
        {/* Breadcrumb Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center space-x-2 text-sm text-gray-600">
            <Link href="/dashboard" className="flex items-center hover:text-gray-900 transition-colors">
              <Home className="h-4 w-4 mr-1" />
              Dashboard
            </Link>
            <ChevronLeft className="h-4 w-4 rotate-180" />
            <Link href="/microlearning/overview" className="hover:text-gray-900 transition-colors">
              Training Overview
            </Link>
            <ChevronLeft className="h-4 w-4 rotate-180" />
            <span className="text-gray-900 font-medium">Video Player</span>
          </nav>
        </div>
        
        <MicrolearningModule 
          userId={user.uid}
          onComplete={handleComplete}
          className="player-focused"
        />
      </main>
      <Footer />
    </div>
  );
} 