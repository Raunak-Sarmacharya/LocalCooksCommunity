import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import TrainingVideoPlayer from '@/components/training/TrainingVideoPlayer';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { tt } from '@/i18n/common-ns';
import { ct } from '@/i18n/chef-ns';
import { ChevronLeft, Home, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';

export default function MicrolearningPlayer() {
  const { user, loading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow pt-16 sm:pt-20 md:pt-24 pb-8 sm:pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
          <nav className="flex items-center space-x-1 sm:space-x-2 text-xs sm:text-sm text-gray-600 flex-wrap gap-1 sm:gap-0">
            <Link href="/dashboard" className="flex items-center hover:text-gray-900 transition-colors">
              <Home className="h-4 w-4 mr-1" />
              {tt('dashboard')}
            </Link>
            <ChevronLeft className="h-4 w-4 rotate-180" />
            <Link href="/microlearning/overview" className="hover:text-gray-900 transition-colors">
              {ct('trTrainingOverviewBreadcrumb')}
            </Link>
            <ChevronLeft className="h-4 w-4 rotate-180" />
            <span className="text-gray-900 font-medium">{ct('trVideoPlayerBreadcrumb')}</span>
          </nav>
        </div>

        <TrainingVideoPlayer className="player-focused" />
      </main>
      <Footer />
    </div>
  );
}
