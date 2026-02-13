import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  MediaPlayer,
  MediaProvider,
  useMediaPlayer,
  useMediaRemote,
  useMediaState,
  type MediaPlayerInstance,
} from '@vidstack/react';
import '@vidstack/react/player/styles/base.css';
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

// ─── Inner UI component (must be a child of <MediaPlayer>) ───────────────────
// Uses Vidstack hooks for reactive state + remote control.
// All custom business logic (segments, completion) lives here.

interface PlayerUIProps {
  onProgress?: (progress: number, watchedSeconds: number) => void;
  onComplete?: () => void;
  onStart?: () => void;
  isCompleted: boolean;
  isRewatching: boolean;
  accessLevel: 'limited' | 'full';
  showApplicationPrompt: boolean;
  onApplicationPromptClose?: () => void;
}

function PlayerUI({
  onProgress,
  onComplete,
  onStart,
  isCompleted,
  isRewatching,
  accessLevel,
  showApplicationPrompt,
  onApplicationPromptClose,
}: PlayerUIProps) {
  // ── Vidstack reactive state (context from nearest <MediaPlayer>) ──
  const paused = useMediaState('paused');
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const muted = useMediaState('muted');
  const fullscreen = useMediaState('fullscreen');
  const started = useMediaState('started');
  const canPlay = useMediaState('canPlay');
  const playbackRate = useMediaState('playbackRate');
  const controlsVisible = useMediaState('controlsVisible');
  const error = useMediaState('error');

  // ── Vidstack remote control + player instance ──
  const remote = useMediaRemote();
  const player = useMediaPlayer();

  // ── Custom business logic state ──
  const watchedSegmentsRef = useRef<{ start: number; end: number }[]>([]);
  const lastTimeRef = useRef(0);
  const completedRef = useRef(isCompleted);
  const startFiredRef = useRef(false);
  const [localCompleted, setLocalCompleted] = useState(false);
  const videoCompleted = isCompleted || localCompleted;
  const [showCompletionBanner, setShowCompletionBanner] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [actualWatchPercent, setActualWatchPercent] = useState(0);

  // Keep completion ref in sync with prop — only sync UPWARD (false→true).
  useEffect(() => {
    if (isCompleted) completedRef.current = true;
  }, [isCompleted]);

  // Store callbacks in refs so the event listener always has fresh references
  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);
  const onStartRef = useRef(onStart);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);

  // ── Track segments + completion via Vidstack's reactive subscribe ──
  // player.subscribe() gives plain unwrapped state values (not signals) and fires
  // synchronously whenever any accessed property changes. This replaces the unreliable
  // useEffect([currentTime]) approach.
  useEffect(() => {
    if (!player) return;

    let lastCt = -1;

    return player.subscribe(({ currentTime: ct, duration: dur, playing: isPlaying, seeking: isSeeking, started: hasStarted, ended: hasEnded }) => {
      // Fire onStart on first playback
      if (hasStarted && !startFiredRef.current) {
        startFiredRef.current = true;
        onStartRef.current?.();
      }

      // Handle natural end — mark complete
      if (hasEnded && !completedRef.current) {
        completedRef.current = true;
        setLocalCompleted(true);
        onCompleteRef.current?.();
      }

      // Update lastTimeRef on seek so segment tracking stays accurate
      if (isSeeking) {
        lastTimeRef.current = ct;
        return;
      }

      // Only process segment tracking on actual time changes during playback
      if (ct === lastCt || !isPlaying || dur === 0 || !isFinite(dur)) return;
      lastCt = ct;

      // Track watched segments only during continuous playback
      const segStart = lastTimeRef.current;
      const segEnd = ct;
      if (segEnd > segStart && segEnd - segStart <= 2) {
        watchedSegmentsRef.current.push({ start: segStart, end: segEnd });
      }
      lastTimeRef.current = ct;

      // Calculate actual watch percentage from merged segments
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
      const watchPct = Math.min((total / dur) * 100, 100);
      setActualWatchPercent(watchPct);

      // STRICT completion: check BEFORE firing onProgress to prevent race.
      if (!completedRef.current && watchPct >= COMPLETION_THRESHOLD) {
        completedRef.current = true;
        setLocalCompleted(true);
        setShowCompletionBanner(true);
        onCompleteRef.current?.();
        setTimeout(() => setShowCompletionBanner(false), 6000);
      }

      // Fire progress AFTER completion check — skip for completed videos
      if (!completedRef.current && dur > 0) {
        const pct = (ct / dur) * 100;
        onProgressRef.current?.(pct, watchPct);
      }
    });
  }, [player]);

  // ── Control handlers ──
  const togglePlayPause = useCallback(() => {
    if (paused) remote.play();
    else remote.pause();
  }, [paused, remote]);

  const toggleMute = useCallback(() => {
    if (muted) remote.unmute();
    else remote.mute();
  }, [muted, remote]);

  const seekTo = useCallback((pct: number) => {
    if (duration > 0) remote.seek((pct / 100) * duration);
  }, [duration, remote]);

  const skip = useCallback((seconds: number) => {
    remote.seek(Math.max(0, Math.min(duration, currentTime + seconds)));
  }, [currentTime, duration, remote]);

  const restart = useCallback(() => {
    remote.seek(0);
    watchedSegmentsRef.current = [];
    lastTimeRef.current = 0;
    setActualWatchPercent(0);
    if (!isRewatching && !isCompleted) {
      completedRef.current = false;
      setLocalCompleted(false);
    }
  }, [isRewatching, isCompleted, remote]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreen) remote.exitFullscreen();
    else remote.enterFullscreen();
  }, [fullscreen, remote]);

  const changeSpeed = useCallback((speed: number) => {
    remote.changePlaybackRate(speed);
    setShowSpeedMenu(false);
  }, [remote]);

  const formatTime = (time: number): string => {
    if (!isFinite(time) || time < 0) return '0:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isLoading = !canPlay && !error;
  const hasError = !!error;

  return (
    <>
      {/* Loading Overlay */}
      {isLoading && !hasError && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
          <div className="text-center text-white space-y-3">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/30 border-t-white mx-auto" />
            <p className="text-sm font-medium">Loading video...</p>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-10">
          <div className="text-center text-white p-6 max-w-sm">
            <AlertCircle className="h-12 w-12 mx-auto mb-3 text-destructive" />
            <h3 className="font-semibold mb-1">Video Unavailable</h3>
            <p className="text-sm text-white/70 mb-4">
              Failed to load video. Please check your connection and try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => remote.play()}
              className="text-white border-white/30 hover:bg-white/10"
            >
              Try Again
            </Button>
          </div>
        </div>
      )}

      {/* Completion Banner — top overlay */}
      {showCompletionBanner && !isLoading && !hasError && (
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
      {videoCompleted && !showCompletionBanner && !isLoading && !hasError && (
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
          <div className="bg-card text-card-foreground rounded-xl p-6 shadow-2xl border border-border max-w-md w-full relative">
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

      {/* Center play button on pause (not for loading/error/application prompt) */}
      {paused && !isLoading && !hasError && started && !showApplicationPrompt && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer z-10"
          onClick={togglePlayPause}
        >
          <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm transition-transform hover:scale-110">
            <Play className="h-7 w-7 text-white ml-1" />
          </div>
        </div>
      )}

      {/* Initial play overlay */}
      {!started && !isLoading && !hasError && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/40 z-10"
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
      {(controlsVisible || paused) && !isLoading && !hasError && started && (
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
              <span className="text-[11px] text-white/70 tabular-nums w-10">{formatTime(duration)}</span>
            </div>

            {/* Control buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={togglePlayPause} className="text-white hover:bg-white/15 h-8 w-8 p-0">
                      {paused ? <Play className="h-4 w-4 ml-0.5" /> : <Pause className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>{paused ? 'Play (Space)' : 'Pause (Space)'}</p></TooltipContent>
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
                      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>{muted ? 'Unmute (M)' : 'Mute (M)'}</p></TooltipContent>
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
                        {playbackRate}x
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
                            playbackRate === speed ? "text-primary font-semibold" : "text-popover-foreground"
                          )}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Watch progress indicator */}
                {started && !videoCompleted && (
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
                      {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>Fullscreen (F)</p></TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main VideoPlayer component ──────────────────────────────────────────────
// Handles Streamable iframe fallback vs Vidstack-powered native player.

export default function VideoPlayer({
  videoUrl,
  title,
  duration: _duration,
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
  const isStreamableUrl = videoUrl.includes('streamable.com/e/');
  const _playerRef = useRef<MediaPlayerInstance>(null);

  // ── Streamable iframe path (no Vidstack, manual completion) ──
  if (isStreamableUrl) {
    return <StreamablePlayer
      videoUrl={videoUrl}
      title={title}
      onComplete={onComplete}
      onStart={onStart}
      isCompleted={isCompleted}
      className={className}
    />;
  }

  // ── Native video path — powered by Vidstack ──
  return (
    <TooltipProvider delayDuration={300}>
      <MediaPlayer
        ref={_playerRef}
        src={videoUrl}
        autoPlay={autoPlay}
        playsInline
        controlsDelay={3000}
        keyShortcuts={{
          togglePaused: 'k Space',
          toggleMuted: 'm',
          toggleFullscreen: 'f',
          seekBackward: 'ArrowLeft',
          seekForward: 'ArrowRight',
        }}
        className={cn(
          "relative !rounded-lg overflow-hidden border border-border bg-black group [&_video]:object-contain data-[fullscreen]:!rounded-none data-[fullscreen]:!border-0",
          className
        )}
      >
        <MediaProvider />
        {/* key={videoUrl} remounts PlayerUI on URL change, resetting all custom state */}
        <PlayerUI
          key={videoUrl}
          onProgress={onProgress}
          onComplete={onComplete}
          onStart={onStart}
          isCompleted={isCompleted}
          isRewatching={isRewatching}
          accessLevel={accessLevel}
          showApplicationPrompt={showApplicationPrompt}
          onApplicationPromptClose={onApplicationPromptClose}
        />
      </MediaPlayer>
    </TooltipProvider>
  );
}

// ─── Streamable iframe player (extracted for clarity) ────────────────────────

function StreamablePlayer({
  videoUrl,
  title,
  onComplete,
  onStart,
  isCompleted = false,
  className = "",
}: Pick<VideoPlayerProps, 'videoUrl' | 'title' | 'onComplete' | 'onStart' | 'isCompleted' | 'className'>) {
  const completedRef = useRef(isCompleted);
  const [localCompleted, setLocalCompleted] = useState(false);
  const videoCompleted = isCompleted || localCompleted;
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (isCompleted) completedRef.current = true;
  }, [isCompleted]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("relative rounded-lg overflow-hidden border border-border bg-black", className)}>
        <div className="relative aspect-video">
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
                if (!hasStarted) { setHasStarted(true); onStart?.(); }
              }}
              onError={() => {}}
            />
          </div>
        </div>

        {/* Bottom info bar — Streamable completion section */}
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
                  setLocalCompleted(true);
                  onComplete?.();
                }}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Mark Complete
              </Button>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
