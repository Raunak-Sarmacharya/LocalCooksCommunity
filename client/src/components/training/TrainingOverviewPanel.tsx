import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle,
  Download,
  ExternalLink,
  FileText,
  Lock,
  Play
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import TrainingVideoPlayer from './TrainingVideoPlayer';

type ViewMode = 'overview' | 'player';

interface TrainingOverviewPanelProps {
  className?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

export default function TrainingOverviewPanel({ className, viewMode: controlledViewMode, onViewModeChange }: TrainingOverviewPanelProps) {
  const { user: firebaseUser } = useFirebaseAuth();
  const { showAlert } = useCustomAlerts();
  const [isDownloading, setIsDownloading] = useState(false);
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('overview');

  // Support both controlled (from parent breadcrumbs) and uncontrolled usage
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;

  const user = firebaseUser;

  // Query training access level and progress
  // NOTE: All hooks must be called before any conditional returns
  const { data: trainingAccess, isLoading: isLoadingTrainingAccess } = useQuery({
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
            return {
              accessLevel: 'limited',
              hasApprovedApplication: false,
              applicationInfo: { message: 'Submit application for full training access', canApply: true }
            };
          }
          throw new Error(`Failed to fetch training access: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error("Error fetching training access:", error);
        return {
          accessLevel: 'limited',
          hasApprovedApplication: false,
          applicationInfo: { message: 'Error loading training access' }
        };
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Query completion status
  const { data: microlearningCompletion, isLoading: isLoadingCompletion } = useQuery({
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
          if (response.status === 404) {
            return null;
          }
          throw new Error(`Failed to fetch completion status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error("Error fetching microlearning completion:", error);
        return null;
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const isLoading = isLoadingTrainingAccess || isLoadingCompletion;

  const safeTrainingAccess = trainingAccess || {
    accessLevel: 'limited',
    hasApprovedApplication: false,
    applicationInfo: { message: 'Submit application for full training access', canApply: true }
  };

  const hasFullAccess = safeTrainingAccess?.accessLevel === 'full' || safeTrainingAccess?.hasApprovedApplication;
  const isCompleted = microlearningCompletion?.completion?.confirmed || microlearningCompletion?.confirmed;

  // Calculate progress from video progress data
  const videoProgress = trainingAccess?.progress || [];
  const completedVideos = videoProgress.filter((p: { completed?: boolean }) => p.completed).length;
  const totalVideos = 22;
  const progressPercentage = Math.round((completedVideos / totalVideos) * 100);

  // If in player mode, render the video player (after all hooks)
  if (viewMode === 'player') {
    return (
      <TrainingVideoPlayer 
        className={className}
      />
    );
  }

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
      console.error('Error downloading certificate:', error);
      showAlert({
        title: "Download Failed",
        description: "Failed to download certificate. Please try again.",
        type: "error"
      });
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Training & Certification</h2>
            <p className="text-muted-foreground mt-1">Loading your training progress...</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Training & Certification</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Food safety knowledge and professional certification</p>
        </div>
        {isCompleted && (
          <Badge variant="success">
            <Award className="h-3 w-3 mr-1" />
            Certified
          </Badge>
        )}
      </div>

      {/* Progress summary (if any progress) */}
      {completedVideos > 0 && (
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Overall progress</span>
              <span className="text-sm text-muted-foreground tabular-nums">{completedVideos}/{totalVideos} videos</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Modules overview */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Training Modules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Food Safety Basics */}
            <div className="p-4 rounded-lg border border-border/50 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm text-foreground">Food Safety Basics</h3>
                {hasFullAccess ? (
                  <Badge variant="outline" className="text-xs">14 videos</Badge>
                ) : (
                  <div className="flex gap-1.5">
                    <Badge variant="outline" className="text-xs">1 free</Badge>
                    <Badge variant="secondary" className="text-xs"><Lock className="h-2.5 w-2.5 mr-0.5" />13 locked</Badge>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">HACCP principles, contamination prevention, and food handling fundamentals.</p>
            </div>

            {/* Safety & Hygiene */}
            <div className="p-4 rounded-lg border border-border/50 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm text-foreground">Safety &amp; Hygiene How-To&apos;s</h3>
                {hasFullAccess ? (
                  <Badge variant="outline" className="text-xs">8 videos</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs"><Lock className="h-2.5 w-2.5 mr-0.5" />8 locked</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Practical demonstrations and industry best practices.</p>
            </div>
          </div>

          {/* Feature tags */}
          <div className="flex flex-wrap gap-2 pt-3 border-t border-border/50">
            <Badge variant="outline" className="text-xs font-normal">HACCP-Based</Badge>
            <Badge variant="outline" className="text-xs font-normal">Self-Paced</Badge>
            <Badge variant="outline" className="text-xs font-normal">Industry Standard</Badge>
            <Badge variant="outline" className="text-xs font-normal">Certificate Included</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Status cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* Completed: Certificate download */}
        {isCompleted && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Award className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Training Completed</h3>
                  <p className="text-xs text-muted-foreground">You&apos;ve earned your Local Cooks certification</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/50">
                <div>
                  <p className="text-sm font-medium">Local Cooks Certificate</p>
                  <p className="text-xs text-muted-foreground">PDF download</p>
                </div>
                <Button size="sm" variant="outline" onClick={downloadCertificate} disabled={isDownloading}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  {isDownloading ? 'Downloading...' : 'Download'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Completed: Official certificate CTA */}
        {isCompleted && (
          <Card className="border-border/50">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                  <ExternalLink className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Official SkillsPass Certificate</h3>
                  <p className="text-xs text-muted-foreground">Free, recognized by employers and health authorities</p>
                </div>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-primary flex-shrink-0" />Recognized certification</div>
                <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-primary flex-shrink-0" />100% free, no hidden costs</div>
                <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-primary flex-shrink-0" />Lifetime digital access</div>
              </div>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => window.open('https://skillspassnl.com', '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Get Official Certificate
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Limited: Application required */}
        {!hasFullAccess && safeTrainingAccess?.applicationInfo?.canApply && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Application Required</h3>
                  <p className="text-xs text-muted-foreground">{safeTrainingAccess.applicationInfo.message}</p>
                </div>
              </div>
              <Button asChild className="w-full">
                <Link href="/dashboard?view=applications&action=new">
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Submit Application
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Limited: Application pending */}
        {!hasFullAccess && safeTrainingAccess?.applicationInfo?.message && !safeTrainingAccess?.applicationInfo?.canApply && (
          <Card className="border-border/50">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Application Status</h3>
                  <p className="text-xs text-muted-foreground">{safeTrainingAccess.applicationInfo.message}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Full access: Welcome + progress */}
        {hasFullAccess && !isCompleted && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Full Access Granted</h3>
                  <p className="text-xs text-muted-foreground">Access all 22 training videos and earn your certification</p>
                </div>
              </div>
              
              {completedVideos > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium tabular-nums">{completedVideos}/{totalVideos}</span>
                  </div>
                  <Progress value={progressPercentage} className="h-1.5" />
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />All 22 videos</div>
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />Progress tracking</div>
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />Both modules</div>
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />Certificate</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Limited: Sample access info */}
        {!hasFullAccess && (
          <Card className="border-border/50">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Sample Access</h3>
                  <p className="text-xs text-muted-foreground">Preview the first video, then apply for full access</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />22 training videos</div>
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />2 modules</div>
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />Certificate</div>
                <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-primary" />Lifetime access</div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Action button */}
      <div className="text-center space-y-2">
        <Button size="lg" onClick={() => setViewMode('player')} className="gap-2">
          <Play className="h-4 w-4" />
          {!hasFullAccess
            ? 'Start with Sample Video'
            : isCompleted
            ? 'Review Training'
            : completedVideos > 0
            ? 'Continue Training'
            : 'Start Training'}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground">
          {!hasFullAccess
            ? 'Preview the introduction video, then apply for full access'
            : isCompleted
            ? 'Rewatch any video at your convenience'
            : 'Pick up where you left off'}
        </p>
      </div>
    </div>
  );
}
