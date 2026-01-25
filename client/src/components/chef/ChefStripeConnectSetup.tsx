/**
 * Chef Stripe Connect Setup Component
 * 
 * Allows chefs to set up Stripe Connect to receive payments when selling
 * on the LocalCooks platform. This is only shown after their seller
 * application has been approved.
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CreditCard, CheckCircle2, AlertCircle, ExternalLink, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';

interface ChefStripeConnectSetupProps {
  isApproved?: boolean; // Whether the chef's seller application is approved
}

export default function ChefStripeConnectSetup({ isApproved = false }: ChefStripeConnectSetupProps) {
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
    enabled: !!firebaseUser && isApproved,
  });

  const hasStripeAccount = !!userProfile?.stripeConnectAccountId || !!userProfile?.stripe_connect_account_id;
  const onboardingStatus = userProfile?.stripeConnectOnboardingStatus || userProfile?.stripe_connect_onboarding_status;
  const isOnboardingComplete = onboardingStatus === 'complete';

  // Fetch service fee rate
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
      return { rate: 0.05, percentage: '5.00' };
    },
    staleTime: 5 * 60 * 1000,
    enabled: isApproved,
  });

  const serviceFeePercentage = serviceFeeRateData?.percentage;

  // Listen for cross-tab completion events
  useEffect(() => {
    if (!isApproved) return;
    
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
  }, [queryClient, toast, isApproved]);

  const handleAccountCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
  };

  // Create Connect account mutation - uses chef-specific endpoint
  const createAccountMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/chef/stripe-connect/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const error = await response.json();
        if (error.error === 'Stripe Connect account already exists' && error.accountId) {
          return { accountId: error.accountId, alreadyExists: true };
        }
        throw new Error(error.error || 'Failed to create account');
      }
      return response.json();
    },
    onSuccess: async (data) => {
      handleAccountCreated();
      
      if (data.alreadyExists) {
        toast({
          title: 'Account Already Connected',
          description: 'Your Stripe account is already connected. You can access your dashboard below.',
        });
        return;
      }
      
      // If we got a URL, open it
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        await startOnboardingMutation.mutateAsync();
      }
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
      const response = await fetch('/api/chef/stripe-connect/onboarding-link', {
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

  // Get dashboard login link mutation
  const getDashboardLinkMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) throw new Error('Not authenticated');
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/chef/stripe-connect/dashboard-link', {
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
      return { url: data.url, requiresOnboarding: data.requiresOnboarding || false };
    },
    onSuccess: (data: { url: string; requiresOnboarding: boolean }) => {
      window.open(data.url, '_blank', 'noopener,noreferrer');
      
      if (data.requiresOnboarding) {
        toast({
          title: 'Opening Stripe Setup',
          description: 'Complete your Stripe Connect setup to start receiving payments.',
        });
        queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      } else {
        toast({
          title: 'Opening Dashboard',
          description: 'Your Stripe Dashboard is opening in a new tab.',
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
      const response = await fetch('/api/chef/stripe-connect/sync', {
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
      queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      if (data.status === 'complete' || data.detailsSubmitted) {
        toast({
          title: "Setup Complete",
          description: "Your Stripe account is now fully connected.",
        });
      } else {
        toast({
          title: "Still Pending",
          description: "Stripe reports that onboarding is not yet complete.",
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

  // Show locked state if not approved
  if (!isApproved) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Lock className="h-5 w-5" />
            Payment Setup
          </CardTitle>
          <CardDescription>
            Connect your Stripe account to receive payments when you sell on LocalCooks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Payment setup will be available once your seller application on LocalCooks is approved.
              This is required to receive payments from customers when you sell food on our platform.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

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
            Connect your Stripe account to start receiving payments when customers order your food.
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
                  ✅ You'll receive payments automatically when customers order your food.
                  The platform service fee ({serviceFeePercentage}%) will be deducted automatically, and the remaining amount
                  will be transferred to your bank account within 2-7 business days.
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
      // Account created but onboarding not complete
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
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
                    Complete Stripe Setup
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

  return null;
}
