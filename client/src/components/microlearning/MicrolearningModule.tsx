import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, ExternalLink, Download, Award, AlertCircle } from 'lucide-react';
import VideoPlayer from './VideoPlayer';
import CompletionTracker from './CompletionTracker';
import { useAuth } from '@/hooks/use-auth';
import { motion } from 'framer-motion';

interface VideoData {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  duration: string;
  required: boolean;
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

// Sample video data - replace with actual Always Food Safe content
const TRAINING_VIDEOS: VideoData[] = [
  {
    id: 'food-handling',
    title: 'Proper Food Handling Techniques',
    description: 'Learn the fundamentals of safe food handling, including proper storage, preparation, and temperature control.',
    videoUrl: '/api/videos/food-handling.mp4', // Replace with actual video URLs
    duration: '8:45',
    required: true
  },
  {
    id: 'contamination-prevention',
    title: 'Contamination Prevention',
    description: 'Understand how to prevent cross-contamination and maintain a safe kitchen environment.',
    videoUrl: '/api/videos/contamination-prevention.mp4',
    duration: '6:30',
    required: true
  },
  {
    id: 'allergen-awareness',
    title: 'Allergen Awareness & Management',
    description: 'Essential knowledge about food allergens and how to manage them safely in your kitchen.',
    videoUrl: '/api/videos/allergen-awareness.mp4',
    duration: '5:15',
    required: true
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

  const currentVideo = TRAINING_VIDEOS[currentVideoIndex];
  const allVideosCompleted = userProgress.length === TRAINING_VIDEOS.length && 
    userProgress.every(p => p.completed);
  const overallProgress = (userProgress.filter(p => p.completed).length / TRAINING_VIDEOS.length) * 100;

  useEffect(() => {
    loadUserProgress();
  }, [userId]);

  const loadUserProgress = async () => {
    try {
      const response = await fetch(`/api/microlearning/progress/${userId || user?.id}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setUserProgress(data.progress || []);
        setCompletionConfirmed(data.completionConfirmed || false);
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
          'Content-Type': 'application/json'
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
    if (nextIndex < TRAINING_VIDEOS.length) {
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
          'Content-Type': 'application/json'
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

  const videoProgressData = TRAINING_VIDEOS.map(video => {
    const progress = getVideoProgress(video.id);
    return {
      id: video.id,
      title: video.title,
      duration: video.duration,
      completed: progress?.completed || false,
      progress: progress?.progress || 0,
      completedAt: progress?.completedAt,
      startedAt: progress?.startedAt
    };
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className={`max-w-6xl mx-auto p-6 ${className}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Food Safety Microlearning
              </h1>
              <p className="text-gray-600 mt-2">
                Complete these essential food safety training videos to enhance your knowledge and certification.
              </p>
            </div>
            {completionConfirmed && (
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                <Award className="h-4 w-4 mr-1" />
                Certified
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Video Player Section */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <span className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                      {currentVideoIndex + 1}
                    </span>
                    {currentVideo.title}
                  </CardTitle>
                  {currentVideo.required && (
                    <Badge variant="outline">Required</Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600">{currentVideo.description}</p>
              </CardHeader>
              <CardContent>
                <VideoPlayer
                  videoUrl={currentVideo.videoUrl}
                  title={currentVideo.title}
                  onStart={() => handleVideoStart(currentVideo.id)}
                  onProgress={(progress) => handleVideoProgress(currentVideo.id, progress)}
                  onComplete={() => handleVideoComplete(currentVideo.id)}
                  isCompleted={getVideoProgress(currentVideo.id)?.completed || false}
                  requireFullWatch={true}
                />

                {/* Video Navigation */}
                <div className="flex justify-between mt-6">
                  <Button
                    variant="outline"
                    onClick={() => setCurrentVideoIndex(Math.max(0, currentVideoIndex - 1))}
                    disabled={currentVideoIndex === 0}
                  >
                    Previous Video
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setCurrentVideoIndex(Math.min(TRAINING_VIDEOS.length - 1, currentVideoIndex + 1))}
                    disabled={currentVideoIndex === TRAINING_VIDEOS.length - 1}
                  >
                    Next Video
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Video Selection Tabs */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Training Modules</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={currentVideo.id} onValueChange={(videoId) => {
                  const index = TRAINING_VIDEOS.findIndex(v => v.id === videoId);
                  if (index !== -1) setCurrentVideoIndex(index);
                }}>
                  <TabsList className="grid w-full grid-cols-3">
                    {TRAINING_VIDEOS.map((video, index) => {
                      const progress = getVideoProgress(video.id);
                      return (
                        <TabsTrigger 
                          key={video.id} 
                          value={video.id}
                          className="relative"
                        >
                          {progress?.completed && (
                            <CheckCircle className="h-4 w-4 text-green-500 absolute -top-1 -right-1" />
                          )}
                          Module {index + 1}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  
                  {TRAINING_VIDEOS.map((video) => (
                    <TabsContent key={video.id} value={video.id} className="mt-4">
                      <div className="text-sm text-gray-600">
                        <h4 className="font-medium mb-2">{video.title}</h4>
                        <p>{video.description}</p>
                        <p className="mt-2 text-xs">Duration: {video.duration}</p>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Progress Tracker Section */}
          <div className="lg:col-span-1">
            <CompletionTracker
              videos={videoProgressData}
              overallProgress={overallProgress}
              completedCount={userProgress.filter(p => p.completed).length}
              totalCount={TRAINING_VIDEOS.length}
            />

            {/* Completion Confirmation */}
            {allVideosCompleted && !completionConfirmed && (
              <Card className="mt-6">
                <CardContent className="p-6">
                  <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h3 className="font-semibold text-gray-900 mb-2">
                      Ready for Certification
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      You've completed all required training videos. Confirm completion to receive your certificate.
                    </p>
                    <Button
                      onClick={confirmCompletion}
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? 'Processing...' : 'Confirm Completion'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Certificate Download */}
            {completionConfirmed && (
              <Card className="mt-6">
                <CardContent className="p-6">
                  <div className="text-center">
                    <Award className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <h3 className="font-semibold text-green-900 mb-2">
                      Certification Complete!
                    </h3>
                    <p className="text-sm text-green-700 mb-4">
                      Congratulations! You've successfully completed the food safety training.
                    </p>
                    <div className="space-y-2">
                      <Button variant="outline" className="w-full">
                        <Download className="h-4 w-4 mr-2" />
                        Download Certificate
                      </Button>
                      <Button variant="outline" className="w-full">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Always Food Safe Portal
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
} 