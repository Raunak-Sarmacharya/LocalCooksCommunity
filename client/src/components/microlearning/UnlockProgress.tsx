import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/use-auth';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Award, CheckCircle, ChefHat, Clock, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';

interface Application {
  id: number;
  status: string;
  createdAt: string;
}

interface UnlockProgressProps {
  hasApprovedApplication: boolean;
  className?: string;
}

export default function UnlockProgress({ hasApprovedApplication, className = "" }: UnlockProgressProps) {
  const { user } = useAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      fetchApplications();
    }
  }, [user]);

  const fetchApplications = async () => {
    try {
      const response = await fetch('/api/applications/my-applications', {
        credentials: 'include',
        headers: {
          'X-User-ID': user?.id?.toString() || ''
        }
      });

      if (response.ok) {
        const data = await response.json();
        const normalizedData = data.map((app: any) => ({
          id: app.id,
          status: app.status,
          createdAt: app.created_at || app.createdAt
        }));
        setApplications(normalizedData);
      }
    } catch (error) {
      console.error('Failed to fetch applications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Determine current step and progress
  // Only consider active applications (not cancelled or rejected)
  const activeApplications = applications.filter(app => 
    app.status !== 'cancelled' && app.status !== 'rejected'
  );
  const hasSubmittedApplication = activeApplications.length > 0;
  const latestApplication = activeApplications[0];
  const isApplicationApproved = hasApprovedApplication;
  const isApplicationPending = latestApplication?.status === 'new' || latestApplication?.status === 'inReview';
  const isApplicationRejected = latestApplication?.status === 'rejected';
  
  // Check if user has any rejected applications (for messaging purposes)
  const hasRejectedApplications = applications.some(app => app.status === 'rejected');
  const hasCancelledApplications = applications.some(app => app.status === 'cancelled');

  // Calculate progress percentage
  let progressPercentage = 20; // Account created
  let currentStep = 2; // Default to needing to submit application

  if (hasSubmittedApplication) {
    progressPercentage = 50;
    currentStep = 3; // Waiting for approval
    
    if (isApplicationApproved) {
      progressPercentage = 100;
      currentStep = 4; // Completed
    } else if (isApplicationPending) {
      progressPercentage = 75;
      currentStep = 3;
    }
  } else if (hasRejectedApplications || hasCancelledApplications) {
    // User had applications before but they were rejected/cancelled
    // Keep them at the "submit application" step but show they need to reapply
    progressPercentage = 20;
    currentStep = 2;
  }

  const steps = [
    {
      id: 1,
      title: "Create Account",
      description: "Sign up for LocalCooks",
      status: "completed",
      icon: CheckCircle,
      color: "text-green-600",
      bgColor: "bg-green-100"
    },
    {
      id: 2,
      title: "Submit Application",
      description: hasRejectedApplications ? "Submit a new application" : 
                   hasCancelledApplications ? "Submit a new application" :
                   "Complete your chef application",
      status: hasSubmittedApplication ? "completed" : "current",
      icon: hasSubmittedApplication ? CheckCircle : FileText,
      color: hasSubmittedApplication ? "text-green-600" : "text-blue-600",
      bgColor: hasSubmittedApplication ? "bg-green-100" : "bg-blue-100",
      action: !hasSubmittedApplication ? "/apply" : null
    },
    {
      id: 3,
      title: "Get Approved",
      description: "Wait for application review",
      status: isApplicationApproved ? "completed" : 
             isApplicationPending ? "pending" : 
             isApplicationRejected ? "rejected" : "waiting",
      icon: isApplicationApproved ? CheckCircle : 
            isApplicationPending ? Clock : 
            isApplicationRejected ? AlertCircle : Clock,
      color: isApplicationApproved ? "text-green-600" : 
             isApplicationPending ? "text-yellow-600" : 
             isApplicationRejected ? "text-red-600" : "text-gray-400",
      bgColor: isApplicationApproved ? "bg-green-100" : 
               isApplicationPending ? "bg-yellow-100" : 
               isApplicationRejected ? "bg-red-100" : "bg-gray-100"
    }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 relative ${className}`}>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            Unlock Full Training Access
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 relative overflow-hidden">
          {/* Progress Bar */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-medium text-sm">Progress to Full Access</span>
              <span className="text-gray-600 text-sm">{progressPercentage}% Complete</span>
            </div>
            <Progress value={progressPercentage} className="h-3" />
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 text-center">
              <span className="break-words">Account Created</span>
              <span className="break-words">Application Submitted</span>
              <span className="break-words">Approved</span>
            </div>
          </div>

          {/* Current Status */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="bg-blue-100 p-2 rounded-full flex-shrink-0">
                <ChefHat className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-blue-900 mb-2 break-words">
                  {isApplicationApproved ? "🎉 Full Access Unlocked!" :
                   isApplicationPending ? "⏳ Application Under Review" :
                   hasSubmittedApplication ? "✅ Application Submitted" :
                   hasRejectedApplications ? "🔄 Ready to Reapply" :
                   hasCancelledApplications ? "🔄 Ready to Apply Again" :
                   "🚀 Ready to Apply"}
                </h3>
                <p className="text-blue-700 text-sm leading-relaxed break-words">
                  {isApplicationApproved ? "You now have access to all 10 training modules!" :
                   isApplicationPending ? "Our team is reviewing your application. You'll be notified once approved." :
                   hasSubmittedApplication ? "Great! Your application is in our system." :
                   hasRejectedApplications ? "Your previous application was not approved. You can submit a new application anytime." :
                   hasCancelledApplications ? "Your previous application was cancelled. Feel free to submit a new one!" :
                   "Complete your chef application to unlock all training modules."}
                </p>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              
              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`flex items-center gap-4 p-4 rounded-lg border-2 transition-all relative overflow-hidden
                    ${isActive ? 'border-primary bg-primary/5' : 'border-gray-200 bg-gray-50'}
                    ${step.status === 'completed' ? 'border-green-200 bg-green-50' : ''}
                    ${step.status === 'rejected' ? 'border-red-200 bg-red-50' : ''}
                  `}
                >
                  <div className={`p-2 rounded-full ${step.bgColor}`}>
                    <Icon className={`h-5 w-5 ${step.color}`} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-medium truncate">{step.title}</h4>
                      <Badge
                        variant="outline"
                        className={`text-xs
                          ${step.status === 'completed' ? 'bg-green-100 text-green-800 border-green-300' : ''}
                          ${step.status === 'current' ? 'bg-blue-100 text-blue-800 border-blue-300' : ''}
                          ${step.status === 'pending' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' : ''}
                          ${step.status === 'rejected' ? 'bg-red-100 text-red-800 border-red-300' : ''}
                          ${step.status === 'waiting' ? 'bg-gray-100 text-gray-600 border-gray-300' : ''}
                        `}
                      >
                        {step.status === 'completed' ? 'Completed' :
                         step.status === 'current' ? 'Action Needed' :
                         step.status === 'pending' ? 'In Review' :
                         step.status === 'rejected' ? 'Needs Update' :
                         'Waiting'}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 break-words leading-relaxed">{step.description}</p>
                  </div>

                  {step.action && step.status === 'current' && (
                    <Button asChild size="sm" className="ml-auto flex-shrink-0">
                      <Link href={step.action}>
                        <span className="hidden sm:inline">Start Application</span>
                        <span className="sm:hidden">Start</span>
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  )}

                  {step.status === 'rejected' && (
                    <Button asChild size="sm" variant="outline" className="ml-auto flex-shrink-0">
                      <Link href="/apply">
                        <span className="hidden sm:inline">Update Application</span>
                        <span className="sm:hidden">Update</span>
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Action Section */}
          {!isApplicationApproved && (
            <div className="border-t pt-6">
              <div className="flex flex-col gap-3 relative z-10">
                <div className="flex flex-col sm:flex-row gap-3">
                  {!hasSubmittedApplication ? (
                    <Button asChild className="flex-1 min-w-0">
                      <Link href="/apply">
                        <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span className="truncate">
                          {hasRejectedApplications || hasCancelledApplications ? 
                            "Submit New Application" : 
                            "Start Application Now"}
                        </span>
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" className="flex-1 min-w-0">
                      <Link href="/dashboard">
                        <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span className="truncate">Check Application Status</span>
                      </Link>
                    </Button>
                  )}
                  
                  <Button asChild variant="outline" className="min-w-0 sm:flex-shrink-0">
                    <Link href="/">
                      <span className="truncate">Learn More About LocalCooks</span>
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Previous Application Notice */}
          {(hasRejectedApplications || hasCancelledApplications) && !hasSubmittedApplication && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 relative z-10">
              <div className="flex items-start gap-3 text-yellow-800 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">Fresh Start:</span>
                  <span className="ml-1 break-words">
                    {hasRejectedApplications ? 
                      "Your previous application was not approved, but you can submit a new one anytime with updated information." :
                      "Your previous application was cancelled. You're welcome to submit a new application whenever you're ready!"
                    }
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Benefits Preview */}
          <div className="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">🎓 What You'll Unlock:</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3 text-green-600" />
                <span>9 Additional Training Modules</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3 text-green-600" />
                <span>NL Food Handler Certification</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3 text-green-600" />
                <span>Government-Approved Content</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3 text-green-600" />
                <span>Official Completion Certificate</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 