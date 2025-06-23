import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from '@/lib/firebase';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    Award,
    BadgeCheck,
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
import React from 'react';
import { Link, useLocation } from 'wouter';

export default function MicrolearningOverview() {
  const { user: firebaseUser, loading: firebaseLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const { showAlert } = useCustomAlerts();

  // Check for session-based auth (for admin users)
  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
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
  const loading = firebaseLoading || sessionLoading;

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!loading && !user) {
      console.log('🔄 MicrolearningOverview: Redirecting to auth - no user');
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  // Query training access level and progress - Support both Firebase and session auth
  const { data: trainingAccess, isLoading: isLoadingTrainingAccess, error: trainingAccessError } = useQuery({
    queryKey: ["training-access", user?.uid || user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      console.log('🔄 MicrolearningOverview: Fetching training access for user:', user);
      
      try {
        // Use different endpoints based on auth method
        if (user.authMethod === 'session') {
          // Admin session-based access
          const userId = user.id;
          const response = await fetch(`/api/microlearning/progress/${userId}`, {
            method: "GET",
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': userId.toString()
            },
          });

          if (!response.ok) {
            if (response.status === 404) {
              console.log('📝 MicrolearningOverview: No training progress found (session) - defaulting to admin access');
              // Admins get full access by default
              return {
                accessLevel: 'full',
                hasApprovedApplication: true,
                isAdmin: true,
                applicationInfo: { message: 'Admin has full access to all training' }
              };
            }
            throw new Error(`Failed to fetch training access (session): ${response.status} ${response.statusText}`);
          }

          const result = await response.json();
          console.log('✅ MicrolearningOverview: Training access fetched (session):', result);
          return result;
        } else {
          // Firebase-based access
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
              console.log('📝 MicrolearningOverview: No training progress found (firebase) - defaulting to limited access');
              return {
                accessLevel: 'limited',
                hasApprovedApplication: false,
                applicationInfo: { message: 'Submit application for full training access' }
              };
            }
            throw new Error(`Failed to fetch training access (firebase): ${response.status} ${response.statusText}`);
          }

          const result = await response.json();
          console.log('✅ MicrolearningOverview: Training access fetched (firebase):', result);
          return result;
        }
      } catch (error) {
        console.error("❌ MicrolearningOverview: Error fetching training access:", error);
        // Return admin access if it's a session user, limited for others
        if (user.authMethod === 'session' && user.role === 'admin') {
          return {
            accessLevel: 'full',
            hasApprovedApplication: true,
            isAdmin: true,
            applicationInfo: { message: 'Admin has full access to all training' }
          };
        }
        return {
          accessLevel: 'limited',
          hasApprovedApplication: false,
          applicationInfo: { message: 'Error loading training access' }
        };
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Query completion status - Support both Firebase and session auth
  const { data: microlearningCompletion, isLoading: isLoadingCompletion, error: completionError } = useQuery({
    queryKey: ["microlearning-completion", user?.uid || user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      try {
        if (user.authMethod === 'session') {
          // Admin session-based access
          const userId = user.id;
          const response = await fetch(`/api/microlearning/completion/${userId}`, {
            method: "GET",
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': userId.toString()
            },
          });

          if (!response.ok) {
            if (response.status === 404) {
              console.log('📝 MicrolearningOverview: No completion found (session)');
              return null;
            }
            throw new Error(`Failed to fetch completion status (session): ${response.status} ${response.statusText}`);
          }

          const result = await response.json();
          console.log('✅ MicrolearningOverview: Completion status fetched (session):', result);
          return result;
        } else {
          // Firebase-based access
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
              console.log('📝 MicrolearningOverview: No completion found (firebase)');
              return null;
            }
            throw new Error(`Failed to fetch completion status (firebase): ${response.status} ${response.statusText}`);
          }

          const result = await response.json();
          console.log('✅ MicrolearningOverview: Completion status fetched (firebase):', result);
          return result;
        }
      } catch (error) {
        console.error("❌ MicrolearningOverview: Error fetching microlearning completion:", error);
        return null;
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Enhanced loading logic with better error handling
  const isInitialLoading = loading || (user && (isLoadingTrainingAccess || isLoadingCompletion));
  const hasError = trainingAccessError || completionError;
  
  // Provide fallback data if there was an error loading (moved before early returns)
  const safeTrainingAccess = trainingAccess || {
    accessLevel: 'limited',
    hasApprovedApplication: false,
    applicationInfo: { message: 'Submit application for full training access' }
  };

  const safeMicrolearningCompletion = microlearningCompletion || null;

  const hasFullAccess = safeTrainingAccess?.accessLevel === 'full' || safeTrainingAccess?.hasApprovedApplication;
  const isCompleted = safeMicrolearningCompletion?.completion?.confirmed || safeMicrolearningCompletion?.confirmed;

  // Add debug logging to understand what data we're getting (moved before early returns)
  React.useEffect(() => {
    if (microlearningCompletion || trainingAccess) {
      console.log('🎯 Microlearning completion data:', microlearningCompletion);
      console.log('🎯 Training access data:', trainingAccess);
    }
  }, [microlearningCompletion, trainingAccess]);
  
  console.log('🔄 MicrolearningOverview: Render state:', {
    loading,
    user: !!user,
    isLoadingTrainingAccess,
    isLoadingCompletion,
    isInitialLoading,
    hasError: !!hasError,
    trainingAccess: !!trainingAccess,
    microlearningCompletion: !!microlearningCompletion
  });

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
        const error = await response.json();
        console.error('Certificate download failed:', error);
        throw new Error('Failed to download certificate');
      }

      // Handle PDF download
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

  if (isInitialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent mx-auto"></div>
          <p className="text-slate-600 font-medium">Loading your training overview...</p>
          <p className="text-slate-500 text-sm">
            {loading ? 'Authenticating...' : 
             isLoadingTrainingAccess ? 'Checking access level...' : 
             isLoadingCompletion ? 'Loading completion status...' : 
             'Preparing content...'}
          </p>
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

  // Show error state if data failed to load but still render with fallbacks
  if (hasError && !trainingAccess && !microlearningCompletion) {
    console.log('⚠️ MicrolearningOverview: Error state with fallbacks');
  }

  // If there's a critical error and we have no fallback data, show error page but with minimal UI
  if (hasError && !trainingAccess && !microlearningCompletion && !isInitialLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50">
        <Header />
        <main className="flex-grow pt-16 md:pt-20 pb-12 flex items-center justify-center">
          <div className="text-center space-y-6 max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <span className="text-red-600 text-2xl">⚠️</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Unable to Load Training Data</h2>
              <p className="text-slate-600 mb-4">
                We're having trouble loading your training information. This is usually temporary.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

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
                    
                    {/* Added celebratory elements to fill white space */}
                    <div className="flex justify-center items-center gap-3 py-4">
                      <motion.div
                        animate={{ 
                          rotate: [0, 15, -15, 0],
                          scale: [1, 1.1, 1]
                        }}
                        transition={{ 
                          duration: 2,
                          repeat: Infinity,
                          repeatType: "reverse"
                        }}
                        className="text-2xl"
                      >
                        🏆
                      </motion.div>
                      <div className="flex items-center gap-2">
                        <motion.div
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          <Sparkles className="h-6 w-6 text-yellow-500" />
                        </motion.div>
                        <Badge className="bg-emerald-200 text-emerald-800 border-emerald-400 px-3 py-1 font-semibold">
                          <BadgeCheck className="h-4 w-4 mr-1" />
                          Local Cooks Certified
                        </Badge>
                        <motion.div
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                        >
                          <Sparkles className="h-6 w-6 text-yellow-500" />
                        </motion.div>
                      </div>
                      <motion.div
                        animate={{ 
                          rotate: [0, -15, 15, 0],
                          scale: [1, 1.1, 1]
                        }}
                        transition={{ 
                          duration: 2,
                          repeat: Infinity,
                          repeatType: "reverse",
                          delay: 0.5
                        }}
                        className="text-2xl"
                      >
                        🎊
                      </motion.div>
                    </div>
                    
                    <div className="bg-emerald-100 rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-emerald-800">Certificate Available</p>
                          <p className="text-sm text-emerald-600">Download your Local Cooks certification</p>
                        </div>
                        <Button 
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={downloadCertificate}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Get Official Food Safety Certificate - For completed users */}
              {isCompleted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl p-8 border-2 border-blue-200 shadow-lg"
                >
                  <div className="text-center space-y-6">
                    <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto">
                      <Shield className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-blue-900 mb-2">🎓 Get Your Official Food Safety Certificate</h3>
                      <p className="text-blue-700">Complete your certification journey with a FREE official Food Safety Basics certificate from SkillsPass NL.</p>
                    </div>
                    <div className="bg-blue-100 rounded-2xl p-4 space-y-4">
                      <div className="text-left">
                        <div className="flex items-center gap-2 mb-3">
                          <Trophy className="h-5 w-5 text-blue-600" />
                          <p className="font-semibold text-blue-800">Why Get This Official Certificate:</p>
                        </div>
                        <div className="space-y-2 text-sm text-blue-700">
                          <div className="flex items-start gap-2">
                            <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">✓</span>
                            <span>Recognized by employers & health authorities</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">✓</span>
                            <span>100% FREE certification - no hidden costs</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">✓</span>
                            <span>Lifetime digital certificate access</span>
                          </div>
                        </div>
                        <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                          <p className="text-xs text-blue-600">
                            <span className="font-semibold">✨ Bonus:</span> Access 35+ additional FREE training programs
                          </p>
                        </div>
                      </div>
                      <Button 
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                        onClick={() => {
                          window.open('https://skillspassnl.com', '_blank', 'noopener,noreferrer');
                        }}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Get Your FREE Official Certificate
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Application Status - Dynamic based on access level */}
              {!hasFullAccess && safeTrainingAccess?.applicationInfo?.message && safeTrainingAccess?.applicationInfo?.canApply && (
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
                        <p className="text-yellow-800">{safeTrainingAccess.applicationInfo.message}</p>
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

              {/* Application Status Info - For users with active applications */}
              {!hasFullAccess && safeTrainingAccess?.applicationInfo?.message && !safeTrainingAccess?.applicationInfo?.canApply && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl p-8 border-2 border-blue-200 shadow-lg"
                >
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Clock className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-blue-900 mb-2">Application Status</h3>
                        <p className="text-blue-800">{safeTrainingAccess.applicationInfo.message}</p>
                      </div>
                    </div>
                    <Button 
                      asChild
                      className="w-full bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-semibold py-3"
                    >
                      <Link href="/dashboard">
                        <FileText className="h-5 w-5 mr-2" />
                        Check Application Status
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