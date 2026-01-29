import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle,
  Clock,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Play,
  Shield,
  Sparkles,
  Star,
  Trophy,
  Users
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import TrainingVideoPlayer from './TrainingVideoPlayer';

type ViewMode = 'overview' | 'player';

interface TrainingOverviewPanelProps {
  className?: string;
}

export default function TrainingOverviewPanel({ className }: TrainingOverviewPanelProps) {
  const { user: firebaseUser } = useFirebaseAuth();
  const { showAlert } = useCustomAlerts();
  const [isDownloading, setIsDownloading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('overview');

  const user = firebaseUser;

  // If in player mode, render the video player
  if (viewMode === 'player') {
    return (
      <TrainingVideoPlayer 
        onBack={() => setViewMode('overview')} 
        className={className}
      />
    );
  }

  // Query training access level and progress
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
  const completedVideos = videoProgress.filter((p: any) => p.completed).length;
  const totalVideos = 22;
  const progressPercentage = Math.round((completedVideos / totalVideos) * 100);

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
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
          <BookOpen className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Training & Certification</h2>
          <p className="text-muted-foreground mt-1">Improve your food safety knowledge and get certified.</p>
        </div>
        {isCompleted && (
          <Badge className="bg-green-600 text-white px-3 py-1.5">
            <Award className="h-4 w-4 mr-1.5" />
            Certified
          </Badge>
        )}
      </div>

      {/* Training Modules Overview Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="border-border/50 shadow-sm overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500" />
          <CardHeader className="pb-4">
            <CardTitle className="text-xl text-center">Training Modules Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Module Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Food Safety Basics */}
              <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">Food Safety Basics</h3>
                  <div className="flex gap-2">
                    {hasFullAccess ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                        14 Available
                      </Badge>
                    ) : (
                      <>
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                          1 Available
                        </Badge>
                        <Badge className="bg-slate-100 text-slate-600 border-slate-300 text-xs">
                          13 Locked
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Essential HACCP principles, contamination prevention, and food handling fundamentals.
                </p>
              </div>

              {/* Safety & Hygiene How-To's */}
              <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">Safety & Hygiene How-To's</h3>
                  {hasFullAccess ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                      8 Available
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-600 border-slate-300 text-xs">
                      8 Locked
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Step-by-step practical demonstrations and industry best practices.
                </p>
              </div>
            </div>

            {/* Feature Badges */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border/50">
              <div className="text-center">
                <div className="w-3 h-3 bg-emerald-500 rounded-full mx-auto mb-2" />
                <span className="text-sm text-muted-foreground">HACCP-Based</span>
              </div>
              <div className="text-center">
                <div className="w-3 h-3 bg-blue-500 rounded-full mx-auto mb-2" />
                <span className="text-sm text-muted-foreground">Self-Paced</span>
              </div>
              <div className="text-center">
                <div className="w-3 h-3 bg-purple-500 rounded-full mx-auto mb-2" />
                <span className="text-sm text-muted-foreground">Industry Standard</span>
              </div>
              <div className="text-center">
                <div className="w-3 h-3 bg-yellow-500 rounded-full mx-auto mb-2" />
                <span className="text-sm text-muted-foreground">Certified</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Dynamic Status Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Completion Certificate - For completed users */}
        {isCompleted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 shadow-lg h-full">
              <CardContent className="p-6 space-y-4">
                <div className="text-center space-y-4">
                  <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto">
                    <Award className="h-7 w-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-emerald-900">🎉 Training Completed!</h3>
                    <p className="text-emerald-700 text-sm mt-1">Congratulations! You've earned your Local Cooks certification.</p>
                  </div>
                  
                  {/* Celebratory elements */}
                  <div className="flex justify-center items-center gap-2 py-2">
                    <motion.div
                      animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
                      className="text-xl"
                    >
                      🏆
                    </motion.div>
                    <Badge className="bg-emerald-200 text-emerald-800 border-emerald-400 px-3 py-1 font-semibold">
                      <BadgeCheck className="h-4 w-4 mr-1" />
                      Local Cooks Certified
                    </Badge>
                    <motion.div
                      animate={{ rotate: [0, -15, 15, 0], scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity, repeatType: "reverse", delay: 0.5 }}
                      className="text-xl"
                    >
                      🎊
                    </motion.div>
                  </div>
                  
                  <div className="bg-emerald-100 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-left">
                        <p className="font-semibold text-emerald-800 text-sm">Certificate Available</p>
                        <p className="text-xs text-emerald-600">Download your Local Cooks certification</p>
                      </div>
                      <Button 
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={downloadCertificate}
                        disabled={isDownloading}
                      >
                        <Download className="h-4 w-4 mr-1.5" />
                        {isDownloading ? 'Downloading...' : 'Download'}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Official Certificate Card - For completed users */}
        {isCompleted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-lg h-full">
              <CardContent className="p-6 space-y-4">
                <div className="text-center space-y-4">
                  <div className="w-14 h-14 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto">
                    <Shield className="h-7 w-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-blue-900">🎓 Get Your Official Certificate</h3>
                    <p className="text-blue-700 text-sm mt-1">Complete your certification with a FREE official Food Safety certificate from SkillsPass NL.</p>
                  </div>
                  
                  <div className="bg-blue-100 rounded-xl p-4 space-y-3">
                    <div className="text-left space-y-2">
                      <div className="flex items-center gap-2 mb-2">
                        <Trophy className="h-4 w-4 text-blue-600" />
                        <p className="font-semibold text-blue-800 text-sm">Why Get This Official Certificate:</p>
                      </div>
                      <div className="space-y-1.5 text-xs text-blue-700">
                        <div className="flex items-start gap-2">
                          <span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold flex-shrink-0">✓</span>
                          <span>Recognized by employers & health authorities</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold flex-shrink-0">✓</span>
                          <span>100% FREE certification - no hidden costs</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold flex-shrink-0">✓</span>
                          <span>Lifetime digital certificate access</span>
                        </div>
                      </div>
                    </div>
                    <Button 
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                      onClick={() => window.open('https://skillspassnl.com', '_blank', 'noopener,noreferrer')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Get Your FREE Official Certificate
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Application Required - For limited users who can apply */}
        {!hasFullAccess && safeTrainingAccess?.applicationInfo?.canApply && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="border-2 border-yellow-200 bg-gradient-to-br from-yellow-50 to-orange-50 shadow-lg h-full">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-yellow-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <FileText className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-yellow-900">Application Required</h3>
                    <p className="text-yellow-800 text-sm mt-1">{safeTrainingAccess.applicationInfo.message}</p>
                  </div>
                </div>
                <Button 
                  asChild
                  className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white font-semibold"
                >
                  <Link href="/apply">
                    <FileText className="h-4 w-4 mr-2" />
                    Submit Application Now
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Application Status - For users with pending applications */}
        {!hasFullAccess && safeTrainingAccess?.applicationInfo?.message && !safeTrainingAccess?.applicationInfo?.canApply && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-lg h-full">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Clock className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-blue-900">Application Status</h3>
                    <p className="text-blue-800 text-sm mt-1">{safeTrainingAccess.applicationInfo.message}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Full Access Welcome - For approved users not yet completed */}
        {hasFullAccess && !isCompleted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="border-2 border-emerald-200 bg-gradient-to-br from-blue-50 to-emerald-50 shadow-lg h-full">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-emerald-900">Full Access Granted!</h3>
                    <p className="text-emerald-800 text-sm mt-1">Your application has been approved. Access all 22 training videos and earn your certification.</p>
                  </div>
                </div>
                
                {/* Progress indicator */}
                {completedVideos > 0 && (
                  <div className="bg-white/60 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-emerald-900">Your Progress</span>
                      <span className="text-emerald-700">{completedVideos} of {totalVideos} videos</span>
                    </div>
                    <div className="w-full h-2 bg-emerald-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercentage}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                )}
                
                <div className="bg-white/60 rounded-xl p-4 space-y-2">
                  <h4 className="font-semibold text-emerald-900 flex items-center gap-2 text-sm">
                    <span className="text-green-600">🔓</span>
                    Your Access Includes:
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2 text-emerald-700">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                      <span>All 22 Videos</span>
                    </div>
                    <div className="flex items-center gap-2 text-emerald-700">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                      <span>Progress Tracking</span>
                    </div>
                    <div className="flex items-center gap-2 text-emerald-700">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                      <span>Both Modules</span>
                    </div>
                    <div className="flex items-center gap-2 text-emerald-700">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                      <span>Certificate</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Community Card - For approved users not yet completed */}
        {hasFullAccess && !isCompleted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 shadow-lg h-full">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-rose-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-rose-900">Join Our Community</h3>
                    <p className="text-rose-800 text-sm mt-1">Connect with fellow culinary professionals and grow your network.</p>
                  </div>
                </div>
                <div className="bg-white/60 rounded-xl p-4 space-y-2">
                  <h4 className="font-semibold text-rose-900 flex items-center gap-2 text-sm">
                    <span className="text-rose-600">🤝</span>
                    Community Benefits:
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2 text-rose-700">
                      <Star className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
                      <span>Professional Network</span>
                    </div>
                    <div className="flex items-center gap-2 text-rose-700">
                      <Star className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
                      <span>Industry Insights</span>
                    </div>
                    <div className="flex items-center gap-2 text-rose-700">
                      <Star className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
                      <span>Career Opportunities</span>
                    </div>
                    <div className="flex items-center gap-2 text-rose-700">
                      <Star className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
                      <span>Peer Support</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Sample Access Card - For limited users */}
        {!hasFullAccess && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-lg h-full">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-blue-900">Welcome to Your Food Safety Journey!</h3>
                    <p className="text-blue-800 text-sm mt-1">Experience our comprehensive training with a sample video, then unlock the complete curriculum.</p>
                  </div>
                </div>
                <div className="bg-white/60 rounded-xl p-4 space-y-2">
                  <h4 className="font-semibold text-blue-900 flex items-center gap-2 text-sm">
                    <span className="text-blue-600">📚</span>
                    Full Training Includes:
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2 text-blue-700">
                      <Star className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                      <span>22 Training Videos</span>
                    </div>
                    <div className="flex items-center gap-2 text-blue-700">
                      <Star className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                      <span>2 Comprehensive Modules</span>
                    </div>
                    <div className="flex items-center gap-2 text-blue-700">
                      <Star className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                      <span>Completion Certificate</span>
                    </div>
                    <div className="flex items-center gap-2 text-blue-700">
                      <Star className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                      <span>Lifetime Access</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Action Button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="text-center space-y-4"
      >
        {!hasFullAccess ? (
          <div className="space-y-3">
            <Button
              size="lg"
              onClick={() => setViewMode('player')}
              className="bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-700 hover:to-blue-700 text-white font-bold px-8 py-3 text-base rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
            >
              <Play className="h-5 w-5 mr-2" />
              Start with Sample Video
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
            <p className="text-sm text-muted-foreground">
              Try our introduction video, then submit your application for full access
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              size="lg"
              onClick={() => setViewMode('player')}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold px-8 py-3 text-base rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
            >
              <Play className="h-5 w-5 mr-2" />
              {isCompleted ? 'Review Training Materials' : 'Continue Your Training'}
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
            <p className="text-sm text-muted-foreground">
              {isCompleted 
                ? 'Access all videos and materials anytime'
                : 'Continue where you left off and track your progress'
              }
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
