/**
 * Customer Payment Component
 * 
 * This component handles customer payments (chefs booking kitchens) using:
 * - Credit/debit cards (standard in Canada) - primary payment method
 * - ACSS pre-authorized debit (optional, for recurring payments)
 * 
 * This is SEPARATE from Stripe Connect onboarding (which is for managers/chefs to receive payouts).
 * 
 * Uses PaymentIntent with manual capture (pre-authorization):
 * - Places authorization hold when booking is confirmed
 * - Payment is captured after cancellation period expires
 * - If cancelled within cancellation period, hold is released
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, CheckCircle2, CreditCard } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Initialize Stripe
// Support both VITE_STRIPE_PUBLISHABLE_KEY (Vite convention) and STRIPE_PUBLISHABLE_KEY (fallback)
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = loadStripe(stripePublishableKey);

interface CustomerPaymentProps {
  clientSecret: string;
  amount: number; // in cents
  currency: string;
  onSuccess: (paymentIntentId: string, paymentMethodId: string) => void;
  onError: (error: string) => void;
}

function PaymentForm({ clientSecret, amount, currency, onSuccess, onError }: CustomerPaymentProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const hasCalledSuccessRef = useRef(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (elements) {
      setIsReady(true);
    }
  }, [elements]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || isProcessing || isSubmittingRef.current || hasCalledSuccessRef.current) {
      return;
    }

    // Check payment status first to avoid confirming already confirmed payments
    try {
      const retrieved = await stripe.retrievePaymentIntent(clientSecret);
      if (retrieved.paymentIntent) {
        const pi = retrieved.paymentIntent;
        // Authorization hold successful or payment succeeded
        if (pi.status === 'succeeded' || pi.status === 'processing' || pi.status === 'requires_capture') {
          // Payment already confirmed
          let paymentMethodId = '';
          if (typeof pi.payment_method === 'string') {
            paymentMethodId = pi.payment_method;
          } else if (pi.payment_method && typeof pi.payment_method === 'object') {
            paymentMethodId = (pi.payment_method as any).id || '';
          }

          if (!hasCalledSuccessRef.current && paymentMethodId) {
            hasCalledSuccessRef.current = true;
            console.log('Payment already confirmed:', pi.id);
            onSuccess(pi.id, paymentMethodId);
          }
          return;
        }
      }
    } catch (checkError) {
      console.error('Error checking payment status:', checkError);
      // Continue with confirmation if check fails
    }

    isSubmittingRef.current = true;
    setIsProcessing(true);
    setError(null);

    try {
      // Step 1: Submit elements to validate and collect payment method
      // This must be called before confirmPayment() per Stripe's deferred payment pattern
      const { error: submitError } = await elements.submit();

      if (submitError) {
        setError(submitError.message || 'Payment form validation failed');
        onError(submitError.message || 'Payment form validation failed');
        isSubmittingRef.current = false;
        setIsProcessing(false);
        return;
      }

      // Step 2: Confirm payment after successful submission
      // For ACSS debit, confirmPayment will collect the mandate and automatically confirm
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required', // Only redirect if required (3DS, etc.)
      });

      if (confirmError) {
        setError(confirmError.message || 'Payment failed');
        onError(confirmError.message || 'Payment failed');
        isSubmittingRef.current = false;
        setIsProcessing(false);
        return;
      }

      // Check payment intent status
      if (paymentIntent) {
        // Authorization hold successful or payment succeeded
        if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing' || paymentIntent.status === 'requires_capture') {
          // Get payment method ID - can be string or object
          let paymentMethodId = '';
          if (typeof paymentIntent.payment_method === 'string') {
            paymentMethodId = paymentIntent.payment_method;
          } else if (paymentIntent.payment_method && typeof paymentIntent.payment_method === 'object') {
            paymentMethodId = (paymentIntent.payment_method as any).id || '';
          }

          // Only call onSuccess once
          if (!hasCalledSuccessRef.current && paymentMethodId) {
            hasCalledSuccessRef.current = true;
            console.log('Payment confirmed successfully:', paymentIntent.id);
            onSuccess(paymentIntent.id, paymentMethodId);
            return; // Exit early to prevent further processing
          }
        } else if (paymentIntent.status === 'requires_payment_method') {
          // Still needs payment method - mandate collection might have failed
          setError('Please complete the bank account information and try again.');
          onError('Payment method collection incomplete');
        } else if (paymentIntent.status === 'canceled') {
          setError('Payment was canceled');
          onError('Payment was canceled');
        } else {
          const errorMsg = `Payment status: ${paymentIntent.status}`;
          setError(errorMsg);
          onError(errorMsg);
        }
      } else {
        // If no paymentIntent returned, retrieve it to check status
        try {
          const retrieved = await stripe.retrievePaymentIntent(clientSecret);
          if (retrieved.paymentIntent) {
            const pi = retrieved.paymentIntent;
            // Authorization hold successful or payment succeeded
            if (pi.status === 'succeeded' || pi.status === 'processing' || pi.status === 'requires_capture') {
              let paymentMethodId = '';
              if (typeof pi.payment_method === 'string') {
                paymentMethodId = pi.payment_method;
              } else if (pi.payment_method && typeof pi.payment_method === 'object') {
                paymentMethodId = (pi.payment_method as any).id || '';
              }

              if (!hasCalledSuccessRef.current && paymentMethodId) {
                hasCalledSuccessRef.current = true;
                console.log('Payment confirmed successfully (retrieved):', pi.id);
                onSuccess(pi.id, paymentMethodId);
                return;
              }
            } else {
              setError(`Payment status: ${pi.status}`);
              onError(`Payment status: ${pi.status}`);
            }
          }
        } catch (retrieveError: any) {
          console.error('Error retrieving payment intent:', retrieveError);
          setError('Unable to verify payment status. Please check your booking status.');
          onError('Unable to verify payment status');
        }
      }
    } catch (err: any) {
      console.error('Payment submission error:', err);
      const errorMsg = err.message || 'An unexpected error occurred';
      setError(errorMsg);
      onError(errorMsg);
    } finally {
      isSubmittingRef.current = false;
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
          We'll place an authorization hold on your payment method. The charge will be processed after the cancellation period expires.
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
            // Prioritize cards (standard in Canada), ACSS as secondary option
            defaultValues: {
              billingDetails: {
                address: {
                  country: 'CA', // Default to Canada
                },
              },
            },
            // Payment method types are automatically determined from the PaymentIntent
            // No need to specify paymentMethodTypes here - Stripe Elements shows what's available
          }}
        />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2 mb-2">
          <CreditCard className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-900 mb-1">How Payment Works</h4>
            <p className="text-xs text-blue-800 mb-2">
              <strong>Credit/Debit Card:</strong> We'll place an <strong>authorization hold</strong> on your card when you confirm this booking. 
              This appears as a "pending" transaction in your bank app. The <strong>actual charge</strong> will be processed 
              after the cancellation period expires (typically 24 hours before your booking). If you cancel within the cancellation period, 
              the hold will be released automatically.
            </p>
            <p className="text-xs text-blue-800 mb-2">
              <strong>ACSS Bank Debit:</strong> ACSS payments process immediately when you confirm the booking. 
              By providing your bank account information, you authorize us to debit your account for this booking 
              and create a mandate for future bookings. You can cancel this authorization at any time.
            </p>
            <p className="text-xs text-blue-700">
              <strong>Your payment method is saved securely</strong> for faster checkout on future bookings.
            </p>
          </div>
        </div>
      </div>

      <Button
        type="submit"
        disabled={!stripe || !elements || isProcessing || !isReady || hasCalledSuccessRef.current}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing Payment...
          </>
        ) : hasCalledSuccessRef.current ? (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Payment Confirmed
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

/**
 * Customer Payment Component (Card + ACSS)
 * 
 * This is for CUSTOMERS (chefs) making payments for bookings.
 * Uses PaymentElement which supports both cards and ACSS debit.
 * 
 * NOTE: This is separate from Stripe Connect onboarding (for managers to receive payouts).
 * 
 * Exported as ACSSDebitPayment for backward compatibility, but handles both cards and ACSS.
 */
export default function ACSSDebitPayment({ clientSecret, amount, currency, onSuccess, onError }: CustomerPaymentProps) {
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

  // Use useMemo to prevent Elements from re-initializing on every render
  const elementsOptions = useMemo(() => options, [clientSecret]);

  return (
    <Elements stripe={stripePromise} options={elementsOptions} key={clientSecret}>
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
