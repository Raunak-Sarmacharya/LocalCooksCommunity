import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import MicrolearningModule from '@/components/microlearning/MicrolearningModule';
import { useAuth } from '@/hooks/use-auth';
import React from 'react';
import { useLocation } from 'wouter';

export default function Microlearning() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth');
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
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
        <MicrolearningModule 
          userId={user.id}
          onComplete={handleComplete}
        />
      </main>
      <Footer />
    </div>
  );
} 