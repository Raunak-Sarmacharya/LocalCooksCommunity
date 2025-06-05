import { useAuth } from '@/hooks/use-auth';
import { useEffect, useState } from 'react';

interface VideoData {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  duration: string;
  required: boolean;
  certification: string;
  source: string;
}

interface UserProgress {
  videoId: string;
  progress: number;
  completed: boolean;
  completedAt?: Date;
  startedAt?: Date;
}

interface MicrolearningModuleProps {
  userId?: number;
  onComplete?: () => void;
  className?: string;
}

const videos = [
  {
    id: 'canada-food-handling',
    title: 'Safe Food Handling Basics',
    description: 'Health Canada approved fundamentals of safe food handling, temperature control, and personal hygiene',
    duration: '8:45',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    source: 'Health Canada',
    certification: 'Government of Canada Approved'
  },
  {
    id: 'canada-contamination-prevention',
    title: 'Preventing Food Contamination',
    description: 'CFIA guidelines for preventing cross-contamination and maintaining food safety standards',
    duration: '6:30',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    source: 'Canadian Food Inspection Agency (CFIA)',
    certification: 'Federal Government Standards'
  },
  {
    id: 'canada-allergen-awareness',
    title: 'Allergen Awareness and Management',
    description: 'Safe Food for Canadians Regulations compliance for allergen identification and control',
    duration: '5:15',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    source: 'Canadian Food Inspection Agency (CFIA)',
    certification: 'Safe Food for Canadians Regulations'
  },
  {
    id: 'nl-temperature-control',
    title: 'Temperature Danger Zone & Time Control',
    description: 'Master the 2-hour rule and temperature danger zone (4°C-60°C) for Newfoundland food premises compliance',
    duration: '7:20',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    source: 'Health Canada + NL Department of Health',
    certification: 'NL Food Premises Regulations'
  },
  {
    id: 'nl-personal-hygiene',
    title: 'Personal Hygiene for Food Handlers',
    description: 'Hand washing, uniform standards, illness reporting, and hygiene protocols for Newfoundland certification',
    duration: '6:45',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    source: 'NL Department of Health & Community Services',
    certification: 'NL Food Handler Certification Required'
  },
  {
    id: 'nl-cleaning-sanitizing',
    title: 'Cleaning and Sanitizing Procedures',
    description: 'Proper cleaning vs sanitizing, chemical safety, and equipment maintenance for food premises',
    duration: '8:15',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    source: 'CFIA + NL Public Health',
    certification: 'Food Premises Act Compliance'
  },
  {
    id: 'nl-haccp-principles',
    title: 'HACCP Principles for Small Kitchens',
    description: 'Introduction to Hazard Analysis Critical Control Points for new chefs and kitchen managers',
    duration: '9:30',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    source: 'Canadian Food Inspection Agency (CFIA)',
    certification: 'HACCP Foundation Knowledge'
  },
  {
    id: 'nl-food-storage',
    title: 'Proper Food Storage & Receiving',
    description: 'Cold storage, dry storage, FIFO rotation, and delivery inspection procedures',
    duration: '7:50',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    source: 'Health Canada',
    certification: 'Safe Food for Canadians Regulations'
  },
  {
    id: 'nl-cooking-temperatures',
    title: 'Safe Cooking Temperatures & Methods',
    description: 'Internal temperatures for meat, poultry, seafood, and proper cooking techniques',
    duration: '6:20',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
    source: 'Health Canada',
    certification: 'Government of Canada Approved'
  },
  {
    id: 'nl-inspection-preparation',
    title: 'Health Inspection Readiness',
    description: 'What inspectors look for, documentation requirements, and how to prepare for NL health inspections',
    duration: '8:00',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    source: 'NL Department of Health & Community Services',
    certification: 'Food Premises Regulations'
  }
];

