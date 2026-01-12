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
        throw new Error(error.error || 'Failed to create account');
      }
      return response.json();
    },
    onSuccess: async () => {
      // Refresh user profile to get the new account ID
      handleAccountCreated();
      // After creating account, get onboarding link
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
      return data.url;
    },
    onSuccess: (url: string) => {
      // Open Stripe Dashboard in a new tab
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
            The platform service fee (5% + $0.30 per transaction) will be automatically deducted.
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

  // Connected - show success message and dashboard button
  if (hasStripeAccount) {
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
                The platform service fee (5% + $0.30 per transaction) will be deducted automatically, and the remaining amount
                will be transferred to your bank account within 2-7 business days.
              </AlertDescription>
            </Alert>
            {userProfile?.stripeConnectAccountId && (
              <div className="text-sm text-gray-600 space-y-1">
                <p><strong>Account ID:</strong> {userProfile.stripeConnectAccountId}</p>
              </div>
            )}
            <Button 
              onClick={handleAccessDashboard}
              variant="outline"
              className="w-full"
              disabled={getDashboardLinkMutation.isPending}
            >
              {getDashboardLinkMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Access your Stripe Dashboard
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

}
