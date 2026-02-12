import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  CheckCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  requireFullWatch?: boolean;
  accessLevel?: 'limited' | 'full';
  showApplicationPrompt?: boolean;
  onApplicationPromptClose?: () => void;
}

const COMPLETION_THRESHOLD = 90; // Must watch 90% of actual video duration
const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
  requireFullWatch: _requireFullWatch = true,
  accessLevel = 'full',
  showApplicationPrompt = false,
  onApplicationPromptClose
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const watchedSegmentsRef = useRef<{start: number, end: number}[]>([]);
  const lastTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const completedRef = useRef(isCompleted);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isStreamableUrl = videoUrl.includes('streamable.com/e/');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(duration || 0);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [videoCompleted, setVideoCompleted] = useState(isCompleted);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showCompletionBanner, setShowCompletionBanner] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [actualWatchPercent, setActualWatchPercent] = useState(0);

  // Calculate actual watch percentage from segments (ref-based for performance)
  const calculateWatchPercentage = useCallback(() => {
    const dur = videoRef.current?.duration || videoDuration;
    if (dur === 0) return 0;

    const sorted = [...watchedSegmentsRef.current].sort((a, b) => a.start - b.start);
    let total = 0;
    let lastEnd = -1;

    for (const seg of sorted) {
      if (seg.start > lastEnd) {
        total += seg.end - seg.start;
        lastEnd = seg.end;
      } else if (seg.end > lastEnd) {
        total += seg.end - lastEnd;
        lastEnd = seg.end;
      }
    }

    return Math.min((total / dur) * 100, 100);
  }, [videoDuration]);

  // Reset state on URL change or completion prop change
  const prevUrlRef = useRef(videoUrl);
  if (prevUrlRef.current !== videoUrl) {
    prevUrlRef.current = videoUrl;
    // Synchronous reset during render avoids cascading effect setState
    // These will be applied on the next commit
  }

  useEffect(() => {
    // Reset all player state when video URL changes
    setProgress(0);
    setCurrentTime(0);
    setHasStarted(false);
    setIsPlaying(false);
    setLoading(true);
    setHasError(false);
    setErrorMessage('');
    setShowCompletionBanner(false);
    setPlaybackSpeed(1);
    setShowSpeedMenu(false);
    setActualWatchPercent(0);
    watchedSegmentsRef.current = [];
    lastTimeRef.current = 0;
    isPlayingRef.current = false;
    completedRef.current = isCompleted;
    setVideoCompleted(isCompleted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // Keep completion ref in sync with prop — only sync UPWARD (false→true).
  // Never reset local completion to false from prop, because there's a race:
  // internal completion fires onComplete → parent async API → re-render with stale isCompleted=false
  if (isCompleted) {
    completedRef.current = true;
    if (!videoCompleted) setVideoCompleted(true);
  }

  // Auto-hide controls during playback
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlayingRef.current) {
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, []);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setVideoDuration(video.duration);
      setLoading(false);
      setHasError(false);
    };
    const handleLoadStart = () => { setLoading(true); setHasError(false); };
    const handleCanPlay = () => setLoading(false);
    const handleError = () => {
      setLoading(false);
      setHasError(true);
      setErrorMessage('Failed to load video. Please check your connection and try again.');
    };

    const handleTimeUpdate = () => {
      const ct = video.currentTime;
      const dur = video.duration;
      setCurrentTime(ct);

      if (dur > 0) {
        const pct = (ct / dur) * 100;
        setProgress(pct);

        // Track watched segments only during actual playback (not seeking)
        if (isPlayingRef.current && !video.seeking) {
          const segStart = lastTimeRef.current;
          const segEnd = ct;
          // Only record continuous segments (< 2s gap = normal playback)
          if (segEnd > segStart && segEnd - segStart <= 2) {
            watchedSegmentsRef.current.push({ start: segStart, end: segEnd });
          }
        }
        lastTimeRef.current = ct;

        const watchPct = calculateWatchPercentage();
        setActualWatchPercent(watchPct);

        // STRICT completion: check BEFORE firing onProgress to prevent race.
        // If we fire onProgress first, the parent sends completed=false to the API,
        // which can overwrite the completed=true from onComplete in the DB.
        if (!completedRef.current && watchPct >= COMPLETION_THRESHOLD) {
          completedRef.current = true;
          setVideoCompleted(true);
          setShowCompletionBanner(true);
          onComplete?.();
          setTimeout(() => setShowCompletionBanner(false), 6000);
        }

        // Fire progress AFTER completion check — parent can read correct completion state
        // Skip progress updates for already-completed videos (no point overwriting DB)
        if (!completedRef.current) {
          onProgress?.(pct, watchPct);
        }
      }
    };

    const handlePlay = () => {
      isPlayingRef.current = true;
      setIsPlaying(true);
      if (!hasStarted) { setHasStarted(true); onStart?.(); }
      resetControlsTimer();
    };
    const handlePause = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setShowControls(true);
    };
    const handleEnded = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setShowControls(true);
      // Natural end = mark complete regardless of watch percentage
      if (!completedRef.current) {
        completedRef.current = true;
        setVideoCompleted(true);
        onComplete?.();
      }
    };
    const handleSeeking = () => {
      // Just update the last time ref — do NOT auto-complete on seek
      lastTimeRef.current = video.currentTime;
    };
    const handleSeeked = () => { /* no-op, seek tracking handled in handleSeeking */ };

    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);

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
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [hasStarted, onStart, onProgress, onComplete, calculateWatchPercentage, resetControlsTimer]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlayingRef.current) { video.pause(); } else { video.play(); }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(prev => !prev);
  }, []);

  const seekTo = useCallback((pct: number) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    video.currentTime = (pct / 100) * video.duration;
  }, []);

  const skip = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    resetControlsTimer();
  }, [resetControlsTimer]);

  const restart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setProgress(0);
    setCurrentTime(0);
    watchedSegmentsRef.current = [];
    lastTimeRef.current = 0;
    setActualWatchPercent(0);
    if (!isRewatching && !isCompleted) {
      completedRef.current = false;
      setVideoCompleted(false);
    }
  }, [isRewatching, isCompleted]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen not supported:', err);
    }
  }, []);

  const changeSpeed = useCallback((speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const handleFSChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFSChange);
    return () => document.removeEventListener('fullscreenchange', handleFSChange);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, toggleMute, toggleFullscreen, skip, resetControlsTimer]);

  const formatTime = (time: number): string => {
    if (!isFinite(time) || time < 0) return '0:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={containerRef}
        className={cn(
          "relative rounded-lg overflow-hidden border border-border bg-black group",
          isFullscreen && "rounded-none border-0",
          className
        )}
        onMouseMove={resetControlsTimer}
        onMouseLeave={() => isPlayingRef.current && setShowControls(false)}
      >
        {/* Video Element */}
        <div className="relative aspect-video">
          {isStreamableUrl ? (
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
                  if (!hasStarted) { setHasStarted(true); onStart?.(); }
                }}
                onError={() => {
                  setLoading(false);
                  setHasError(true);
                  setErrorMessage('Failed to load video. Please check your connection.');
                }}
              />
            </div>
          ) : (
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain bg-black"
              autoPlay={autoPlay}
              playsInline
              preload="metadata"
              onClick={togglePlayPause}
            />
          )}

          {/* Loading Overlay */}
          {loading && !hasError && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
              <div className="text-center text-white space-y-3">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/30 border-t-white mx-auto" />
                <p className="text-sm font-medium">Loading video...</p>
              </div>
            </div>
          )}

          {/* Error Overlay */}
          {hasError && (
            <div className="absolute inset-0 bg-black/90 flex items-center justify-center">
              <div className="text-center text-white p-6 max-w-sm">
                <AlertCircle className="h-12 w-12 mx-auto mb-3 text-destructive" />
                <h3 className="font-semibold mb-1">Video Unavailable</h3>
                <p className="text-sm text-white/70 mb-4">{errorMessage}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHasError(false);
                    setLoading(true);
                    videoRef.current?.load();
                  }}
                  className="text-white border-white/30 hover:bg-white/10"
                >
                  Try Again
                </Button>
              </div>
            </div>
          )}

          {/* Completion Banner — top overlay */}
          {showCompletionBanner && !loading && !hasError && (
            <div className="absolute top-3 left-3 right-3 z-20 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="bg-success/95 backdrop-blur-sm text-success-foreground px-4 py-2.5 rounded-lg flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm font-medium">Video completed</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCompletionBanner(false)}
                  className="text-success-foreground hover:bg-white/20 h-7 w-7 p-0 flex-shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Completed badge — persistent */}
          {videoCompleted && !showCompletionBanner && !loading && !hasError && (
            <div className="absolute top-3 left-3 z-10">
              <Badge variant="success" className="shadow-md">
                <CheckCircle className="h-3 w-3 mr-1" />
                Completed
              </Badge>
            </div>
          )}

          {/* Application prompt overlay */}
          {showApplicationPrompt && accessLevel === 'limited' && videoCompleted && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30 p-4">
              <div className="bg-card text-card-foreground rounded-xl p-6 shadow-2xl border border-border max-w-md w-full">
                <div className="text-center space-y-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto">
                    <CheckCircle className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Great start!</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Submit your application to unlock all 22 training videos and earn your certification.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={() => window.location.href = '/dashboard?view=applications&action=new'}
                    >
                      Submit Application
                    </Button>
                    <Button
                      variant="outline"
                      onClick={onApplicationPromptClose}
                    >
                      Continue Exploring
                    </Button>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onApplicationPromptClose}
                  className="absolute top-2 right-2 h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Center play button on pause (not for completed, not for streamable) */}
          {!isStreamableUrl && !isPlaying && !loading && !hasError && hasStarted && !showApplicationPrompt && (
            <div
              className="absolute inset-0 flex items-center justify-center cursor-pointer"
              onClick={togglePlayPause}
            >
              <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm transition-transform hover:scale-110">
                <Play className="h-7 w-7 text-white ml-1" />
              </div>
            </div>
          )}

          {/* Initial play overlay */}
          {!isStreamableUrl && !hasStarted && !loading && !hasError && (
            <div
              className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/40"
              onClick={togglePlayPause}
            >
              <div className="text-center space-y-3">
                <div className="w-20 h-20 rounded-full bg-primary/90 flex items-center justify-center mx-auto shadow-xl transition-transform hover:scale-110">
                  <Play className="h-9 w-9 text-primary-foreground ml-1" />
                </div>
                <p className="text-white/80 text-sm font-medium">Click to play</p>
              </div>
            </div>
          )}

          {/* Controls overlay — bottom gradient + controls */}
          {!isStreamableUrl && (showControls || !isPlaying) && !loading && !hasError && hasStarted && (
            <div className="absolute bottom-0 left-0 right-0 z-10 transition-opacity duration-300">
              {/* Gradient backdrop */}
              <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-12 pb-2 px-3 space-y-2">
                {/* Seek bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-white/70 tabular-nums w-10 text-right">{formatTime(currentTime)}</span>
                  <Slider
                    value={[progress]}
                    max={100}
                    step={0.1}
                    onValueChange={([val]) => seekTo(val)}
                    className="flex-1 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/20 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:border-primary hover:[&_[data-slot=slider-track]]:h-1.5"
                  />
                  <span className="text-[11px] text-white/70 tabular-nums w-10">{formatTime(videoDuration)}</span>
                </div>

                {/* Control buttons */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={togglePlayPause} className="text-white hover:bg-white/15 h-8 w-8 p-0">
                          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{isPlaying ? 'Pause (Space)' : 'Play (Space)'}</p></TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => skip(-10)} className="text-white hover:bg-white/15 h-8 w-8 p-0">
                          <SkipBack className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>-10s (←)</p></TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => skip(10)} className="text-white hover:bg-white/15 h-8 w-8 p-0">
                          <SkipForward className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>+10s (→)</p></TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={toggleMute} className="text-white hover:bg-white/15 h-8 w-8 p-0">
                          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{isMuted ? 'Unmute (M)' : 'Mute (M)'}</p></TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={restart} className="text-white hover:bg-white/15 h-8 w-8 p-0">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>Restart</p></TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="flex items-center gap-0.5">
                    {/* Speed control */}
                    <div className="relative">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                            className="text-white hover:bg-white/15 h-8 px-2 text-xs font-medium tabular-nums"
                          >
                            {playbackSpeed}x
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top"><p>Playback speed</p></TooltipContent>
                      </Tooltip>
                      {showSpeedMenu && (
                        <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[80px]">
                          {PLAYBACK_SPEEDS.map(speed => (
                            <button
                              key={speed}
                              onClick={() => changeSpeed(speed)}
                              className={cn(
                                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors",
                                playbackSpeed === speed ? "text-primary font-semibold" : "text-popover-foreground"
                              )}
                            >
                              {speed}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Watch progress indicator */}
                    {hasStarted && !videoCompleted && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-[11px] text-white/60 px-2 tabular-nums">
                            {Math.round(actualWatchPercent)}% watched
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top"><p>Complete {COMPLETION_THRESHOLD}% to mark as watched</p></TooltipContent>
                      </Tooltip>
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={toggleFullscreen} className="text-white hover:bg-white/15 h-8 w-8 p-0">
                          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>Fullscreen (F)</p></TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom info bar — Streamable completion section */}
        {isStreamableUrl && (
          <div className="bg-card border-t border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-medium text-foreground truncate">{title}</h3>
                {videoCompleted && (
                  <Badge variant="success" className="flex-shrink-0">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Completed
                  </Badge>
                )}
              </div>
              {hasStarted && !videoCompleted && (
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => {
                    completedRef.current = true;
                    setVideoCompleted(true);
                    onComplete?.();
                  }}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                  Mark Complete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
} 