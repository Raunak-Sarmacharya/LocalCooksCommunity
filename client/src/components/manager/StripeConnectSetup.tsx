/**
 * Stripe Connect Setup Component
 * 
 * Allows managers to set up Stripe Connect to receive payments directly
 * after the platform service fee is deducted.
 */

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

  // Fetch user profile to check for Stripe Connect account ID
  const { data: userProfile, isLoading } = useQuery({
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

  const hasStripeAccount = !!userProfile?.stripeConnectAccountId || !!userProfile?.stripe_connect_account_id;
  const onboardingStatus = userProfile?.stripeConnectOnboardingStatus || userProfile?.stripe_connect_onboarding_status;
  const isOnboardingComplete = onboardingStatus === 'complete';

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

  const handleAccessDashboard = () => {
    getDashboardLinkMutation.mutate();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
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
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Payment Setup Complete
            </CardTitle>
            <CardDescription>
              Your Stripe account is connected and ready to receive payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
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
                className="w-full bg-[#635BFF] hover:bg-[#5851E6] text-white"
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
              <p className="text-xs text-gray-500 text-center">
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
              <AlertCircle className="h-5 w-5 text-amber-600" />
              Complete Stripe Setup
            </CardTitle>
            <CardDescription>
              Your Stripe account has been created, but you need to complete the setup process to start receiving payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  ⚠️ You need to complete Stripe's onboarding process to start receiving payments.
                  This takes about 5 minutes and includes providing business information and bank account details.
                </AlertDescription>
              </Alert>
              <Button 
                onClick={handleAccessDashboard}
                className="w-full bg-[#635BFF] hover:bg-[#5851E6] text-white"
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
              <p className="text-xs text-gray-500 text-center">
                Click to complete your Stripe Connect setup and start receiving payments. The setup page will open in a new tab.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }
  }

}
