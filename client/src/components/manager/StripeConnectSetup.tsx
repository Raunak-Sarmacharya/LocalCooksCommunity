import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
/**
 * Stripe Connect Setup Component
 * 
 * Allows managers to set up Stripe Connect to receive payments directly
 * after the platform service fee is deducted.
 */

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, ExternalLink, Clock, ShieldAlert } from "@/components/ui/manager-icons";
import { toast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { tt } from "@/i18n/common-ns";

/**
 * Card-level actions.
 *
 * The app's pill, at `h-9` (via `size="sm"`) rather than the 44px `index.css` forces on
 * EVERY button — `min-height` beats `height`, so `md:!min-h-0` is what lets a shorter
 * button exist at all, scoped to `md:` so the mobile touch target keeps its floor.
 *
 * And never full-width. A CTA stretched the whole width of a settings card is what made
 * "Connect with Stripe" read as a landing page instead of as one setting among several.
 * (The row-level hierarchy on the profile page lives in `ContactVerificationRow`.)
 */
const CARD_ACTION = "md:!min-h-0 shadow-none hover:shadow-none hover:translate-y-0";
const CARD_ACTION_QUIET = "md:!min-h-0 text-muted-foreground hover:text-foreground";

/**
 * The state heading plus the Stripe mark.
 *
 * Three states render this identical block, and it carried `slate-*` colours with `dark:`
 * variants while every other card on the page uses the semantic tokens — so it did not
 * follow the theme the rest of the page does.
 */
function StripeHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <img src="/stripe-logo.png" alt="Stripe" className="mt-0.5 h-5 shrink-0 opacity-90" />
    </div>
  );
}

