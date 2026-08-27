import { Badge } from '@/components/ui/badge';
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Award, CheckCircle, Circle, Clock, Lock, TrendingUp } from 'lucide-react';

interface VideoProgress {
  id: string;
  title: string;
  duration: string;
  completed: boolean;
  progress: number;
  completedAt?: Date | string;
  startedAt?: Date | string;
}

interface CompletionTrackerProps {
  videos: VideoProgress[];
  overallProgress: number;
  completedCount: number;
  totalCount: number;
  className?: string;
  showDetailed?: boolean;
  onVideoClick?: (videoId: string, videoIndex: number) => void;
  currentVideoId?: string;
  accessLevel?: 'limited' | 'full';
  completionConfirmed?: boolean;
  userRole?: string;
  currentModuleVideos?: any[];
  userProgress?: any[];
}

export default function CompletionTracker({
  videos,
  overallProgress,
  completedCount,
  totalCount,
  className = "",
  showDetailed = true,
  onVideoClick,
  currentVideoId,
  accessLevel = 'full',
  completionConfirmed = false,
  userRole,
  currentModuleVideos = [],
  userProgress = []
}: CompletionTrackerProps) {
  const allCompleted = completedCount === totalCount;
  const { showAlert } = useCustomAlerts();

  return (
    <div className={cn("bg-card rounded-lg border shadow-none", className)}>
      <div className="p-4 sm:p-6 border-b">
        <div className="flex items-center gap-3 mb-4 lg:mb-6">
          <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg border flex items-center justify-center flex-shrink-0">
            <TrendingUp className="h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground">Your Progress</h3>
            <p className="text-sm text-muted-foreground">Complete all videos to earn your food safety certification</p>
          </div>
          {allCompleted && (
            <Badge variant="success" className="self-start">
              <Award className="h-4 w-4 mr-1 flex-shrink-0" />
              <span className="whitespace-nowrap">Completed</span>
            </Badge>
          )}
        </div>

        <div className="space-y-3 lg:space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xl lg:text-2xl font-bold text-foreground">{Math.round(overallProgress)}%</span>
            <span className="text-xs lg:text-sm text-muted-foreground">{completedCount} of {totalCount} complete</span>
          </div>
          
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <motion.div
              className="bg-foreground/70 h-2 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>

      {showDetailed && (
        <div className="p-4 sm:p-6">
          <div className="space-y-3">
            {videos.map((video, index) => {
              const isCurrent = currentVideoId === video.id;
              const isClickable = !!onVideoClick;
              
              let canAccess = false;
              let isAccessLocked = false;
              
              if (completionConfirmed || userRole === 'admin') {
                canAccess = true;
              } else if (accessLevel === 'full') {
                if (index === 0) {
                  canAccess = true;
                } else {
                  const previousVideo = currentModuleVideos[index - 1];
                  const previousCompleted = userProgress.find(p => p.videoId === previousVideo?.id)?.completed || false;
                  canAccess = previousCompleted;
                }
              } else {
                canAccess = index === 0;
              }
              
              isAccessLocked = !canAccess;
              
              return (
                <div
                  key={video.id}
                  onClick={() => {
                    if (isClickable && canAccess) {
                      onVideoClick?.(video.id, index);
                    } else if (isClickable && accessLevel === 'limited') {
                      onVideoClick?.(video.id, index);
                    } else if (isClickable && accessLevel === 'full' && !canAccess) {
                      showAlert({
                        title: "Access Restricted",
                        description: "Please complete the previous video before accessing this one.",
                        type: "warning"
                      });
                      return;
                    }
                  }}
                  className={cn(
                    "flex items-start p-3 rounded-lg border transition-all duration-200",
                    video.completed && "border-success/30",
                    video.progress > 0 && !video.completed && "border-border",
                    isAccessLocked && "opacity-60",
                    isCurrent && !isAccessLocked && "ring-1 ring-foreground/10 border-foreground/20",
                    isClickable && canAccess && "cursor-pointer hover:bg-muted/30",
                    isClickable && isAccessLocked && accessLevel === 'limited' && "cursor-pointer hover:opacity-80"
                  )}
                >
                  <div className="flex items-center gap-3 flex-shrink-0 mr-3">
                    <div 
                      className={cn(
                        "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium border",
                        video.completed && "bg-success text-success-foreground border-success",
                        video.progress > 0 && !video.completed && "border-border text-foreground",
                        isCurrent && !isAccessLocked && "border-foreground/30 text-foreground",
                        isAccessLocked && "border-border text-muted-foreground"
                      )}
                    >
                      {index + 1}
                    </div>
                    {video.completed ? (
                      <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-success flex-shrink-0" />
                    ) : isAccessLocked ? (
                      <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground flex-shrink-0" />
                    ) : video.progress > 0 ? (
                      <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0 sm:justify-between">
                      <h4 className={cn(
                        "font-medium text-sm break-words leading-tight",
                        isAccessLocked ? "text-muted-foreground" : "text-foreground"
                      )}>
                        {video.title}
                      </h4>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {video.duration}
                      </span>
                    </div>
                    
                    {video.progress > 0 && !video.completed && !isAccessLocked && (
                      <div className="mt-2">
                        <Progress value={video.progress} className="h-1.5" />
                        <span className="text-xs text-muted-foreground mt-1 block">
                          {Math.round(video.progress)}% watched
                        </span>
                      </div>
                    )}

                    {video.completed && video.completedAt && (
                      <p className="text-xs text-muted-foreground mt-1 break-words">
                        Completed on {new Date(video.completedAt).toLocaleDateString()}
                      </p>
                    )}

                    {isAccessLocked && accessLevel === 'limited' && (
                      <p className="text-xs text-muted-foreground mt-1 break-words">
                        Complete application to access
                      </p>
                    )}
                    
                    {isAccessLocked && accessLevel === 'full' && index > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 break-words">
                        Complete previous video first
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {allCompleted && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <Award className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-foreground break-words">
                  Congratulations! Training Complete
                </h4>
                <p className="text-sm text-muted-foreground mt-1 break-words leading-relaxed">
                  You have completed all food safety training videos. You can now proceed and download your completion certificate.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
