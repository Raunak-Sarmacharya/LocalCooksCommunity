import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import {
  Award,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Lock,
  Play,
  Shield
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
const foodSafetyBasicsVideos: VideoData[] = [
  {
    id: 'basics-cross-contamination',
    title: 'An Introduction',
    description: 'Most of the food poisoning problems we see in our kitchens are caused by food. But it is easy to win the fight against food poisoning and other diseases and to serve food and drinks from the kitchen without food safety problems. Want to know how to win? Watch the videos in this course!',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/1.%20Food%20Safety%20Understanding%20Food%20Safety.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-allergen-awareness',
    title: 'Basic Conditions of HACCP',
    description: 'The practice of HACCP has its analysis and critical control points and gives you seven principles that helps you keeping your food safe.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/2.%20Food%20Safety%20Basic%20Conditions%20of%20HACCP.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-cooking-temps',
    title: 'Reducing Complexity',
    description: 'Learn how to simplify the food processes in your kitchen.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/3.%20Food%20Safety%20Reducing%20Complexity.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-temperature-danger',
    title: 'Personal Hygiene',
    description: 'It is very important that all employees follow the rules of personal hygiene. Learn how you can avoid bad bacteria coming into your kitchen.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/4.%20Food%20Safety%20Personal%20Hygiene.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-personal-hygiene',
    title: 'Deliveries',
    description: 'Let\'s start thinking about delivery of goods to your kitchen. An important part of food safety is choosing a good supplier.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/5.%20Food%20Safety%20Deliveries.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-storage',
    title: 'Storage',
    description: 'Food safety also includes storage, because each product requires their own way of storaging.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/6.%20Food%20Safety%20Storage.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-illness-reporting',
    title: 'Preparation',
    description: 'It is time to wash your hands! Preparation time is important for food safety.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/7.%20Food%20Safety%20Preparation.mp4',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-safety-plan',
    title: 'Regeneration',
    description: 'Sometimes you need to prepare food before the customer is ordering. Learn what steps we must take to keep this food safe.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/8.%20Food%20Safety%20Regeneration.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-pest-control',
    title: 'To Start',
    description: 'The care we followed in the preparation process must continue. Are you ready to start?',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/9.%20Food%20Safety%20To%20start.mp4',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-chemical-safety',
    title: 'After Service',
    description: 'After the service is finished we still need to take care of food safety practices.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/10.%20Food%20Safety%20After%20Service.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-fifo',
    title: 'Waste Removal',
    description: 'There is always a lot of waste we have after a service. This waste contains a lot of bacteria.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/11.%20Food%20Safety%20Waste%20Removal.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-receiving',
    title: 'Cleaning and Maintenance',
    description: 'Following the steps in this video is very important and helps you to keep your kitchen clean.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/12.%20Food%20Safety%20Cleaning%20and%20Maintenance.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-cooling-reheating',
    title: 'Weekly Log Sheets',
    description: 'Every thing we see is very important and needs to be recorded. Make sure HACCP is in place.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/13.%20Food%20Safety%20Weekly%20Log%20Sheets.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-thawing',
    title: 'Wrap Up',
    description: 'We are almost at the end, well done!',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/14.%20Food%20Safety%20Wrap%20up.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  }
];

// Module 2: Safety and Hygiene How-To's (8 videos)
const safetyHygieneVideos: VideoData[] = [
  {
    id: 'howto-handwashing',
    title: 'How to Wash Your Hands',
    description: 'In this video, we will take you through the steps to correctly and thoroughly wash your hands.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/1.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Wash%20Your%20Hands.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-sanitizing',
    title: 'How to clean a food preparation station',
    description: 'Discover the best ways to disinfect, degrease and more to boost health and safety in the kitchen.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/2.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Food%20Preparation%20Su.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-thermometer',
    title: 'How to clean kitchen utensils',
    description: 'They\'re the tools of a professional chef\'s trade so keeping them safe and ready for use is vital.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/3.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Culinary%20Utensil.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-cleaning-schedule',
    title: 'How to clean a stove',
    description: 'This expert checklist will provide brilliant results and easier kitchen management.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/4.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Stove.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-equipment-cleaning',
    title: 'How to clean a kitchen floor',
    description: 'Try these straightforward cleaning tips. Discover the equipment you\'ll need.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/5.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Kitchen%20Floor.mp4',
    source: 'CFIA',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-uniform-care',
    title: 'How to clean a restaurant floor',
    description: 'Help create a fresh, welcoming front of house with simple skills.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/6.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Restaurant%20Floor.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-wound-care',
    title: 'How to clean tables and chairs',
    description: 'Want to know the best techniques for cleaning up after customers?',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/7.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20Tables%20and%20Chairs.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-inspection-prep',
    title: 'How to clean a washroom',
    description: 'Take responsibility for the cleanliness of even the smallest room in your restaurant.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/8.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Washroom.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  }
];

const videos: VideoData[] = [...foodSafetyBasicsVideos, ...safetyHygieneVideos];

export default function TrainingVideoPlayer({ className }: TrainingVideoPlayerProps) {
  const { showAlert } = useCustomAlerts();
  const { user: firebaseUser } = useFirebaseAuth();
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
  const [accessLevel, setAccessLevel] = useState<'full' | 'limited'>('limited');
  const [applicationInfo, setApplicationInfo] = useState<{ canApply?: boolean; message?: string } | null>(null);
  const [showApplicationPrompt, setShowApplicationPrompt] = useState(false);

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
        setAccessLevel(data.accessLevel || (user.role === 'admin' ? 'full' : 'limited'));
        setApplicationInfo(data.applicationInfo || null);
      } else if (user.role === 'admin') {
        setAccessLevel('full');
      }
    } catch (error) {
      console.error('Failed to load progress:', error);
      if (user?.role === 'admin') setAccessLevel('full');
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
      console.error('Failed to update progress:', error);
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
        showAlert({ title: "Authentication Error", description: "Please refresh and try again.", type: "error" });
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
        showAlert({ title: "Congratulations!", description: "You have completed your food safety training and earned your certificate.", type: "success" });
      } else {
        const errorData = await response.json().catch(() => ({}));
        showAlert({ title: "Error", description: errorData.message || 'Failed to confirm completion.', type: "error" });
      }
    } catch (error) {
      console.error('Failed to confirm completion:', error);
      showAlert({ title: "Network Error", description: "Please check your connection and try again.", type: "error" });
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
      showAlert({ title: "Video Locked", description: "Complete the previous video to unlock this one.", type: "warning" });
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
          <p className="text-sm text-muted-foreground">Loading training...</p>
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
            videos completed
          </div>

          {completionConfirmed ? (
            <Badge variant="success"><Award className="h-3 w-3 mr-1" />Certified</Badge>
          ) : accessLevel === 'full' ? (
            <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Full Access</Badge>
          ) : user?.role === 'admin' ? (
            <Badge variant="outline"><Shield className="h-3 w-3 mr-1" />Admin</Badge>
          ) : (
            <Badge variant="secondary"><Lock className="h-3 w-3 mr-1" />Sample</Badge>
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
                  <h3 className="font-semibold text-sm">All videos completed</h3>
                  <p className="text-xs text-muted-foreground">Confirm to generate your certificate</p>
                </div>
              </div>
              <Button onClick={confirmCompletion} disabled={isSubmitting} size="sm">
                {isSubmitting ? 'Confirming...' : 'Confirm & Certify'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Video player — main area */}
        <div className="lg:col-span-8 space-y-3">
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
                    <Badge variant="secondary" className="text-xs">Preview</Badge>
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
                  Previous
                </Button>

                <span className="text-xs text-muted-foreground tabular-nums">
                  {currentVideoIndex + 1} / {currentModuleVideos.length}
                </span>

                {accessLevel === 'limited' && currentVideoIndex === 0 ? (
                  applicationInfo?.canApply ? (
                    <Button asChild size="sm" className="gap-1">
                      <Link href="/dashboard?view=applications&action=new">
                        Apply for Full Access
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <Link href="/dashboard">
                        Check Status
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )
                ) : isLastInModule ? (
                  <Button size="sm" variant="outline" disabled className="gap-1">
                    Module Complete
                    <CheckCircle className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={goToNextVideo}
                    disabled={!canGoNext}
                    className="gap-1"
                  >
                    {!currentVideoCompleted && accessLevel === 'full' ? 'Watch to Unlock' : 'Next Video'}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-3">
          
          {/* Module selector */}
          <Card className="border-border/50">
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
                  <div className="font-medium mb-0.5">Basics</div>
                  <div className="text-muted-foreground">
                    {userProgress.filter(p => p.completed && foodSafetyBasicsVideos.some(v => v.id === p.videoId)).length}/14
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
                  <div className="font-medium mb-0.5">How-To&apos;s</div>
                  <div className="text-muted-foreground">
                    {userProgress.filter(p => p.completed && safetyHygieneVideos.some(v => v.id === p.videoId)).length}/8
                  </div>
                </button>
              </div>

              {/* Module progress bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Module progress</span>
                  <span className="font-medium tabular-nums">{Math.round(moduleProgress)}%</span>
                </div>
                <Progress value={moduleProgress} className="h-1.5" />
              </div>
            </CardContent>
          </Card>

          {/* Status cards */}
          {accessLevel === 'limited' && applicationInfo?.canApply && (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-warning" />
                  <span className="text-xs font-medium">Application required for full access</span>
                </div>
                <Button asChild size="sm" className="w-full" variant="outline">
                  <Link href="/dashboard?view=applications&action=new">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Submit Application
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {completionConfirmed && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">Training Completed</span>
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
                      console.error('Certificate download error:', err);
                    }
                  }}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download Certificate
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Video list */}
          <Card className="border-border/50 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50 bg-muted/30">
              <span className="text-xs font-medium text-foreground">
                {currentModule === 'basics' ? 'Food Safety Basics' : "Safety & Hygiene How-To's"}
              </span>
            </div>
            <div className="overflow-y-auto max-h-[420px]">
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
            <div className="px-3 py-2 border-t border-border/50 bg-muted/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Overall</span>
                <span className="font-medium tabular-nums">{totalCompleted}/{videos.length} completed</span>
              </div>
              <Progress value={overallProgress} className="h-1 mt-1.5" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
