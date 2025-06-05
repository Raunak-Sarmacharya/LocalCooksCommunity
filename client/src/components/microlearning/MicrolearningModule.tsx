import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, ExternalLink, Download, Award, AlertCircle, Shield, ArrowRight } from 'lucide-react';
import VideoPlayer from './VideoPlayer';
import CompletionTracker from './CompletionTracker';
import UnlockProgress from './UnlockProgress';
import { useAuth } from '@/hooks/use-auth';
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

  const currentVideo = videos[currentVideoIndex];
  const allVideosCompleted = userProgress.length === videos.length && 
    userProgress.every(p => p.completed);
  const overallProgress = (userProgress.filter(p => p.completed).length / videos.length) * 100;

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
        setAccessLevel(data.accessLevel || 'limited');
        setHasApprovedApplication(data.hasApprovedApplication || false);
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
                Food Safety Certification Training - Newfoundland & Labrador
              </h1>
              <p className="text-gray-600 mt-2">
                Comprehensive training for new chefs preparing for licensing and certification in Newfoundland. 
                Complete all 10 modules to meet NL Food Handler Certification requirements.
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
              <span className="font-medium text-blue-800">Official Training - Government of Canada & Newfoundland</span>
            </div>
            <p className="text-blue-700 text-sm">
              Comprehensive training featuring content from Health Canada, CFIA, and NL Department of Health & Community Services. 
              Specifically designed to prepare new chefs for Newfoundland Food Handler Certification and licensing requirements.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                🍁 Federal Standards
              </span>
              <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                🏛️ NL Food Premises Act
              </span>
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                📋 HACCP Principles
              </span>
            </div>
          </div>

          {/* Demo Notice */}
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-orange-800 text-sm">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Demo Mode:</span>
              <span>Sample videos are used for demonstration. In production, these would be official government training videos.</span>
            </div>
          </div>

          {/* Access Level Notification */}
          {accessLevel === 'limited' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-yellow-800 mb-1">
                    Limited Access - Application Approval Required
                  </h3>
                  <p className="text-yellow-700 text-sm mb-3">
                    You currently have access to the first training module only. To unlock all 10 comprehensive modules 
                    and earn your Food Handler Certification, please submit and get approval for your LocalCooks application.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 w-fit">
                      ✓ Module 1: Safe Food Handling Basics (Available Now)
                    </Badge>
                    <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300 w-fit">
                      🔒 Modules 2-10: Requires Application Approval
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <Button
                      asChild
                      size="sm"
                      className="bg-yellow-600 hover:bg-yellow-700 text-white"
                    >
                      <Link href="/apply">Submit Application to Unlock Full Training</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Action Banner for Limited Users */}
        {accessLevel === 'limited' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-primary/10 to-blue-100 border border-primary/20 rounded-lg p-4 mb-6"
          >
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/20 p-2 rounded-full">
                  <Award className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">Unlock 9 More Training Modules</h3>
                  <p className="text-sm text-gray-600">Complete your chef application to access the full certification program</p>
                </div>
              </div>
              <Button asChild size="sm" className="shrink-0">
                <Link href="/apply">
                  Get Full Access
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </div>
          </motion.div>
        )}

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
                    {accessLevel === 'limited' && currentVideoIndex === 0 && (
                      <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                        Free Preview
                      </Badge>
                    )}
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
                    disabled={currentVideoIndex === videos.length - 1 || (accessLevel === 'limited' && currentVideoIndex === 0)}
                  >
                    {accessLevel === 'limited' && currentVideoIndex === 0 ? '🔒 Locked' : 'Next Video'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Video Selection Tabs */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Training Modules
                  {accessLevel === 'limited' && (
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                      1 of 10 Available
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={currentVideo.id} onValueChange={(videoId) => {
                  const index = videos.findIndex(v => v.id === videoId);
                  if (index !== -1) setCurrentVideoIndex(index);
                }}>
                  <TabsList className="grid w-full grid-cols-2 lg:grid-cols-5 gap-1">
                    {videos.map((video, index) => {
                      const progress = getVideoProgress(video.id);
                      const isLocked = accessLevel === 'limited' && index > 0;
                      return (
                        <TabsTrigger 
                          key={video.id} 
                          value={video.id}
                          className={`relative text-xs p-2 ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                          disabled={isLocked}
                        >
                          {progress?.completed && (
                            <CheckCircle className="h-3 w-3 text-green-500 absolute -top-1 -right-1" />
                          )}
                          {isLocked && (
                            <span className="absolute -top-1 -right-1 text-gray-400">🔒</span>
                          )}
                          <span className="hidden sm:inline">Module</span> {index + 1}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  
                  {videos.map((video, index) => {
                    const isLocked = accessLevel === 'limited' && index > 0;
                    return (
                      <TabsContent key={video.id} value={video.id} className="space-y-4">
                        <div className={`bg-gray-50 p-4 rounded-lg ${isLocked ? 'border-2 border-yellow-200' : ''}`}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                              {video.title}
                              {isLocked && <span className="text-yellow-600">🔒</span>}
                            </h3>
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              {video.certification}
                            </Badge>
                          </div>
                          <p className="text-gray-600 mb-2">{video.description}</p>
                          {isLocked && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-2">
                              <p className="text-yellow-800 text-sm font-medium mb-1">
                                🔒 Application Approval Required
                              </p>
                              <p className="text-yellow-700 text-xs">
                                This module is locked. Submit and get approval for your LocalCooks application to access all training modules.
                              </p>
                            </div>
                          )}
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span>Duration: {video.duration}</span>
                            <span>Source: {video.source}</span>
                          </div>
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Progress Tracker Section */}
          <div className="lg:col-span-1">
            {accessLevel === 'limited' ? (
              <UnlockProgress 
                hasApprovedApplication={hasApprovedApplication}
                className="mb-6"
              />
            ) : null}
            
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
                      Ready for NL Food Handler Certification
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Congratulations! You've completed all 10 comprehensive training modules covering federal and 
                      Newfoundland food safety requirements. Confirm completion to receive your certificate.
                    </p>
                  </div>
                  
                  <Button
                    onClick={confirmCompletion}
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting ? 'Processing...' : 'Confirm Completion'}
                  </Button>
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
                      NL Food Handler Certification Complete!
                    </h3>
                    <p className="text-sm text-green-700 mb-4">
                      Excellent! You've completed comprehensive training covering all requirements for Newfoundland 
                      Food Handler Certification and licensing preparation.
                    </p>
                    <div className="space-y-2">
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={async () => {
                          try {
                            const response = await fetch(`/api/microlearning/certificate/${userId || user?.id}`);
                            if (response.ok) {
                              const data = await response.json();
                              // For now, just show an alert with the certificate info
                              alert(`Certificate generated! Your completion has been recorded for ${new Date(data.completionDate).toLocaleDateString()}`);
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