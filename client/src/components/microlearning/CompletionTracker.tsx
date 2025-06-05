import React from 'react';
import { CheckCircle, Circle, Clock, Award } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface VideoProgress {
  id: string;
  title: string;
  duration: string;
  completed: boolean;
  progress: number;
  completedAt?: Date;
  startedAt?: Date;
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
      <div className="p-6 border-b">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Food Safety Training Progress
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Complete all videos to earn your food safety certification
            </p>
          </div>
          {allCompleted && (
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              <Award className="h-4 w-4 mr-1" />
              Completed
            </Badge>
          )}
        </div>

        {/* Overall Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Overall Progress</span>
            <span className="text-gray-600">
              {completedCount} of {totalCount} videos completed
            </span>
          </div>
          <Progress value={overallProgress} className="h-3" />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{Math.round(overallProgress)}% complete</span>
            <span>~{formatWatchTime(totalWatchTime)} total</span>
          </div>
        </div>
      </div>

      {/* Video List */}
      {showDetailed && (
        <div className="p-6">
          <div className="space-y-3">
            {videos.map((video, index) => (
              <div
                key={video.id}
                className={cn(
                  "flex items-center p-3 rounded-lg border transition-colors",
                  video.completed 
                    ? "bg-green-50 border-green-200" 
                    : video.progress > 0 
                      ? "bg-blue-50 border-blue-200"
                      : "bg-gray-50 border-gray-200"
                )}
              >
                {/* Video Number & Status Icon */}
                <div className="flex items-center mr-4">
                  <div 
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium mr-3",
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
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : video.progress > 0 ? (
                    <Clock className="h-5 w-5 text-blue-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-400" />
                  )}
                </div>

                {/* Video Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className={cn(
                      "font-medium text-sm truncate",
                      video.completed ? "text-green-900" : "text-gray-900"
                    )}>
                      {video.title}
                    </h4>
                    <span className="text-xs text-gray-500 ml-2">
                      {video.duration}
                    </span>
                  </div>
                  
                  {/* Progress Bar for Individual Video */}
                  {video.progress > 0 && !video.completed && (
                    <div className="mt-2">
                      <Progress value={video.progress} className="h-1.5" />
                      <span className="text-xs text-gray-500 mt-1">
                        {Math.round(video.progress)}% watched
                      </span>
                    </div>
                  )}

                  {/* Completion Info */}
                  {video.completed && video.completedAt && (
                    <p className="text-xs text-green-600 mt-1">
                      Completed on {video.completedAt.toLocaleDateString()}
                    </p>
                  )}

                  {/* In Progress Info */}
                  {video.progress > 0 && !video.completed && video.startedAt && (
                    <p className="text-xs text-blue-600 mt-1">
                      Started on {video.startedAt.toLocaleDateString()}
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
        <div className="px-6 pb-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center">
              <Award className="h-5 w-5 text-green-500 mr-2" />
              <div>
                <h4 className="font-medium text-green-900">
                  Congratulations! Training Complete
                </h4>
                <p className="text-sm text-green-700 mt-1">
                  You've successfully completed all food safety training videos. 
                  You can now proceed with your certification.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 