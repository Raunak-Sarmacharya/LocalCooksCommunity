import { logger } from "@/lib/logger";
import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from '@/lib/firebase';
import { SKILLSPASS_OFFICIAL_CERT_URL } from '@/config/skillspass';
import { ChefPageHeader, QuietNotice } from '@/components/chef/ui';
import { useQuery } from '@tanstack/react-query';
import {
    AlertTriangle,
    BookOpen,
    Download,
    ExternalLink,
    Play,
    Shield,
    type LucideIcon,
} from 'lucide-react';
import React, { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';

const BASICS_VIDEO_COUNT = 14;
const HYGIENE_VIDEO_COUNT = 8;
const TOTAL_VIDEOS = BASICS_VIDEO_COUNT + HYGIENE_VIDEO_COUNT;

const TRAINING_MODULES = [
  {
    id: 'basics',
    videoIdPrefix: 'basics-',
    title: 'Food Safety Basics',
    videoCount: BASICS_VIDEO_COUNT,
    description: 'HACCP principles, contamination prevention, and food handling fundamentals.',
  },
  {
    id: 'hygiene',
    videoIdPrefix: 'howto-',
    title: "Safety & Hygiene How-To's",
    videoCount: HYGIENE_VIDEO_COUNT,
    description: 'Practical demonstrations for kitchen hygiene and cleaning.',
  },
] as const;

export default function MicrolearningOverview() {
  const { user: firebaseUser, loading: firebaseLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const { showAlert } = useCustomAlerts();
  const [isDownloading, setIsDownloading] = useState(false);

  const user = firebaseUser;
  const loading = firebaseLoading;

  React.useEffect(() => {
    if (!loading && !user) {
      logger.info('🔄 MicrolearningOverview: Redirecting to auth - no user');
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  const { data: trainingAccess, isLoading: isLoadingTrainingAccess, error: trainingAccessError } = useQuery({
    queryKey: ["training-access", user?.uid],
    queryFn: async () => {
      if (!user) return null;
      
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated Firebase user found");
        }
        
        const token = await currentUser.getIdToken();
        
        const response = await fetch(`/api/firebase/microlearning/progress/${user.uid}`, {
          method: "GET",
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            return { accessLevel: 'full', progress: [] };
          }
          throw new Error(`Failed to fetch training access (firebase): ${response.status} ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        logger.error("❌ MicrolearningOverview: Error fetching training access:", error);
        return { accessLevel: 'full', progress: [] };
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const { data: microlearningCompletion, isLoading: isLoadingCompletion, error: completionError } = useQuery({
    queryKey: ["microlearning-completion", user?.uid],
    queryFn: async () => {
      if (!user) return null;
      
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated Firebase user found");
        }
        
        const token = await currentUser.getIdToken();
        
        const response = await fetch(`/api/firebase/microlearning/completion/${user.uid}`, {
          method: "GET",
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
        });

        if (!response.ok) {
          if (response.status === 404) return null;
          throw new Error(`Failed to fetch completion status (firebase): ${response.status} ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        logger.error("❌ MicrolearningOverview: Error fetching microlearning completion:", error);
        return null;
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const isInitialLoading = loading || (user && (isLoadingTrainingAccess || isLoadingCompletion));
  const hasError = trainingAccessError || completionError;
  const safeTrainingAccess = trainingAccess || { accessLevel: 'full', progress: [] };
  const safeMicrolearningCompletion = microlearningCompletion || null;
  const isCompleted = safeMicrolearningCompletion?.completion?.confirmed || safeMicrolearningCompletion?.confirmed;
  const videoProgress = safeTrainingAccess?.progress || [];
  const completedVideos = videoProgress.filter((v: { completed?: boolean }) => v.completed).length;
  const hasStartedTraining = videoProgress.some(
    (v: { completed?: boolean; progress?: number; watchedPercentage?: number }) =>
      Boolean(v.completed) || (v.progress ?? 0) > 0 || (v.watchedPercentage ?? 0) > 0
  );

  const videoCtaLabel = isCompleted
    ? 'Review videos'
    : hasStartedTraining
      ? 'Continue videos'
      : 'Start videos';

  const downloadCertificate = async () => {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        showAlert({
          title: "Authentication Required",
          description: "Authentication required. Please log in again.",
          type: "error"
        });
        return;
      }

      setIsDownloading(true);
      const token = await firebaseUser.getIdToken();

      const response = await fetch(`/api/firebase/microlearning/certificate/${firebaseUser.uid}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to download certificate');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `LocalCooks-Certificate-${firebaseUser.displayName || firebaseUser.email || 'user'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showAlert({
        title: "Success",
        description: "Certificate downloaded successfully!",
        type: "success"
      });
    } catch (error) {
      logger.error('Error downloading certificate:', error);
      showAlert({
        title: "Download Failed",
        description: "Failed to download certificate. Please try again.",
        type: "error"
      });
    } finally {
      setIsDownloading(false);
    }
  };

  if (isInitialLoading) {
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
        <div className="text-muted-foreground">Redirecting to login...</div>
      </div>
    );
  }

  if (hasError && !trainingAccess && !microlearningCompletion && !isInitialLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-grow pt-16 md:pt-20 pb-12 flex items-center justify-center">
          <div className="text-center space-y-6 max-w-md mx-auto px-4">
            <AlertTriangle className="h-10 w-10 text-warning mx-auto" />
            <div>
              <h2 className="text-xl font-semibold mb-2">Unable to Load Training Data</h2>
              <p className="text-muted-foreground mb-4">
                We're having trouble loading your training information. This is usually temporary.
              </p>
              <div className="space-y-3">
                <Button onClick={() => window.location.reload()} className="w-full">
                  Try Again
                </Button>
                <Button variant="outline" onClick={() => navigate('/dashboard')} className="w-full">
                  Go to Dashboard
                </Button>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow pt-16 md:pt-20 pb-12">
        <div className="container mx-auto px-4 max-w-5xl space-y-6">
          <ChefPageHeader
            title="Training"
            description="Official certification for kitchens, and Local Cooks videos on this page."
            actions={
              isCompleted ? (
                <Badge variant="success">Videos complete</Badge>
              ) : completedVideos > 0 ? (
                <Badge variant="outline">{completedVideos} of {TOTAL_VIDEOS} complete</Badge>
              ) : undefined
            }
          />

          <QuietNotice title="LocalCooks training is not an official food handler certificate">
            These videos are a learning resource. They are not recognized by health authorities
            or most commercial kitchens as official certification.
          </QuietNotice>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TrackCard
              icon={Shield}
              label="Required by kitchens"
              title="Official food handler certificate"
              description="Local Cooks does not issue an officially accepted certificate. Register free with SkillsPass NL — the path most kitchens and health authorities recognize."
              meta="Free registration · External site"
              action={
                <Button asChild variant="outline" className="w-full">
                  <a href={SKILLSPASS_OFFICIAL_CERT_URL} target="_blank" rel="noopener noreferrer">
                    Get SkillsPass certificate
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              }
            />

            <TrackCard
              icon={BookOpen}
              label="On this page"
              title="Local Cooks training videos"
              description={`${TOTAL_VIDEOS} videos on food safety and hygiene. Completing them gives a Local Cooks learning certificate, not official food handler certification.`}
              meta={isCompleted ? 'Videos complete' : completedVideos > 0 ? `${completedVideos} of ${TOTAL_VIDEOS} videos complete` : `${TOTAL_VIDEOS} videos · Self-paced`}
              action={
                isCompleted ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={downloadCertificate} disabled={isDownloading}>
                      <Download className="h-4 w-4" />
                      {isDownloading ? 'Downloading…' : 'Download'}
                    </Button>
                    <Button asChild>
                      <Link href="/microlearning/player">
                        <Play className="h-4 w-4" />
                        {videoCtaLabel}
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <Button asChild className="w-full">
                    <Link href="/microlearning/player">
                      <Play className="h-4 w-4" />
                      {videoCtaLabel}
                    </Link>
                  </Button>
                )
              }
            />
          </div>

          <Card className="border-border/50 shadow-none">
            <CardContent className="p-5 pt-5">
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h3 className="font-semibold text-foreground">Local Cooks modules</h3>
                <p className="text-sm text-muted-foreground tabular-nums">{TOTAL_VIDEOS} videos</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TRAINING_MODULES.map((module) => {
                  const completedInModule = videoProgress.filter(
                    (item: { completed?: boolean; videoId?: string }) =>
                      item.completed && item.videoId?.startsWith(module.videoIdPrefix)
                  ).length;
                  const modulePercent = Math.round((completedInModule / module.videoCount) * 100);

                  return (
                    <div key={module.id} className="rounded-lg border border-border/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="font-medium text-sm text-foreground">{module.title}</h4>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {completedInModule}/{module.videoCount}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        {module.description}
                      </p>
                      <Progress value={modulePercent} className="h-1.5 bg-muted mt-3" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function TrackCard({
  icon: Icon,
  label,
  title,
  description,
  meta,
  action,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  description: string;
  meta: string;
  action: ReactNode;
}) {
  return (
    <Card className="border-border/50 shadow-none h-full">
      <CardContent className="p-5 pt-5 flex flex-col h-full">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <h3 className="font-semibold text-foreground mt-0.5">{title}</h3>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-4 leading-relaxed flex-1">
          {description}
        </p>
        <p className="text-xs text-muted-foreground mt-4">{meta}</p>
        <div className="mt-4">{action}</div>
      </CardContent>
    </Card>
  );
}
