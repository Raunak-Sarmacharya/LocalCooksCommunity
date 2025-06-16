import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from '@/lib/firebase';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    Award,
    CheckCircle,
    Download,
    FileText,
    GraduationCap,
    Play,
    Shield,
    Star,
    Users
} from 'lucide-react';
import React from 'react';
import { Link, useLocation } from 'wouter';

export default function MicrolearningOverview() {
  const { user, loading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  // Query training access level and progress - Same as dashboard
  const { data: trainingAccess, isLoading: isLoadingTrainingAccess } = useQuery({
    queryKey: ["training-access", user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      
      try {
        // Get Firebase token for authentication
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated user found");
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
            // No training progress found - default to limited access
            return {
              accessLevel: 'limited',
              hasApprovedApplication: false,
              applicationInfo: { message: 'Submit application for full training access' }
            };
          }
          throw new Error("Failed to fetch training access");
        }

        return await response.json();
      } catch (error) {
        console.error("Error fetching training access:", error);
        return {
          accessLevel: 'limited',
          hasApprovedApplication: false,
          applicationInfo: { message: 'Submit application for full training access' }
        };
      }
    },
    enabled: Boolean(user?.uid),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  // Query microlearning completion status
  const { data: microlearningCompletion, isLoading: isLoadingCompletion } = useQuery({
    queryKey: ["microlearning-completion", user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated user found");
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
            return null; // No completion found
          }
          throw new Error("Failed to fetch completion status");
        }

        return await response.json();
      } catch (error) {
        console.error("Error fetching microlearning completion:", error);
        return null;
      }
    },
    enabled: Boolean(user?.uid),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

  if (loading || isLoadingTrainingAccess || isLoadingCompletion) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent mx-auto"></div>
          <p className="text-slate-600 font-medium">Loading your training overview...</p>
        </div>
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

  const hasFullAccess = trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication;
  const isCompleted = microlearningCompletion?.completion?.confirmed || microlearningCompletion?.confirmed;

  // Add debug logging to understand what data we're getting
  React.useEffect(() => {
    if (microlearningCompletion) {
      console.log('🎯 Microlearning completion data:', microlearningCompletion);
      console.log('🎯 Is completed?', isCompleted);
      console.log('🎯 Has full access?', hasFullAccess);
      console.log('🎯 Training access data:', trainingAccess);
    }
  }, [microlearningCompletion, isCompleted, hasFullAccess, trainingAccess]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50">
      <Header />
      <main className="flex-grow pt-16 md:pt-20 pb-12">
        <div className="w-full">
          {/* Hero Section - Brand Colors - Fixed positioning */}
          <div className="relative bg-gradient-to-r from-emerald-600 via-blue-600 to-purple-600 overflow-hidden">
            <div className="absolute inset-0 bg-black/20"></div>
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/10"></div>
            
            <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                className="text-center space-y-8"
              >
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-white/20 backdrop-blur-sm rounded-full text-white font-medium border border-white/30">
                  <Shield className="h-5 w-5 flex-shrink-0" />
                  <span>Food Safety Training Modules</span>
                  {isCompleted && (
                    <>
                      <span className="w-1 h-1 bg-white/60 rounded-full flex-shrink-0"></span>
                      <div className="flex items-center gap-1 text-yellow-300">
                        <Award className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm">Certified</span>
                      </div>
                    </>
                  )}
                </div>
                
                <div className="space-y-6">
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight">
                    Food Safety Training
                    <span className="block bg-gradient-to-r from-yellow-300 to-emerald-300 bg-clip-text text-transparent">
                      Video Learning Modules
                    </span>
                  </h1>
                  
                  <p className="text-lg sm:text-xl text-blue-100 max-w-3xl mx-auto leading-relaxed">
                    Master food safety fundamentals with our comprehensive HACCP-based training program. 
                    Industry-standard curriculum featuring Unilever Food Solutions content.
                  </p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mt-12">
                  <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                    <div className="text-3xl font-bold text-white mb-2">22</div>
                    <div className="text-blue-100">Training Videos</div>
                  </div>
                  <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                    <div className="text-3xl font-bold text-white mb-2">2</div>
                    <div className="text-blue-100">Training Modules</div>
                  </div>
                  <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                    <div className="text-3xl font-bold text-white mb-2">100%</div>
                    <div className="text-blue-100">HACCP Certified</div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* Content Section */}
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
            
            {/* Training Modules Overview - Dynamic with responsive design */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-3xl p-6 md:p-8 shadow-xl border border-slate-200"
            >
              <div className="text-center space-y-6">
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">Training Modules Overview</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto">
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <h3 className="text-sm md:text-base font-semibold text-slate-800">Food Safety Basics</h3>
                      <div className="flex gap-2 flex-wrap justify-center sm:justify-start">
                        {hasFullAccess ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 px-2 md:px-3 py-1 text-xs">
                            14 Available
                          </Badge>
                        ) : (
                          <>
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 px-2 md:px-3 py-1 text-xs">
                              1 Available
                            </Badge>
                            <Badge className="bg-slate-100 text-slate-600 border-slate-300 px-2 md:px-3 py-1 text-xs">
                              13 Locked
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-xs md:text-sm text-slate-600 text-left">Essential HACCP principles, contamination prevention, and food handling fundamentals.</p>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <h3 className="text-sm md:text-base font-semibold text-slate-800">Safety & Hygiene How-To's</h3>
                      <div className="flex justify-center sm:justify-start">
                        {hasFullAccess ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 px-2 md:px-3 py-1 text-xs">
                            8 Available
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-600 border-slate-300 px-2 md:px-3 py-1 text-xs">
                            8 Locked
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs md:text-sm text-slate-600 text-left">Step-by-step practical demonstrations and industry best practices.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-slate-200">
                  <div className="text-center">
                    <div className="w-3 h-3 bg-emerald-500 rounded-full mx-auto mb-2"></div>
                    <span className="text-xs md:text-sm text-slate-600">HACCP-Based</span>
                  </div>
                  <div className="text-center">
                    <div className="w-3 h-3 bg-blue-500 rounded-full mx-auto mb-2"></div>
                    <span className="text-xs md:text-sm text-slate-600">Self-Paced</span>
                  </div>
                  <div className="text-center">
                    <div className="w-3 h-3 bg-purple-500 rounded-full mx-auto mb-2"></div>
                    <span className="text-xs md:text-sm text-slate-600">Industry Standard</span>
                  </div>
                  <div className="text-center">
                    <div className="w-3 h-3 bg-yellow-500 rounded-full mx-auto mb-2"></div>
                    <span className="text-xs md:text-sm text-slate-600">Certified</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Dynamic Status Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Completion Certificate - For completed users */}
              {isCompleted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-3xl p-8 border-2 border-emerald-200 shadow-lg"
                >
                  <div className="text-center space-y-6">
                    <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto">
                      <Award className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-emerald-900 mb-2">🎉 Training Completed!</h3>
                      <p className="text-emerald-700">Congratulations! You've earned your Local Cooks certification.</p>
                    </div>
                    <div className="bg-emerald-100 rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-emerald-800">Certificate Available</p>
                          <p className="text-sm text-emerald-600">Download your official certification</p>
                        </div>
                        <Button 
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={async () => {
                            try {
                              // Get Firebase token for authentication
                              const currentUser = auth.currentUser;
                              if (!currentUser) {
                                console.error('No authenticated user found');
                                alert('Authentication required. Please log in again.');
                                return;
                              }
                              
                              const token = await currentUser.getIdToken();
                              
                              const response = await fetch(`/api/firebase/microlearning/certificate/${user.uid}`, {
                                method: 'GET',
                                headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${token}`
                                }
                              });

                              if (response.ok) {
                                // Handle PDF download
                                const blob = await response.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.style.display = 'none';
                                a.href = url;
                                a.download = `LocalCooks-Certificate-${user.displayName || user.email || 'user'}.pdf`;
                                document.body.appendChild(a);
                                a.click();
                                window.URL.revokeObjectURL(url);
                                document.body.removeChild(a);
                              } else {
                                const error = await response.json();
                                console.error('Certificate download failed:', error);
                                alert('Failed to download certificate. Please try again.');
                              }
                            } catch (error) {
                              console.error('Error downloading certificate:', error);
                              alert('Failed to download certificate. Please try again.');
                            }
                          }}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Application Status - Dynamic based on access level */}
              {!hasFullAccess && trainingAccess?.applicationInfo?.message && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-3xl p-8 border-2 border-yellow-200 shadow-lg"
                >
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-yellow-500 rounded-xl flex items-center justify-center flex-shrink-0">
                        <FileText className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-yellow-900 mb-2">Application Required</h3>
                        <p className="text-yellow-800">{trainingAccess.applicationInfo.message}</p>
                      </div>
                    </div>
                    <Button 
                      asChild
                      className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white font-semibold py-3"
                    >
                      <Link href="/apply">
                        <FileText className="h-5 w-5 mr-2" />
                        Submit Application Now
                      </Link>
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Full Access Welcome - For approved users */}
              {hasFullAccess && !isCompleted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-gradient-to-br from-blue-50 to-emerald-50 rounded-3xl p-8 border-2 border-emerald-200 shadow-lg"
                >
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center flex-shrink-0">
                        <CheckCircle className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-emerald-900 mb-2">Full Access Granted!</h3>
                        <p className="text-emerald-800">Your application has been approved. Access all 22 training videos and earn your certification.</p>
                      </div>
                    </div>
                    <div className="bg-white/60 rounded-2xl p-4 space-y-3">
                      <h4 className="font-semibold text-emerald-900 flex items-center gap-2">
                        <span className="text-green-600">🔓</span>
                        Your Access Includes:
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2 text-emerald-700">
                          <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                          <span>All 22 Videos</span>
                        </div>
                        <div className="flex items-center gap-2 text-emerald-700">
                          <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                          <span>Progress Tracking</span>
                        </div>
                        <div className="flex items-center gap-2 text-emerald-700">
                          <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                          <span>Both Modules</span>
                        </div>
                        <div className="flex items-center gap-2 text-emerald-700">
                          <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                          <span>Certificate</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Join Community Card - For approved users (companion card) */}
              {hasFullAccess && !isCompleted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-gradient-to-br from-rose-50 to-pink-50 rounded-3xl p-8 border-2 border-rose-200 shadow-lg"
                >
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-rose-500 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Users className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-rose-900 mb-2">Join Our Community</h3>
                        <p className="text-rose-800">Connect with fellow culinary professionals and grow your network in the food industry.</p>
                      </div>
                    </div>
                    <div className="bg-white/60 rounded-2xl p-4 space-y-3">
                      <h4 className="font-semibold text-rose-900 flex items-center gap-2">
                        <span className="text-rose-600">🤝</span>
                        Community Benefits:
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2 text-rose-700">
                          <Star className="h-4 w-4 text-rose-600 flex-shrink-0" />
                          <span>Professional Network</span>
                        </div>
                        <div className="flex items-center gap-2 text-rose-700">
                          <Star className="h-4 w-4 text-rose-600 flex-shrink-0" />
                          <span>Industry Insights</span>
                        </div>
                        <div className="flex items-center gap-2 text-rose-700">
                          <Star className="h-4 w-4 text-rose-600 flex-shrink-0" />
                          <span>Career Opportunities</span>
                        </div>
                        <div className="flex items-center gap-2 text-rose-700">
                          <Star className="h-4 w-4 text-rose-600 flex-shrink-0" />
                          <span>Peer Support</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Sample Access - For limited users (single card only) */}
              {!hasFullAccess && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl p-8 border-2 border-blue-200 shadow-lg"
                >
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                        <GraduationCap className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-blue-900 mb-2">Welcome to Your Food Safety Journey!</h3>
                        <p className="text-blue-800">Experience our comprehensive training with a sample video, then unlock the complete curriculum.</p>
                      </div>
                    </div>
                    <div className="bg-white/60 rounded-2xl p-4 space-y-3">
                      <h4 className="font-semibold text-blue-900 flex items-center gap-2">
                        <span className="text-blue-600">📚</span>
                        Full Training Includes:
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2 text-blue-700">
                          <Star className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          <span>22 Training Videos</span>
                        </div>
                        <div className="flex items-center gap-2 text-blue-700">
                          <Star className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          <span>2 Comprehensive Modules</span>
                        </div>
                        <div className="flex items-center gap-2 text-blue-700">
                          <Star className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          <span>Completion Certificate</span>
                        </div>
                        <div className="flex items-center gap-2 text-blue-700">
                          <Star className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          <span>Lifetime Access</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

            </div>

            {/* Action Buttons - Dynamic with proper centering */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-center space-y-6 px-4 sm:px-0"
            >
              {!hasFullAccess ? (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <Button
                      asChild
                      size="lg"
                      className="bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-700 hover:to-blue-700 text-white font-bold px-12 py-4 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 w-full max-w-sm sm:w-auto"
                    >
                      <Link href="/microlearning/player">
                        <Play className="h-6 w-6 mr-3" />
                        Start with Sample Video
                        <ArrowRight className="h-6 w-6 ml-3" />
                      </Link>
                    </Button>
                  </div>
                  <p className="text-slate-600">
                    Try our introduction video, then submit your application for full access
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <Button
                      asChild
                      size="lg"
                      className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold px-12 py-4 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 w-full max-w-sm sm:w-auto"
                    >
                      <Link href="/microlearning/player">
                        <Play className="h-6 w-6 mr-3" />
                        {isCompleted ? 'Review Training Materials' : 'Continue Your Training'}
                        <ArrowRight className="h-6 w-6 ml-3" />
                      </Link>
                    </Button>
                  </div>
                  <p className="text-slate-600">
                    {isCompleted 
                      ? 'Access all videos and materials anytime'
                      : 'Continue where you left off and track your progress'
                    }
                  </p>
                </div>
              )}
            </motion.div>

          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
} 