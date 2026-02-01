/**
 * Stripe Connect Setup Component
 * 
 * Allows managers to set up Stripe Connect to receive payments directly
 * after the platform service fee is deducted.
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CreditCard, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';

export default function StripeConnectSetup() {
  const { user: firebaseUser } = useFirebaseAuth();
  const queryClient = useQueryClient();

  // Fetch Stripe Connect status from dedicated endpoint (queries Stripe API for real status)
  const { data: stripeStatus, isLoading } = useQuery({
    queryKey: ['/api/manager/stripe-connect/status', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/manager/stripe-connect/status', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch Stripe status');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
    staleTime: 1000 * 30, // Cache for 30 seconds
  });

  // Also fetch user profile for account ID display (fallback)
  const { data: userProfile } = useQuery({
    queryKey: ['/api/user/profile', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch profile');
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
        console.error('Error fetching service fee rate:', error);
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
      console.log('Received broadcast message:', event.data);
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
          toast.success("Stripe Setup Complete", {
            description: "Your account is ready to receive payments."
          });
        } else if (updatedStatus?.detailsSubmitted) {
          toast.info("Setup Progress Saved", {
            description: "Additional verification may be required. Check your Stripe dashboard."
          });
        } else {
          toast.info("Status Updated", {
            description: "Your Stripe setup status has been refreshed."
          });
        }
      }
    };

    return () => {
      channel.close();
    };
  }, [queryClient, toast, firebaseUser?.uid]);

  // Invalidate user profile query after creating account to refresh the UI
  const handleAccountCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
  };

  // Create Connect account mutation
  const createAccountMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
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
        toast.info('Account Already Connected', {
          description: 'Your Stripe account is already connected. You can access your dashboard below.'
        });
        return;
      }
      
      // After creating new account, get onboarding link
      await startOnboardingMutation.mutateAsync();
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Get onboarding link mutation
  const startOnboardingMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
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
      toast({
        title: 'Error',
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
      if (!firebaseUser) throw new Error('Not authenticated');
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
        throw new Error('Dashboard link URL not provided');
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
        toast({
          title: 'Opening Stripe Setup',
          description: 'Complete your Stripe Connect setup to start receiving payments.',
        });
        // Refresh user profile to update onboarding status after completion
        queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      } else {
        toast({
          title: 'Opening Dashboard',
          description: 'Your Stripe Connected Account Dashboard is opening in a new tab.',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to open Stripe. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const checkStatusMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/manager/stripe-connect/sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) throw new Error('Failed to sync status');
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
        toast({
          title: "Setup Complete",
          description: "Your Stripe account is now fully connected and ready to receive payments.",
        });
      } else if (data.details?.detailsSubmitted) {
        toast({
          title: "Verification Pending",
          description: "Your details have been submitted. Stripe is verifying your identity - this may take a few minutes.",
        });
      } else {
         toast({
          title: "Setup Incomplete",
          description: "Please complete all required steps in Stripe to start receiving payments.",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleAccessDashboard = () => {
    getDashboardLinkMutation.mutate();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not connected - show create account button
  if (!hasStripeAccount) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Connect Payments</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Receive payments directly to your bank</p>
            </div>
          </div>
          <img src="/stripe-logo.png" alt="Stripe" className="h-6" />
        </div>
        
        <Button 
          onClick={handleCreateAccount}
          disabled={createAccountMutation.isPending}
          className="w-full bg-[#635bff] hover:bg-[#5851db]"
        >
          {createAccountMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating Account...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Connect with Stripe
            </>
          )}
        </Button>
        <p className="text-xs text-slate-400 text-center">
          Secure setup opens in a new tab (~5 min)
        </p>
      </div>
    );
  }

  // Account created but onboarding may not be complete
  if (hasStripeAccount) {
    // Show different UI based on onboarding status
    if (isOnboardingComplete) {
      // Onboarding complete - show success state
      return (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Payments Connected</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Ready to receive payments</p>
              </div>
            </div>
            <img src="/stripe-logo.png" alt="Stripe" className="h-6" />
          </div>
          
          <Button 
            onClick={handleAccessDashboard}
            variant="outline"
            className="w-full"
            disabled={getDashboardLinkMutation.isPending}
          >
            {getDashboardLinkMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Opening...
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                View Stripe Dashboard
              </>
            )}
          </Button>
        </div>
      );
    } else {
      // Account created but onboarding not complete - show setup needed state
      return (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Complete Setup</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Finish onboarding to receive payments</p>
              </div>
            </div>
            <img src="/stripe-logo.png" alt="Stripe" className="h-6" />
          </div>
          
          <Button 
            onClick={handleAccessDashboard}
            className="w-full bg-[#635bff] hover:bg-[#5851db]"
            disabled={getDashboardLinkMutation.isPending}
          >
            {getDashboardLinkMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Opening Setup...
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Complete Stripe Setup
              </>
            )}
          </Button>
          
          <Button 
            variant="ghost"
            onClick={() => checkStatusMutation.mutate()}
            disabled={checkStatusMutation.isPending}
            className="w-full text-slate-500"
            size="sm"
          >
            {checkStatusMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Checking...
              </>
            ) : (
              "Already completed? Refresh status"
            )}
          </Button>
        </div>
      );
    }
  }

}
