import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useFirebaseAuth } from '@/hooks/use-auth';
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
  const { user } = useFirebaseAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.uid) {
      fetchApplications();
    }
  }, [user]);

  const fetchApplications = async () => {
    try {
      const response = await fetch('/api/applications/my-applications', {
        credentials: 'include',
        headers: {
          'X-User-ID': user?.uid || ''
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
      setLoading(false);
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
  const isApplicationPending = latestApplication?.status === 'inReview';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <Card className="overflow-hidden border border-gray-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="h-5 w-5 text-primary flex-shrink-0" />
            <span>Unlock Full Training Access</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Progress Bar */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
              <span className="font-medium text-sm text-gray-900">Progress to Full Access</span>
              <Badge variant="secondary" className="text-xs font-medium w-fit">
                {progressPercentage}% Complete
              </Badge>
            </div>
            <Progress value={progressPercentage} className="h-2.5" />
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
              <div className="text-center">
                <span className="block">Account</span>
                <span className="block">Created</span>
              </div>
              <div className="text-center">
                <span className="block">Application</span>
                <span className="block">Submitted</span>
              </div>
              <div className="text-center">
                <span className="block">Approved</span>
                <span className="block">Access</span>
              </div>
            </div>
          </div>

          {/* Current Status */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="bg-blue-100 p-2.5 rounded-xl flex-shrink-0">
                <ChefHat className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <h3 className="font-semibold text-blue-900 text-sm">
                  {isApplicationApproved ? "🎉 Full Access Unlocked!" :
                   isApplicationPending ? "⏳ Application Under Review" :
                   hasSubmittedApplication ? "✅ Application Submitted" :
                   hasRejectedApplications ? "🔄 Ready to Reapply" :
                   hasCancelledApplications ? "🔄 Ready to Apply Again" :
                   "🚀 Ready to Apply"}
                </h3>
                <p className="text-blue-700 text-sm leading-relaxed">
                  {isApplicationApproved ? "You now have access to all training videos!" :
                   isApplicationPending ? "Our team is reviewing your application. You'll be notified once approved." :
                   hasSubmittedApplication ? "Great! Your application is in our system." :
                   hasRejectedApplications ? "Your previous application was not approved. You can submit a new application anytime." :
                   hasCancelledApplications ? "Your previous application was cancelled. Feel free to submit a new one!" :
                   "Complete your chef application to unlock all training videos."}
                </p>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              
              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-all duration-200
                    ${isActive ? 'border-primary bg-primary/5 shadow-sm' : 'border-gray-200 bg-gray-50/50'}
                    ${step.status === 'completed' ? 'border-green-200 bg-green-50/50' : ''}
                    ${step.status === 'rejected' ? 'border-red-200 bg-red-50/50' : ''}
                  `}
                >
                  <div className={`p-2 rounded-lg ${step.bgColor} flex-shrink-0`}>
                    <Icon className={`h-4 w-4 ${step.color}`} />
                  </div>
                  
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium text-sm text-gray-900">{step.title}</h4>
                      <Badge
                        variant="outline"
                        className={`text-xs px-2 py-0.5
                          ${step.status === 'completed' ? 'bg-green-100 text-green-800 border-green-300' : ''}
                          ${step.status === 'current' ? 'bg-blue-100 text-blue-800 border-blue-300' : ''}
                          ${step.status === 'pending' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' : ''}
                          ${step.status === 'rejected' ? 'bg-red-100 text-red-800 border-red-300' : ''}
                          ${step.status === 'waiting' ? 'bg-gray-100 text-gray-600 border-gray-300' : ''}
                        `}
                      >
                        {step.status === 'completed' ? 'Done' :
                         step.status === 'current' ? 'Action' :
                         step.status === 'pending' ? 'Review' :
                         step.status === 'rejected' ? 'Update' :
                         'Wait'}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{step.description}</p>
                    
                    {step.action && step.status === 'current' && (
                      <Button asChild size="sm" className="mt-2 h-8 text-xs">
                        <Link href={step.action}>
                          Start Application
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    )}

                    {step.status === 'rejected' && (
                      <Button asChild size="sm" variant="outline" className="mt-2 h-8 text-xs">
                        <Link href="/apply">
                          Update Application
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Action Section */}
          {!isApplicationApproved && (
            <div className="border-t border-gray-200 pt-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  {!hasSubmittedApplication ? (
                    <Button asChild className="h-10 text-sm font-medium">
                      <Link href="/apply">
                        <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                        {hasRejectedApplications || hasCancelledApplications ? 
                          "Submit New Application" : 
                          "Start Application Now"}
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" className="h-10 text-sm">
                      <Link href="/dashboard">
                        <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                        Check Application Status
                      </Link>
                    </Button>
                  )}
                  
                  <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-gray-600">
                    <Link href="/">
                      Learn More About LocalCooks
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Previous Application Notice */}
          {(hasRejectedApplications || hasCancelledApplications) && !hasSubmittedApplication && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="flex items-start gap-2 text-amber-800 text-xs">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <span className="font-medium block">Fresh Start Available</span>
                  <span className="leading-relaxed">
                    {hasRejectedApplications ? 
                      "Submit a new application anytime with updated information." :
                      "You can submit a new application whenever you're ready!"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Benefits Preview */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4">
            <h4 className="font-semibold text-gray-900 mb-3 text-sm">🎓 What You'll Unlock:</h4>
            <div className="grid grid-cols-1 gap-2.5 text-sm text-gray-700">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">13 remaining videos from Food Safety Basics module</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">1 additional training module (Safety & Hygiene How-To's)</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">Food Safety Certification Preparation Content</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">Completion Certificate</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 