export default function StripeConnectSetup() {
  
  const { user: firebaseUser } = useFirebaseAuth();
  const queryClient = useQueryClient();

  // Fetch Stripe Connect status from dedicated endpoint (queries Stripe API for real status)
  const { data: stripeStatus, isLoading } = useQuery({
    queryKey: ['/api/manager/stripe-connect/status', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/manager/stripe-connect/status', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(tt("failedToFetchStripeStatus"));
      }
      return response.json();
    },
    enabled: !!firebaseUser,
    staleTime: 1000 * 30, // Cache for 30 seconds
    // Opening this tab MUST re-read the connection state.
    //
    // Stripe onboarding does not happen in one step — the manager is sent to Stripe, comes
    // back, may be asked for more documents, and the account then sits in a verification
    // queue. So the status is the whole point of this screen, and serving a cached answer
    // would show "Connect with Stripe" to someone who has already connected.
    //
    // `staleTime` alone was not enough: Radix unmounts an inactive `TabsContent`, so the
    // component remounts on every visit — but a remount within the 30s window is still
    // "fresh", and the query client's global default is `staleTime: Infinity`. `"always"`
    // makes the remount authoritative regardless of either.
    //
    // Per-observer, so this does NOT make the dashboard's `useOnboardingStatus` (which
    // reads the same key) refetch on its own schedule.
    refetchOnMount: "always",
  });

  // Also fetch user profile for account ID display (fallback)
  const { data: userProfile } = useQuery({
    queryKey: ['/api/user/profile', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(tt("failedToFetchProfile"));
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Use Stripe API status (more accurate) instead of DB status
  // If Stripe API explicitly says no account exists, trust that over the database
  // This handles the case where the account was deleted on Stripe's side
  const stripeApiSaysNoAccount = stripeStatus && stripeStatus.hasAccount === false;
  const hasStripeAccount = stripeApiSaysNoAccount 
    ? false 
    : (stripeStatus?.hasAccount || !!userProfile?.stripeConnectAccountId || !!userProfile?.stripe_connect_account_id);
  const isOnboardingComplete = stripeStatus?.status === 'complete' && stripeStatus?.chargesEnabled && stripeStatus?.payoutsEnabled;

  // Fetch service fee rate (public endpoint - no auth required)
  const { data: serviceFeeRateData } = useQuery({
    queryKey: ['/api/platform-settings/service-fee-rate'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/platform-settings/service-fee-rate');
        if (response.ok) {
          return response.json();
        }
      } catch (error) {
        logger.error('Error fetching service fee rate:', error);
      }
      // Default to 5% if unable to fetch
      return { rate: 0.05, percentage: '5.00' };
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const serviceFeePercentage = serviceFeeRateData?.percentage ;

  // [NEW] Listen for cross-tab completion events
  useEffect(() => {
    const channel = new BroadcastChannel('stripe_onboarding_channel');
    
    channel.onmessage = async (event) => {
      logger.info('Received broadcast message:', event.data);
      if (event.data?.type === 'STRIPE_SETUP_COMPLETE') {
        // Force refetch queries and wait for completion
        await queryClient.refetchQueries({ queryKey: ['/api/user/profile'] });
        await queryClient.refetchQueries({ queryKey: ['/api/manager/stripe-connect/status'] });
        
        // Get the updated status from the cache after refetch
        const updatedStatus = queryClient.getQueryData<{
          chargesEnabled?: boolean;
          payoutsEnabled?: boolean;
          detailsSubmitted?: boolean;
          status?: string;
        }>(['/api/manager/stripe-connect/status', firebaseUser?.uid]);
        
        // Show toast based on actual refetched status
        if (updatedStatus?.chargesEnabled && updatedStatus?.payoutsEnabled) {
          toast.success(mt("stripeSetupCompleteTitle"), {
            description: mt("yourAccountIsNowReadyToReceivePayments")
          });
        } else if (updatedStatus?.detailsSubmitted) {
          toast.info(mt("setupProgressSavedTitle"), {
            description: mt("setupProgressSavedDesc")
          });
        } else {
          toast.info(mt("statusUpdated"), {
            description: mt("stripeStatusRefreshedDesc")
          });
        }
      }
    };

    return () => {
      channel.close();
    };
  }, [queryClient, toast, firebaseUser?.uid]);

  // [INDUSTRY STANDARD] Auto-refresh status when user returns to tab
  // This handles the case where user completes Stripe in another tab and comes back
  useEffect(() => {
    let lastHiddenTime = 0;
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastHiddenTime = Date.now();
      } else {
        // Only refresh if tab was hidden for at least 3 seconds (user likely went to Stripe)
        const wasHiddenLongEnough = Date.now() - lastHiddenTime > 3000;
        if (wasHiddenLongEnough && hasStripeAccount && !isOnboardingComplete) {
          logger.info('[Stripe] Tab visible again, checking status...');
          queryClient.invalidateQueries({ queryKey: ['/api/manager/stripe-connect/status'] });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [queryClient, hasStripeAccount, isOnboardingComplete]);

  // Invalidate user profile query after creating account to refresh the UI
  const handleAccountCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
  };

  // Create Connect account mutation
  const createAccountMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await auth.currentUser?.getIdToken();
      // Check if we're in the setup flow to pass to server for proper return URLs
      const isSetupFlow = window.location.pathname.includes('/manager/setup');
      const response = await fetch('/api/manager/stripe-connect/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: isSetupFlow ? 'setup' : undefined }),
      });
      if (!response.ok) {
        const error = await response.json();
        // If account already exists, return the error with accountId so we can handle it
        if (error.error === 'Stripe Connect account already exists' && error.accountId) {
          return { accountId: error.accountId, alreadyExists: true };
        }
        throw new Error(error.error || 'Failed to create account');
      }
      return response.json();
    },
    onSuccess: async (data) => {
      // Refresh user profile to get the account ID (whether new or existing)
      handleAccountCreated();
      
      // If account already existed, don't try to start onboarding
      if (data.alreadyExists) {
        toast.info(tt("accountAlreadyConnected"), {
          description: mt("stripeAlreadyConnectedDesc")
        });
        return;
      }
      
      // After creating new account, get onboarding link
      await startOnboardingMutation.mutateAsync();
    },
    onError: (error: Error) => {
      toast({ title: mt("error"),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Get onboarding link mutation
  const startOnboardingMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await auth.currentUser?.getIdToken();
      // Check if we're in the setup flow
      const isSetupFlow = window.location.pathname.includes('/manager/setup');
      const fromParam = isSetupFlow ? '?from=setup' : '';
      const response = await fetch(`/api/manager/stripe-connect/onboarding-link${fromParam}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get onboarding link');
      }
      const data = await response.json();
      return data.url;
    },
    onSuccess: (url: string) => {
      // Open Stripe's onboarding page in a new tab to avoid logging out the user
      window.open(url, '_blank');
    },
    onError: (error: Error) => {
      toast({ title: mt("error"),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleCreateAccount = () => {
    createAccountMutation.mutate();
  };

  const handleStartOnboarding = () => {
    startOnboardingMutation.mutate();
  };

  // Get dashboard login link mutation (for completed accounts)
  // Also handles onboarding redirect if not complete
  const getDashboardLinkMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await auth.currentUser?.getIdToken();
      // Check if we're in the setup flow
      const isSetupFlow = window.location.pathname.includes('/manager/setup');
      const fromParam = isSetupFlow ? '?from=setup' : '';
      const response = await fetch(`/api/manager/stripe-connect/dashboard-link${fromParam}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get dashboard link');
      }
      const data = await response.json();
      if (!data.url) {
        throw new Error(tt("dashboardLinkNotProvided"));
      }
      // Return both URL and whether onboarding is required
      return { url: data.url, requiresOnboarding: data.requiresOnboarding || false };
    },
    onSuccess: (data: { url: string; requiresOnboarding: boolean }) => {
      // Open Stripe Dashboard or Onboarding in a new tab
      // Note: window.open() may return null even when the tab opens successfully in some browsers,
      // so we don't check for popup blocking to avoid false positives
      window.open(data.url, '_blank', 'noopener,noreferrer');
      
      if (data.requiresOnboarding) {
        toast({ title: mt("openingStripeSetup"),
          description: mt("completeYourStripeConnectSetupToStartReceivingPayments"),
        });
        // Refresh user profile to update onboarding status after completion
        queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      } else {
        toast({ title: mt("openingDashboard"),
          description: mt("yourStripeConnectedAccountDashboardIsOpeningInANewTab"),
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: mt("error"),
        description: error.message || 'Failed to open Stripe. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const checkStatusMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/manager/stripe-connect/sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) throw new Error(tt("failedToSyncStatus"));
      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate both queries to refresh status
      queryClient.invalidateQueries({ queryKey: ['/api/manager/stripe-connect/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      
      // Only show "Setup Complete" when BOTH chargesEnabled AND payoutsEnabled are true
      // Don't rely on status field alone as it can be misleading
      const isFullyReady = data.details?.chargesEnabled === true && data.details?.payoutsEnabled === true;
      if (isFullyReady) {
        toast({ title: mt("setupComplete"),
          description: mt("yourStripeAccountIsNowFullyConnectedAndReadyToReceivePayment"),
        });
      } else if (data.details?.detailsSubmitted) {
        toast({ title: mt("verificationPending"),
          description: mt("yourDetailsHaveBeenSubmittedStripeIsVerifyingYourIdentityThi"),
        });
      } else {
         toast({ title: mt("setupIncomplete"),
          description: mt("pleaseCompleteAllRequiredStepsInStripeToStartReceivingPaymen"),
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: mt("syncFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleAccessDashboard = () => {
    getDashboardLinkMutation.mutate();
  };

  // Managers need to know up front that Stripe's processing fee comes out of each
  // booking before the transfer lands in their account (see stripe-transfer-service).
  const payoutFeeNote = (
    <div className="space-y-1 rounded-xl border bg-muted/40 px-3 py-2.5">
      <p className="text-xs font-medium text-foreground">{mt("howPayoutsWork")}</p>
      <p className="text-xs text-muted-foreground">
        {mt("howPayoutsWorkBody")}
        {serviceFeePercentage
          ? ` ${mt("howPayoutsWorkServiceFeeNote", { percent: serviceFeePercentage })}`
          : ""}
      </p>
    </div>
  );

  if (isLoading) {
    // Bare spinner, not a Card: BOTH hosts already supply the card (the onboarding
    // wizard via `PaymentSetupStep`, the profile tab via its own shell), so this used
    // to render a card inside a card.
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not connected - show create account button
  if (!hasStripeAccount) {
    return (
      <div className="space-y-4">
        <StripeHeading title={mt("connectPayments")} subtitle={mt("receivePaymentsDirectlyToYourBank")} />

        <div>
          <Button
            size="sm"
            className={CARD_ACTION}
            onClick={handleCreateAccount}
            disabled={createAccountMutation.isPending}
          >
            {createAccountMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />{mt("creatingAccount")}</>
            ) : (
              <>
                <CreditCard className="mr-1.5 h-4 w-4" />{mt("connectWithStripe")}</>
            )}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {mt("secureSetupOpensNewTab")}
          </p>
        </div>

        {payoutFeeNote}
      </div>
    );
  }

  // Account created but onboarding may not be complete
  if (hasStripeAccount) {
    // Show different UI based on onboarding status
    if (isOnboardingComplete) {
      // Onboarding complete - show success state
      return (
        <div className="space-y-4">
          <StripeHeading title={mt("paymentsConnected")} subtitle={mt("readyToReceivePayments")} />

          <Button
            size="sm"
            className={CARD_ACTION}
            onClick={handleAccessDashboard}
            disabled={getDashboardLinkMutation.isPending}
          >
            {getDashboardLinkMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />{mt("opening")}</>
            ) : (
              <>
                <ExternalLink className="mr-1.5 h-4 w-4" />{mt("viewStripeDashboard")}</>
            )}
          </Button>
          {payoutFeeNote}
        </div>
      );
    } else {
      // Account created but onboarding not complete - show dynamic stage-aware UI
      const stage = stripeStatus?.verificationStage || 'incomplete';
      
      // Dynamic UI config based on verification stage
      const stageConfig: Record<string, {
        title: string;
        subtitle: string;
        buttonLabel: string;
        buttonLoadingLabel: string;
        buttonIcon: typeof CreditCard;
        helpText: string;
        isActionable: boolean;
      }> = {
        details_needed: {
          title: mt("startStripeSetup"),
          subtitle: mt("enterYourBusinessAndBankDetails"),
          buttonLabel: mt("startStripeSetup"),
          buttonLoadingLabel: mt("openingSetupEllipsis"),
          buttonIcon: CreditCard,
          helpText: mt("opensStripeNewTabAbout5Min"),
          isActionable: true,
        },
        requires_additional_info: {
          title: mt("additionalInfoNeeded"),
          subtitle: mt("additionalInfoNeededDesc"),
          buttonLabel: mt("provideAdditionalInformation"),
          buttonLoadingLabel: mt("openingStripeEllipsis"),
          buttonIcon: ExternalLink,
          helpText: mt("stripeRequiresAdditionalDocumentsOrDetails"),
          isActionable: true,
        },
        pending_verification: {
          title: mt("verificationInProgress"),
          subtitle: mt("verificationInProgressDesc"),
          buttonLabel: mt("checkVerificationStatus"),
          buttonLoadingLabel: mt("openingStripeEllipsis"),
          buttonIcon: Clock,
          helpText: mt("usuallyTakesFewMinutesAutoRefresh"),
          isActionable: true,
        },
        past_due: {
          title: mt("actionRequired"),
          subtitle: mt("overdueRequirementsUpdateNow"),
          buttonLabel: mt("updateRequiredInformation"),
          buttonLoadingLabel: mt("openingStripeEllipsis"),
          buttonIcon: ShieldAlert,
          helpText: mt("accountMayBeRestrictedUntilResolved"),
          isActionable: true,
        },
        payouts_disabled: {
          title: mt("addBankAccount"),
          subtitle: mt("chargesEnabledAddBankForPayouts"),
          buttonLabel: mt("addBankAccount"),
          buttonLoadingLabel: mt("openingStripeEllipsis"),
          buttonIcon: ExternalLink,
          helpText: mt("canAcceptPaymentsNeedBankForPayouts"),
          isActionable: true,
        },
        charges_disabled: {
          title: mt("chargesNotEnabled"),
          subtitle: mt("completeSetupToAcceptPayments"),
          buttonLabel: mt("completePaymentSetup"),
          buttonLoadingLabel: mt("openingStripeEllipsis"),
          buttonIcon: CreditCard,
          helpText: mt("additionalVerificationNeededToProcessCharges"),
          isActionable: true,
        },
        rejected: {
          title: mt("accountRejected"),
          subtitle: mt("stripeCouldNotVerifyYourAccount"),
          buttonLabel: mt("contactSupport"),
          buttonLoadingLabel: mt("openingEllipsis"),
          buttonIcon: ExternalLink,
          helpText: mt("pleaseContactSupportForAssistance"),
          isActionable: true,
        },
        incomplete: {
          title: mt("completeSetup"),
          subtitle: mt("finishOnboardingToReceivePayments"),
          buttonLabel: mt("continueStripeSetup"),
          buttonLoadingLabel: mt("openingSetupEllipsis"),
          buttonIcon: CreditCard,
          helpText: mt("opensStripeInANewTab"),
          isActionable: true,
        },
      };

      const config = stageConfig[stage] || stageConfig.incomplete;
      const ButtonIcon = config.buttonIcon;

      return (
        <div className="space-y-4">
          <StripeHeading title={config.title} subtitle={config.subtitle} />

          {stage === 'pending_verification' && (
            <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950/20">
              <Clock className="h-4 w-4 shrink-0 text-blue-500 animate-pulse" />
              <p className="text-xs text-blue-700 dark:text-blue-300">{mt("stripeIsReviewingYourSubmittedInformationThisUsuallyTakesAFe")}</p>
            </div>
          )}

          {stage === 'past_due' && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-950/20">
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />
              <p className="text-xs text-red-700 dark:text-red-300">{mt("someRequiredInformationIsOverduePleaseUpdateItToKeepYourAcco")}</p>
            </div>
          )}

          <div>
            <Button
              size="sm"
              className={CARD_ACTION}
              onClick={handleAccessDashboard}
              variant={stage === 'past_due' || stage === 'rejected' ? 'destructive' : 'default'}
              disabled={getDashboardLinkMutation.isPending}
            >
              {getDashboardLinkMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  {config.buttonLoadingLabel}
                </>
              ) : (
                <>
                  <ButtonIcon className="mr-1.5 h-4 w-4" />
                  {config.buttonLabel}
                </>
              )}
            </Button>

            <p className="mt-2 text-xs text-muted-foreground">{config.helpText}</p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className={CARD_ACTION_QUIET}
            onClick={() => checkStatusMutation.mutate()}
            disabled={checkStatusMutation.isPending}
          >
            {checkStatusMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />{mt("checking")}</>
            ) : (
              mt("alreadyCompletedRefreshStatus")
            )}
          </Button>
        </div>
      );
    }
  }

}
