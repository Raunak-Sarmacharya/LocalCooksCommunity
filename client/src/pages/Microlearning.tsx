import { useFirebaseAuth } from "@/hooks/use-auth";
import React from 'react';
import { useLocation } from 'wouter';

export default function Microlearning() {
  const { user, loading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  // Redirect to the new overview page or login
  React.useEffect(() => {
    if (!loading) {
      console.log('🔄 Microlearning: Redirecting user:', !!user);
      if (!user) {
        navigate('/auth');
      } else {
        // Redirect to the new overview page immediately to avoid white screen
        console.log('🔄 Microlearning: Redirecting to overview page');
        navigate('/microlearning/overview');
      }
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-600">Redirecting...</div>
    </div>
  );
} 