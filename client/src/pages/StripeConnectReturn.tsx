/**
 * Stripe Connect Return Page
 * 
 * This page handles the return from Stripe's hosted onboarding flow.
 * It opens in a new tab after Stripe onboarding completes, so we need to:
 * 1. Show a success message
 * 2. Attempt to sync status if authenticated
 * 3. Broadcast success to the original tab
 * 4. Provide instructions to close this tab
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

type SyncStatus = 'loading' | 'success' | 'error' | 'unauthenticated';

export default function StripeConnectReturn() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isSuccess = params.get('success') === 'true';
    const role = params.get('role') || 'manager'; // Default to manager

    if (!isSuccess) {
      setSyncStatus('error');
      setErrorMessage('Stripe setup was not completed. Please try again.');
      return;
    }

    // Wait for Firebase auth to be ready
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // User is authenticated, try to sync
        try {
          const token = await user.getIdToken();
          const endpoint = role === 'chef' 
            ? '/api/chef/stripe-connect/sync'
            : '/api/manager/stripe-connect/sync';
          
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            setSyncStatus('success');
            
            // Broadcast success to other tabs
            try {
              const channel = new BroadcastChannel('stripe_onboarding_channel');
              channel.postMessage({ type: 'STRIPE_SETUP_COMPLETE' });
              channel.close();
            } catch (e) {
              console.log('BroadcastChannel not supported or failed:', e);
            }
          } else {
            // Sync failed but Stripe setup might still be complete
            // Show success anyway since Stripe redirected with success=true
            setSyncStatus('success');
            console.warn('Sync API call failed, but Stripe reported success');
          }
        } catch (error) {
          console.error('Error syncing Stripe status:', error);
          // Still show success since Stripe redirected with success=true
          setSyncStatus('success');
        }
      } else {
        // Not authenticated - still show success message
        // The original tab will handle the sync when user returns
        setSyncStatus('success');
      }
    });

    // Cleanup
    return () => unsubscribe();
  }, []);

  const handleClose = () => {
    window.close();
  };

  const handleGoToDashboard = () => {
    // Redirect to the appropriate dashboard
    const params = new URLSearchParams(window.location.search);
    const role = params.get('role') || 'manager';
    
    if (role === 'chef') {
      window.location.href = '/chef/dashboard';
    } else {
      window.location.href = '/manager/dashboard?view=payments';
    }
  };

  if (syncStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Verifying your Stripe setup...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (syncStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-6 w-6" />
              Setup Issue
            </CardTitle>
            <CardDescription>
              {errorMessage || 'There was an issue with your Stripe setup.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Please return to your dashboard and try the setup again.
              </p>
              <div className="flex gap-2">
                <Button onClick={handleGoToDashboard} className="flex-1">
                  Go to Dashboard
                </Button>
                <Button variant="outline" onClick={handleClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-6 w-6" />
            Stripe Setup Complete!
          </CardTitle>
          <CardDescription>
            Your Stripe account has been successfully connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800">
                ✅ You can now receive payments directly to your bank account.
                Payments will be transferred within 2-7 business days after each booking.
              </p>
            </div>
            
            <p className="text-sm text-muted-foreground text-center">
              You can safely close this tab and return to your dashboard.
            </p>
            
            <div className="flex gap-2">
              <Button onClick={handleGoToDashboard} className="flex-1">
                Go to Dashboard
              </Button>
              <Button variant="outline" onClick={handleClose}>
                Close Tab
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
