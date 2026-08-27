import { logger } from "@/lib/logger";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { SKILLSPASS_OFFICIAL_CERT_URL } from '@/config/skillspass';
import {
  Award,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Lock,
  Play,
  Shield
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import VideoPlayer from '@/components/microlearning/VideoPlayer';

interface VideoData {
  id: string;
  title: string;
  description: string;
  url: string;
  duration: string;
  certification: string;
  source: string;
  module: string;
}

interface UserProgress {
  videoId: string;
  progress: number;
  completed: boolean;
  completedAt?: Date;
  startedAt?: Date;
  watchedPercentage?: number;
  isRewatching?: boolean;
}

interface TrainingVideoPlayerProps {
  className?: string;
}

// Module 1: Food Safety Basics (14 videos)
type VidT = (key: string) => string

const getFoodSafetyBasicsVideos = (t: VidT): VideoData[] => [
  {
    id: 'basics-cross-contamination',
    title: t('vidBasics1Title'),
    description: t('vidBasics1Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/1.%20Food%20Safety%20Understanding%20Food%20Safety.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-allergen-awareness',
    title: t('vidBasics2Title'),
    description: t('vidBasics2Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/2.%20Food%20Safety%20Basic%20Conditions%20of%20HACCP.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-cooking-temps',
    title: t('vidBasics3Title'),
    description: t('vidBasics3Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/3.%20Food%20Safety%20Reducing%20Complexity.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-temperature-danger',
    title: t('vidBasics4Title'),
    description: t('vidBasics4Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/4.%20Food%20Safety%20Personal%20Hygiene.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-personal-hygiene',
    title: t('vidBasics5Title'),
    description: t('vidBasics5Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/5.%20Food%20Safety%20Deliveries.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-storage',
    title: t('vidBasics6Title'),
    description: t('vidBasics6Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/6.%20Food%20Safety%20Storage.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-illness-reporting',
    title: t('vidBasics7Title'),
    description: t('vidBasics7Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/7.%20Food%20Safety%20Preparation.mp4',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-safety-plan',
    title: t('vidBasics8Title'),
    description: t('vidBasics8Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/8.%20Food%20Safety%20Regeneration.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-pest-control',
    title: t('vidBasics9Title'),
    description: t('vidBasics9Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/9.%20Food%20Safety%20To%20start.mp4',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-chemical-safety',
    title: t('vidBasics10Title'),
    description: t('vidBasics10Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/10.%20Food%20Safety%20After%20Service.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-fifo',
    title: t('vidBasics11Title'),
    description: t('vidBasics11Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/11.%20Food%20Safety%20Waste%20Removal.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-receiving',
    title: t('vidBasics12Title'),
    description: t('vidBasics12Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/12.%20Food%20Safety%20Cleaning%20and%20Maintenance.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-cooling-reheating',
    title: t('vidBasics13Title'),
    description: t('vidBasics13Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/13.%20Food%20Safety%20Weekly%20Log%20Sheets.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-thawing',
    title: t('vidBasics14Title'),
    description: t('vidBasics14Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/14.%20Food%20Safety%20Wrap%20up.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  }
];

// Module 2: Safety and Hygiene How-To's (8 videos)
const getSafetyHygieneVideos = (t: VidT): VideoData[] => [
  {
    id: 'howto-handwashing',
    title: t('vidHygiene1Title'),
    description: t('vidHygiene1Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/1.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Wash%20Your%20Hands.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-sanitizing',
    title: t('vidHygiene2Title'),
    description: t('vidHygiene2Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/2.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Food%20Preparation%20Su.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-thermometer',
    title: t('vidHygiene3Title'),
    description: t('vidHygiene3Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/3.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Culinary%20Utensil.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-cleaning-schedule',
    title: t('vidHygiene4Title'),
    description: t('vidHygiene4Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/4.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Stove.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-equipment-cleaning',
    title: t('vidHygiene5Title'),
    description: t('vidHygiene5Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/5.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Kitchen%20Floor.mp4',
    source: 'CFIA',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-uniform-care',
    title: t('vidHygiene6Title'),
    description: t('vidHygiene6Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/6.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Restaurant%20Floor.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-wound-care',
    title: t('vidHygiene7Title'),
    description: t('vidHygiene7Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/7.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20Tables%20and%20Chairs.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-inspection-prep',
    title: t('vidHygiene8Title'),
    description: t('vidHygiene8Desc'),
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/8.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Washroom.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  }
];



export default function TrainingVideoPlayer({ className }: TrainingVideoPlayerProps) {
  const { showAlert } = useCustomAlerts();
  const { user: firebaseUser } = useFirebaseAuth();
  const { t } = useTranslation('chef');
  const queryClient = useQueryClient();
  const user = firebaseUser;
  
  const [userProgress, setUserProgress] = useState<UserProgress[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);

  // Synchronous completion tracking — immune to React state batching delays
  const completedVideoIdsRef = useRef<Set<string>>(new Set());
  // Debounce progress API calls (timeupdate fires ~4x/sec)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentModule, setCurrentModule] = useState<'basics' | 'hygiene'>('basics');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const [accessLevel, setAccessLevel] = useState<'full' | 'limited'>('full');
  const [applicationInfo, setApplicationInfo] = useState<{ canApply?: boolean; message?: string } | null>(null);
  const [showApplicationPrompt, setShowApplicationPrompt] = useState(false);

  // Locale-aware video catalog — rebuilt when the language changes.
  const videos = useMemo(
    () => [...getFoodSafetyBasicsVideos(t as unknown as VidT), ...getSafetyHygieneVideos(t as unknown as VidT)],
    [t]
  );

  const currentModuleVideos = videos.filter(video => video.module === currentModule);
  const currentVideo = currentModuleVideos[currentVideoIndex];
  const allVideosCompleted = videos.every(v =>
    userProgress.some(p => p.videoId === v.id && p.completed)
  );
  const completedInModule = userProgress.filter(
    p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)
  ).length;
  const moduleProgress = currentModuleVideos.length > 0
    ? (completedInModule / currentModuleVideos.length) * 100
    : 0;
  const totalCompleted = userProgress.filter(p => p.completed).length;
  const overallProgress = videos.length > 0 ? (totalCompleted / videos.length) * 100 : 0;

  useEffect(() => {
    loadUserProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const loadUserProgress = async () => {
    try {
      if (!user) { setIsLoading(false); return; }
      const currentUser = auth.currentUser;
      if (!currentUser) { setIsLoading(false); return; }
      
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/firebase/microlearning/progress/${user.uid}`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        const currentVideoIds = videos.map(v => v.id);
        const filteredProgress = (data.progress || []).filter((p: UserProgress) =>
          currentVideoIds.includes(p.videoId)
        );
        setUserProgress(filteredProgress);
        // Seed the completion ref from DB so previously-completed videos are protected
        filteredProgress.forEach((p: UserProgress) => {
          if (p.completed) completedVideoIdsRef.current.add(p.videoId);
        });
        setCompletionConfirmed(data.confirmed || data.completionConfirmed || false);
        setAccessLevel('full');
        setApplicationInfo(data.applicationInfo || null);
      } else {
        setAccessLevel('full');
      }
    } catch (error) {
      logger.error('Failed to load progress:', error);
      setAccessLevel('full');
    } finally {
      setIsLoading(false);
    }
  };

  const updateVideoProgress = async (videoId: string, progressVal: number, completed: boolean = false, watchedPercentage: number = 0) => {
    try {
      if (!user) return;
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/microlearning/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          userId: user.uid,
          videoId,
          progress: progressVal,
          completed,
          watchedPercentage,
          completedAt: completed ? new Date() : undefined
        })
      });

      if (response.ok) {
        setUserProgress(prev => {
          const existing = prev.find(p => p.videoId === videoId);
          const finalCompleted = completed || (existing?.completed || false);
          const updated: UserProgress = {
            videoId,
            progress: progressVal,
            completed: finalCompleted,
            watchedPercentage,
            completedAt: finalCompleted ? (existing?.completedAt || new Date()) : undefined,
            startedAt: existing?.startedAt || (progressVal > 0 ? new Date() : undefined)
          };
          return [...prev.filter(p => p.videoId !== videoId), updated];
        });
      }
    } catch (error) {
      logger.error('Failed to update progress:', error);
    }
  };

  const handleVideoStart = (videoId: string) => {
    const existing = userProgress.find(p => p.videoId === videoId);
    if (!existing || (existing.progress === 0 && !existing.completed)) {
      updateVideoProgress(videoId, 0, false, 0);
    }
  };

  const handleVideoProgress = (videoId: string, progressVal: number, watchedPercentage: number) => {
    if (progressVal <= 0) return;
    // Never send progress updates for videos already completed (prevents race condition overwrite)
    if (completedVideoIdsRef.current.has(videoId)) return;

    // Debounce: only send progress update every 3 seconds (timeupdate fires ~4x/sec)
    if (progressTimerRef.current) return;
    progressTimerRef.current = setTimeout(() => { progressTimerRef.current = null; }, 3000);

    updateVideoProgress(videoId, progressVal, false, watchedPercentage);
  };

  // NO auto-advance — user must click "Next Video" manually
  const handleVideoComplete = (videoId: string) => {
    // Mark in ref IMMEDIATELY (synchronous) — prevents any subsequent onProgress from overwriting
    completedVideoIdsRef.current.add(videoId);
    updateVideoProgress(videoId, 100, true, 100);
    
    if (accessLevel === 'limited' && currentVideoIndex === 0) {
      setTimeout(() => setShowApplicationPrompt(true), 1500);
    }
  };

  const confirmCompletion = async () => {
    if (!allVideosCompleted) return;
    setIsSubmitting(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        showAlert({ title: t("trAuthErrorTitle"), description: t("trAuthErrorBody"), type: "error" });
        return;
      }
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/microlearning/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: user?.uid, completionDate: new Date(), videoProgress: userProgress })
      });

      if (response.ok) {
        setCompletionConfirmed(true);
        queryClient.invalidateQueries({ queryKey: ["microlearning-completion"] });
        queryClient.invalidateQueries({ queryKey: ["training-access"] });
        showAlert({ title: t("trCompleteToastTitle"), description: t("trCompleteToastBody"), type: "success" });
      } else {
        const errorData = await response.json().catch(() => ({}));
        showAlert({ title: t("errorTitle"), description: errorData.message || t("trConfirmFailBody"), type: "error" });
      }
    } catch (error) {
      logger.error('Failed to confirm completion:', error);
      showAlert({ title: t("trNetworkErrorTitle"), description: t("trNetworkErrorBody"), type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getVideoProgress = (videoId: string) => userProgress.find(p => p.videoId === videoId);

  const canAccessVideo = (index: number): boolean => {
    if (completionConfirmed || user?.role === 'admin') return true;
    if (accessLevel === 'full') {
      if (index === 0) return true;
      const prev = currentModuleVideos[index - 1];
      return getVideoProgress(prev.id)?.completed || false;
    }
    return index === 0; // limited: first video only
  };

  const handleVideoClick = (index: number) => {
    if (canAccessVideo(index)) {
      setCurrentVideoIndex(index);
    } else if (accessLevel === 'limited') {
      setShowApplicationPrompt(true);
    } else if (accessLevel === 'full') {
      showAlert({ title: t("trVideoLockedTitle"), description: t("trVideoLockedBody"), type: "warning" });
    }
  };

  // Navigation helpers
  const currentVideoCompleted = getVideoProgress(currentVideo?.id || '')?.completed || false;
  const nextIndex = currentVideoIndex + 1;
  const isLastInModule = nextIndex >= currentModuleVideos.length;
  const canGoNext = !isLastInModule && (currentVideoCompleted || completionConfirmed || user?.role === 'admin');

  const goToNextVideo = () => {
    if (canGoNext) setCurrentVideoIndex(nextIndex);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-16", className)}>
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">{t("trPlayerLoading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          {/* Overall progress pill */}
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1.5">
            <span className="font-medium text-foreground">{totalCompleted}/{videos.length}</span>
            {t("trVideosCompleted")}
          </div>

          {completionConfirmed ? (
            <Badge variant="success"><Award className="h-3 w-3 mr-1" />{t("trBadgeTrainingComplete")}</Badge>
          ) : accessLevel === 'full' ? (
            <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />{t("trBadgeFullAccess")}</Badge>
          ) : user?.role === 'admin' ? (
            <Badge variant="outline"><Shield className="h-3 w-3 mr-1" />{t("trBadgeAdmin")}</Badge>
          ) : (
            <Badge variant="secondary"><Lock className="h-3 w-3 mr-1" />{t("trBadgeSample")}</Badge>
          )}
        </div>
      </div>

      {/* Completion banner */}
      {accessLevel === 'full' && allVideosCompleted && !completionConfirmed && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Award className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{t("trAllCompletedTitle")}</h3>
                  <p className="text-xs text-muted-foreground">{t("trAllCompletedBody")}</p>
                </div>
              </div>
              <Button onClick={confirmCompletion} disabled={isSubmitting} size="sm">
                {isSubmitting ? t('trDownloading') : t('trConfirmCompletion')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main layout — right column height is locked to the left column (ends at SkillsPass notice) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        
        {/* Video player — main area */}
        <div className="flex flex-col gap-3 lg:col-span-8">
          {/* Player */}
          {currentVideo?.url ? (
            <VideoPlayer
              videoUrl={currentVideo.url}
              title={currentVideo.title}
              onStart={() => handleVideoStart(currentVideo.id)}
              onProgress={(p, w) => handleVideoProgress(currentVideo.id, p, w)}
              onComplete={() => handleVideoComplete(currentVideo.id)}
              isCompleted={getVideoProgress(currentVideo.id)?.completed || false}
              isRewatching={completionConfirmed || user?.role === 'admin' || (getVideoProgress(currentVideo.id)?.completed || false)}
              requireFullWatch={true}
              accessLevel={accessLevel}
              showApplicationPrompt={showApplicationPrompt && accessLevel === 'limited' && currentVideoIndex === 0 && (applicationInfo?.canApply || false)}
              onApplicationPromptClose={() => setShowApplicationPrompt(false)}
            />
          ) : (
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
              <Play className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}

          {/* Video info + nav */}
          <Card className="border-border/50">
            <CardContent className="p-4 space-y-3">
              {/* Title row */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                  {currentVideoIndex + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground text-sm leading-tight">{currentVideo?.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{currentVideo?.description}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge variant="outline" className="text-xs">HACCP</Badge>
                  {accessLevel === 'limited' && currentVideoIndex === 0 && (
                    <Badge variant="secondary" className="text-xs">{t("trPreviewBadge")}</Badge>
                  )}
                </div>
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentVideoIndex(Math.max(0, currentVideoIndex - 1))}
                  disabled={currentVideoIndex === 0}
                  className="gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {t("vpPrevious")}
                </Button>

                <span className="text-xs text-muted-foreground tabular-nums">
                  {currentVideoIndex + 1} / {currentModuleVideos.length}
                </span>

                {accessLevel === 'limited' && currentVideoIndex === 0 ? (
                  applicationInfo?.canApply ? (
                    <Button asChild size="sm" className="gap-1">
                      <Link href="/dashboard?view=applications&action=new">
                        {t("vpApplyForFullAccess")}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <Link href="/dashboard">
                        {t("vpCheckStatus")}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )
                ) : isLastInModule ? (
                  <Button size="sm" variant="outline" disabled className="gap-1">
                    {t("vpModuleComplete")}
                    <CheckCircle className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={goToNextVideo}
                    disabled={!canGoNext}
                    className="gap-1"
                  >
                    {!currentVideoCompleted && accessLevel === 'full' ? t("vpWatchToUnlock") : t("vpNextVideo")}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium leading-snug">
                {t("vpNotOfficialCert")}
              </p>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <a
                  href={SKILLSPASS_OFFICIAL_CERT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  {t("trSkillsPassCert")}
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar — fills left column height so the queue ends with the notice */}
        <div className="relative lg:col-span-4">
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden lg:absolute lg:inset-0">
          
          {/* Module selector */}
          <Card className="shrink-0 border-border/50">
            <CardContent className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setCurrentModule('basics'); setCurrentVideoIndex(0); }}
                  className={cn(
                    "p-2.5 rounded-lg border text-left transition-all text-xs",
                    currentModule === 'basics'
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border hover:border-primary/30 text-muted-foreground'
                  )}
                >
                  <div className="font-medium mb-0.5">{t("trTabBasics")}</div>
                  <div className="text-muted-foreground">
                    {userProgress.filter(p => p.completed && videos.some(v => v.id === p.videoId && v.module === 'basics')).length}/14
                  </div>
                </button>

                <button
                  onClick={() => {
                    if (completionConfirmed || user?.role === 'admin' || accessLevel === 'full') {
                      setCurrentModule('hygiene'); setCurrentVideoIndex(0);
                    } else {
                      setShowApplicationPrompt(true);
                    }
                  }}
                  className={cn(
                    "p-2.5 rounded-lg border text-left transition-all text-xs relative",
                    currentModule === 'hygiene'
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border hover:border-primary/30 text-muted-foreground',
                    accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' && 'opacity-60'
                  )}
                >
                  {accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' && (
                    <Lock className="h-3 w-3 absolute top-2 right-2 text-muted-foreground" />
                  )}
                  <div className="font-medium mb-0.5">{t("trTabHowTos")}</div>
                  <div className="text-muted-foreground">
                    {userProgress.filter(p => p.completed && videos.some(v => v.id === p.videoId && v.module === 'hygiene')).length}/8
                  </div>
                </button>
              </div>

              {/* Module progress bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t("trModuleProgress")}</span>
                  <span className="font-medium tabular-nums">{Math.round(moduleProgress)}%</span>
                </div>
                <Progress value={moduleProgress} className="h-1.5" />
              </div>
            </CardContent>
          </Card>

          {/* Status cards */}
          {accessLevel === 'limited' && applicationInfo?.canApply && (
            <Card className="shrink-0 border-warning/30 bg-warning/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-warning" />
                  <span className="text-xs font-medium">{t("trAppRequiredTitle")}</span>
                </div>
                <Button asChild size="sm" className="w-full" variant="outline">
                  <Link href="/dashboard?view=applications&action=new">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    {t("trSubmitApplication")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {completionConfirmed && (
            <Card className="shrink-0 border-primary/30 bg-primary/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">{t("trTrainingCompletedCard")}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    try {
                      const currentUser = auth.currentUser;
                      if (!currentUser) return;
                      const token = await currentUser.getIdToken();
                      const response = await fetch(`/api/firebase/microlearning/certificate/${user?.uid}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                      });
                      if (response.ok) {
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'local-cooks-certificate.pdf';
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                      }
                    } catch (err) {
                      logger.error('Certificate download error:', err);
                    }
                  }}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  {t("trDownloadCert")}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Video list */}
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/50">
            <div className="shrink-0 border-b border-border/50 bg-muted/30 px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                {currentModule === 'basics' ? t("trModuleBasics") : t("trModuleHygiene")}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="p-1.5 space-y-0.5">
                {currentModuleVideos.map((video, index) => {
                  const vProgress = getVideoProgress(video.id);
                  const isCompleted = vProgress?.completed || false;
                  const isCurrent = currentVideoIndex === index;
                  const hasAccess = canAccessVideo(index);

                  return (
                    <button
                      key={video.id}
                      onClick={() => handleVideoClick(index)}
                      className={cn(
                        "w-full flex items-center gap-2 p-2 rounded-md text-left transition-colors text-xs",
                        isCurrent
                          ? 'bg-primary/10 text-foreground'
                          : hasAccess
                          ? 'hover:bg-muted/50 text-foreground'
                          : 'text-muted-foreground/60 cursor-not-allowed'
                      )}
                    >
                      {/* Status indicator */}
                      <div className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-semibold",
                        isCompleted
                          ? 'bg-primary text-primary-foreground'
                          : isCurrent
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : hasAccess
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-muted/50 text-muted-foreground/50'
                      )}>
                        {isCompleted ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : !hasAccess ? (
                          <Lock className="h-2.5 w-2.5" />
                        ) : (
                          index + 1
                        )}
                      </div>

                      <span className="flex-1 truncate leading-tight">{video.title}</span>

                      {isCurrent && !isCompleted && (
                        <Play className="h-3 w-3 text-primary flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Overall progress footer */}
            <div className="shrink-0 border-t border-border/50 bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("trOverall")}</span>
                <span className="font-medium tabular-nums">{t("trCompletedCount", { done: totalCompleted, total: videos.length })}</span>
              </div>
              <Progress value={overallProgress} className="h-1 mt-1.5" />
            </div>
          </Card>
        </div>
        </div>
      </div>
    </div>
  );
}
