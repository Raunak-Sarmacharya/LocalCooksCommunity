import { Badge } from '@/components/ui/badge';
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

  return (
    <div className={cn("bg-white rounded-2xl border shadow-sm", className)}>
      {/* Header with Your Progress UI Style */}
      <div className="p-4 sm:p-6 border-b">
        <div className="flex items-center gap-3 mb-4 lg:mb-6">
          <div className="w-8 h-8 lg:w-10 lg:h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <TrendingUp className="h-4 w-4 lg:h-5 lg:w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900">Your Progress</h3>
            <p className="text-sm text-gray-600">Complete all videos to earn your food safety certification</p>
          </div>
          {allCompleted && (
            <Badge variant="secondary" className="bg-green-100 text-green-800 self-start">
              <Award className="h-4 w-4 mr-1 flex-shrink-0" />
              <span className="whitespace-nowrap">Completed</span>
            </Badge>
          )}
        </div>

        {/* Overall Progress with Your Progress UI Style */}
        <div className="space-y-3 lg:space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xl lg:text-2xl font-bold text-primary">{Math.round(overallProgress)}%</span>
            <span className="text-xs lg:text-sm text-gray-600">{completedCount} of {totalCount} complete</span>
          </div>
          
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <motion.div
              className="bg-gradient-to-r from-primary to-blue-600 h-2 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </div>
          
          <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500">
            <span className="whitespace-nowrap">{Math.round(overallProgress)}% complete</span>
          </div>
        </div>
      </div>

      {/* Clickable Video List */}
      {showDetailed && (
        <div className="p-4 sm:p-6">
          <div className="space-y-3">
            {videos.map((video, index) => {
              const isCurrent = currentVideoId === video.id;
              const isClickable = !!onVideoClick;
              
              // Access control logic - same as bottom panel
              let canAccess = false;
              let isAccessLocked = false;
              
              if (completionConfirmed || userRole === 'admin') {
                canAccess = true;
              } else if (accessLevel === 'full') {
                const previousCompleted = index === 0 || userProgress.find(p => p.videoId === currentModuleVideos[index - 1]?.id)?.completed || false;
                canAccess = index === 0 || previousCompleted;
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
                      // Will be handled by the parent component
                      onVideoClick?.(video.id, index);
                    }
                  }}
                  className={cn(
                    "flex items-start p-3 rounded-lg border transition-all duration-200",
                    video.completed 
                      ? "bg-green-50 border-green-200" 
                      : video.progress > 0 
                        ? "bg-blue-50 border-blue-200"
                        : isAccessLocked
                          ? "bg-gray-50/50 border-gray-200 opacity-60"
                          : "bg-gray-50 border-gray-200",
                    isCurrent && !isAccessLocked && "ring-2 ring-primary/20 border-primary/30",
                    isClickable && canAccess && "cursor-pointer hover:shadow-sm hover:scale-[1.02]",
                    isClickable && isAccessLocked && accessLevel === 'limited' && "cursor-pointer hover:opacity-80"
                  )}
                >
                  {/* Video Number & Status Icon */}
                  <div className="flex items-center gap-3 flex-shrink-0 mr-3">
                    <div 
                      className={cn(
                        "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-colors",
                        video.completed 
                          ? "bg-green-500 text-white"
                          : video.progress > 0
                            ? "bg-blue-500 text-white"
                            : isCurrent && !isAccessLocked
                              ? "bg-primary text-white"
                              : isAccessLocked
                                ? "bg-gray-300 text-gray-500"
                                : "bg-gray-300 text-gray-600"
                      )}
                    >
                      {index + 1}
                    </div>
                    {video.completed ? (
                      <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-500 flex-shrink-0" />
                    ) : isAccessLocked ? (
                      <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 flex-shrink-0" />
                    ) : video.progress > 0 ? (
                      <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-blue-500 flex-shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 flex-shrink-0" />
                    )}
                  </div>

                  {/* Video Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0 sm:justify-between">
                      <h4 className={cn(
                        "font-medium text-sm break-words leading-tight",
                        video.completed ? "text-green-900" : 
                        isCurrent && !isAccessLocked ? "text-primary" : 
                        isAccessLocked ? "text-gray-500" : "text-gray-900"
                      )}>
                        {video.title}
                      </h4>
                      <span className={cn(
                        "text-xs whitespace-nowrap flex-shrink-0",
                        isAccessLocked ? "text-gray-400" : "text-gray-500"
                      )}>
                        {video.duration}
                      </span>
                    </div>
                    
                    {/* Progress Bar for Individual Video */}
                    {video.progress > 0 && !video.completed && !isAccessLocked && (
                      <div className="mt-2">
                        <Progress value={video.progress} className="h-1.5" />
                        <span className="text-xs text-gray-500 mt-1 block">
                          {Math.round(video.progress)}% watched
                        </span>
                      </div>
                    )}

                    {/* Completion Info */}
                    {video.completed && video.completedAt && (
                      <p className="text-xs text-green-600 mt-1 break-words">
                        Completed on {new Date(video.completedAt).toLocaleDateString()}
                      </p>
                    )}

                    {/* In Progress Info */}
                    {video.progress > 0 && !video.completed && video.startedAt && !isAccessLocked && (
                      <p className="text-xs text-blue-600 mt-1 break-words">
                        Started on {new Date(video.startedAt).toLocaleDateString()}
                      </p>
                    )}

                    {/* Access Locked Info */}
                    {isAccessLocked && accessLevel === 'limited' && (
                      <p className="text-xs text-gray-500 mt-1 break-words">
                        Complete application to access
                      </p>
                    )}
                    
                    {isAccessLocked && accessLevel === 'full' && index > 0 && (
                      <p className="text-xs text-gray-500 mt-1 break-words">
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

      {/* Completion Message */}
      {allCompleted && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Award className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-green-900 break-words">
                  Congratulations! Training Complete
                </h4>
                <p className="text-sm text-green-700 mt-1 break-words leading-relaxed">
                  Congratulations! You have completed all food safety training videos. You can now proceed and download your completion certificate.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 