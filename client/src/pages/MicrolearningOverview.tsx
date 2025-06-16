import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { motion } from 'framer-motion';
import {
    AlertCircle,
    ArrowRight,
    Award,
    CheckCircle,
    Clock,
    FileText,
    Play,
    Shield
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';

export default function MicrolearningOverview() {
  const { user, loading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [applicationInfo, setApplicationInfo] = useState({
    hasApprovedApplication: false,
    hasPending: false,
    hasRejected: false,
    hasCancelled: false,
    canApply: false,
    message: ''
  });
  const [completionStatus, setCompletionStatus] = useState({
    completionConfirmed: false,
    allVideosCompleted: false,
    completedCount: 0,
    totalCount: 22
  });

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  // Load application status and completion data
  useEffect(() => {
    const loadApplicationStatus = async () => {
      if (!user?.uid) return;

      try {
        const response = await fetch('/api/applications/status', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          
          const hasApprovedApplication = data.applications?.some((app: any) => app.status === 'approved') || false;
          const hasPending = data.applications?.some((app: any) => app.status === 'pending' || app.status === 'in_review') || false;
          const hasRejected = data.applications?.some((app: any) => app.status === 'rejected') || false;
          const hasCancelled = data.applications?.some((app: any) => app.status === 'cancelled') || false;

          let message = '';
          let canApply = false;

          if (hasApprovedApplication) {
            message = 'Application Approved - Full Access Granted';
          } else if (hasPending) {
            message = 'Application Under Review - Limited Access';
          } else if (hasRejected) {
            message = 'Previous Application Was Declined - You May Reapply';
            canApply = true;
          } else if (hasCancelled) {
            message = 'Previous Application Was Cancelled - You May Reapply';
            canApply = true;
          } else {
            message = 'No Application Submitted - Limited Access';
            canApply = true;
          }

          setApplicationInfo({
            hasApprovedApplication,
            hasPending,
            hasRejected,
            hasCancelled,
            canApply,
            message
          });
        }
      } catch (error) {
        console.error('Error loading application status:', error);
      }
    };

    const loadCompletionStatus = async () => {
      if (!user?.uid) return;

      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/firebase/microlearning/progress/${user.uid}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setCompletionStatus({
            completionConfirmed: data.completionConfirmed || false,
            allVideosCompleted: data.allVideosCompleted || false,
            completedCount: data.completedCount || 0,
            totalCount: data.totalCount || 22
          });
        }
      } catch (error) {
        console.error('Error loading completion status:', error);
      }
    };

    if (user) {
      loadApplicationStatus();
      loadCompletionStatus();
    }
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Redirecting to login...</div>
      </div>
    );
  }

  const { hasApprovedApplication, hasPending, hasRejected, hasCancelled } = applicationInfo;
  const accessLevel = hasApprovedApplication || user?.role === 'admin' || completionStatus.completionConfirmed ? 'full' : 'limited';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow pt-20 md:pt-24 pb-12">
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white overflow-x-hidden">
          <div className="w-full">
            {/* Modern Header */}
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
                    {completionStatus.completionConfirmed && (
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
                    <span className="block text-primary">Video Learning Modules</span>
                  </h1>
                  
                  <p className="text-base sm:text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed px-4">
                    Enhance your food safety knowledge through our curated collection of Unilever Food Solutions training videos. These HACCP-based modules provide practical guidance on food safety fundamentals and hygiene best practices—ideal for learning industry standards, building foundational knowledge, or supporting your ongoing professional development. <br /> <br />
                    <strong className="font-semibold text-primary">Note:</strong> This training provides valuable learning content and upon completion, you'll receive a training completion certificate.
                  </p>

                  <div className="max-w-2xl mx-auto px-4">
                    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                      <div className="text-center space-y-4">
                        <div className="flex items-center justify-center gap-2 mb-3">
                          <span className="text-2xl font-bold text-primary">2</span>
                          <span className="text-gray-600">Professional Training Modules</span>
                        </div>
                        <div className="flex items-center justify-center gap-4 text-sm text-gray-600">
                          <div className="flex flex-col items-center">
                            <div className="flex gap-1 mb-1">
                              {accessLevel === 'limited' ? (
                                <>
                                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300 px-2 py-1">
                                    1 Available
                                  </Badge>
                                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300 px-2 py-1">
                                    13 Locked
                                  </Badge>
                                </>
                              ) : (
                                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300 px-2 py-1">
                                  14 Available
                                </Badge>
                              )}
                            </div>
                            <span>Food Safety Basics</span>
                          </div>
                          <div className="w-px h-8 bg-gray-300"></div>
                          <div className="flex flex-col items-center">
                            <div className="flex gap-1 mb-1">
                              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300 px-2 py-1">
                                {accessLevel === 'limited' ? '8 Locked' : '8 Available'}
                              </Badge>
                            </div>
                            <span>Safety & Hygiene</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>HACCP-Based Content</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span>Self-Paced Learning</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span>Industry-Standard Practices</span>
                          </div>
                        </div>

                        <p className="text-sm font-medium text-primary border-t border-gray-100 pt-4">
                          Enhance your food safety knowledge. Apply proven principles. Elevate your culinary business.
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Application Status and Progress */}
            <div className="w-full">
              <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
                
                {/* Completion Certificate Download Notification */}
                {completionStatus.completionConfirmed && (
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 }}
                    className="rounded-lg border p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-green-200 flex flex-col sm:flex-row items-center gap-4"
                  >
                    <div className="p-2 rounded-full bg-green-100 flex-shrink-0 flex items-center justify-center">
                      <Award className="h-8 w-8 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0 text-center sm:text-left">
                      <h3 className="font-semibold text-green-900 mb-1">Training Completion Certificate Available</h3>
                      <p className="text-sm text-green-700 mb-2">Congratulations! You have completed all food safety training videos. Continue to review materials anytime.</p>
                    </div>
                  </motion.div>
                )}

                {/* Application Status Notification */}
                {!completionStatus.completionConfirmed && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className={`rounded-lg border p-4 ${
                      hasRejected || hasCancelled
                        ? 'bg-orange-50 border-orange-200'
                        : hasPending
                        ? 'bg-blue-50 border-blue-200'
                        : !hasApprovedApplication
                        ? 'bg-yellow-50 border-yellow-200'
                        : 'bg-green-50 border-green-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-1 rounded-full flex-shrink-0 ${
                        hasRejected || hasCancelled
                          ? 'bg-orange-100'
                          : hasPending
                          ? 'bg-blue-100'
                          : !hasApprovedApplication
                          ? 'bg-yellow-100'
                          : 'bg-green-100'
                      }`}>
                        {hasRejected || hasCancelled ? (
                          <AlertCircle className="h-4 w-4 text-orange-600" />
                        ) : hasPending ? (
                          <Clock className="h-4 w-4 text-blue-600" />
                        ) : !hasApprovedApplication ? (
                          <FileText className="h-4 w-4 text-yellow-600" />
                        ) : (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${
                          hasRejected || hasCancelled
                            ? 'text-orange-800'
                            : hasPending
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
                              onClick={() => navigate('/apply')}
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

                {/* Welcome Learning Journey Banner */}
                {accessLevel === 'limited' && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                    className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 sm:p-6 shadow-sm border border-blue-200"
                  >
                    <div className="flex flex-col sm:flex-row items-start gap-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xl">🎓</span>
                      </div>
                      <div className="flex-1 space-y-4 min-w-0">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 mb-2">
                            Welcome to Your Food Safety Journey!
                          </h3>
                          <p className="text-base text-gray-700 leading-relaxed">
                            Start your food safety training today! Watch our introduction video to get a taste of the comprehensive curriculum featuring Unilever Food Solutions content. Once you complete your application, you'll gain access to all 22 training videos and earn your training completion certificate.
                          </p>
                        </div>
                        
                        <div className="bg-white/60 rounded-lg p-4 space-y-3">
                          <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                            <span className="text-green-600">📚</span>
                            What's Included in Your Training:
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            <div className="flex items-center gap-2 text-gray-700">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>22 Training Videos</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-700">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>2 Comprehensive Modules</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-700">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>Training Completion Certificate</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-700">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>Lifetime Access to Materials</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Progress Overview Card */}
                {(hasApprovedApplication || completionStatus.completionConfirmed) && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="bg-white rounded-xl p-6 shadow-sm border border-gray-100"
                  >
                    <div className="text-center space-y-4">
                      <h3 className="text-lg font-semibold text-gray-900">Your Training Progress</h3>
                      <div className="flex items-center justify-center gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{completionStatus.completedCount}</div>
                          <div className="text-sm text-gray-600">Completed</div>
                        </div>
                        <div className="w-px h-8 bg-gray-300"></div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-600">{completionStatus.totalCount}</div>
                          <div className="text-sm text-gray-600">Total Videos</div>
                        </div>
                        <div className="w-px h-8 bg-gray-300"></div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">
                            {Math.round((completionStatus.completedCount / completionStatus.totalCount) * 100)}%
                          </div>
                          <div className="text-sm text-gray-600">Progress</div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="w-full">
              <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 }}
                  className="text-center space-y-6"
                >
                  {accessLevel === 'limited' ? (
                    <div className="space-y-4">
                      <Button
                        asChild
                        size="lg"
                        className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold px-8 py-4 h-auto text-lg"
                      >
                        <Link href="/microlearning/player">
                          <Play className="h-6 w-6 mr-3" />
                          Start with Sample Video
                          <ArrowRight className="h-6 w-6 ml-3" />
                        </Link>
                      </Button>
                      <p className="text-sm text-gray-600">
                        Try our introduction video, then submit your application for full access
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <Button
                        asChild
                        size="lg"
                        className="bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-700 text-white font-semibold px-8 py-4 h-auto text-lg"
                      >
                        <Link href="/microlearning/player">
                          <Play className="h-6 w-6 mr-3" />
                          {completionStatus.completionConfirmed ? 'Review Training Materials' : 'Continue Training'}
                          <ArrowRight className="h-6 w-6 ml-3" />
                        </Link>
                      </Button>
                      <p className="text-sm text-gray-600">
                        {completionStatus.completionConfirmed 
                          ? 'Access all videos and materials anytime'
                          : 'Continue where you left off and track your progress'
                        }
                      </p>
                    </div>
                  )}

                  {applicationInfo.canApply && (
                    <div className="border-t border-gray-200 pt-6 mt-8">
                      <Button
                        asChild
                        variant="outline"
                        size="lg"
                        className="border-2 border-primary text-primary hover:bg-primary hover:text-white font-semibold px-8 py-4 h-auto"
                      >
                        <Link href="/apply">
                          <FileText className="h-5 w-5 mr-2" />
                          Submit Full Application
                        </Link>
                      </Button>
                      <p className="text-xs text-gray-500 mt-2">
                        Unlock all 22 videos and earn your official certification
                      </p>
                    </div>
                  )}
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
} 