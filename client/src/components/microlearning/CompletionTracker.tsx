import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Award, CheckCircle, Circle, Clock } from 'lucide-react';

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
}

export default function CompletionTracker({
  videos,
  overallProgress,
  completedCount,
  totalCount,
  className = "",
  showDetailed = true
}: CompletionTrackerProps) {
  const allCompleted = completedCount === totalCount;
  const totalWatchTime = videos.reduce((acc, video) => {
    // Extract minutes from duration string (e.g., "5:30" -> 5.5 minutes)
    const [minutes, seconds] = video.duration.split(':').map(Number);
    return acc + minutes + (seconds || 0) / 60;
  }, 0);

  const formatWatchTime = (minutes: number): string => {
    if (minutes < 60) {
      return `${Math.round(minutes)} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${hours}h ${remainingMinutes}m`;
  };

  return (
    <div className={cn("bg-white rounded-lg border shadow-sm", className)}>
      {/* Header */}
      <div className="p-4 sm:p-6 border-b">
        <div className="flex flex-col gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 break-words">
              Food Safety Training Progress
            </h3>
            <p className="text-sm text-gray-600 mt-1 break-words">
              Complete all videos to earn your food safety certification
            </p>
          </div>
          {allCompleted && (
            <Badge variant="secondary" className="bg-green-100 text-green-800 self-start">
              <Award className="h-4 w-4 mr-1 flex-shrink-0" />
              <span className="whitespace-nowrap">Completed</span>
            </Badge>
          )}
        </div>

        {/* Overall Progress */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
            <span className="font-medium text-sm">Overall Progress</span>
            <span className="text-gray-600 text-sm">
              {completedCount} of {totalCount} videos completed
            </span>
          </div>
          <Progress value={overallProgress} className="h-3" />
          <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500">
            <span className="whitespace-nowrap">{Math.round(overallProgress)}% complete</span>
            <span className="whitespace-nowrap">~{formatWatchTime(totalWatchTime)} total</span>
          </div>
        </div>
      </div>

      {/* Video List */}
      {showDetailed && (
        <div className="p-4 sm:p-6">
          <div className="space-y-3">
            {videos.map((video, index) => (
              <div
                key={video.id}
                className={cn(
                  "flex items-start p-3 rounded-lg border transition-colors",
                  video.completed 
                    ? "bg-green-50 border-green-200" 
                    : video.progress > 0 
                      ? "bg-blue-50 border-blue-200"
                      : "bg-gray-50 border-gray-200"
                )}
              >
                {/* Video Number & Status Icon */}
                <div className="flex items-center gap-3 flex-shrink-0 mr-3">
                  <div 
                    className={cn(
                      "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium",
                      video.completed 
                        ? "bg-green-500 text-white"
                        : video.progress > 0
                          ? "bg-blue-500 text-white"
                          : "bg-gray-300 text-gray-600"
                    )}
                  >
                    {index + 1}
                  </div>
                  {video.completed ? (
                    <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-500 flex-shrink-0" />
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
                      video.completed ? "text-green-900" : "text-gray-900"
                    )}>
                      {video.title}
                    </h4>
                    <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                      {video.duration}
                    </span>
                  </div>
                  
                  {/* Progress Bar for Individual Video */}
                  {video.progress > 0 && !video.completed && (
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
                  {video.progress > 0 && !video.completed && video.startedAt && (
                    <p className="text-xs text-blue-600 mt-1 break-words">
                      Started on {new Date(video.startedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
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