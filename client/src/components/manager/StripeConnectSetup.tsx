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
import { useToast } from '@/hooks/use-toast';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';

export default function StripeConnectSetup() {
  const { toast } = useToast();
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
  const hasStripeAccount = stripeStatus?.hasAccount || !!userProfile?.stripeConnectAccountId || !!userProfile?.stripe_connect_account_id;
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
    
    channel.onmessage = (event) => {
      console.log('Received broadcast message:', event.data);
      if (event.data?.type === 'STRIPE_SETUP_COMPLETE') {
        toast({
          title: "Setup Verified",
          description: "We detected your completed setup from the other tab.",
        });
        queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      }
    };

    return () => {
      channel.close();
    };
  }, [queryClient, toast]);

  // Invalidate user profile query after creating account to refresh the UI
  const handleAccountCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
  };

  // Create Connect account mutation
  const createAccountMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/manager/stripe-connect/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
        toast({
          title: 'Account Already Connected',
          description: 'Your Stripe account is already connected. You can access your dashboard below.',
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
      const response = await fetch('/api/manager/stripe-connect/onboarding-link', {
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
      const response = await fetch('/api/manager/stripe-connect/dashboard-link', {
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
      
      // Check actual Stripe status fields
      const isFullyReady = data.details?.chargesEnabled && data.details?.payoutsEnabled;
      if (isFullyReady || data.status === 'complete') {
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Set Up Payments
          </CardTitle>
          <CardDescription>
            Connect your Stripe account to start receiving payments directly for kitchen bookings.
            The platform service fee ({serviceFeePercentage}%) will be automatically deducted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Stripe's secure onboarding page will open in a new tab to complete the setup.
                This process takes about 5 minutes. You can continue using this page while setting up.
              </AlertDescription>
            </Alert>
            <Button 
              onClick={handleCreateAccount}
              disabled={createAccountMutation.isPending}
              className="w-full"
            >
              {createAccountMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Connect Stripe Account
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Account created but onboarding may not be complete
  if (hasStripeAccount) {
    // Show different UI based on onboarding status
    if (isOnboardingComplete) {
      // Onboarding complete - show success state
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Payment Setup Complete
            </CardTitle>
            <CardDescription>
              Your Stripe account is connected and ready to receive payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  ✅ You'll receive payments automatically after each booking.
                  The platform service fee ({serviceFeePercentage}%) will be deducted automatically, and the remaining amount
                  will be transferred to your bank account within 2-7 business days.
                </AlertDescription>
              </Alert>
              {/* {userProfile?.stripeConnectAccountId && (
                <div className="text-sm text-gray-600 space-y-1">
                  <p><strong>Account ID:</strong> {userProfile.stripeConnectAccountId}</p>
                </div>
              )} */}
              <Button 
                onClick={handleAccessDashboard}
                className="w-full"
                disabled={getDashboardLinkMutation.isPending}
              >
                {getDashboardLinkMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opening Dashboard...
                  </>
                ) : (
                  <>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Access Your Dashboard
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Click to open your Stripe Express Dashboard in a new tab where you can view payments, payouts, and manage your account settings.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    } else {
      // Account created but onboarding not complete - show setup needed state
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Complete Stripe Setup
            </CardTitle>
            <CardDescription>
              Your Stripe account has been created, but you need to complete the setup process to start receiving payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  ⚠️ You need to complete Stripe's onboarding process to start receiving payments.
                  This takes about 5 minutes and includes providing business information and bank account details.
                </AlertDescription>
              </Alert>
              <Button 
                onClick={handleAccessDashboard}
                className="w-full"
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
                    Setup Stripe Account
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Click to complete your Stripe Connect setup and start receiving payments. The setup page will open in a new tab.
              </p>
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">Already completed setup?</p>
                <Button 
                  variant="outline"
                  onClick={() => checkStatusMutation.mutate()}
                  disabled={checkStatusMutation.isPending}
                  className="w-full"
                >
                  {checkStatusMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking Status...
                    </>
                  ) : (
                    "Refresh Status"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }
  }

}
