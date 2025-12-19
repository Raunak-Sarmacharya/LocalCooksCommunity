import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight,
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
import VideoPlayer from './VideoPlayer';

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

interface MicrolearningModuleProps {
  userId?: string;
  onComplete?: () => void;
  className?: string;
}

// Module 1: Food Safety Basics (14 videos) - Actual titles and descriptions
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
    description: 'The practice of HACCP has its analysis and critical control points and gives you seven principles that helps you keeping your food safe. To make our work better, it is important that you follow all seven principles. Watch them in this video.',
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
    description: 'Let\'s start thinking about delivery of goods to your kitchen. An important part of food safety is choosing a good supplier that is following all the safety standards.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/5.%20Food%20Safety%20Deliveries.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-storage',
    title: 'Storage',
    description: 'Food safety also includes storage, because each product requires their own way of storaging. Find out more in this video.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/6.%20Food%20Safety%20Storage.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-illness-reporting',
    title: 'Preparation',
    description: 'It is time to wash your hands! Preparation time is important for food safety and so you must follow these steps really carefully.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/7.%20Food%20Safety%20Preparation.mp4',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-safety-plan',
    title: 'Regeneration',
    description: 'Sometimes you need to prepare food before the customer is ordering, so that they don\'t have to wait too long for their food. Learn here what steps we must take to keep this food safety.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/8.%20Food%20Safety%20Regeneration.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-pest-control',
    title: 'To Start',
    description: 'The care we followed in the preparation process must continue, because they way the dish is served and presented also needs food safety practices. Are you ready to start?',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/9.%20Food%20Safety%20To%20start.mp4',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-chemical-safety',
    title: 'After Service',
    description: 'After the service is finished we still need to take care of food safety practices. Learn more about it in this video.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/10.%20Food%20Safety%20After%20Service.mp4',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-fifo',
    title: 'Waste Removal',
    description: 'There is always a lot of waste we have after a service. This waste contains a lot of bacteria. Watch how you can best manage waste in this video.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/11.%20Food%20Safety%20Waste%20Removal.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-receiving',
    title: 'Cleaning and Maintenance',
    description: 'Following the steps in this video is very important and helps you to keep your kitchen clean. Learn more in this video.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/12.%20Food%20Safety%20Cleaning%20and%20Maintenance.mp4',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-cooling-reheating',
    title: 'Weekly Log Sheets',
    description: 'Every thing we see is very important and needs to be recorded. Make sure HACCP is in place and has been logged correctly.',
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

// Module 2: Safety and Hygiene How-To's (8 videos) - Actual titles and descriptions
const safetyHygieneVideos: VideoData[] = [
  {
    id: 'howto-handwashing',
    title: 'How to Wash Your Hands',
    description: 'In this video, we will take you through the steps to correctly and thoroughly wash your hands. Keep watching to learn more.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/1.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Wash%20Your%20Hands.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-sanitizing',
    title: 'How to clean a food preparation station',
    description: 'Discover the best ways to disinfect, degrease and more to boost health and safety in the kitchen workplace. Includes worksurfaces, sinks, appliances and unseen areas.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/2.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Food%20Preparation%20Su.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-thermometer',
    title: 'How to clean kitchen utensils',
    description: 'They\'re the tools of a professional chef\'s trade so keeping them safe and ready for use is a vital part of commercial-kitchen cleaning. A little effort can make a huge difference.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/3.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Culinary%20Utensil.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-cleaning-schedule',
    title: 'How to clean a stove',
    description: 'This expert checklist will provide brilliant results and easier kitchen management. Get rid of the likes of chip fat and leftover bits of burnt food.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/4.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Stove.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-equipment-cleaning',
    title: 'How to clean a kitchen floor',
    description: 'Try these straightforward cleaning tips. Discover the equipment you\'ll need, how to do the job safely and the right amount of time to scrub away dirt for.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/5.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Kitchen%20Floor.mp4',
    source: 'CFIA',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-uniform-care',
    title: 'How to clean a restaurant floor',
    description: 'Help create a fresh, welcoming front of house with simple skills such as figure-of-eight mopping. A gleaming floor can reassure diners they\'re eating somewhere that really cares about hygiene.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/6.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Restaurant%20Floor.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-wound-care',
    title: 'How to clean tables and chairs',
    description: 'Want to know the best techniques for cleaning up after customers and getting things ready for the next setting? Watch this short film.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/7.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20Tables%20and%20Chairs.mp4',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-inspection-prep',
    title: 'How to clean a washroom',
    description: 'Take responsibility for the cleanliness of even the smallest room in your restaurant. A guide to washing everything from sinks to baby-change tables thoroughly.',
    duration: '',
    url: 'https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev/8.%20Safety%20and%20Hygiene%20How-tos%20How%20to%20Clean%20a%20Washroom.mp4',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  }
];

