import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import TrainingOverviewPanel from '@/components/training/TrainingOverviewPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { tt } from '@/i18n/common-ns';
import { useEffect } from 'react';
import { useLocation } from 'wouter';

export default function MicrolearningOverview() {
  const { user, loading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-grow pt-16 md:pt-20 pb-12">
          <div className="container mx-auto px-4 max-w-5xl space-y-6">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Skeleton className="h-64 rounded-lg" />
              <Skeleton className="h-64 rounded-lg" />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">{tt('redirectingToLogin')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow pt-16 md:pt-20 pb-12">
        <div className="container mx-auto px-4 max-w-5xl">
          <TrainingOverviewPanel />
        </div>
      </main>
      <Footer />
    </div>
  );
}
