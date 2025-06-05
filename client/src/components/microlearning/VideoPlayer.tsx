import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  videoUrl: string;
  title: string;
  duration?: number;
  onProgress?: (progress: number) => void;
  onComplete?: () => void;
  onStart?: () => void;
  isCompleted?: boolean;
  className?: string;
  autoPlay?: boolean;
  requireFullWatch?: boolean; // Requires user to watch 90% to mark complete
}

export default function VideoPlayer({
  videoUrl,
  title,
  duration,
  onProgress,
  onComplete,
  onStart,
  isCompleted = false,
  className = "",
  autoPlay = false,
  requireFullWatch = true
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(duration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [watchPercentage, setWatchPercentage] = useState(0);
  const [videoCompleted, setVideoCompleted] = useState(isCompleted);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setVideoDuration(video.duration);
      setIsLoading(false);
      setHasError(false);
    };

    const handleLoadStart = () => {
      setIsLoading(true);
      setHasError(false);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    const handleError = () => {
      setIsLoading(false);
      setHasError(true);
      setErrorMessage('Failed to load video. Please check your internet connection and try again.');
    };

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      const duration = video.duration;
      
      setCurrentTime(currentTime);
      
      if (duration > 0) {
        const progressPercent = (currentTime / duration) * 100;
        const watchPercent = Math.max(watchPercentage, progressPercent);
        
        setProgress(progressPercent);
        setWatchPercentage(watchPercent);
        
        onProgress?.(progressPercent);

        // Mark as complete if user has watched required percentage
        if (requireFullWatch && watchPercent >= 90 && !videoCompleted) {
          setVideoCompleted(true);
          onComplete?.();
        } else if (!requireFullWatch && progressPercent >= 95 && !videoCompleted) {
          setVideoCompleted(true);
          onComplete?.();
        }
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      if (!hasStarted) {
        setHasStarted(true);
        onStart?.();
      }
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (!videoCompleted) {
        setVideoCompleted(true);
        onComplete?.();
      }
    };

    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, [hasStarted, onStart, onProgress, onComplete, videoCompleted, watchPercentage, requireFullWatch]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    const newMutedState = !isMuted;
    video.muted = newMutedState;
    setIsMuted(newMutedState);
  };

  const handleVolumeChange = (newVolume: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const seekTo = (percentage: number) => {
    const video = videoRef.current;
    if (!video || videoDuration === 0) return;

    const newTime = (percentage / 100) * videoDuration;
    video.currentTime = newTime;
  };

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    setProgress(0);
    setCurrentTime(0);
  };

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn("relative bg-black rounded-lg overflow-hidden shadow-lg", className)}>
      {/* Video Element */}
      <div className="relative aspect-video">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-cover"
          autoPlay={autoPlay}
          playsInline
          preload="metadata"
        />
        
        {/* Loading Overlay */}
        {isLoading && !hasError && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center text-white">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold mb-2">Loading Video...</h3>
              <p className="text-sm opacity-90">Please wait while the video loads</p>
            </div>
          </div>
        )}

        {/* Error Overlay */}
        {hasError && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center text-white p-4">
              <AlertCircle className="h-16 w-16 mx-auto mb-4 text-red-400" />
              <h3 className="text-xl font-semibold mb-2">Video Unavailable</h3>
              <p className="text-sm opacity-90 mb-4">{errorMessage}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setHasError(false);
                  setIsLoading(true);
                  if (videoRef.current) {
                    videoRef.current.load();
                  }
                }}
                className="text-white border-white hover:bg-white hover:text-black"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}
        
        {/* Video Completion Overlay */}
        {videoCompleted && !isLoading && !hasError && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center text-white">
              <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-400" />
              <h3 className="text-xl font-semibold mb-2">Video Completed!</h3>
              <p className="text-sm opacity-90">You've successfully watched this training video</p>
            </div>
          </div>
        )}

        {/* Play/Pause Overlay */}
        {!isPlaying && !videoCompleted && !isLoading && !hasError && (
          <div 
            className="absolute inset-0 bg-black/30 flex items-center justify-center cursor-pointer transition-opacity hover:bg-black/40"
            onClick={togglePlayPause}
          >
            <Play className="h-16 w-16 text-white" />
          </div>
        )}
      </div>

      {/* Video Controls */}
      <div className="bg-gray-900 text-white p-3 sm:p-4">
        {/* Title and Status */}
        <div className="flex items-start gap-2 mb-3">
          <h3 className="font-medium text-sm leading-tight flex-1 break-words">{title}</h3>
          {videoCompleted && (
            <div className="flex items-center text-green-400 flex-shrink-0">
              <CheckCircle className="h-4 w-4 mr-1 flex-shrink-0" />
              <span className="text-xs whitespace-nowrap">Complete</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-3">
          <div 
            className="relative cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const percentage = (x / rect.width) * 100;
              seekTo(percentage);
            }}
          >
            <Progress 
              value={progress} 
              className="h-2 bg-gray-700"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400 mt-2">
            <span className="whitespace-nowrap">{formatTime(currentTime)}</span>
            {requireFullWatch && (
              <span className="text-center flex-shrink-0">{Math.round(watchPercentage)}% watched</span>
            )}
            <span className="whitespace-nowrap">{formatTime(videoDuration)}</span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 sm:justify-between">
          <div className="flex items-center justify-center gap-2 w-full sm:w-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={togglePlayPause}
              className="text-white hover:bg-white/20 flex-shrink-0"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={restart}
              className="text-white hover:bg-white/20 flex-shrink-0"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMute}
              className="text-white hover:bg-white/20 flex-shrink-0"
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </div>

          <div className="text-xs text-gray-400 text-center sm:text-right whitespace-nowrap">
            {requireFullWatch ? 
              `${Math.round(watchPercentage)}% required` : 
              `${Math.round(progress)}% progress`
            }
          </div>
        </div>
      </div>
    </div>
  );
} 