/**
 * Chef Stripe Connect Setup Component
 * 
 * Links chefs to the PHP app where they can set up Stripe Connect
 * to receive payments when selling on the LocalCooks platform.
 * This is only shown after their seller application has been approved.
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, AlertCircle, ExternalLink, Lock } from 'lucide-react';

// PHP app URL for chef Stripe Connect setup (vendor onboarding)
const CHEF_STRIPE_CONNECT_URL = 'https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php';

interface ChefStripeConnectSetupProps {
  isApproved?: boolean; // Whether the chef's seller application is approved
}

export default function ChefStripeConnectSetup({ isApproved = false }: ChefStripeConnectSetupProps) {
  const handleConnectStripe = () => {
    window.open(CHEF_STRIPE_CONNECT_URL, '_blank', 'noopener,noreferrer');
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

  // Approved - show connect button that links to PHP app
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Set Up Payments
        </CardTitle>
        <CardDescription>
          Connect your Stripe account to start receiving payments when customers order your food.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              You will be redirected to LocalCooks to complete your Stripe Connect setup.
              This process takes about 5 minutes and is required to receive payments.
            </AlertDescription>
          </Alert>
          <Button 
            onClick={handleConnectStripe}
            className="w-full"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Connect Stripe Account
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Opens in a new tab. You&apos;ll be guided through the Stripe Connect setup process.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
