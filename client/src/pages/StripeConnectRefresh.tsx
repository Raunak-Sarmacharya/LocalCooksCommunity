import { logger } from "@/lib/logger";
/**
 * Stripe Connect Refresh Page
 * 
 * This page handles the refresh_url callback from Stripe's hosted onboarding.
 * Per Stripe docs, users are redirected here when:
 * - The Account Link has expired (a few minutes after creation)
 * - The link was already visited (user refreshed, clicked back/forward)
 * - The link was previewed by a messaging app
 * 
 * Industry standard: Automatically generate a new Account Link and redirect back to Stripe.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

type RefreshStatus = 'loading' | 'redirecting' | 'error';

export default function StripeConnectRefresh() {
  const [status, setStatus] = useState<RefreshStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);

  const getRole = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('role') || 'manager';
  };

  const getFromParam = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('from') === 'setup' ? '?from=setup' : '';
  };

  const generateNewLink = async () => {
    setStatus('loading');
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus('error');
        setErrorMessage('Please sign in to continue with Stripe setup.');
        unsubscribe();
        return;
      }

      try {
        const token = await user.getIdToken();
        const role = getRole();
        const fromParam = getFromParam();
        
        const endpoint = role === 'chef'
          ? `/api/chef/stripe-connect/onboarding-link${fromParam}`
          : `/api/manager/stripe-connect/onboarding-link${fromParam}`;

        const response = await fetch(endpoint, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to generate new link');
        }

        const data = await response.json();
        
        if (data.url) {
          setStatus('redirecting');
          // Small delay so user sees the "Redirecting..." message
          setTimeout(() => {
            window.location.href = data.url;
          }, 500);
        } else {
          throw new Error('No onboarding URL returned');
        }
      } catch (error) {
        logger.error('Error generating new Stripe link:', error);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Failed to continue setup');
      }
      
      unsubscribe();
    });
  };

  useEffect(() => {
    generateNewLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    generateNewLink();
  };

  const handleGoBack = () => {
    const role = getRole();
    const params = new URLSearchParams(window.location.search);
    const fromSetup = params.get('from') === 'setup';
    
    if (role === 'chef') {
      window.location.href = '/chef/dashboard';
    } else if (fromSetup) {
      window.location.href = '/manager/setup';
    } else {
      window.location.href = '/manager/dashboard?view=payments';
    }
  };

  if (status === 'loading' || status === 'redirecting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-lg font-medium mb-2">
                {status === 'redirecting' ? 'Redirecting to Stripe...' : 'Preparing Stripe setup...'}
              </p>
              <p className="text-sm text-muted-foreground text-center">
                {status === 'redirecting' 
                  ? 'You will be redirected momentarily.'
                  : 'Your previous link expired. Generating a fresh one...'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="h-6 w-6" />
            Setup Link Expired
          </CardTitle>
          <CardDescription>
            {errorMessage || 'The Stripe setup link has expired or was already used.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This can happen if:
            </p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>The link was open for too long</li>
              <li>You refreshed the page or used browser back/forward</li>
              <li>A messaging app previewed the link</li>
            </ul>
            
            <div className="flex gap-2 pt-2">
              <Button onClick={handleRetry} className="flex-1">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button variant="outline" onClick={handleGoBack}>
                Go Back
              </Button>
            </div>
            
            {retryCount > 2 && (
              <p className="text-xs text-muted-foreground text-center">
                Having trouble? Try starting fresh from your dashboard.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
