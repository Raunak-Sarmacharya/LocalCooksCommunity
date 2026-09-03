import { logger } from "@/lib/logger";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { QuietNotice } from '@/components/chef/ui';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Award, CheckCircle, Clock, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface Application {
  id: number;
  status: string;
  createdAt: string;
}

interface UnlockProgressProps {
  hasApprovedApplication: boolean;
  className?: string;
}

type StepStatus = 'completed' | 'current' | 'pending' | 'rejected' | 'waiting';

function stepBadgeVariant(status: StepStatus): 'success' | 'warning' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'current':
      return 'outline';
    case 'pending':
      return 'warning';
    case 'rejected':
      return 'destructive';
    default:
      return 'outline';
  }
}

function stepBadgeLabel(status: StepStatus, t: TFunction<'chef'>): string {
  switch (status) {
    case 'completed':
      return t('upBadgeDone');
    case 'current':
      return t('upBadgeAction');
    case 'pending':
      return t('upBadgeReview');
    case 'rejected':
      return t('upBadgeUpdate');
    default:
      return t('upBadgeWait');
  }
}

export default function UnlockProgress({ hasApprovedApplication, className = "" }: UnlockProgressProps) {
  const { t } = useTranslation('chef');
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
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;

      if (!currentUser) return;

      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/applications/my', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
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
      logger.error('Failed to fetch applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const activeApplications = applications.filter(app =>
    app.status !== 'cancelled' && app.status !== 'rejected'
  );
  const hasSubmittedApplication = activeApplications.length > 0;
  const latestApplication = activeApplications[0];
  const isApplicationApproved = hasApprovedApplication;
  const isApplicationPending = latestApplication?.status === 'inReview';
  const isApplicationRejected = latestApplication?.status === 'rejected';

  const hasRejectedApplications = applications.some(app => app.status === 'rejected');
  const hasCancelledApplications = applications.some(app => app.status === 'cancelled');

  let progressPercentage = 20;
  let currentStep = 2;

  if (hasSubmittedApplication) {
    progressPercentage = 50;
    currentStep = 3;

    if (isApplicationApproved) {
      progressPercentage = 100;
      currentStep = 4;
    } else if (isApplicationPending) {
      progressPercentage = 75;
      currentStep = 3;
    }
  } else if (hasRejectedApplications || hasCancelledApplications) {
    progressPercentage = 20;
    currentStep = 2;
  }

  const steps = [
    {
      id: 1,
      title: t('upStepCreateAccount'),
      description: t('upStepCreateAccountDesc'),
      status: "completed" as StepStatus,
      icon: CheckCircle,
      action: null as string | null,
    },
    {
      id: 2,
      title: t('upStepSubmitApplication'),
      description: hasRejectedApplications ? t('upStepSubmitNewApplication') :
        hasCancelledApplications ? t('upStepSubmitNewApplication') :
          t('upStepSubmitApplicationDesc'),
      status: (hasSubmittedApplication ? "completed" : "current") as StepStatus,
      icon: hasSubmittedApplication ? CheckCircle : FileText,
      action: !hasSubmittedApplication ? "/dashboard?view=applications&action=new" : null
    },
    {
      id: 3,
      title: t('upStepGetApproved'),
      description: t('upStepGetApprovedDesc'),
      status: (isApplicationApproved ? "completed" :
        isApplicationPending ? "pending" :
          isApplicationRejected ? "rejected" : "waiting") as StepStatus,
      icon: isApplicationApproved ? CheckCircle :
        isApplicationPending ? Clock :
          isApplicationRejected ? AlertCircle : Clock,
      action: null as string | null,
    }
  ];

  const statusTitle = isApplicationApproved ? t('upStatusTrainingAvailable')
    : isApplicationPending ? t('upStatusUnderReview')
      : hasSubmittedApplication ? t('upStatusSubmitted')
        : hasRejectedApplications ? t('upStatusReadyToReapply')
          : hasCancelledApplications ? t('upStatusReadyToApplyAgain')
            : t('upStatusReadyToApply');

  const statusDescription = isApplicationApproved ? t('upDescTrainingAvailable')
    : isApplicationPending ? t('upDescUnderReview')
      : hasSubmittedApplication ? t('upDescSubmitted')
        : hasRejectedApplications ? t('upDescRejected')
          : hasCancelledApplications ? t('upDescCancelled')
            : t('upDescReadyToApply');

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <Card className="overflow-hidden border shadow-none">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="h-5 w-5 text-primary flex-shrink-0" />
            <span>{t('upTitle')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
              <span className="font-medium text-sm">{t('upApplicationProgress')}</span>
              <Badge variant="outline" className="text-xs font-medium w-fit">
                {t('upPercentComplete', { percent: progressPercentage })}
              </Badge>
            </div>
            <Progress value={progressPercentage} className="h-2.5" />
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div className="text-center">
                <span className="block">{t('upAccountCreated')}</span>
                <span className="block">{t('upCreated')}</span>
              </div>
              <div className="text-center">
                <span className="block">{t('upApplicationSubmitted')}</span>
                <span className="block">{t('upSubmitted')}</span>
              </div>
              <div className="text-center">
                <span className="block">{t('upApprovedReady')}</span>
                <span className="block">{t('upReady')}</span>
              </div>
            </div>
          </div>

          <QuietNotice title={statusTitle}>
            {statusDescription}
          </QuietNotice>

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
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border transition-all duration-200",
                    isActive && "border-primary/40 bg-muted/30",
                    !isActive && "border-border bg-card"
                  )}
                >
                  <div className="p-2 rounded-lg border bg-muted flex-shrink-0">
                    <Icon className={cn(
                      "h-4 w-4",
                      step.status === 'completed' && "text-success",
                      step.status === 'pending' && "text-warning",
                      step.status === 'rejected' && "text-destructive",
                      (step.status === 'current' || step.status === 'waiting') && "text-muted-foreground"
                    )} />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium text-sm">{step.title}</h4>
                      <Badge variant={stepBadgeVariant(step.status)} className="text-xs px-2 py-0.5">
                        {stepBadgeLabel(step.status, t)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>

                    {step.action && step.status === 'current' && (
                      <Button asChild size="sm" className="mt-2 h-8 text-xs">
                        <Link href={step.action}>
                          {t('upStartApplication')}
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    )}

                    {step.status === 'rejected' && (
                      <Button asChild size="sm" variant="outline" className="mt-2 h-8 text-xs">
                        <Link href="/dashboard?view=applications&action=new">
                          {t('upUpdateApplication')}
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {!isApplicationApproved && hasSubmittedApplication && (
            <div className="border-t pt-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Button asChild variant="outline" className="h-10 text-sm">
                    <Link href="/dashboard">
                      <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                      {t('upCheckApplicationStatus')}
                    </Link>
                  </Button>

                  <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                    <Link href="/">
                      {t('upLearnMoreAboutLocalCooks')}
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {(hasRejectedApplications || hasCancelledApplications) && !hasSubmittedApplication && (
            <QuietNotice title={t('upFreshStartTitle')}>
              {hasRejectedApplications
                ? t('upFreshStartRejected')
                : t('upFreshStartCancelled')}
            </QuietNotice>
          )}

          <div className="rounded-lg border p-4">
            <h4 className="font-semibold mb-3 text-sm">{t('upWhatYouAccess')}</h4>
            <div className="grid grid-cols-1 gap-2.5 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{t('upAccessBasicsRemaining')}</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{t('upAccessHygieneModule')}</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{t('upAccessCertPrep')}</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{t('upAccessCompletionCert')}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
