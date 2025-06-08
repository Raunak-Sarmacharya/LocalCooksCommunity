import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  Award,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Lock,
  RotateCcw,
  Shield,
  TrendingUp
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import CompletionTracker from './CompletionTracker';
import UnlockProgress from './UnlockProgress';
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
  userId?: number;
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
    url: 'https://streamable.com/e/2f5k73?loop=0',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-allergen-awareness',
    title: 'Basic Conditions of HACCP',
    description: 'The practice of HACCP has its analysis and critical control points and gives you seven principles that helps you keeping your food safe. To make our work better, it is important that you follow all seven principles. Watch them in this video.',
    duration: '',
    url: 'https://streamable.com/e/5wweiz?loop=0',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-cooking-temps',
    title: 'Reducing Complexity',
    description: 'Learn how to simplify the food processes in your kitchen.',
    duration: '',
    url: 'https://streamable.com/e/b1siq0?loop=0',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-temperature-danger',
    title: 'Personal Hygiene',
    description: 'It is very important that all employees follow the rules of personal hygiene. Learn how you can avoid bad bacteria coming into your kitchen.',
    duration: '',
    url: 'https://streamable.com/e/wqfjm5?loop=0',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-personal-hygiene',
    title: 'Deliveries',
    description: 'Let\'s start thinking about delivery of goods to your kitchen. An important part of food safety is choosing a good supplier that is following all the safety standards.',
    duration: '',
    url: 'https://streamable.com/e/8wmj23?loop=0',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-storage',
    title: 'Storage',
    description: 'Food safety also includes storage, because each product requires their own way of storaging. Find out more in this video.',
    duration: '',
    url: 'https://streamable.com/e/wr0jb8?loop=0',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-illness-reporting',
    title: 'Preparation',
    description: 'It is time to wash your hands! Preparation time is important for food safety and so you must follow these steps really carefully.',
    duration: '',
    url: 'https://streamable.com/e/o3hwlj?loop=0',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-food-safety-plan',
    title: 'Regeneration',
    description: 'Sometimes you need to prepare food before the customer is ordering, so that they don\'t have to wait too long for their food. Learn here what steps we must take to keep this food safety.',
    duration: '',
    url: 'https://streamable.com/e/rv0ka9?loop=0',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-pest-control',
    title: 'To Start',
    description: 'The care we followed in the preparation process must continue, because they way the dish is served and presented also needs food safety practices. Are you ready to start?',
    duration: '',
    url: 'https://streamable.com/e/do2odt?loop=0',
    source: 'NL Health',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-chemical-safety',
    title: 'After Service',
    description: 'After the service is finished we still need to take care of food safety practices. Learn more about it in this video.',
    duration: '',
    url: 'https://streamable.com/e/shprtw?loop=0',
    source: 'CFIA',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-fifo',
    title: 'Waste Removal',
    description: 'There is always a lot of waste we have after a service. This waste contains a lot of bacteria. Watch how you can best manage waste in this video.',
    duration: '',
    url: 'https://streamable.com/e/3zueet?loop=0',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-receiving',
    title: 'Cleaning and Maintenance',
    description: 'Following the steps in this video is very important and helps you to keep your kitchen clean. Learn more in this video.',
    duration: '',
    url: 'https://streamable.com/e/dxu2su?loop=0',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-cooling-reheating',
    title: 'Weekly Log Sheets',
    description: 'Every thing we see is very important and needs to be recorded. Make sure HACCP is in place and has been logged correctly.',
    duration: '',
    url: 'https://streamable.com/e/4axpdy?loop=0',
    source: 'Health Canada',
    certification: 'Food Safety Basics',
    module: 'basics'
  },
  {
    id: 'basics-thawing',
    title: 'Wrap Up',
    description: 'We are almost at the end, well done!',
    duration: '',
    url: 'https://streamable.com/e/d691km?loop=0',
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
    url: 'https://streamable.com/e/4isx5j?loop=0',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-sanitizing',
    title: 'How to clean a food preparation station',
    description: 'Discover the best ways to disinfect, degrease and more to boost health and safety in the kitchen workplace. Includes worksurfaces, sinks, appliances and unseen areas.',
    duration: '',
    url: 'https://streamable.com/e/qo69ox?loop=0',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-thermometer',
    title: 'How to clean kitchen utensils',
    description: 'They\'re the tools of a professional chef\'s trade so keeping them safe and ready for use is a vital part of commercial-kitchen cleaning. A little effort can make a huge difference.',
    duration: '',
    url: 'https://streamable.com/e/8rvz9d?loop=0',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-cleaning-schedule',
    title: 'How to clean a stove',
    description: 'This expert checklist will provide brilliant results and easier kitchen management. Get rid of the likes of chip fat and leftover bits of burnt food.',
    duration: '',
    url: 'https://streamable.com/e/vxqj7b?loop=0',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-equipment-cleaning',
    title: 'How to clean a kitchen floor',
    description: 'Try these straightforward cleaning tips. Discover the equipment you\'ll need, how to do the job safely and the right amount of time to scrub away dirt for.',
    duration: '',
    url: 'https://streamable.com/e/akb6pq?loop=0',
    source: 'CFIA',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-uniform-care',
    title: 'How to clean a restaurant floor',
    description: 'Help create a fresh, welcoming front of house with simple skills such as figure-of-eight mopping. A gleaming floor can reassure diners they\'re eating somewhere that really cares about hygiene.',
    duration: '',
    url: 'https://streamable.com/e/arbfdo?loop=0',
    source: 'NL Health',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-wound-care',
    title: 'How to clean tables and chairs',
    description: 'Want to know the best techniques for cleaning up after customers and getting things ready for the next setting? Watch this short film.',
    duration: '',
    url: 'https://streamable.com/e/1gjyiq?loop=0',
    source: 'Health Canada',
    certification: 'Safety & Hygiene How-To',
    module: 'hygiene'
  },
  {
    id: 'howto-inspection-prep',
    title: 'How to clean a washroom',
    description: 'Take responsibility for the cleanliness of even the smallest room in your restaurant. A guide to washing everything from sinks to baby-change tables thoroughly.',
    duration: '',
    url: 'https://streamable.com/e/r0l74p?loop=0',
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
  const { user } = useAuth();
  const [userProgress, setUserProgress] = useState<UserProgress[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [currentModule, setCurrentModule] = useState<'basics' | 'hygiene'>('basics');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const [accessLevel, setAccessLevel] = useState<'full' | 'limited'>('limited');
  const [hasApprovedApplication, setHasApprovedApplication] = useState(false);
  const [applicationInfo, setApplicationInfo] = useState<any>(null);

  // Filter videos by current module
  const currentModuleVideos = videos.filter(video => video.module === currentModule);
  const currentVideo = currentModuleVideos[currentVideoIndex];
  const allVideosCompleted = userProgress.length === videos.length && 
    userProgress.every(p => p.completed);
  const overallProgress = (userProgress.filter(p => p.completed).length / videos.length) * 100;

  // Debug log
  console.log('MicrolearningModule rendering:', {
    isLoading,
    applicationInfo,
    hasApprovedApplication,
    accessLevel,
    userProgress: userProgress.length
  });

  useEffect(() => {
    loadUserProgress();
  }, [userId]);

  const loadUserProgress = async () => {
    try {
      const response = await fetch(`/api/microlearning/progress/${userId || user?.id}`, {
        credentials: 'include',
        headers: {
          'X-User-ID': String(userId || user?.id || '')
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Progress data received:', data);
        
        // Filter out any old video IDs that don't match current video structure
        const currentVideoIds = videos.map(v => v.id);
        const filteredProgress = (data.progress || []).filter((p: UserProgress) => 
          currentVideoIds.includes(p.videoId)
        );
        
        console.log('Filtered progress (removing old video IDs):', {
          original: data.progress?.length || 0,
          filtered: filteredProgress.length,
          currentVideoIds,
          progressVideoIds: (data.progress || []).map((p: UserProgress) => p.videoId)
        });
        
        setUserProgress(filteredProgress);
        setCompletionConfirmed(data.completionConfirmed || false);
        setAccessLevel(data.accessLevel || 'limited');
        setHasApprovedApplication(data.hasApprovedApplication || false);
        setApplicationInfo(data.applicationInfo || null);
      } else {
        console.error('Failed to load progress:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to load progress:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateVideoProgress = async (videoId: string, progress: number, completed: boolean = false, watchedPercentage: number = 0) => {
    try {
      const response = await fetch('/api/microlearning/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': String(userId || user?.id || '')
        },
        body: JSON.stringify({
          userId: userId || user?.id,
          videoId,
          progress,
          completed,
          watchedPercentage,
          completedAt: completed ? new Date() : undefined
        }),
        credentials: 'include'
      });

      if (response.ok) {
        // Update local state immediately for better UX
        setUserProgress(prev => {
          const filtered = prev.filter(p => p.videoId !== videoId);
          const existing = prev.find(p => p.videoId === videoId);
          
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
    
    // Auto-advance to next video after a short delay
    setTimeout(() => {
      const nextIndex = currentVideoIndex + 1;
      const isLastModule = nextIndex >= currentModuleVideos.length;
      
      if (!isLastModule && accessLevel === 'full') {
        setCurrentVideoIndex(nextIndex);
      } else if (isLastModule && currentModule === 'basics') {
        // Check if all basics videos are completed to unlock hygiene module
        const allBasicsCompleted = foodSafetyBasicsVideos.every(basicVideo => 
          userProgress.find(p => p.videoId === basicVideo.id)?.completed || basicVideo.id === videoId
        );
        
        if (allBasicsCompleted) {
          setCurrentModule('hygiene');
          setCurrentVideoIndex(0);
        }
      }
    }, 2000); // 2 second delay to show completion message
  };

  const confirmCompletion = async () => {
    if (!allVideosCompleted) return;
    
    setIsSubmitting(true);
    try {
      // Submit completion to Always Food Safe API
      const response = await fetch('/api/microlearning/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': String(userId || user?.id || '')
        },
        body: JSON.stringify({
          userId: userId || user?.id,
          completionDate: new Date(),
          videoProgress: userProgress
        }),
        credentials: 'include'
      });

      if (response.ok) {
        setCompletionConfirmed(true);
        onComplete?.();
      }
    } catch (error) {
      console.error('Failed to confirm completion:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getVideoProgress = (videoId: string) => {
    return userProgress.find(p => p.videoId === videoId);
  };

  const videoProgressData = videos.map(video => {
    const progress = getVideoProgress(video.id);
    const progressData = {
      id: video.id,
      title: video.title,
      duration: video.duration,
      completed: progress?.completed || false,
      progress: progress?.progress || 0,
      completedAt: progress?.completedAt,
      startedAt: progress?.startedAt,
      certification: video.certification,
      source: video.source
    };
    
    return progressData;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">Loading training modules...</span>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br from-gray-50 to-white overflow-x-hidden ${className}`}>
      <div className="w-full">
        {/* Modern Header - Fixed container */}
        <div className="w-full bg-white/80 backdrop-blur-sm border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="text-center space-y-6"
            >
                                  <div className="inline-flex items-center gap-3 px-4 py-2 bg-primary/10 rounded-full text-primary font-medium text-sm">
                <Shield className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">Food Safety Training Modules</span>
                {completionConfirmed && (
                  <>
                    <span className="w-1 h-1 bg-primary/60 rounded-full flex-shrink-0"></span>
                    <div className="flex items-center gap-1 text-green-600">
                      <Award className="h-3 w-3 flex-shrink-0" />
                      <span className="text-xs">Completed</span>
                    </div>
                  </>
                )}
              </div>
              
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 leading-tight px-4">
                Food Safety Training
                <span className="block text-primary">Two Essential Modules</span>
              </h1>
              
              <p className="text-base sm:text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed px-4">
                Our streamlined video training features two comprehensive modules designed for efficient learning. Module 1 covers Food Safety Basics (14 videos), while Module 2 focuses on Safety and Hygiene How-To's (8 videos) with shorter demo videos for practical application.
              </p>

              <div className="max-w-2xl mx-auto px-4">
                                  <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                  <div className="text-center space-y-4">
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <span className="text-2xl font-bold text-primary">2</span>
                      <span className="text-gray-600">Comprehensive Training Modules</span>
                    </div>
                    <div className="flex items-center justify-center gap-4 text-sm text-gray-600">
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-semibold text-primary">14</span>
                        <span>Food Safety Basics</span>
                      </div>
                      <div className="w-px h-8 bg-gray-300"></div>
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-semibold text-primary">8</span>
                        <span>Safety & Hygiene</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span>Short Demo Videos</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        <span>Two Module Structure</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                        <span>Quick Testing</span>
                      </div>
                    </div>

                    <p className="text-sm font-medium text-primary border-t border-gray-100 pt-4">
                      Strengthen your knowledge. Meet certification standards. Grow your culinary business.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Clean notification system */}
        <div className="w-full">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
            
            {/* Rewatch Mode Notification */}
            {completionConfirmed && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-lg border p-4 bg-green-50 border-green-200"
              >
                <div className="flex items-start gap-3">
                  <div className="p-1 rounded-full bg-green-100 flex-shrink-0">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                      <RotateCcw className="h-4 w-4" />
                      Rewatch Mode Active - Full Access Granted
                    </p>
                    <p className="text-xs text-green-700 mt-1">
                      🎉 Congratulations! You've completed your certification. You can now access and rewatch any video in any order.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Application Status Notification */}
            {applicationInfo && !completionConfirmed && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className={`rounded-lg border p-4 ${
                  applicationInfo.hasRejected || applicationInfo.hasCancelled
                    ? 'bg-orange-50 border-orange-200'
                    : applicationInfo.hasPending
                    ? 'bg-blue-50 border-blue-200'
                    : !hasApprovedApplication
                    ? 'bg-yellow-50 border-yellow-200'
                    : 'bg-green-50 border-green-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-1 rounded-full flex-shrink-0 ${
                    applicationInfo.hasRejected || applicationInfo.hasCancelled
                      ? 'bg-orange-100'
                      : applicationInfo.hasPending
                      ? 'bg-blue-100'
                      : !hasApprovedApplication
                      ? 'bg-yellow-100'
                      : 'bg-green-100'
                  }`}>
                    {applicationInfo.hasRejected || applicationInfo.hasCancelled ? (
                      <AlertCircle className="h-4 w-4 text-orange-600" />
                    ) : applicationInfo.hasPending ? (
                      <Clock className="h-4 w-4 text-blue-600" />
                    ) : !hasApprovedApplication ? (
                      <FileText className="h-4 w-4 text-yellow-600" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      applicationInfo.hasRejected || applicationInfo.hasCancelled
                        ? 'text-orange-800'
                        : applicationInfo.hasPending
                        ? 'text-blue-800'
                        : !hasApprovedApplication
                        ? 'text-yellow-800'
                        : 'text-green-800'
                    }`}>
                      {applicationInfo.message}
                    </p>
                    {applicationInfo.canApply && (
                      <div className="mt-2">
                        <button
                          onClick={() => window.location.href = '/apply'}
                          className="text-xs px-3 py-1 bg-primary text-white rounded-full hover:bg-primary/90 transition-colors"
                        >
                          Submit Application
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Demo Notice - Subtle */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="bg-white/80 backdrop-blur-sm border border-orange-200/50 rounded-xl p-4"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 text-orange-700">
                <div className="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0 mt-1.5 sm:mt-0"></div>
                <span className="text-sm font-medium">Demo Environment</span>
                <span className="text-sm opacity-75 break-words">Sample videos for demonstration purposes</span>
              </div>
            </motion.div>

            {/* Access Level Notification - Clean & Modern */}
            {accessLevel === 'limited' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100"
              >
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-yellow-600 text-lg">🔒</span>
                  </div>
                  <div className="flex-1 space-y-3 min-w-0">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">
                        Free Preview Available
                      </h3>
                      <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
                        Experience Module 1 for free. Complete your application to unlock all 10 comprehensive modules for skillpass.nl preparation. Re-watch any completed module anytime as a refresher.
                      </p>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                      <div className="flex items-center gap-2 text-sm text-green-700">
                        <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                        <span className="whitespace-nowrap">Module 1 Available</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <div className="w-2 h-2 bg-gray-300 rounded-full flex-shrink-0"></div>
                        <span className="whitespace-nowrap">9 More Modules</span>
                      </div>
                    </div>

                    <Button
                      asChild
                      size="sm"
                      className="bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 w-full sm:w-auto"
                    >
                      <Link href="/apply">
                        Unlock Full Training
                        <ArrowRight className="h-4 w-4 ml-2 flex-shrink-0" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="w-full">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            
            {/* Module Selector */}
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 mb-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Select Training Module</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => { 
                      // Always allow switching to basics module
                      setCurrentModule('basics'); 
                      setCurrentVideoIndex(0); 
                    }}
                    disabled={false}
                                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        currentModule === 'basics' 
                          ? 'bg-primary text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    Food Safety Basics (14)
                  </button>
                  <button
                    onClick={() => { 
                      // Module access logic:
                      // 1. If certification completed - unrestricted access to both modules
                      // 2. If full access but not completed - must complete all basics videos first
                      // 3. If limited access - no access to hygiene module
                      const allBasicsCompleted = foodSafetyBasicsVideos.every(video => 
                        userProgress.find(p => p.videoId === video.id)?.completed || false
                      );
                      
                      if (completionConfirmed || (accessLevel === 'full' && allBasicsCompleted)) {
                        setCurrentModule('hygiene'); 
                        setCurrentVideoIndex(0); 
                      }
                    }}
                    disabled={accessLevel === 'limited' || (!completionConfirmed && !foodSafetyBasicsVideos.every(video => 
                      userProgress.find(p => p.videoId === video.id)?.completed || false
                    ))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      currentModule === 'hygiene' 
                        ? 'bg-primary text-white' 
                        : (accessLevel === 'limited' || (!completionConfirmed && !foodSafetyBasicsVideos.every(video => 
                            userProgress.find(p => p.videoId === video.id)?.completed || false
                          )))
                        ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    title={
                      completionConfirmed
                        ? 'Access granted - Rewatch any module freely'
                        : accessLevel === 'limited' 
                        ? 'Complete your application to access this module'
                        : !foodSafetyBasicsVideos.every(video => 
                            userProgress.find(p => p.videoId === video.id)?.completed || false
                          )
                        ? 'Complete all Food Safety Basics videos first'
                        : ''
                    }
                  >
                    Safety & Hygiene How-To's (8)
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <div className="font-medium text-blue-900">
                    {currentModule === 'basics' ? 'Food Safety Basics' : 'Safety & Hygiene How-To\'s'}
                  </div>
                  <div className="text-blue-700 text-xs mt-1">
                    {currentModule === 'basics' 
                      ? 'Essential knowledge and principles'
                      : 'Step-by-step practical demonstrations'
                    }
                  </div>
                </div>
                <div className="bg-green-50 p-3 rounded-lg">
                  <div className="font-medium text-green-900">Module Progress</div>
                  <div className="text-green-700 text-xs mt-1">
                    {userProgress.filter(p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length} of {currentModuleVideos.length} completed
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
              {/* Video Player Section - Modern Design */}
              <div className="xl:col-span-2 order-2 xl:order-1">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-4 lg:space-y-6"
                >
                  {/* Video Header */}
                  <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100">
                    <div className="flex flex-col gap-4 mb-4">
                      <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary rounded-xl flex items-center justify-center text-white font-semibold text-base sm:text-lg flex-shrink-0">
                          {currentVideoIndex + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 leading-tight break-words">{currentVideo.title}</h2>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {!currentVideo.url.includes('streamable.com/e/') && (
                              <>
                                <span className="text-sm text-gray-600 whitespace-nowrap">{currentVideo.duration}</span>
                                <span className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></span>
                              </>
                            )}
                            <span className="text-sm text-gray-600 break-all">{currentVideo.source}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {accessLevel === 'limited' && currentVideoIndex === 0 && (
                          <div className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap">
                            Free Preview
                          </div>
                        )}
                        <div className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap">
                          Required
                        </div>
                      </div>
                    </div>
                    <p className="text-sm sm:text-base text-gray-600 leading-relaxed break-words">{currentVideo.description}</p>
                  </div>

                  {/* Video Player */}
                  <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
                    <div className="aspect-video w-full">
                      {currentVideo.url ? (
                        <VideoPlayer
                          videoUrl={currentVideo.url}
                          title={currentVideo.title}
                          onStart={() => handleVideoStart(currentVideo.id)}
                          onProgress={(progress, watchedPercentage) => handleVideoProgress(currentVideo.id, progress, watchedPercentage)}
                          onComplete={() => handleVideoComplete(currentVideo.id)}
                          isCompleted={getVideoProgress(currentVideo.id)?.completed || false}
                          isRewatching={completionConfirmed || ((getVideoProgress(currentVideo.id)?.completed || false) && (getVideoProgress(currentVideo.id)?.progress || 0) < 100)}
                          requireFullWatch={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-100">
                          <div className="text-center">
                            <div className="text-gray-400 mb-2">📹</div>
                            <p className="text-gray-600">Video player will load here</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Modern Video Navigation */}
                    <div className="p-4 sm:p-6 bg-gray-50/50 border-t">
                      <div className="flex flex-col gap-3 sm:gap-4">
                        <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                          <span className="whitespace-nowrap">Video {currentVideoIndex + 1} of {currentModuleVideos.length}</span>
                          <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                          <span className="whitespace-nowrap">{currentModule === 'basics' ? 'Food Safety Basics' : 'Safety & Hygiene How-To\'s'}</span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCurrentVideoIndex(Math.max(0, currentVideoIndex - 1))}
                            disabled={currentVideoIndex === 0}
                            className="flex items-center justify-center gap-2 w-full"
                          >
                            <ChevronLeft className="h-4 w-4 flex-shrink-0" />
                            <span className="truncate">Previous</span>
                          </Button>

                          {(() => {
                            const nextIndex = currentVideoIndex + 1;
                            const isLastModule = nextIndex >= currentModuleVideos.length;
                            const isLimitedAccess = accessLevel === 'limited' && currentVideoIndex === 0;
                            const currentProgress = getVideoProgress(currentVideo.id);
                            
                            // Check completion status explicitly - this should be true if video was ever completed
                            const currentCompleted = currentProgress?.completed || false;
                            
                            // Navigation logic:
                            // 1. If certification completed - unrestricted navigation
                            // 2. If full access but not completed - can proceed only if current video is completed
                            // 3. If limited access - no navigation beyond first video
                            let nextCanAccess = false;
                            
                            if (completionConfirmed) {
                              // Unrestricted navigation for completed users
                              nextCanAccess = true;
                            } else if (accessLevel === 'full') {
                              // Sequential navigation - current video must be completed
                              nextCanAccess = currentCompleted;
                            } else {
                              // Limited access - no navigation
                              nextCanAccess = false;
                            }
                            
                            const isNextLocked = !isLastModule && (!nextCanAccess || isLimitedAccess);

                            return (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => !isLastModule && nextCanAccess && setCurrentVideoIndex(nextIndex)}
                                disabled={isLastModule || isNextLocked}
                                className="flex items-center justify-center gap-2 w-full"
                                title={
                                  isLastModule ? "This is the last module" :
                                  isLimitedAccess ? "Complete your application to unlock more modules" :
                                  !currentCompleted ? "Complete this module to unlock the next one" :
                                  undefined
                                }
                              >
                                {isLimitedAccess ? (
                                  <>
                                    <Lock className="h-4 w-4 flex-shrink-0" />
                                    <span className="truncate">Locked</span>
                                  </>
                                ) : !currentCompleted && accessLevel === 'full' ? (
                                  <>
                                    <span className="truncate">Complete First</span>
                                    <ChevronRight className="h-4 w-4 flex-shrink-0" />
                                  </>
                                ) : (
                                  <>
                                    <span className="truncate">Next</span>
                                    <ChevronRight className="h-4 w-4 flex-shrink-0" />
                                  </>
                                )}
                              </Button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Modern Module Grid */}
                <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {currentModule === 'basics' ? 'Food Safety Basics' : 'Safety & Hygiene How-To\'s'}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {accessLevel === 'limited' && (
                        <div className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs sm:text-sm font-medium">
                          Limited Access
                        </div>
                      )}
                      <div className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs sm:text-sm font-medium">
                        {userProgress.filter(p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length} / {currentModuleVideos.length} Completed
                      </div>
                    </div>
                  </div>

                  {/* Current Module Progress */}
                  <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-blue-900">
                        {currentModule === 'basics' ? 'Food Safety Basics' : 'Safety & Hygiene How-To\'s'} Progress
                      </span>
                      <span className="text-sm font-bold text-blue-900">
                        {Math.round((userProgress.filter(p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length / currentModuleVideos.length) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 mb-3">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${(userProgress.filter(p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length / currentModuleVideos.length) * 100}%` }}
                      ></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-xs text-blue-700">
                      <div className="text-center">
                        <div className="font-semibold">{userProgress.filter(p => p.completed && currentModuleVideos.some(v => v.id === p.videoId)).length}</div>
                        <div>Videos Completed</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold">
                          {currentModuleVideos.length > 0 && userProgress.filter(p => currentModuleVideos.some(v => v.id === p.videoId)).length > 0
                            ? Math.round(userProgress
                                .filter(p => currentModuleVideos.some(v => v.id === p.videoId))
                                .reduce((acc, p) => acc + (p.watchedPercentage || 0), 0) / currentModuleVideos.length)
                            : 0}%
                        </div>
                        <div>Average Watch Time</div>
                      </div>
                    </div>
                  </div>

                  {/* Current Module Video Grid */}
                  <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-5 gap-2 sm:gap-3 mb-6">
                    {currentModuleVideos.map((video, index) => {
                      const progress = getVideoProgress(video.id);
                      const isLocked = accessLevel === 'limited' && index > 0;
                      const isCurrent = currentVideoIndex === index;
                      const watchedPercentage = progress?.watchedPercentage || 0;
                      const isCompleted = progress?.completed || false;
                      
                      // Debug logging for current video
                      if (isCurrent && progress) {
                        console.log(`Current video ${video.id} progress:`, progress);
                      }
                      
                      // Access control logic:
                      // 1. If user has completed certification - unlimited access to all videos for rewatching
                      // 2. If user has full access but not completed - sequential learning (complete previous videos first)
                      // 3. If user has limited access - only first video
                      let canAccess = false;
                      
                      if (completionConfirmed) {
                        // Full certification completed - unrestricted access to all videos for rewatching
                        canAccess = true;
                      } else if (accessLevel === 'full') {
                        // Sequential learning for users with full access but not yet completed
                        const previousCompleted = index === 0 || userProgress.find(p => p.videoId === currentModuleVideos[index - 1].id)?.completed || false;
                        canAccess = index === 0 || previousCompleted;
                      } else {
                        // Limited access - only first video
                        canAccess = index === 0;
                      }
                      
                      const isAccessLocked = !canAccess;
                      
                      return (
                        <button
                          key={video.id}
                          onClick={() => canAccess && setCurrentVideoIndex(index)}
                          disabled={isAccessLocked}
                          className={`relative p-2 sm:p-3 rounded-xl border transition-all duration-200 ${
                            isCurrent
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : isAccessLocked
                              ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                              : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                          }`}
                        >
                          {/* Progress Ring */}
                          <div className="absolute -top-1 -right-1 w-6 h-6 sm:w-7 sm:h-7">
                            {isCompleted ? (
                              <div className="w-full h-full bg-green-500 rounded-full flex items-center justify-center">
                                <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 text-white" />
                              </div>
                            ) : isAccessLocked ? (
                              <div className="w-full h-full bg-gray-400 rounded-full flex items-center justify-center">
                                <Lock className="h-3 w-3 sm:h-4 sm:w-4 text-white" />
                              </div>
                            ) : watchedPercentage > 0 ? (
                              <div className="relative w-full h-full">
                                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 24 24">
                                  <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    fill="none"
                                    stroke="#e5e7eb"
                                    strokeWidth="2"
                                  />
                                  <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    fill="none"
                                    stroke="#3b82f6"
                                    strokeWidth="2"
                                    strokeDasharray={`${2 * Math.PI * 10}`}
                                    strokeDashoffset={`${2 * Math.PI * 10 * (1 - watchedPercentage / 100)}`}
                                    className="transition-all duration-300"
                                  />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-xs font-medium text-blue-600">
                                    {Math.round(watchedPercentage)}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          
                          <div className="text-center">
                            <div className={`w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-1 sm:mb-2 rounded-lg flex items-center justify-center text-xs sm:text-sm font-semibold ${
                              isCurrent
                                ? 'bg-primary text-white'
                                : isAccessLocked
                                ? 'bg-gray-300 text-gray-500'
                                : isCompleted
                                ? 'bg-green-100 text-green-700'
                                : watchedPercentage > 0
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {index + 1}
                            </div>
                            <div className="text-xs text-gray-600 hidden sm:block">
                              Module {index + 1}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Current Module Details */}
                  <div className="border-t pt-4 sm:pt-6">
                    <div className="space-y-3">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-start gap-2">
                          <h4 className="font-medium text-gray-900 flex-1 leading-tight break-words">
                            {currentVideo.title}
                          </h4>
                          {accessLevel === 'limited' && currentVideoIndex > 0 && (
                            <span className="text-yellow-600 flex-shrink-0">🔒</span>
                          )}
                        </div>
                        
                        <div className="px-3 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-medium text-center break-words">
                          {currentVideo.certification}
                        </div>
                        
                        <p className="text-sm text-gray-600 leading-relaxed break-words">
                          {currentVideo.description}
                        </p>
                      </div>
                      
                      {accessLevel === 'limited' && currentVideoIndex > 0 && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Lock className="h-3 w-3 sm:h-4 sm:w-4 text-yellow-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-yellow-800 font-medium text-sm">
                                Application Approval Required
                              </p>
                              <p className="text-yellow-700 text-xs">
                                Complete your chef application to unlock this module
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="whitespace-nowrap">Duration: {currentVideo.duration}</span>
                        <span className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></span>
                        <span className="break-all">Source: {currentVideo.source}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modern Sidebar */}
              <div className="xl:col-span-1 order-1 xl:order-2">
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                  className="space-y-4 lg:space-y-6 xl:sticky xl:top-6"
                >
                  {/* Unlock Progress for Limited Users */}
                  {accessLevel === 'limited' && (
                    <UnlockProgress 
                      hasApprovedApplication={hasApprovedApplication}
                    />
                  )}
                  
                  {/* Modern Progress Card */}
                  <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3 mb-4 lg:mb-6">
                      <div className="w-8 h-8 lg:w-10 lg:h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <TrendingUp className="h-4 w-4 lg:h-5 lg:w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900">Your Progress</h3>
                        <p className="text-sm text-gray-600 hidden sm:block">Track your learning journey</p>
                      </div>
                    </div>

                    <div className="space-y-3 lg:space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xl lg:text-2xl font-bold text-primary">{Math.round(overallProgress)}%</span>
                        <span className="text-xs lg:text-sm text-gray-600">{userProgress.filter(p => p.completed).length} of {videos.length} complete</span>
                      </div>
                      
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <motion.div
                          className="bg-gradient-to-r from-primary to-blue-600 h-2 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${overallProgress}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Detailed Progress Tracker */}
                  <CompletionTracker
                    videos={videoProgressData}
                    overallProgress={overallProgress}
                    completedCount={userProgress.filter(p => p.completed).length}
                    totalCount={videos.length}
                  />

                  {/* Modern Completion Card */}
                  {allVideosCompleted && !completionConfirmed && (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-200">
                      <div className="text-center space-y-4">
                        <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center mx-auto">
                          <Award className="h-8 w-8 text-white" />
                        </div>
                        
                        <div>
                          <h3 className="font-semibold text-green-900 mb-2">
                            Ready for Certification!
                          </h3>
                          <p className="text-sm text-green-700 leading-relaxed">
                            Congratulations! You've completed all training modules. Confirm to receive your certificate.
                          </p>
                        </div>
                        
                        <Button
                          onClick={confirmCompletion}
                          disabled={isSubmitting}
                          className="w-full bg-green-600 hover:bg-green-700"
                        >
                          {isSubmitting ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                              Processing...
                            </>
                          ) : (
                            'Confirm Completion'
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Modern Certificate Card */}
                  {completionConfirmed && (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-200">
                      <div className="text-center space-y-4">
                        <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center mx-auto">
                          <Award className="h-8 w-8 text-white" />
                        </div>
                        
                        <div>
                          <h3 className="font-semibold text-green-900 mb-2">
                            Certification Complete!
                          </h3>
                          <p className="text-sm text-green-700 leading-relaxed mb-4">
                            You've successfully completed all NL Food Handler Certification requirements.
                          </p>
                        </div>
                        
                        <Button 
                          variant="outline" 
                          className="w-full border-green-300 text-green-700 hover:bg-green-100"
                          onClick={async () => {
                            try {
                              const currentUserId = userId || user?.id;
                              
                              // Include authentication headers matching other working endpoints
                              const headers: Record<string, string> = {};
                              if (currentUserId) {
                                headers['X-User-ID'] = currentUserId.toString();
                              }

                              const response = await fetch(`/api/microlearning/certificate/${currentUserId}`, {
                                method: 'GET',
                                headers,
                                credentials: 'include'
                              });
                              
                              if (response.ok) {
                                const data = await response.json();
                                alert(`Certificate generated! Your completion has been recorded for ${new Date(data.completionDate).toLocaleDateString()}`);
                              } else {
                                const errorData = await response.json();
                                console.error('Certificate error:', errorData);
                                alert(`Error: ${errorData.message || 'Failed to generate certificate'}`);
                              }
                            } catch (error) {
                              console.error('Error downloading certificate:', error);
                              alert('Error downloading certificate. Please try again.');
                            }
                          }}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download Certificate
                        </Button>
                        
                        <div className="space-y-1 text-xs text-green-600">
                          <div className="flex items-center justify-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                            <span>Health Canada Approved</span>
                          </div>
                          <div className="flex items-center justify-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                            <span>CFIA Compliant</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 