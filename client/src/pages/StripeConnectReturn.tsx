/**
 * Stripe Connect Return Page
 * 
 * This page handles the return from Stripe's hosted onboarding flow.
 * It handles both:
 * 1. New tab scenario - when Stripe opens in a new tab
 * 2. Same tab redirect - when returning from Stripe ID verification
 * 
 * The page will:
 * 1. Sync status with backend
 * 2. Broadcast success to other tabs (for new tab scenario)
 * 3. Auto-redirect to the appropriate page after a short delay
 */

import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, Loader2, AlertCircle, X, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

type SyncStatus = 'loading' | 'success' | 'error' | 'unauthenticated';

export default function StripeConnectReturn() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [countdown, setCountdown] = useState(5);
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Get redirect destination based on URL params
  const getRedirectDestination = () => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get('role') || 'manager';
    const fromSetup = params.get('from') === 'setup';
    
    if (role === 'chef') {
      return { url: '/chef/dashboard', label: 'Chef Dashboard' };
    } else if (fromSetup) {
      return { url: '/manager/setup', label: 'Setup Page' };
    } else {
      return { url: '/manager/dashboard?view=payments', label: 'Payments Dashboard' };
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isSuccess = params.get('success') === 'true';
    const role = params.get('role') || 'manager';

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

            // Start auto-redirect countdown
            startAutoRedirect();
          } else {
            // Sync failed but Stripe setup might still be complete
            setSyncStatus('success');
            console.warn('Sync API call failed, but Stripe reported success');
            startAutoRedirect();
          }
        } catch (error) {
          console.error('Error syncing Stripe status:', error);
          // Still show success since Stripe redirected with success=true
          setSyncStatus('success');
          startAutoRedirect();
        }
      } else {
        // Not authenticated - still show success message
        setSyncStatus('success');
        startAutoRedirect();
      }
    });

    // Cleanup
    return () => {
      unsubscribe();
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  const startAutoRedirect = () => {
    // Start countdown
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Redirect after 5 seconds
    redirectTimerRef.current = setTimeout(() => {
      handleGoToDashboard();
    }, 5000);
  };

  const cancelAutoRedirect = () => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(0);
  };

  const handleClose = () => {
    cancelAutoRedirect();
    window.close();
  };

  const handleGoToDashboard = () => {
    cancelAutoRedirect();
    const { url } = getRedirectDestination();
    window.location.href = url;
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
  const { label } = getRedirectDestination();
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
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
            <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-sm text-green-800 dark:text-green-200">
                ✅ You can now receive payments directly to your bank account.
                Payments will be transferred within 2-7 business days after each booking.
              </p>
            </div>
            
            {countdown > 0 ? (
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Redirecting to <span className="font-medium">{label}</span> in {countdown} seconds...
                </p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={cancelAutoRedirect}
                  className="text-xs"
                >
                  Cancel auto-redirect
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center">
                You can safely close this tab or click below to continue.
              </p>
            )}
            
            <div className="flex gap-2">
              <Button onClick={handleGoToDashboard} className="flex-1">
                <ExternalLink className="h-4 w-4 mr-2" />
                Go to {label}
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
