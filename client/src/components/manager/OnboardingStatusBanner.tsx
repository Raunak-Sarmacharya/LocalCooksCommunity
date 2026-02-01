import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { 
  Sparkles, 
  ChevronRight, 
  Clock, 
  CheckCircle2, 
  Shield,
  ArrowRight,
  FileCheck,
  Rocket
} from 'lucide-react';

interface OnboardingStatusBannerProps {
  showSetupBanner: boolean;
  showLicenseReviewBanner: boolean;
  isReadyForBookings: boolean;
  missingSteps: string[];
  onContinueSetup: () => void;
  className?: string;
}

export function OnboardingStatusBanner({
  showSetupBanner,
  showLicenseReviewBanner,
  isReadyForBookings,
  missingSteps,
  onContinueSetup,
  className
}: OnboardingStatusBannerProps) {
  
  // Setup Incomplete Banner
  if (showSetupBanner) {
    const stepsRemaining = missingSteps.length;
    
    return (
      <div className={cn(
        "relative overflow-hidden rounded-xl border shadow-sm mx-6 mt-6 mb-6",
        "bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900",
        "dark:from-slate-950 dark:via-slate-900 dark:to-slate-950",
        className
      )}>
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px]" />
        
        {/* Gradient accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
        
        <div className="relative px-6 py-5">
          <div className="flex items-center justify-between gap-6">
            {/* Left content */}
            <div className="flex items-center gap-4 min-w-0">
              {/* Icon container */}
              <div className="flex-shrink-0">
                <div className="relative">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center ring-1 ring-white/10">
                    <Sparkles className="w-6 h-6 text-blue-400" />
                  </div>
                  {/* Steps indicator badge */}
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center ring-2 ring-slate-900">
                    <span className="text-[10px] font-bold text-slate-900">{stepsRemaining}</span>
                  </div>
                </div>
              </div>
              
              {/* Text content */}
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-white tracking-tight">
                  Complete your kitchen setup
                </h3>
                <p className="text-sm text-slate-400 mt-0.5 truncate">
                  {stepsRemaining === 1 
                    ? `Just 1 step remaining to start accepting bookings`
                    : `${stepsRemaining} steps remaining to start accepting bookings`
                  }
                </p>
              </div>
            </div>
            
            {/* Right content - CTA */}
            <div className="flex-shrink-0 flex items-center gap-3">
              {/* Missing steps preview */}
              <div className="hidden lg:flex items-center gap-2">
                {missingSteps.slice(0, 2).map((step, index) => (
                  <span 
                    key={index}
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-white/5 text-slate-300 ring-1 ring-white/10"
                  >
                    {step}
                  </span>
                ))}
                {missingSteps.length > 2 && (
                  <span className="text-xs text-slate-500">
                    +{missingSteps.length - 2} more
                  </span>
                )}
              </div>
              
              <Button
                onClick={onContinueSetup}
                className="bg-white text-slate-900 hover:bg-slate-100 font-medium shadow-lg shadow-white/10 transition-all hover:shadow-white/20"
              >
                Continue Setup
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // License Under Review Banner
  if (showLicenseReviewBanner) {
    return (
      <div className={cn(
        "relative overflow-hidden rounded-xl border shadow-sm mx-6 mt-6 mb-6",
        "bg-gradient-to-r from-amber-50 via-orange-50/50 to-amber-50",
        "dark:from-amber-950/30 dark:via-amber-900/20 dark:to-amber-950/30",
        "border-amber-200/60 dark:border-amber-800/40",
        className
      )}>
        {/* Subtle pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(251,191,36,0.08),transparent_50%)]" />
        
        {/* Gradient accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400" />
        
        <div className="relative px-6 py-5">
          <div className="flex items-center justify-between gap-6">
            {/* Left content */}
            <div className="flex items-center gap-4 min-w-0">
              {/* Icon container with animated ring */}
              <div className="flex-shrink-0">
                <div className="relative">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 flex items-center justify-center ring-1 ring-amber-200 dark:ring-amber-700/50">
                    <Clock className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  {/* Animated pulse ring */}
                  <div className="absolute inset-0 rounded-xl ring-2 ring-amber-400/50 animate-ping opacity-75" style={{ animationDuration: '2s' }} />
                </div>
              </div>
              
              {/* Text content */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-amber-900 dark:text-amber-100 tracking-tight">
                    License Under Review
                  </h3>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-700">
                    Pending
                  </span>
                </div>
                <p className="text-sm text-amber-700/80 dark:text-amber-300/70 mt-0.5">
                  Your kitchen license is being reviewed. You'll be able to accept bookings once approved.
                </p>
              </div>
            </div>
            
            {/* Right content - Status info */}
            <div className="flex-shrink-0 hidden sm:flex items-center gap-4">
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/60 dark:bg-amber-950/40 ring-1 ring-amber-200/60 dark:ring-amber-800/40">
                <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <div className="text-left">
                  <p className="text-xs font-medium text-amber-900 dark:text-amber-200">Typical review time</p>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">1-2 business days</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Progress indicator */}
          <div className="mt-4 pt-4 border-t border-amber-200/40 dark:border-amber-800/30">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Setup Complete</span>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center ring-2 ring-amber-400/50">
                  <FileCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                </div>
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300">License Review</span>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
              <div className="flex items-center gap-2 opacity-50">
                <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Rocket className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <span className="text-xs font-medium text-slate-400">Ready for Bookings</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // No banner needed
  return null;
}

export default OnboardingStatusBanner;
