import { logger } from "@/lib/logger";
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { SKILLSPASS_OFFICIAL_CERT_URL } from '@/config/skillspass';
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Download,
  ExternalLink,
  Play,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChefPageHeader } from "@/components/chef/ui";
import TrainingVideoPlayer from './TrainingVideoPlayer';
import { tt } from "@/i18n/common-ns";
import { ct } from "@/i18n/chef-ns";

type ViewMode = 'overview' | 'player';

interface TrainingOverviewPanelProps {
  className?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

interface VideoProgressItem {
  videoId?: string;
  completed?: boolean;
}

const BASICS_VIDEO_COUNT = 14;
const HYGIENE_VIDEO_COUNT = 8;
const TOTAL_VIDEOS = BASICS_VIDEO_COUNT + HYGIENE_VIDEO_COUNT;

const TRAINING_MODULES = [
  {
    id: 'basics',
    videoIdPrefix: 'basics-',
    titleKey: 'trModuleBasics',
    videoCount: BASICS_VIDEO_COUNT,
    descriptionKey: 'trModuleBasicsDesc',
  },
  {
    id: 'hygiene',
    videoIdPrefix: 'howto-',
    titleKey: 'trModuleHygiene',
    videoCount: HYGIENE_VIDEO_COUNT,
    descriptionKey: 'trModuleHygieneDesc',
  },
] as const;

export default function TrainingOverviewPanel({ className, viewMode: controlledViewMode, onViewModeChange }: TrainingOverviewPanelProps) {
  const { t } = useTranslation('chef');
  const { user: firebaseUser } = useFirebaseAuth();
  const { showAlert } = useCustomAlerts();
  const [isDownloading, setIsDownloading] = useState(false);
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('overview');

  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;
  const user = firebaseUser;

  const { data: trainingAccess, isLoading: isLoadingTrainingAccess } = useQuery({
    queryKey: ["training-access", user?.uid],
    queryFn: async () => {
      if (!user) return null;

      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error(tt("noAuthenticatedUser"));
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
              accessLevel: 'full',
              progress: [],
            };
          }
          throw new Error(`Failed to fetch training access: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        logger.error("Error fetching training access:", error);
        return {
          accessLevel: 'full',
          progress: [],
        };
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const { data: microlearningCompletion, isLoading: isLoadingCompletion } = useQuery({
    queryKey: ["microlearning-completion", user?.uid],
    queryFn: async () => {
      if (!user) return null;

      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error(tt("noAuthenticatedUser"));
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
        logger.error("Error fetching microlearning completion:", error);
        return null;
      }
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const isLoading = isLoadingTrainingAccess || isLoadingCompletion;
  const isCompleted = Boolean(microlearningCompletion?.completion?.confirmed || microlearningCompletion?.confirmed);
  const videoProgress: VideoProgressItem[] = trainingAccess?.progress || [];
  const completedVideos = videoProgress.filter((item) => item.completed).length;

  if (viewMode === 'player') {
    return (
      <TrainingVideoPlayer
        className={className}
      />
    );
  }

  const openPlayer = () => setViewMode('player');

  const downloadCertificate = async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        showAlert({
          title: t("trAuthRequiredTitle"),
          description: t("trAuthRequiredBody"),
          type: "error"
        });
        return;
      }

      setIsDownloading(true);
      const token = await currentUser.getIdToken();

      const response = await fetch(`/api/firebase/microlearning/certificate/${currentUser.uid}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(ct("failedToDownloadCertificate"));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `LocalCooks-Certificate-${currentUser.displayName || currentUser.email || 'user'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showAlert({
        title: t("trCertSuccessTitle"),
        description: t("trCertSuccessBody"),
        type: "success"
      });
    } catch (error) {
      logger.error('Error downloading certificate:', error);
      showAlert({
        title: t("trCertFailTitle"),
        description: t("trCertFailBody"),
        type: "error"
      });
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return <TrainingOverviewSkeleton className={className} />;
  }

  const videoCtaLabel = isCompleted
    ? t('trReviewVideos')
    : completedVideos > 0
      ? t('trContinueVideos')
      : t('trStartVideos');

  return (
    <div className={cn("space-y-6", className)}>
      <ChefPageHeader
        title={t("trPageTitle")}
        description={t("trPageDesc")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrackCard
          icon={Shield}
          label={t("trOfficialLabel")}
          title={t("trOfficialTitle")}
          description={t("trOfficialDesc")}
          meta={t("trOfficialMeta")}
          action={
            <Button asChild variant="outline" className="w-full">
              <a href={SKILLSPASS_OFFICIAL_CERT_URL} target="_blank" rel="noopener noreferrer">
                {t("trOfficialCta")}
                <ExternalLink className="h-4 w-4" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Button>
          }
        />

        <TrackCard
          icon={BookOpen}
          label={t("trLocalLabel")}
          title={t("trLocalTitle")}
          description={t("trLocalDesc", { count: TOTAL_VIDEOS })}
          meta={isCompleted ? t('trMetaComplete') : completedVideos > 0 ? t('trMetaProgress', { done: completedVideos, total: TOTAL_VIDEOS }) : t('trMetaSelfPaced', { count: TOTAL_VIDEOS })}
          action={
            isCompleted ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={downloadCertificate} disabled={isDownloading}>
                  <Download className="h-4 w-4" />
                  {isDownloading ? t('trDownloading') : t('trDownload')}
                </Button>
                <Button onClick={openPlayer}>
                  {videoCtaLabel}
                </Button>
              </div>
            ) : (
              <Button onClick={openPlayer} className="w-full">
                <Play className="h-4 w-4" />
                {videoCtaLabel}
              </Button>
            )
          }
        />
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-5 pt-5">
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <h3 className="font-semibold text-foreground">{t("trModulesHeading")}</h3>
            <p className="text-sm text-muted-foreground tabular-nums">{t("trVideosCount", { count: TOTAL_VIDEOS })}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {TRAINING_MODULES.map((module) => {
              const completedInModule = videoProgress.filter(
                (item) => item.completed && item.videoId?.startsWith(module.videoIdPrefix)
              ).length;
              const modulePercent = Math.round((completedInModule / module.videoCount) * 100);

              return (
                <div key={module.id} className="rounded-lg border border-border/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-medium text-sm text-foreground">{t(module.titleKey)}</h4>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {completedInModule}/{module.videoCount}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                    {t(module.descriptionKey)}
                  </p>
                  <Progress value={modulePercent} className="h-1.5 bg-muted mt-3" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TrackCard({
  icon: Icon,
  label,
  title,
  description,
  meta,
  action,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  description: string;
  meta: string;
  action: ReactNode;
}) {
  return (
    <Card className="border-border/50 shadow-sm h-full">
      <CardContent className="p-5 pt-5 flex flex-col h-full">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <h3 className="font-semibold text-foreground mt-0.5">{title}</h3>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-4 leading-relaxed flex-1">
          {description}
        </p>
        <p className="text-xs text-muted-foreground mt-4">{meta}</p>
        <div className="mt-4">{action}</div>
      </CardContent>
    </Card>
  );
}

function TrainingOverviewSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}
