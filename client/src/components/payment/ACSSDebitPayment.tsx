import { useState, useEffect } from 'react';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Initialize Stripe
// Support both VITE_STRIPE_PUBLISHABLE_KEY (Vite convention) and STRIPE_PUBLISHABLE_KEY (fallback)
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = loadStripe(stripePublishableKey);

interface ACSSDebitPaymentProps {
  clientSecret: string;
  amount: number; // in cents
  currency: string;
  onSuccess: (paymentIntentId: string, paymentMethodId: string) => void;
  onError: (error: string) => void;
}

function PaymentForm({ clientSecret, amount, currency, onSuccess, onError }: ACSSDebitPaymentProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (elements) {
      setIsReady(true);
    }
  }, [elements]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Submit payment
      const { error: submitError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required', // Don't redirect, handle in-app
      });

      if (submitError) {
        setError(submitError.message || 'Payment failed');
        onError(submitError.message || 'Payment failed');
        setIsProcessing(false);
        return;
      }

      if (paymentIntent) {
        if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
          // Get payment method from payment intent
          const paymentMethodId = paymentIntent.payment_method as string;
          onSuccess(paymentIntent.id, paymentMethodId);
        } else {
          const errorMsg = `Payment status: ${paymentIntent.status}`;
          setError(errorMsg);
          onError(errorMsg);
        }
      } else {
        setError('Payment confirmation failed');
        onError('Payment confirmation failed');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'An unexpected error occurred';
      setError(errorMsg);
      onError(errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatAmount = (cents: number, curr: string) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: curr.toUpperCase(),
    }).format(cents / 100);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">Total Amount</span>
          <span className="text-lg font-bold text-gray-900">{formatAmount(amount, currency)}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Payment will be processed via pre-authorized debit from your Canadian bank account.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="border border-gray-200 rounded-lg p-4">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">Pre-Authorized Debit Agreement</h4>
        <p className="text-xs text-blue-800 mb-2">
          By providing your bank account information, you authorize Local Cooks Community to debit your account 
          for this booking and any future bookings you make. You can cancel this authorization at any time by 
          contacting your bank or us.
        </p>
        <p className="text-xs text-blue-700">
          Payments typically take 3-5 business days to process. You will receive email confirmation once the payment is processed.
        </p>
      </div>

      <Button
        type="submit"
        disabled={!stripe || !elements || isProcessing || !isReady}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing Payment...
          </>
        ) : (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Confirm Payment
          </>
        )}
      </Button>
    </form>
  );
}

export default function ACSSDebitPayment({ clientSecret, amount, currency, onSuccess, onError }: ACSSDebitPaymentProps) {
  const [stripeError, setStripeError] = useState<string | null>(null);

  useEffect(() => {
    const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      setStripeError('Stripe publishable key is not configured. Please set VITE_STRIPE_PUBLISHABLE_KEY in environment variables.');
    }
  }, []);

  if (stripeError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{stripeError}</AlertDescription>
      </Alert>
    );
  }

  if (!clientSecret) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Payment configuration error. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const options: StripeElementsOptions = {
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#2563eb',
        colorBackground: '#ffffff',
        colorText: '#1f2937',
        colorDanger: '#ef4444',
        fontFamily: 'system-ui, sans-serif',
        spacingUnit: '4px',
        borderRadius: '8px',
      },
    },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentForm
        clientSecret={clientSecret}
        amount={amount}
        currency={currency}
        onSuccess={onSuccess}
        onError={onError}
      />
    </Elements>
  );
}
