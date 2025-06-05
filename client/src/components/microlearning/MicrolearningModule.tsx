import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, ExternalLink, Download, Award, AlertCircle, Shield } from 'lucide-react';
import VideoPlayer from './VideoPlayer';
import CompletionTracker from './CompletionTracker';
import { motion } from 'framer-motion';

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
  userId: number;
  className?: string;
}

const videos = [
  {
    id: 'canada-food-handling',
    title: 'Safe Food Handling Basics',
    description: 'Health Canada approved fundamentals of safe food handling, temperature control, and personal hygiene',
    duration: '8:45',
    url: 'https://www.canada.ca/content/dam/hc-sc/videos/health/food-safety/food-handling-basics.mp4',
    source: 'Health Canada',
    certification: 'Government of Canada Approved'
  },
  {
    id: 'canada-contamination-prevention',
    title: 'Preventing Food Contamination',
    description: 'CFIA guidelines for preventing cross-contamination and maintaining food safety standards',
    duration: '6:30',
    url: 'https://inspection.canada.ca/content/dam/cfia/videos/food-safety/contamination-prevention.mp4',
    source: 'Canadian Food Inspection Agency (CFIA)',
    certification: 'Federal Government Standards'
  },
  {
    id: 'canada-allergen-awareness',
    title: 'Allergen Awareness and Management',
    description: 'Safe Food for Canadians Regulations compliance for allergen identification and control',
    duration: '5:15',
    url: 'https://inspection.canada.ca/content/dam/cfia/videos/food-safety/allergen-management.mp4',
    source: 'Canadian Food Inspection Agency (CFIA)',
    certification: 'Safe Food for Canadians Regulations'
  }
];

export default function MicrolearningModule({
  userId,
  className = ""
}: MicrolearningModuleProps) {
  const [userProgress, setUserProgress] = useState<UserProgress[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const [participantName, setParticipantName] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');

  const currentVideo = videos[currentVideoIndex];
  const allVideosCompleted = userProgress.length === videos.length && 
    userProgress.every(p => p.completed);
  const overallProgress = (userProgress.filter(p => p.completed).length / videos.length) * 100;

  useEffect(() => {
    loadUserProgress();
  }, [userId]);

  const loadUserProgress = async () => {
    try {
      const response = await fetch(`/api/microlearning/progress/${userId}`);
      
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
          userId,
          videoId,
          progress,
          completed,
          completedAt: completed ? new Date() : undefined
        })
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
    if (!allVideosCompleted || !participantName.trim()) return;
    
    setIsSubmitting(true);
    try {
      // Submit completion with participant information
      const response = await fetch('/api/microlearning/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          completionDate: new Date(),
          videoProgress: userProgress,
          participantName: participantName.trim(),
          participantEmail: participantEmail.trim() || undefined
        })
      });

      if (response.ok) {
        setCompletionConfirmed(true);
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

        <div className="mb-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-center mb-2">
              <Shield className="h-5 w-5 text-blue-600 mr-2" />
              <span className="font-medium text-blue-800">Government of Canada Approved Training</span>
            </div>
            <p className="text-blue-700 text-sm">
              This microlearning program features official food safety training content from Health Canada 
              and the Canadian Food Inspection Agency (CFIA), aligned with the Safe Food for Canadians Regulations.
            </p>
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
                  videoUrl={currentVideo.url}
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
                    onClick={() => setCurrentVideoIndex(Math.min(videos.length - 1, currentVideoIndex + 1))}
                    disabled={currentVideoIndex === videos.length - 1}
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
                  const index = videos.findIndex(v => v.id === videoId);
                  if (index !== -1) setCurrentVideoIndex(index);
                }}>
                  <TabsList className="grid w-full grid-cols-3">
                    {videos.map((video, index) => {
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
                  
                  {videos.map((video) => (
                    <TabsContent key={video.id} value={video.id} className="space-y-4">
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-semibold">{video.title}</h3>
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            {video.certification}
                          </Badge>
                        </div>
                        <p className="text-gray-600 mb-2">{video.description}</p>
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <span>Duration: {video.duration}</span>
                          <span>Source: {video.source}</span>
                        </div>
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
              totalCount={videos.length}
            />

            {/* Completion Confirmation */}
            {allVideosCompleted && !completionConfirmed && (
              <Card className="mt-6">
                <CardContent className="p-6">
                  <div className="text-center mb-4">
                    <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h3 className="font-semibold text-gray-900 mb-2">
                      Ready for Certification
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      You've completed all required training videos. Please provide your information to receive your official certificate.
                    </p>
                  </div>
                  
                  <div className="space-y-4 text-left">
                    <div>
                      <label htmlFor="participantName" className="block text-sm font-medium text-gray-700 mb-1">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        id="participantName"
                        value={participantName}
                        onChange={(e) => setParticipantName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter your full name"
                        required
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="participantEmail" className="block text-sm font-medium text-gray-700 mb-1">
                        Email Address (Optional)
                      </label>
                      <input
                        type="email"
                        id="participantEmail"
                        value={participantEmail}
                        onChange={(e) => setParticipantEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter your email address"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Used for certificate delivery and future updates
                      </p>
                    </div>
                    
                    <Button
                      onClick={confirmCompletion}
                      disabled={isSubmitting || !participantName.trim()}
                      className="w-full"
                    >
                      {isSubmitting ? 'Processing...' : 'Confirm Completion & Get Certificate'}
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
                      Congratulations! You've successfully completed the Government of Canada approved food safety training.
                    </p>
                    <div className="space-y-2">
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={async () => {
                          try {
                            const response = await fetch(`/api/microlearning/certificate/${userId}`);
                            if (response.ok) {
                              const data = await response.json();
                              // For now, just show an alert with the certificate info
                              alert(`Certificate generated! Your completion has been recorded for ${participantName} on ${new Date(data.completionDate).toLocaleDateString()}`);
                            }
                          } catch (error) {
                            console.error('Error downloading certificate:', error);
                          }
                        }}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download Certificate
                      </Button>
                      <div className="text-xs text-gray-500 mt-2">
                        <p>✓ Health Canada & CFIA Approved Content</p>
                        <p>✓ Safe Food for Canadians Regulations Compliant</p>
                        {participantName && <p>✓ Certified to: {participantName}</p>}
                      </div>
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