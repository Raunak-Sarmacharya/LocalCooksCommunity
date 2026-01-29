import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Download,
  FileText,
  Lock,
  Play,
  Shield,
  TrendingUp,
  XCircle
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
  onBack: () => void;
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

export default function TrainingVideoPlayer({ onBack, className }: TrainingVideoPlayerProps) {
  const { showAlert } = useCustomAlerts();
  const { user: firebaseUser } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const user = firebaseUser;
  
  const [userProgress, setUserProgress] = useState<UserProgress[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [currentModule, setCurrentModule] = useState<'basics' | 'hygiene'>('basics');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const [accessLevel, setAccessLevel] = useState<'full' | 'limited'>('limited');
  const [hasApprovedApplication, setHasApprovedApplication] = useState(false);
  const [applicationInfo, setApplicationInfo] = useState<any>(null);
  const [showApplicationPrompt, setShowApplicationPrompt] = useState(false);

  const currentModuleVideos = videos.filter(video => video.module === currentModule);
  const currentVideo = currentModuleVideos[currentVideoIndex];
  const allVideosCompleted = userProgress.length === videos.length && 
    userProgress.every((p: any) => p.completed);
  const overallProgress = (userProgress.filter(p => p.completed).length / videos.length) * 100;
  const moduleProgress = (userProgress.filter((p: any) => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length / currentModuleVideos.length) * 100;

  useEffect(() => {
    loadUserProgress();
  }, [user?.uid]);

  const loadUserProgress = async () => {
    try {
      if (!user) {
        console.error('No authenticated user found');
        setIsLoading(false);
        return;
      }

      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('No authenticated Firebase user found');
        setIsLoading(false);
        return;
      }
      
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/firebase/microlearning/progress/${user?.uid}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        const currentVideoIds = videos.map(v => v.id);
        const filteredProgress = (data.progress || []).filter((p: any) => 
          currentVideoIds.includes(p.videoId)
        );
        
        setUserProgress(filteredProgress);
        setCompletionConfirmed(data.confirmed || data.completionConfirmed || false);
        setAccessLevel(data.accessLevel || (user.role === 'admin' ? 'full' : 'limited'));
        setHasApprovedApplication(data.hasApprovedApplication || (user.role === 'admin'));
        setApplicationInfo(data.applicationInfo || null);
      } else {
        if (user.role === 'admin') {
          setAccessLevel('full');
          setHasApprovedApplication(true);
          setApplicationInfo({ message: 'Admin has full access to all training' });
        }
      }
    } catch (error) {
      console.error('Failed to load progress:', error);
      if (user?.role === 'admin') {
        setAccessLevel('full');
        setHasApprovedApplication(true);
        setApplicationInfo({ message: 'Admin has full access to all training' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const updateVideoProgress = async (videoId: string, progress: number, completed: boolean = false, watchedPercentage: number = 0) => {
    try {
      if (!user) return;

      const currentUser = auth.currentUser;
      if (!currentUser) return;
      
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/microlearning/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: user?.uid,
          videoId,
          progress,
          completed,
          watchedPercentage,
          completedAt: completed ? new Date() : undefined
        })
      });

      if (response.ok) {
        setUserProgress(prev => {
          const filtered = (prev as any[]).filter((p: any) => p.videoId !== videoId);
          const existing = (prev as any[]).find((p: any) => p.videoId === videoId);
          
          const finalCompleted = completed || (existing?.completed || false);
          const finalCompletedAt = finalCompleted ? (existing?.completedAt || new Date()) : undefined;
          
          const updatedProgress = {
            videoId,
            progress,
            completed: finalCompleted,
            watchedPercentage,
            completedAt: finalCompletedAt,
            startedAt: existing?.startedAt || (progress > 0 ? new Date() : undefined)
          };
          
          return [...filtered, updatedProgress];
        });
      }
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  };

  const handleVideoStart = (videoId: string) => {
    const existingProgress = userProgress.find(p => p.videoId === videoId);
    if (!existingProgress || (existingProgress.progress === 0 && !existingProgress.completed)) {
      updateVideoProgress(videoId, 0, false, 0);
    }
  };

  const handleVideoProgress = (videoId: string, progress: number, watchedPercentage: number) => {
    if (progress > 0) {
      const existingProgress = userProgress.find(p => p.videoId === videoId);
      const wasAlreadyCompleted = existingProgress?.completed || false;
      updateVideoProgress(videoId, progress, wasAlreadyCompleted, watchedPercentage);
    }
  };

  const handleVideoComplete = (videoId: string) => {
    updateVideoProgress(videoId, 100, true, 100);
    
    const isLimitedAccessUser = accessLevel === 'limited';
    const isCompletingFirstVideo = currentVideoIndex === 0;
    
    if (isLimitedAccessUser && isCompletingFirstVideo) {
      setTimeout(() => {
        setShowApplicationPrompt(true);
      }, 2000);
    } else if (!completionConfirmed && accessLevel === 'full') {
      setTimeout(() => {
        const nextIndex = currentVideoIndex + 1;
        const isLastModule = nextIndex >= currentModuleVideos.length;
        
        if (!isLastModule) {
          setCurrentVideoIndex(nextIndex);
        } else if (currentModule === 'basics') {
          const allBasicsCompleted = foodSafetyBasicsVideos.every(basicVideo => 
            userProgress.find(p => p.videoId === basicVideo.id)?.completed || basicVideo.id === videoId
          );
          
          if (allBasicsCompleted) {
            setCurrentModule('hygiene');
            setCurrentVideoIndex(0);
          }
        }
      }, 2000);
    }
  };

  const confirmCompletion = async () => {
    if (!allVideosCompleted) return;
    
    setIsSubmitting(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        showAlert({
          title: "Authentication Error",
          description: "Authentication error. Please refresh the page and try again.",
          type: "error"
        });
        return;
      }
      
      const token = await currentUser.getIdToken();
      
      const response = await fetch('/api/firebase/microlearning/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: user?.uid,
          completionDate: new Date(),
          videoProgress: userProgress
        })
      });

      if (response.ok) {
        setCompletionConfirmed(true);
        queryClient.invalidateQueries({ queryKey: ["microlearning-completion"] });
        queryClient.invalidateQueries({ queryKey: ["training-access"] });
        
        showAlert({
          title: "Congratulations! 🎉",
          description: "You've completed your food safety training and earned your certificate!",
          type: "success"
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        showAlert({
          title: "Completion Error",
          description: errorData.message || 'Failed to confirm completion. Please try again.',
          type: "error"
        });
      }
    } catch (error) {
      console.error('Failed to confirm completion:', error);
      showAlert({
        title: "Network Error",
        description: "Network error. Please check your connection and try again.",
        type: "error"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getVideoProgress = (videoId: string) => {
    return userProgress.find((p: any) => p.videoId === videoId);
  };

  const handleVideoClick = (videoId: string, videoIndex: number) => {
    const targetVideo = currentModuleVideos[videoIndex];
    if (!targetVideo) return;

    let canAccess = false;
    
    if (completionConfirmed || user?.role === 'admin') {
      canAccess = true;
    } else if (accessLevel === 'full') {
      canAccess = true;
    } else if (accessLevel === 'limited') {
      canAccess = videoIndex === 0;
    }

    if (canAccess) {
      setCurrentVideoIndex(videoIndex);
    } else if (accessLevel === 'limited') {
      setShowApplicationPrompt(true);
    }
  };

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <div className="text-center space-y-4">
          <div className="w-14 h-14 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Play className="h-7 w-7 text-white" />
            </motion.div>
          </div>
          <h3 className="text-lg font-semibold text-foreground">Loading Your Training</h3>
          <p className="text-muted-foreground text-sm">Preparing your personalized learning experience...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </Button>
        <div className="flex-1" />
        
        {/* Access Level Badge */}
        {completionConfirmed ? (
          <Badge className="bg-green-100 text-green-800 border-green-300 px-3 py-1">
            <Award className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        ) : accessLevel === 'full' ? (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 px-3 py-1">
            <CheckCircle className="h-3 w-3 mr-1" />
            Full Access
          </Badge>
        ) : user?.role === 'admin' ? (
          <Badge className="bg-purple-100 text-purple-800 border-purple-300 px-3 py-1">
            <Shield className="h-3 w-3 mr-1" />
            Admin
          </Badge>
        ) : (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 px-3 py-1">
            <Lock className="h-3 w-3 mr-1" />
            Limited
          </Badge>
        )}
      </div>

      {/* Course Header */}
      <Card className="border-border/50 shadow-sm overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500" />
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Food Safety Training</h2>
                <p className="text-sm text-muted-foreground">
                  {currentModule === 'basics' ? 'Food Safety Basics' : 'Safety & Hygiene How-To\'s'} • Video {currentVideoIndex + 1} of {currentModuleVideos.length}
                </p>
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-lg font-bold text-foreground">{Math.round(moduleProgress)}%</div>
              <div className="text-xs text-muted-foreground">Module Progress</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Completion Confirmation - Shows when all videos are completed */}
      {accessLevel === 'full' && allVideosCompleted && !completionConfirmed && !isSubmitting && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-blue-50 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                  <Award className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Training Complete! 🎉</h3>
                  <p className="text-sm text-muted-foreground">Ready for certification</p>
                </div>
              </div>
              
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4">
                <p className="text-emerald-800 text-sm">
                  Congratulations! You've completed all 22 training videos. 
                  Click below to confirm your completion and generate your official certificate.
                </p>
              </div>
              
              <Button 
                onClick={confirmCompletion}
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-emerald-500 to-blue-500 hover:from-emerald-600 hover:to-blue-600 text-white"
              >
                {isSubmitting ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="h-4 w-4 mr-2"
                    >
                      <Circle className="h-4 w-4" />
                    </motion.div>
                    Confirming Completion...
                  </>
                ) : (
                  <>
                    <Award className="h-4 w-4 mr-2" />
                    Confirm Completion & Generate Certificate
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Video Player Section */}
        <div className="lg:col-span-3 space-y-4">
          
          {/* Video Info Card */}
          <Card className="border-border/50 shadow-sm overflow-hidden">
            <CardContent className="p-4 bg-gradient-to-r from-slate-50 to-blue-50">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {currentVideoIndex + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-foreground mb-2">{currentVideo?.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                      HACCP-based
                    </Badge>
                    {accessLevel === 'limited' && currentVideoIndex === 0 && (
                      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs">
                        Free Preview
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-muted-foreground text-xs">
                      Required
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{currentVideo?.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Video Player */}
          <Card className="border-border/50 shadow-lg overflow-hidden">
            <div className="aspect-video bg-black">
              {currentVideo?.url ? (
                <VideoPlayer
                  videoUrl={currentVideo.url}
                  title={currentVideo.title}
                  onStart={() => handleVideoStart(currentVideo.id)}
                  onProgress={(progress, watchedPercentage) => handleVideoProgress(currentVideo.id, progress, watchedPercentage)}
                  onComplete={() => handleVideoComplete(currentVideo.id)}
                  isCompleted={(getVideoProgress(currentVideo.id) as any)?.completed || false}
                  isRewatching={completionConfirmed || user?.role === 'admin' || ((getVideoProgress(currentVideo.id) as any)?.completed || false)}
                  requireFullWatch={false}
                  accessLevel={accessLevel}
                  showApplicationPrompt={showApplicationPrompt && accessLevel === 'limited' && currentVideoIndex === 0 && applicationInfo?.canApply}
                  onApplicationPromptClose={() => setShowApplicationPrompt(false)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center text-white">
                    <Play className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg">Video Loading...</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Video Controls */}
            <CardContent className="p-4 bg-muted/30 border-t">
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentVideoIndex(Math.max(0, currentVideoIndex - 1))}
                  disabled={currentVideoIndex === 0}
                  className="gap-1.5"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>

                <div className="text-sm text-muted-foreground">
                  Video {currentVideoIndex + 1} of {currentModuleVideos.length}
                </div>

                {(() => {
                  const nextIndex = currentVideoIndex + 1;
                  const isLastVideo = nextIndex >= currentModuleVideos.length;
                  const isLimitedAccess = accessLevel === 'limited' && currentVideoIndex === 0;

                  if (isLimitedAccess && applicationInfo?.canApply) {
                    return (
                      <Button asChild className="bg-gradient-to-r from-emerald-500 to-blue-500 hover:from-emerald-600 hover:to-blue-600 gap-1.5">
                        <Link href="/dashboard?view=applications&action=new">
                          Submit Application
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    );
                  }

                  if (isLimitedAccess && !applicationInfo?.canApply) {
                    return (
                      <Button asChild className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 gap-1.5">
                        <Link href="/dashboard">
                          Check Status
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    );
                  }

                  let canAccessNext = false;
                  if (completionConfirmed || user?.role === 'admin') {
                    canAccessNext = true;
                  } else if (accessLevel === 'full') {
                    const currentVideoProgress = getVideoProgress(currentVideo?.id || '');
                    const currentVideoCompleted = (currentVideoProgress as any)?.completed || false;
                    canAccessNext = currentVideoCompleted || isLastVideo;
                  }

                  return (
                    <Button
                      size="sm"
                      onClick={() => {
                        if (isLastVideo) return;
                        
                        if (!canAccessNext && accessLevel === 'full') {
                          showAlert({
                            title: "Access Restricted",
                            description: "Please complete the current video before proceeding to the next one.",
                            type: "warning"
                          });
                          return;
                        }
                        
                        if (canAccessNext) {
                          setCurrentVideoIndex(nextIndex);
                        }
                      }}
                      disabled={isLastVideo || (!canAccessNext && accessLevel !== 'full')}
                      className={cn(
                        "gap-1.5",
                        canAccessNext && !isLastVideo && "bg-gradient-to-r from-emerald-500 to-blue-500 hover:from-emerald-600 hover:to-blue-600"
                      )}
                      variant={canAccessNext && !isLastVideo ? "default" : "outline"}
                    >
                      {isLastVideo ? (
                        <>
                          Module Complete
                          <CheckCircle className="h-4 w-4" />
                        </>
                      ) : !canAccessNext && accessLevel === 'full' ? (
                        <>
                          Complete Current
                          <Clock className="h-4 w-4" />
                        </>
                      ) : !canAccessNext ? (
                        <>
                          Locked
                          <Lock className="h-4 w-4" />
                        </>
                      ) : (
                        <>
                          Next Video
                          <ChevronRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  );
                })()}
              </div>
            </CardContent>
          </Card>

          {/* Module Selection */}
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4">
              <h3 className="font-semibold text-foreground mb-3">Training Modules</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => { setCurrentModule('basics'); setCurrentVideoIndex(0); }}
                  className={cn(
                    "p-3 rounded-xl border-2 transition-all text-left",
                    currentModule === 'basics'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-border hover:border-muted-foreground/30'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={cn("w-2.5 h-2.5 rounded-full", currentModule === 'basics' ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
                    <h4 className="font-medium text-sm">Food Safety Basics</h4>
                  </div>
                  <p className="text-xs text-muted-foreground">14 essential training videos</p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {userProgress.filter(p => p.completed && foodSafetyBasicsVideos.some(v => v.id === p.videoId)).length} of 14 completed
                  </div>
                </button>

                <button
                  onClick={() => {
                    if (completionConfirmed || user?.role === 'admin' || accessLevel === 'full') {
                      setCurrentModule('hygiene');
                      setCurrentVideoIndex(0);
                    } else {
                      setShowApplicationPrompt(true);
                    }
                  }}
                  className={cn(
                    "p-3 rounded-xl border-2 transition-all text-left relative",
                    currentModule === 'hygiene'
                      ? 'border-blue-500 bg-blue-50'
                      : accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin'
                      ? 'border-border hover:border-yellow-300 opacity-75'
                      : 'border-border hover:border-muted-foreground/30'
                  )}
                >
                  {accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' && (
                    <div className="absolute top-2 right-2">
                      <div className="w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center">
                        <Lock className="h-2.5 w-2.5 text-white" />
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 mb-1">
                    <div className={cn("w-2.5 h-2.5 rounded-full", currentModule === 'hygiene' ? 'bg-blue-500' : 'bg-muted-foreground/30')} />
                    <h4 className="font-medium text-sm">Safety & Hygiene How-To's</h4>
                  </div>
                  <p className="text-xs text-muted-foreground">8 practical demonstration videos</p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {userProgress.filter(p => p.completed && safetyHygieneVideos.some(v => v.id === p.videoId)).length} of 8 completed
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          
          {/* Progress Overview */}
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm">Your Progress</h3>
                  <p className="text-xs text-muted-foreground">Module completion status</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600 mb-0.5">{Math.round(moduleProgress)}%</div>
                  <div className="text-xs text-muted-foreground">Current Module</div>
                </div>
                
                <div className="w-full bg-muted rounded-full h-1.5">
                  <motion.div
                    className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${moduleProgress}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-center text-xs">
                  <div>
                    <div className="font-semibold text-foreground">
                      {userProgress.filter(p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length}
                    </div>
                    <div className="text-muted-foreground">Completed</div>
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{currentModuleVideos.length}</div>
                    <div className="text-muted-foreground">Total Videos</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Application Status Cards */}
          {accessLevel === 'limited' && applicationInfo?.canApply && (
            <Card className="border-yellow-200 bg-yellow-50/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 bg-yellow-500 rounded-xl flex items-center justify-center">
                    <FileText className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-yellow-900 text-sm">Application Required</h3>
                    <p className="text-xs text-yellow-700">Submit to unlock full access</p>
                  </div>
                </div>
                
                <Button 
                  asChild
                  size="sm"
                  className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white"
                >
                  <Link href="/dashboard?view=applications&action=new">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Submit Application
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {accessLevel === 'limited' && !applicationInfo?.canApply && applicationInfo?.message && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center">
                    <Clock className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-blue-900 text-sm">Application Status</h3>
                    <p className="text-xs text-blue-700">Being processed</p>
                  </div>
                </div>
                <p className="text-xs text-blue-800 mb-3">{applicationInfo.message}</p>
              </CardContent>
            </Card>
          )}

          {completionConfirmed && (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 bg-green-500 rounded-xl flex items-center justify-center">
                    <Award className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-green-900 text-sm">Training Completed! 🎉</h3>
                    <p className="text-xs text-green-700">Rewatch any video</p>
                  </div>
                </div>
                
                <Button 
                  size="sm"
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  onClick={async () => {
                    try {
                      const currentUser = auth.currentUser;
                      if (currentUser) {
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
                      }
                    } catch (error) {
                      console.error('Certificate download error:', error);
                    }
                  }}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download Certificate
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Video List */}
          <Card className="border-border/50 shadow-sm overflow-hidden">
            <div className="p-3 border-b border-border/50">
              <h3 className="font-semibold text-foreground text-sm">Module Videos</h3>
              <p className="text-xs text-muted-foreground">{currentModuleVideos.length} videos in this module</p>
            </div>
            
            <div className="overflow-y-auto max-h-64">
              <div className="p-2 space-y-1">
                {currentModuleVideos.map((video, index) => {
                  const progress = getVideoProgress(video.id);
                  const isCompleted = (progress as any)?.completed || false;
                  const isCurrent = currentVideoIndex === index;
                  
                  let canAccess = false;
                  if (completionConfirmed || user?.role === 'admin') {
                    canAccess = true;
                  } else if (accessLevel === 'full') {
                    if (index === 0) {
                      canAccess = true;
                    } else {
                      const previousVideo = currentModuleVideos[index - 1];
                      const previousProgress = getVideoProgress(previousVideo.id);
                      canAccess = (previousProgress as any)?.completed || false;
                    }
                  } else {
                    canAccess = index === 0;
                  }

                  return (
                    <button
                      key={video.id}
                      onClick={() => {
                        if (canAccess) {
                          handleVideoClick(video.id, index);
                        } else if (accessLevel === 'full' && !canAccess) {
                          showAlert({
                            title: "Access Restricted",
                            description: "Please complete the previous video before accessing this one.",
                            type: "warning"
                          });
                        } else {
                          handleVideoClick(video.id, index);
                        }
                      }}
                      className={cn(
                        "w-full p-2.5 rounded-lg text-left transition-all",
                        isCurrent
                          ? 'bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200'
                          : canAccess
                          ? 'hover:bg-muted/50 border border-transparent hover:border-border'
                          : 'opacity-60 cursor-pointer border border-transparent hover:opacity-80'
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0",
                          isCompleted
                            ? 'bg-green-500 text-white'
                            : isCurrent
                            ? 'bg-gradient-to-r from-emerald-500 to-blue-500 text-white'
                            : canAccess
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-muted/50 text-muted-foreground/50'
                        )}>
                          {isCompleted ? '✓' : !canAccess ? '🔒' : index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{video.title}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