export default function MicrolearningModule({
  userId,
  onComplete,
  className = ""
}: MicrolearningModuleProps) {
  const { user } = useAuth();
  const [userProgress, setUserProgress] = useState<UserProgress[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const [accessLevel, setAccessLevel] = useState<'full' | 'limited'>('limited');
  const [hasApprovedApplication, setHasApprovedApplication] = useState(false);
  const [applicationInfo, setApplicationInfo] = useState<any>(null);

  const currentVideo = videos[currentVideoIndex];
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
        setUserProgress(data.progress || []);
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

  const updateVideoProgress = async (videoId: string, progress: number, completed: boolean = false) => {
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
          completedAt: completed ? new Date() : undefined
        }),
        credentials: 'include'
      });

      if (response.ok) {
        const updatedProgress = userProgress.filter(p => p.videoId !== videoId);
        const existingProgress = userProgress.find(p => p.videoId === videoId);
        
        updatedProgress.push({
          videoId,
          progress,
          completed,
          completedAt: completed ? new Date() : existingProgress?.completedAt,
          startedAt: existingProgress?.startedAt || (progress > 0 ? new Date() : undefined)
        });
        
        setUserProgress(updatedProgress);
      }
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  };

  const handleVideoStart = (videoId: string) => {
    const existingProgress = userProgress.find(p => p.videoId === videoId);
    if (!existingProgress) {
      updateVideoProgress(videoId, 0);
    }
  };

  const handleVideoProgress = (videoId: string, progress: number) => {
    updateVideoProgress(videoId, progress);
  };

  const handleVideoComplete = (videoId: string) => {
    updateVideoProgress(videoId, 100, true);
    
    // Auto-advance to next video if available
    const nextIndex = currentVideoIndex + 1;
    if (nextIndex < videos.length) {
      setTimeout(() => {
        setCurrentVideoIndex(nextIndex);
      }, 2000);
    }
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
    return {
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
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">Loading training modules...</span>
      </div>
    );
  }

  // Simplified initial render to test
  return (
    <div className={`min-h-screen bg-gray-50 p-4 ${className}`}>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Food Safety Training</h1>
        
        {/* Application Status */}
        {applicationInfo && (
          <div className="bg-white p-4 rounded-lg shadow mb-4">
            <h2 className="font-semibold mb-2">Application Status</h2>
            <p className="text-sm">{applicationInfo.message}</p>
            <div className="mt-2 text-xs text-gray-600">
              <div>Has Active: {applicationInfo.hasActive ? 'Yes' : 'No'}</div>
              <div>Has Pending: {applicationInfo.hasPending ? 'Yes' : 'No'}</div>
              <div>Has Rejected: {applicationInfo.hasRejected ? 'Yes' : 'No'}</div>
              <div>Has Cancelled: {applicationInfo.hasCancelled ? 'Yes' : 'No'}</div>
              <div>Can Apply: {applicationInfo.canApply ? 'Yes' : 'No'}</div>
              <div>Latest Status: {applicationInfo.latestStatus}</div>
            </div>
            {applicationInfo.canApply && (
              <button
                onClick={() => window.location.href = '/apply'}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Submit Application
              </button>
            )}
          </div>
        )}

        {/* Progress Info */}
        <div className="bg-white p-4 rounded-lg shadow mb-4">
          <h2 className="font-semibold mb-2">Your Progress</h2>
          <div>Access Level: {accessLevel}</div>
          <div>Has Approved Application: {hasApprovedApplication ? 'Yes' : 'No'}</div>
          <div>Overall Progress: {Math.round(overallProgress)}%</div>
          <div>Videos Completed: {userProgress.filter(p => p.completed).length} / {videos.length}</div>
          
          <div className="mt-4">
            <h3 className="font-medium mb-2">Current Progress:</h3>
            {userProgress.map(progress => (
              <div key={progress.videoId} className="text-sm">
                Video: {progress.videoId} - {progress.progress}% 
                {progress.completed && ' ✓ Completed'}
              </div>
            ))}
          </div>
        </div>

        {/* Current Video Info */}
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="font-semibold mb-2">Current Video: {currentVideo.title}</h2>
          <p className="text-sm text-gray-600 mb-2">{currentVideo.description}</p>
          <div className="text-xs text-gray-500">
            Duration: {currentVideo.duration} | Source: {currentVideo.source}
          </div>
          
          {accessLevel === 'limited' && currentVideoIndex > 0 ? (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-yellow-800 text-sm">🔒 This video is locked. Submit an application to unlock all modules.</p>
            </div>
          ) : (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
              <p className="text-green-800 text-sm">✅ This video is available for viewing.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 