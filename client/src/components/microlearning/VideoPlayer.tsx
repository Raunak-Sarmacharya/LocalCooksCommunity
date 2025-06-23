import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  videoUrl: string;
  title: string;
  duration?: number;
  onProgress?: (progress: number, watchedSeconds: number) => void;
  onComplete?: () => void;
  onStart?: () => void;
  isCompleted?: boolean;
  isRewatching?: boolean;
  className?: string;
  autoPlay?: boolean;
  requireFullWatch?: boolean; // Now less strict - allows early completion
  accessLevel?: 'limited' | 'full';
  showApplicationPrompt?: boolean;
  onApplicationPromptClose?: () => void;
}

export default function VideoPlayer({
  videoUrl,
  title,
  duration,
  onProgress,
  onComplete,
  onStart,
  isCompleted = false,
  isRewatching = false,
  className = "",
  autoPlay = false,
  requireFullWatch = true,
  accessLevel = 'full',
  showApplicationPrompt = false,
  onApplicationPromptClose
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Check if this is a Streamable URL
  const isStreamableUrl = videoUrl.includes('streamable.com/e/');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(duration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [watchedSegments, setWatchedSegments] = useState<{start: number, end: number}[]>([]);
  const [totalWatchedSeconds, setTotalWatchedSeconds] = useState(0);
  const [videoCompleted, setVideoCompleted] = useState(isCompleted);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastTimeUpdate, setLastTimeUpdate] = useState(0);
  const [shouldShowCompletePrompt, setShouldShowCompletePrompt] = useState(false);
  const [hasReachedNearEnd, setHasReachedNearEnd] = useState(false);
  const [showCompletionBanner, setShowCompletionBanner] = useState(false);

  // Reset video state when video URL changes or completion status changes
  useEffect(() => {
    // Always reset state when URL changes to prevent state bleed between videos
    setProgress(0);
    setCurrentTime(0);
    setHasStarted(false);
    setIsPlaying(false);
    setWatchedSegments([]);
    setTotalWatchedSeconds(0);
    setLastTimeUpdate(0);
    setLoading(true);
    setHasError(false);
    setErrorMessage('');
    setShouldShowCompletePrompt(false);
    setHasReachedNearEnd(false);
    setShowCompletionBanner(false);
    
    // Set completion state based on props, but only after a small delay to prevent flickering
    setTimeout(() => {
      setVideoCompleted(isCompleted);
    }, 100);
  }, [videoUrl, isCompleted]);

  // Additional effect to handle completion state changes independently
  useEffect(() => {
    // Update completion state without resetting other states
    // This handles cases where completion status changes for the same video
    setVideoCompleted(isCompleted);
    
    // If video becomes completed, hide prompts
    if (isCompleted) {
      setShouldShowCompletePrompt(false);
      setShowCompletionBanner(false);
    }
  }, [isCompleted]);

  // Timer to show completion prompt at appropriate moments
  useEffect(() => {
    if (!hasReachedNearEnd || videoCompleted || shouldShowCompletePrompt) return;

    // Show completion prompt after 3 seconds to give users time to decide
    const timer = setTimeout(() => {
      if (!videoCompleted && hasReachedNearEnd && !shouldShowCompletePrompt) {
        setShouldShowCompletePrompt(true);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [hasReachedNearEnd, videoCompleted, shouldShowCompletePrompt]);

  // Calculate actual watch percentage based on watched segments
  const calculateWatchPercentage = () => {
    if (videoDuration === 0) return 0;
    
    // Merge overlapping segments and calculate total watched time
    const sortedSegments = [...watchedSegments].sort((a, b) => a.start - b.start);
    let totalWatched = 0;
    let lastEnd = -1;
    
    for (const segment of sortedSegments) {
      if (segment.start > lastEnd) {
        totalWatched += segment.end - segment.start;
        lastEnd = segment.end;
      } else if (segment.end > lastEnd) {
        totalWatched += segment.end - lastEnd;
        lastEnd = segment.end;
      }
    }
    
    return Math.min((totalWatched / videoDuration) * 100, 100);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setVideoDuration(video.duration);
      setLoading(false);
      setHasError(false);
    };

    const handleLoadStart = () => {
      setLoading(true);
      setHasError(false);
    };

    const handleCanPlay = () => {
      setLoading(false);
    };

    const handleError = () => {
      setLoading(false);
      setHasError(true);
      setErrorMessage('Failed to load video. Please check your internet connection and try again.');
    };

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      const duration = video.duration;
      
      setCurrentTime(currentTime);
      
      if (duration > 0) {
        const progressPercent = (currentTime / duration) * 100;
        setProgress(progressPercent);
        
        // Track watched segments only when video is playing
        if (isPlaying && !video.seeking && currentTime > lastTimeUpdate) {
          const segmentStart = lastTimeUpdate;
          const segmentEnd = currentTime;
          
          // Only add segment if it's a reasonable continuous watch (less than 2 second jump)
          if (segmentEnd - segmentStart <= 2) {
            setWatchedSegments(prev => {
              const newSegments = [...prev, { start: segmentStart, end: segmentEnd }];
              return newSegments;
            });
          }
        }
        
        setLastTimeUpdate(currentTime);
        
        // Calculate actual watch percentage
        const actualWatchPercentage = calculateWatchPercentage();
        
        onProgress?.(progressPercent, actualWatchPercentage);

        // IMPROVED COMPLETION LOGIC: Show completion prompt when user has engaged sufficiently
        if (progressPercent >= 15 && !videoCompleted) {
          // Check if user has interacted significantly with the video (either watched some or skipped forward)
          const hasWatchedSome = actualWatchPercentage > 8 || progressPercent > 30;
          
          // Show completion prompt earlier to give users more control
          if (progressPercent >= 70 && hasWatchedSome) {
            setHasReachedNearEnd(true);
          }
          
          // Also track when video reaches actual end for automatic completion prompt
          if (progressPercent >= 95) {
            setHasReachedNearEnd(true);
          }
          
          // Complete if:
          // 1. Video reached very end (98%+) - natural completion
          // 2. User has skipped forward significantly (40%+) - allows skipping to end
          // 3. Video naturally ended
          if (progressPercent >= 98 || (hasWatchedSome && progressPercent >= 40)) {
            setVideoCompleted(true);
            setShowCompletionBanner(true);
            setShouldShowCompletePrompt(false);
            onComplete?.();
            
            // Auto-hide banner after 8 seconds
            setTimeout(() => {
              setShowCompletionBanner(false);
            }, 8000);
          }
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
      // Always mark as complete when video ends naturally
      if (!videoCompleted) {
        setVideoCompleted(true);
        setShouldShowCompletePrompt(false);
        onComplete?.();
      }
    };

    const handleSeeking = () => {
      // Reset time tracking when user seeks
      setLastTimeUpdate(video.currentTime);
      
      // RELAXED: Allow completion on seeking to near end
      const currentProgress = (video.currentTime / video.duration) * 100;
      
      // Track near end for prompt system
      if (currentProgress >= 95) {
        setHasReachedNearEnd(true);
      }
      
      if (currentProgress >= 85 && !videoCompleted && hasStarted) {
        // User seeked to near end - mark as complete
        setVideoCompleted(true);
        setShouldShowCompletePrompt(false);
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
    video.addEventListener('seeking', handleSeeking);

    return () => {
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('seeking', handleSeeking);
    };
  }, [hasStarted, onStart, onProgress, onComplete, videoCompleted, watchedSegments, requireFullWatch, isPlaying, lastTimeUpdate]);

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
    setWatchedSegments([]);
    setTotalWatchedSeconds(0);
    setVideoCompleted(false);
    setLastTimeUpdate(0);
  };

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const actualWatchPercentage = calculateWatchPercentage();

  return (
    <div className={cn("relative bg-black rounded-lg overflow-hidden shadow-lg", className)}>
      {/* Video Element */}
      <div className="relative aspect-video">
        {isStreamableUrl ? (
          /* Streamable Embed */
          <div className="w-full h-full">
            <iframe
              src={videoUrl}
              width="100%"
              height="100%"
              style={{ border: 'none', width: '100%', height: '100%' }}
              allow="fullscreen"
              allowFullScreen
              className="w-full h-full"
              onLoad={() => {
                setLoading(false);
                setHasError(false);
                // Trigger start event for progress tracking
                if (!hasStarted) {
                  setHasStarted(true);
                  onStart?.();
                  
                  // For Streamable videos, show completion prompt after reasonable time
                  // since we can't track progress reliably
                  setTimeout(() => {
                    if (!videoCompleted) {
                      setShouldShowCompletePrompt(true);
                    }
                  }, 30000); // Show prompt after 30 seconds for Streamable videos
                }
              }}
              onError={() => {
                setLoading(false);
                setHasError(true);
                setErrorMessage('Failed to load Streamable video. Please check your internet connection and try again.');
              }}
            />
          </div>
        ) : (
          /* Standard Video */
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-cover"
            autoPlay={autoPlay}
            playsInline
            preload="metadata"
          />
        )}
        
        {/* Loading Overlay */}
        {loading && !hasError && (
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
                  setLoading(true);
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
        
        {/* Subtle Completion Banner - Top of video */}
        {showCompletionBanner && !loading && !hasError && (
          <div className="absolute top-4 left-4 right-4 z-10">
            <div className="bg-green-600/90 backdrop-blur-sm text-white px-4 py-3 rounded-lg shadow-lg border border-green-500/50">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <CheckCircle className="h-5 w-5 text-green-200 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">Video Completed! 🎉</p>
                    <p className="text-xs text-green-200">You can rewatch or continue with controls below</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      restart();
                      setShowCompletionBanner(false);
                    }}
                    className="text-white hover:bg-white/20 h-8 px-3 text-xs"
                    title="Restart video from beginning"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Restart
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCompletionBanner(false)}
                    className="text-white hover:bg-white/20 h-8 w-8 p-0"
                    title="Dismiss completion message"
                  >
                    ✕
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Completion Badge - More prominent and less confusing */}
        {videoCompleted && !loading && !hasError && (
          <div className="absolute top-4 left-4 z-10">
            <div className="bg-green-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-lg shadow-lg border border-green-500/50 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Video Completed ✓</span>
            </div>
          </div>
        )}

        {/* Application Prompt for Limited Access Users - Shows within video player after first video completion */}
        {showApplicationPrompt && accessLevel === 'limited' && videoCompleted && (
          <div className="absolute inset-x-4 top-1/2 transform -translate-y-1/2 z-30">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl p-4 shadow-2xl border border-blue-400/50 max-w-lg mx-auto">
              <div className="text-center text-white">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">🎉</span>
                </div>
                <h3 className="font-semibold text-xl mb-2">Great job completing your first video!</h3>
                <p className="text-sm text-blue-100 mb-4 leading-relaxed">
                  You've just finished our sample food safety training video. Ready to unlock access to all 22 training videos and earn your training completion certificate?
                </p>
                <div className="flex flex-col gap-3 mb-4">
                  <Button
                    onClick={() => window.location.href = '/apply'}
                    className="bg-white text-blue-600 hover:bg-blue-50 font-semibold"
                  >
                    <span className="mr-2">📝</span>
                    Submit Application Now
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onApplicationPromptClose}
                    className="border-white/30 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
                  >
                    Continue Exploring
                  </Button>
                </div>
                <p className="text-xs text-blue-200">
                  💡 Application approval unlocks: Full video library • HACCP-based training • Local Cooks certification • Chef network access
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onApplicationPromptClose}
                  className="absolute top-2 right-2 text-white hover:bg-white/20 p-2"
                >
                  ✕
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Improved Completion Prompt - centered and more prominent */}
        {shouldShowCompletePrompt && !videoCompleted && !loading && !hasError && !showApplicationPrompt && (
          <div className="absolute inset-x-4 top-1/2 transform -translate-y-1/2 z-20">
            <div className="bg-black/90 backdrop-blur-sm rounded-xl p-4 shadow-2xl border border-white/30 max-w-md mx-auto">
              <div className="text-center text-white">
                <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Mark Video as Complete?</h3>
                <p className="text-sm text-gray-300 mb-4">
                  You've engaged with this video sufficiently. Mark it as complete to unlock the next video in your training sequence.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShouldShowCompletePrompt(false)}
                    className="border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-200 hover:border-gray-400 font-medium"
                  >
                    Keep Watching
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setVideoCompleted(true);
                      setShouldShowCompletePrompt(false);
                      onComplete?.();
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Play/Pause Overlay - Only for standard videos and when not showing completion overlay */}
        {!isStreamableUrl && !isPlaying && !videoCompleted && !loading && !hasError && (
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
        {/* Title and Status - Only for standard videos */}
        {!isStreamableUrl && (
          <div className="flex items-start gap-2 mb-3">
            <h3 className="font-medium text-sm leading-tight flex-1 break-words">{title}</h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              {videoCompleted && (
                <div className="flex items-center text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                  <CheckCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                  <span className="text-xs whitespace-nowrap font-medium">Completed</span>
                </div>
              )}
              {isCompleted && isRewatching && !videoCompleted && (
                <div className="flex items-center text-blue-400 bg-blue-400/10 px-2 py-1 rounded-full">
                  <RotateCcw className="h-3 w-3 mr-1 flex-shrink-0" />
                  <span className="text-xs whitespace-nowrap">Rewatching</span>
                </div>
              )}
              {isCompleted && !isRewatching && !videoCompleted && (
                <div className="flex items-center text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                  <CheckCircle className="h-4 w-4 mr-1 flex-shrink-0" />
                  <span className="text-xs whitespace-nowrap">Complete</span>
                </div>
              )}
            </div>
          </div>
        )}

        {isStreamableUrl ? (
          /* Streamable Video - Enhanced Interface */
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between mb-3">
              <div className="flex-1">
                <h3 className="font-medium text-sm leading-tight break-words">{title}</h3>
                <p className="text-xs text-gray-400 mt-1">Interactive training video with embedded controls</p>
              </div>
            </div>
            
            {/* Completion Section for Streamable videos */}
            {hasStarted && !videoCompleted && !shouldShowCompletePrompt && (
              <div className="p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-blue-400" />
                    <div>
                      <p className="text-sm font-medium text-blue-400">Finished watching?</p>
                      <p className="text-xs text-blue-300/80">Mark as complete when you're done to continue</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setVideoCompleted(true);
                      setShouldShowCompletePrompt(false);
                      onComplete?.();
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Standard Video - Full Controls */
          <>
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
                <span className="text-center flex-shrink-0">{Math.round(progress)}% progress</span>
                <span className="whitespace-nowrap">{formatTime(videoDuration)}</span>
              </div>
            </div>

            {/* Completion Status Bar - Shows when video can be completed */}
            {hasStarted && !videoCompleted && !shouldShowCompletePrompt && progress > 15 && (
              <div className="mb-3 p-3 bg-green-900/30 border border-green-700/50 rounded-lg">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-green-400">Ready to complete</p>
                      <p className="text-xs text-green-300/80">You can mark this video as complete to continue</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setVideoCompleted(true);
                      setShouldShowCompletePrompt(false);
                      onComplete?.();
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                </div>
              </div>
            )}

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
                  title={videoCompleted ? "Restart completed video" : "Restart video"}
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
                {Math.round(progress)}% progress
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
} 