// Combine all videos
const videos: VideoData[] = [...foodSafetyBasicsVideos, ...safetyHygieneVideos];

export default function MicrolearningModule({
  userId,
  onComplete,
  className = ""
}: MicrolearningModuleProps) {
  const { showAlert } = useCustomAlerts();
  const isPlayerFocused = className.includes('player-focused');
  const { user: firebaseUser } = useFirebaseAuth();
  
  // Check for session-based auth (for admin users)
  const { data: sessionUser } = useQuery({
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

  // Filter videos by current module
  const currentModuleVideos = videos.filter(video => video.module === currentModule);
  const currentVideo = currentModuleVideos[currentVideoIndex];
  const allVideosCompleted = userProgress.length === videos.length && 
    userProgress.every((p: any) => p.completed);
  const overallProgress = (userProgress.filter(p => p.completed).length / videos.length) * 100;

  // Debug log
  console.log('MicrolearningModule rendering:', {
    isLoading,
    applicationInfo,
    hasApprovedApplication,
    accessLevel,
    userProgress: userProgress.length,
    allVideosCompleted,
    completionConfirmed,
    isSubmitting,
    shouldShowCompletionCard: accessLevel === 'full' && allVideosCompleted && !completionConfirmed && !isSubmitting
  });

  useEffect(() => {
    loadUserProgress();
  }, [userId]);

  const loadUserProgress = async () => {
    try {
      if (!user) {
        console.error('No authenticated user found');
        return;
      }

      let response;
      if (user.authMethod === 'session') {
        // Admin session-based access
        const effectiveUserId = userId || user.id;
        response = await fetch(`/api/microlearning/progress/${effectiveUserId}`, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': effectiveUserId.toString()
          }
        });
      } else {
        // Firebase-based access
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.error('No authenticated Firebase user found');
          return;
        }
        
        const token = await currentUser.getIdToken();
        response = await fetch(`/api/firebase/microlearning/progress/${userId || user?.uid}`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
      }
      
      if (response.ok) {
        const data = await response.json();
        console.log('Progress data received:', data);
        
        // Filter out any old video IDs that don't match current video structure
        const currentVideoIds = videos.map(v => v.id);
        const filteredProgress = (data.progress || []).filter((p: any) => 
          currentVideoIds.includes(p.videoId)
        );
        
        console.log('Filtered progress (removing old video IDs):', {
          original: data.progress?.length || 0,
          filtered: filteredProgress.length,
          currentVideoIds,
          progressVideoIds: (data.progress || []).map((p: any) => p.videoId)
        });
        
        setUserProgress(filteredProgress);
        setCompletionConfirmed(data.confirmed || data.completionConfirmed || false);
        setAccessLevel(data.accessLevel || (user.role === 'admin' ? 'full' : 'limited'));
        setHasApprovedApplication(data.hasApprovedApplication || (user.role === 'admin'));
        setApplicationInfo(data.applicationInfo || null);
      } else {
        console.error('Failed to load progress:', response.status, response.statusText);
        // For admins, provide default full access even if API fails
        if (user.role === 'admin') {
          setAccessLevel('full');
          setHasApprovedApplication(true);
          setApplicationInfo({ message: 'Admin has full access to all training' });
        }
      }
    } catch (error) {
      console.error('Failed to load progress:', error);
      // For admins, provide default full access even if API fails
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
      if (!user) {
        console.error('No authenticated user found');
        return;
      }

      let response;
      if (user.authMethod === 'session') {
        // Admin session-based access
        const effectiveUserId = userId || user.id;
        response = await fetch('/api/microlearning/progress', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': effectiveUserId.toString()
          },
          body: JSON.stringify({
            userId: effectiveUserId,
            videoId,
            progress,
            completed,
            watchedPercentage,
            completedAt: completed ? new Date() : undefined
          })
        });
      } else {
        // Firebase-based access
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.error('No authenticated Firebase user found');
          return;
        }
        
        const token = await currentUser.getIdToken();
        response = await fetch('/api/firebase/microlearning/progress', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            userId: userId || user?.uid,
            videoId,
            progress,
            completed,
            watchedPercentage,
            completedAt: completed ? new Date() : undefined
          })
        });
      }

      if (response.ok) {
        // Update local state immediately for better UX
        setUserProgress(prev => {
          const filtered = (prev as any[]).filter((p: any) => p.videoId !== videoId);
          const existing = (prev as any[]).find((p: any) => p.videoId === videoId);
          
          // If explicitly setting to completed, use that. Otherwise preserve existing completion status
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
          
          console.log(`Progress updated for ${videoId}:`, updatedProgress);
          return [...filtered, updatedProgress];
        });
      } else {
        console.error('Failed to update progress:', response.status);
      }
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  };

  const handleVideoStart = (videoId: string) => {
    const existingProgress = userProgress.find(p => p.videoId === videoId);
    if (!existingProgress || (existingProgress.progress === 0 && !existingProgress.completed)) {
      // Only initialize progress if video hasn't been started AND isn't completed
      updateVideoProgress(videoId, 0, false, 0);
    }
    // If video is completed, user is re-watching - no need to update progress
  };

  const handleVideoProgress = (videoId: string, progress: number, watchedPercentage: number) => {
    // Only update if there's meaningful progress
    if (progress > 0) {
      const existingProgress = userProgress.find(p => p.videoId === videoId);
      const wasAlreadyCompleted = existingProgress?.completed || false;
      
      // If video was already completed, don't send completed: false which might reset it
      // Just update the progress without changing completion status
      updateVideoProgress(videoId, progress, wasAlreadyCompleted, watchedPercentage);
    }
  };

  const handleVideoComplete = (videoId: string) => {
    updateVideoProgress(videoId, 100, true, 100);
    
    // Show success message
    const video = videos.find(v => v.id === videoId);
    if (video) {
      console.log(`Module completed: ${video.title}`);
    }
    
    // Auto-advance logic - but prevent looping for limited access users
    const isInRewatchMode = completionConfirmed || user?.role === 'admin';
    const isLimitedAccessUser = accessLevel === 'limited';
    const isCompletingFirstVideo = currentVideoIndex === 0;
    
    if (!isInRewatchMode && !isLimitedAccessUser) {
      // Only auto-advance for users with full access
      setTimeout(() => {
        const nextIndex = currentVideoIndex + 1;
        const isLastModule = nextIndex >= currentModuleVideos.length;
        
        if (!isLastModule && accessLevel === 'full') {
          setCurrentVideoIndex(nextIndex);
        } else if (isLastModule && currentModule === 'basics') {
          // Check if all basics videos are completed to access hygiene module
          const allBasicsCompleted = foodSafetyBasicsVideos.every(basicVideo => 
            userProgress.find(p => p.videoId === basicVideo.id)?.completed || basicVideo.id === videoId
          );
          
          if (allBasicsCompleted) {
            setCurrentModule('hygiene');
            setCurrentVideoIndex(0);
          }
        }
      }, 2000); // 2 second delay to show completion message
    } else if (isLimitedAccessUser && isCompletingFirstVideo) {
      // For limited access users completing the sample video, show application prompt
      setTimeout(() => {
        setShowApplicationPrompt(true);
        console.log('Limited access user completed sample video - showing application prompt');
      }, 2000); // Show prompt after 2 seconds to let completion message display
    }
  };

  const confirmCompletion = async () => {
    if (!allVideosCompleted) return;
    
    setIsSubmitting(true);
    try {
      // Get Firebase token for authentication
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('No authenticated user found');
        showAlert({
          title: "Authentication Error",
          description: "Authentication error. Please refresh the page and try again.",
          type: "error"
        });
        return;
      }
      
      const token = await currentUser.getIdToken();
      
      // Submit completion to Firebase microlearning completion API
      const response = await fetch('/api/firebase/microlearning/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: userId || user?.uid,
          completionDate: new Date(),
          videoProgress: userProgress
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Completion confirmed successfully:', result);
        setCompletionConfirmed(true);
        
        // Reload user progress to ensure state is synchronized with server
        setTimeout(() => {
          loadUserProgress();
        }, 1000);
        
        onComplete?.();
      } else {
        // Handle non-200 responses
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to confirm completion:', errorData);
        
        if (response.status === 403 && errorData.requiresApproval) {
          // User doesn't have approved application
          showAlert({
            title: "Application Required",
            description: errorData.message || 'You need an approved application to complete certification. Please check your application status.',
            type: "warning"
          });
        } else if (response.status === 401) {
          // Authentication error
          showAlert({
            title: "Authentication Error",
            description: "Authentication error. Please refresh the page and try again.",
            type: "error"
          });
        } else {
          // Generic error
          showAlert({
            title: "Completion Error",
            description: errorData.message || 'Failed to confirm completion. Please try again.',
            type: "error"
          });
        }
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

  const videoProgressData = videos.map(video => {
    const progress = getVideoProgress(video.id);
    const progressData = {
      id: video.id,
      title: video.title,
      duration: video.duration,
      completed: (progress as any)?.completed || false,
      progress: (progress as any)?.progress || 0,
      completedAt: (progress as any)?.completedAt,
      startedAt: (progress as any)?.startedAt,
      certification: video.certification,
      source: video.source
    };
    
    return progressData;
  });

  // Calculate module-specific progress
  const moduleProgress = (userProgress.filter((p: any) => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length / currentModuleVideos.length) * 100;

  // Video navigation with proper unlock logic
  const handleVideoClick = (videoId: string, videoIndex: number) => {
    const targetVideo = currentModuleVideos[videoIndex];
    if (!targetVideo) return;

    // Access control logic
    let canAccess = false;
    
    if (completionConfirmed || user?.role === 'admin') {
      // Full certification completed OR admin - unrestricted access
      canAccess = true;
    } else if (accessLevel === 'full') {
      // Full access users can navigate freely 
      canAccess = true;
    } else if (accessLevel === 'limited') {
      // Limited access - only first video
      canAccess = videoIndex === 0;
    }

    if (canAccess) {
      setCurrentVideoIndex(videoIndex);
    } else if (accessLevel === 'limited') {
      // Show application prompt for limited users
      setShowApplicationPrompt(true);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-4"
        >
          <div className="w-16 h-16 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Play className="h-8 w-8 text-white" />
            </motion.div>
          </div>
          <h3 className="text-xl font-semibold text-slate-800">Loading Your Training</h3>
          <p className="text-slate-600">Preparing your personalized learning experience...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50">
      {/* Modern Header with Course Info */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-40"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-900">Food Safety Training</h1>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span>{currentModule === 'basics' ? 'Food Safety Basics' : 'Safety & Hygiene How-To\'s'}</span>
                  <Circle className="h-1 w-1 fill-current" />
                  <span>Video {currentVideoIndex + 1} of {currentModuleVideos.length}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Access Level Indicator */}
              <div className="hidden sm:flex items-center gap-2">
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

              {/* Progress Indicator */}
              <div className="hidden md:flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-900">{Math.round(moduleProgress)}%</div>
                  <div className="text-xs text-slate-600">Module Progress</div>
                </div>
                <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      completionConfirmed 
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                        : accessLevel === 'full'
                        ? 'bg-gradient-to-r from-emerald-500 to-blue-500'
                        : 'bg-gradient-to-r from-yellow-500 to-orange-500'
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${moduleProgress}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </div>


            </div>
          </div>
        </div>
      </motion.div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Completion Confirmation Section - Shows when all videos are completed but not yet confirmed */}
        {accessLevel === 'full' && allVideosCompleted && !completionConfirmed && !isSubmitting && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200 mb-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                <Award className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Training Complete! 🎉</h3>
                <p className="text-sm text-slate-600">Ready for certification</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <h4 className="font-semibold text-slate-900">Food Safety Basics</h4>
                </div>
                <p className="text-sm text-slate-600">14 training videos</p>
                <div className="mt-2 text-xs text-emerald-600 font-medium">
                  ✓ Complete
                </div>
              </div>
              
              <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <h4 className="font-semibold text-slate-900">Safety & Hygiene How-To's</h4>
                </div>
                <p className="text-sm text-slate-600">8 training videos</p>
                <div className="mt-2 text-xs text-blue-600 font-medium">
                  ✓ Complete
                </div>
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
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Main Content Area */}
          <div className="lg:col-span-3 space-y-6 order-1 lg:order-1">
            
            {/* Video Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-3xl overflow-hidden shadow-xl border border-slate-200"
            >
              {/* Video Header */}
              <div className="p-6 bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                    {currentVideoIndex + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-slate-900 mb-2 leading-tight">{currentVideo.title}</h2>
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                        HACCP-based
                      </Badge>
                      {accessLevel === 'limited' && currentVideoIndex === 0 && (
                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                          Free Preview
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-slate-600">
                        Required
                      </Badge>
                    </div>
                    <p className="text-slate-600 leading-relaxed">{currentVideo.description}</p>
                  </div>
                </div>
              </div>

              {/* Video Player */}
              <div className="aspect-video bg-black">
                {currentVideo.url ? (
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
              <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-200">
                {/* Mobile-first responsive layout */}
                <div className="space-y-4 sm:space-y-0">
                  {/* Progress indicator - full width on mobile */}
                  <div className="text-center sm:hidden">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full text-sm text-slate-600 border border-slate-200">
                      <Circle className="h-1.5 w-1.5 fill-current" />
                      <span className="font-medium">Video {currentVideoIndex + 1} of {currentModuleVideos.length}</span>
                    </div>
                  </div>
                  
                  {/* Controls layout */}
                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentVideoIndex(Math.max(0, currentVideoIndex - 1))}
                      disabled={currentVideoIndex === 0}
                      className="flex items-center gap-1.5 px-3 sm:px-4"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="hidden xs:inline">Previous</span>
                      <span className="xs:hidden">Prev</span>
                    </Button>

                    {/* Desktop progress indicator */}
                    <div className="hidden sm:flex items-center gap-2 text-sm text-slate-600">
                      <span>Video {currentVideoIndex + 1} of {currentModuleVideos.length}</span>
                    </div>

                    {(() => {
                      const nextIndex = currentVideoIndex + 1;
                      const isLastVideo = nextIndex >= currentModuleVideos.length;
                      const isLimitedAccess = accessLevel === 'limited' && currentVideoIndex === 0;

                    if (isLimitedAccess && applicationInfo?.canApply) {
                      return (
                        <Button asChild className="bg-gradient-to-r from-emerald-500 to-blue-500 hover:from-emerald-600 hover:to-blue-600">
                          <Link href="/apply">
                            Submit Application
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </Link>
                        </Button>
                      );
                    }

                    if (isLimitedAccess && !applicationInfo?.canApply) {
                      return (
                        <Button asChild className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600">
                          <Link href="/dashboard">
                            Check Status
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </Link>
                        </Button>
                      );
                    }

                    let canAccessNext = false;
                    if (completionConfirmed || user?.role === 'admin') {
                      canAccessNext = true;
                    } else if (accessLevel === 'full') {
                      // For full access users, require previous video completion for sequential access
                      const currentVideoProgress = getVideoProgress(currentVideo.id);
                      const currentVideoCompleted = (currentVideoProgress as any)?.completed || false;
                      
                      if (currentVideoCompleted || isLastVideo) {
                        canAccessNext = true;
                      } else {
                        canAccessNext = false;
                      }
                    }

                    return (
                      <Button
                        size="sm"
                        onClick={() => {
                          if (isLastVideo) return;
                          
                          if (!canAccessNext && accessLevel === 'full') {
                            // Show a message that they need to complete current video first
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
                        className={`flex items-center gap-1.5 px-3 sm:px-4 ${canAccessNext && !isLastVideo ? "bg-gradient-to-r from-emerald-500 to-blue-500 hover:from-emerald-600 hover:to-blue-600" : ""}`}
                        variant={canAccessNext && !isLastVideo ? "default" : "outline"}
                      >
                        {isLastVideo ? (
                          <>
                            <span className="hidden xs:inline">Module Complete</span>
                            <span className="xs:hidden">Complete</span>
                            <CheckCircle className="h-4 w-4" />
                          </>
                        ) : !canAccessNext && accessLevel === 'full' ? (
                          <>
                            <span className="hidden xs:inline">Complete Current Video</span>
                            <span className="xs:hidden">Complete Current</span>
                            <Clock className="h-4 w-4 hidden xs:inline" />
                          </>
                        ) : !canAccessNext ? (
                          <>
                            <span className="hidden xs:inline">Locked</span>
                            <span className="xs:hidden">🔒</span>
                            <Lock className="h-4 w-4 hidden xs:inline" />
                          </>
                        ) : (
                          <>
                            <span className="hidden xs:inline">Next Video</span>
                            <span className="xs:hidden">Next</span>
                            <ChevronRight className="h-4 w-4" />
                          </>
                        )}
                      </Button>
                    );
                  })()}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Module Selection */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200"
            >
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Training Modules</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => setCurrentModule('basics')}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    currentModule === 'basics'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-3 h-3 rounded-full ${currentModule === 'basics' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <h4 className="font-semibold text-slate-900">Food Safety Basics</h4>
                    </div>
                    <p className="text-sm text-slate-600">14 essential training videos</p>
                    <div className="mt-2 text-xs text-slate-500">
                      {userProgress.filter(p => p.completed && foodSafetyBasicsVideos.some(v => v.id === p.videoId)).length} of 14 completed
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    // Only allow module switching if user has full access or is admin/completed
                    if (completionConfirmed || user?.role === 'admin' || accessLevel === 'full') {
                      setCurrentModule('hygiene');
                    } else {
                      // Show application prompt for limited users
                      setShowApplicationPrompt(true);
                    }
                  }}
                  className={`p-4 rounded-xl border-2 transition-all relative ${
                    currentModule === 'hygiene'
                      ? 'border-blue-500 bg-blue-50'
                      : accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin'
                      ? 'border-slate-200 hover:border-yellow-300 opacity-75'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Lock indicator for limited access users */}
                  {accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' && (
                    <div className="absolute top-2 right-2">
                      <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                        <Lock className="h-3 w-3 text-white" />
                      </div>
                    </div>
                  )}
                  
                  <div className="text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-3 h-3 rounded-full ${currentModule === 'hygiene' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                      <h4 className={`font-semibold ${
                        accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' 
                          ? 'text-slate-600' 
                          : 'text-slate-900'
                      }`}>
                        Safety & Hygiene How-To's
                      </h4>
                      {accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' && (
                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs">
                          Locked
                        </Badge>
                      )}
                    </div>
                    <p className={`text-sm ${
                      accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' 
                        ? 'text-slate-500' 
                        : 'text-slate-600'
                    }`}>
                      8 practical demonstration videos
                    </p>
                    <div className={`mt-2 text-xs ${
                      accessLevel === 'limited' && !completionConfirmed && user?.role !== 'admin' 
                        ? 'text-slate-400' 
                        : 'text-slate-500'
                    }`}>
                      {userProgress.filter(p => p.completed && safetyHygieneVideos.some(v => v.id === p.videoId)).length} of 8 completed
                    </div>
                  </div>
                </button>
              </div>
            </motion.div>
          </div>

          {/* Enhanced Sidebar */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="lg:col-span-1 order-2 lg:order-2"
          >
            <div className="space-y-6">
              
              {/* Progress Overview */}
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Your Progress</h3>
                    <p className="text-sm text-slate-600">Module completion status</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-emerald-600 mb-1">{Math.round(moduleProgress)}%</div>
                    <div className="text-sm text-slate-600">Current Module</div>
                  </div>
                  
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <motion.div
                      className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${moduleProgress}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-center text-sm">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {userProgress.filter(p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length}
                      </div>
                      <div className="text-slate-600">Completed</div>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">{currentModuleVideos.length}</div>
                      <div className="text-slate-600">Total Videos</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Application Status - Detailed for Different States */}
              {/* Limited Access - Application Required (only show if user can apply) */}
              {accessLevel === 'limited' && applicationInfo?.canApply && (
                <div className="space-y-4">
                  {/* Detailed Application Status Card */}
                  <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-yellow-500 rounded-xl flex items-center justify-center">
                        <FileText className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">Application Required</h3>
                        <p className="text-sm text-slate-600">Submit to unlock full access</p>
                      </div>
                    </div>
                    
                    {applicationInfo?.message && (
                      <div className={`rounded-xl p-4 mb-4 ${
                        applicationInfo.hasPending 
                          ? 'bg-blue-50 border border-blue-200' 
                          : applicationInfo.hasRejected 
                          ? 'bg-red-50 border border-red-200'
                          : applicationInfo.hasCancelled
                          ? 'bg-gray-50 border border-gray-200'
                          : 'bg-yellow-50 border border-yellow-200'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          {applicationInfo.hasPending && <Clock className="h-4 w-4 text-blue-600" />}
                          {applicationInfo.hasRejected && <XCircle className="h-4 w-4 text-red-600" />}
                          {applicationInfo.hasCancelled && <XCircle className="h-4 w-4 text-gray-600" />}
                          {!applicationInfo.hasPending && !applicationInfo.hasRejected && !applicationInfo.hasCancelled && (
                            <FileText className="h-4 w-4 text-yellow-600" />
                          )}
                          <span className={`font-medium text-sm ${
                            applicationInfo.hasPending 
                              ? 'text-blue-800' 
                              : applicationInfo.hasRejected 
                              ? 'text-red-800'
                              : applicationInfo.hasCancelled
                              ? 'text-gray-800'
                              : 'text-yellow-800'
                          }`}>
                            {applicationInfo.hasPending 
                              ? 'Application Under Review' 
                              : applicationInfo.hasRejected 
                              ? 'Application Not Approved'
                              : applicationInfo.hasCancelled
                              ? 'Application Cancelled'
                              : 'Application Required'}
                          </span>
                        </div>
                        <p className={`text-sm ${
                          applicationInfo.hasPending 
                            ? 'text-blue-800' 
                            : applicationInfo.hasRejected 
                            ? 'text-red-800'
                            : applicationInfo.hasCancelled
                            ? 'text-gray-800'
                            : 'text-yellow-800'
                        }`}>
                          {applicationInfo.message}
                        </p>
                      </div>
                    )}
                    
                    <Button 
                      asChild
                      className={`w-full font-semibold ${
                        applicationInfo.hasRejected || applicationInfo.hasCancelled
                          ? 'bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600'
                          : 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600'
                      } text-white`}
                    >
                      <Link href="/apply">
                        <FileText className="h-4 w-4 mr-2" />
                        {applicationInfo.hasRejected || applicationInfo.hasCancelled
                          ? 'Submit New Application'
                          : applicationInfo.hasPending
                          ? 'View Application Status'
                          : 'Submit Application'}
                      </Link>
                    </Button>
                  </div>
                </div>
              )}

              {/* Limited Access - Application Status (for users with active applications) */}
              {accessLevel === 'limited' && !applicationInfo?.canApply && applicationInfo?.message && (
                <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                      <Clock className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">Application Status</h3>
                      <p className="text-sm text-slate-600">Your application is being processed</p>
                    </div>
                  </div>
                  
                  <div className={`rounded-xl p-4 mb-4 ${
                    applicationInfo.hasPending 
                      ? 'bg-blue-50 border border-blue-200' 
                      : 'bg-slate-50 border border-slate-200'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="h-4 w-4 text-blue-600" />
                      <span className="font-medium text-sm text-blue-800">
                        {applicationInfo.hasPending ? 'Application Under Review' : 'Application Submitted'}
                      </span>
                    </div>
                    <p className="text-sm text-blue-800">
                      {applicationInfo.message}
                    </p>
                  </div>
                  
                  <Button 
                    asChild
                    className="w-full font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white"
                  >
                    <Link href="/dashboard">
                      <FileText className="h-4 w-4 mr-2" />
                      Check Application Status
                    </Link>
                  </Button>
                </div>
              )}

              {/* Full Access Status for Approved Users */}
              {accessLevel === 'full' && !completionConfirmed && !allVideosCompleted && (
                <div className="bg-white rounded-2xl p-6 shadow-lg border border-emerald-200">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
                      <CheckCircle className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-emerald-900">Full Access Granted!</h3>
                      <p className="text-sm text-emerald-700">All videos unlocked</p>
                    </div>
                  </div>
                  
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <h4 className="font-medium text-emerald-900 mb-3 flex items-center gap-2">
                      <span className="text-green-600">🔓</span>
                      Your Access Includes:
                    </h4>
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-3 text-emerald-700">
                        <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm">Complete 22-video curriculum</span>
                      </div>
                      <div className="flex items-center gap-3 text-emerald-700">
                        <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm">Both training modules</span>
                      </div>
                      <div className="flex items-center gap-3 text-emerald-700">
                        <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm">Progress tracking & analytics</span>
                      </div>
                      <div className="flex items-center gap-3 text-emerald-700">
                        <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm">Official completion certificate</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}



              {/* Completion Status for Completed Users */}
              {completionConfirmed && (
                <div className="bg-white rounded-2xl p-6 shadow-lg border border-green-200">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
                      <Award className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-green-900">Training Completed! 🎉</h3>
                      <p className="text-sm text-green-700">You can rewatch any video</p>
                    </div>
                  </div>
                  
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-green-800 text-sm mb-3">
                      Congratulations! You've earned your Local Cooks certification. 
                      Feel free to rewatch any training content.
                    </p>
                    <Button 
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
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
                      <Download className="h-4 w-4 mr-2" />
                      Download Certificate
                    </Button>
                  </div>
                </div>
              )}

              {/* Compact Video List */}
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 max-h-96 overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                  <h3 className="font-semibold text-slate-900">Module Videos</h3>
                  <p className="text-sm text-slate-600">{currentModuleVideos.length} videos in this module</p>
                </div>
                
                <div className="overflow-y-auto max-h-80">
                  <div className="p-2 space-y-1">
                    {currentModuleVideos.map((video, index) => {
                      const progress = getVideoProgress(video.id);
                      const isCompleted = (progress as any)?.completed || false;
                      const isCurrent = currentVideoIndex === index;
                      
                      // Access control - enforce sequential completion for full access users
                      let canAccess = false;
                      if (completionConfirmed || user?.role === 'admin') {
                        canAccess = true;
                      } else if (accessLevel === 'full') {
                        // For full access, allow access to first video or if previous video is completed
                        if (index === 0) {
                          canAccess = true;
                        } else {
                          const previousVideo = currentModuleVideos[index - 1];
                          const previousProgress = getVideoProgress(previousVideo.id);
                          canAccess = (previousProgress as any)?.completed || false;
                        }
                      } else {
                        // Limited access only gets first video
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
                              return;
                            } else {
                              handleVideoClick(video.id, index); // Will trigger application prompt
                            }
                          }}
                          className={`w-full p-3 rounded-xl text-left transition-all ${
                            isCurrent
                              ? 'bg-gradient-to-r from-emerald-50 to-blue-50 border-2 border-emerald-200'
                              : canAccess
                              ? 'hover:bg-slate-50 border border-transparent hover:border-slate-200'
                              : accessLevel === 'full'
                              ? 'hover:bg-orange-50 border border-orange-200 cursor-pointer'
                              : 'opacity-60 cursor-pointer border border-slate-100 hover:opacity-80'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                              isCompleted
                                ? 'bg-green-500 text-white'
                                : isCurrent
                                ? 'bg-gradient-to-r from-emerald-500 to-blue-500 text-white'
                                : canAccess
                                ? 'bg-slate-300 text-slate-700'
                                : 'bg-slate-200 text-slate-400'
                            }`}>
                              {isCompleted ? '✓' : !canAccess ? '🔒' : index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{video.title}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>


    </div>
  );
} 