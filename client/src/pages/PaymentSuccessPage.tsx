import { logger } from "@/lib/logger";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertCircle } from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";

// ── Inline keyframes for premium draw + progress animations ──
const successAnimationCSS = `
@keyframes sc-draw-circle{to{stroke-dashoffset:0}}
@keyframes sc-draw-check{to{stroke-dashoffset:0}}
@keyframes sc-fill-bg{to{opacity:1}}
@keyframes sc-progress{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}
@keyframes sc-fade-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.sc-circle{stroke-dasharray:175.93;stroke-dashoffset:175.93;animation:sc-draw-circle .6s cubic-bezier(.65,0,.45,1) forwards}
.sc-fill{opacity:0;animation:sc-fill-bg .3s ease-out .4s forwards}
.sc-check{stroke-dasharray:30;stroke-dashoffset:30;animation:sc-draw-check .3s cubic-bezier(.65,0,.45,1) .55s forwards}
.sc-slide{animation:sc-progress 2s cubic-bezier(.4,0,.2,1) infinite}
.sc-stagger{opacity:0;animation:sc-fade-up .45s ease-out forwards}
`;

// ── Animated SVG checkmark (Stripe/Notion draw-in pattern) ──
function AnimatedCheckmark() {
  return (
    <svg className="w-16 h-16 mx-auto" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="28" className="sc-fill" fill="hsl(var(--muted))" />
      <circle
        cx="32" cy="32" r="28"
        className="sc-circle"
        stroke="hsl(var(--foreground))"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M22 33L29 40L42 25"
        className="sc-check"
        stroke="hsl(var(--foreground))"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Indeterminate progress bar ──
function IndeterminateProgress() {
  return (
    <div className="w-full max-w-[140px] h-[2px] bg-border rounded-full overflow-hidden mx-auto">
      <div className="h-full w-1/4 bg-muted-foreground/50 rounded-full sc-slide" />
    </div>
  );
}

export default function PaymentSuccessPage() {
  const [, navigate] = useLocation();
  useFirebaseAuth();
  const [booking, setBooking] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setIsPolling] = useState(false);
  const [, setPollingAttempt] = useState(0);

  // Get booking ID or session ID from URL
  // Enterprise-grade flow: booking is created in webhook, so we may need to poll
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get('bookingId') || params.get('booking_id');
    const sessionId = params.get('session_id');

    // If no booking ID and no session ID, show generic success
    if (!bookingId && !sessionId) {
      // Payment was successful but booking details not available yet
      setIsLoading(false);
      return;
    }

    // Fetch booking details with retry for enterprise flow
    const fetchBooking = async (retryCount = 0): Promise<void> => {
      try {
        const { auth } = await import('@/lib/firebase');
        
        // Wait for auth state to be ready (Firebase may still be initializing after redirect)
        let currentUser = auth.currentUser;
        if (!currentUser) {
          // Wait up to 5 seconds for auth state to initialize
          for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            currentUser = auth.currentUser;
            if (currentUser) break;
          }
        }
        
        if (!currentUser) {
          logger.info('[PaymentSuccess] No user after waiting, will retry fetch');
          // Instead of showing error immediately, retry the whole fetch
          if (retryCount < 3) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return fetchBooking(retryCount + 1);
          }
          setError('Please log in to view booking details');
          setIsLoading(false);
          return;
        }

        const token = await currentUser.getIdToken();
        
        // If we have a booking ID, fetch directly
        if (bookingId) {
          const response = await fetch(`/api/chef/bookings/${bookingId}`, {
            credentials: 'include',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            throw new Error('Failed to fetch booking details');
          }

          const bookingData = await response.json();
          setBookingFromData(bookingData);
          return;
        }

        // Enterprise flow: Fetch by session ID
        // The booking is created by the webhook using the payment intent ID
        if (sessionId) {
          const response = await fetch(`/api/chef/bookings/by-session/${sessionId}`, {
            credentials: 'include',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const bookingData = await response.json();
            setBookingFromData(bookingData);
            return;
          }

          // If 404 or other error, booking may not be created yet - retry
          if ((response.status === 404 || response.status >= 500) && retryCount < 15) {
            logger.info(`[PaymentSuccess] Booking not found yet (status: ${response.status}), retrying (${retryCount + 1}/15)...`);
            setIsPolling(true);
            setPollingAttempt(retryCount + 1);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return fetchBooking(retryCount + 1);
          }
        }

        // Fallback: try to get latest booking
        const fallbackResponse = await fetch(`/api/chef/bookings?limit=1`, {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (fallbackResponse.ok) {
          const data = await fallbackResponse.json();
          const bookings = data.bookings || data;
          if (Array.isArray(bookings) && bookings.length > 0) {
            const latestBooking = bookings[0];
            const createdAt = new Date(latestBooking.createdAt || latestBooking.created_at);
            const now = new Date();
            const diffMs = now.getTime() - createdAt.getTime();
            
            if (diffMs < 120000) { // Within 2 minutes
              setBookingFromData(latestBooking);
              return;
            }
          }
        }

        // If booking not found yet and we have retries left, wait and retry
        if (retryCount < 15) {
          setIsPolling(true);
          setPollingAttempt(retryCount + 1);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return fetchBooking(retryCount + 1);
        }

        // After retries, show success with processing message (payment was successful)
        setIsPolling(false);
        setIsLoading(false);
        // Don't set error - show payment success with processing message instead
      } catch (err: any) {
        logger.error('Error fetching booking:', err);
        // For enterprise flow, retry on errors (webhook may still be processing)
        if (!bookingId && retryCount < 15) {
          logger.info(`[PaymentSuccess] Error occurred, retrying (${retryCount + 1}/15)...`);
          setIsPolling(true);
          setPollingAttempt(retryCount + 1);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return fetchBooking(retryCount + 1);
        }
        if (bookingId) {
          setError(err.message || 'Failed to load booking details');
        }
        setIsPolling(false);
        setIsLoading(false);
      }
    };

    const setBookingFromData = (bookingData: any) => {
      const normalizedBooking = {
        ...bookingData,
        kitchenName: bookingData.kitchen?.name || bookingData.kitchenName || 'Kitchen',
        locationName: bookingData.location?.name || bookingData.locationName,
        locationAddress: bookingData.location?.address || bookingData.locationAddress,
        bookingDate: bookingData.bookingDate || bookingData.booking_date,
        startTime: bookingData.startTime || bookingData.start_time,
        endTime: bookingData.endTime || bookingData.end_time,
        selectedSlots: bookingData.selectedSlots || bookingData.selected_slots,
        totalPrice: bookingData.totalPrice || bookingData.total_price,
        paymentIntentId: bookingData.paymentIntentId || bookingData.payment_intent_id,
        status: bookingData.status,
      };
      setBooking(normalizedBooking);
      setIsLoading(false);
      
      // Auto-redirect to booking details page after 3 seconds
      if (normalizedBooking.id) {
        setTimeout(() => {
          navigate(`/booking/${normalizedBooking.id}`);
        }, 3000);
      }
    };

    fetchBooking();
  }, [navigate]);


  // ── Full-screen shell (Stripe/Notion immersive pattern) ──
  const PageShell = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
      <style>{successAnimationCSS}</style>
      <div className="w-full max-w-sm mx-auto px-6 text-center">
        {children}
      </div>
    </div>
  );

  // ── Loading / Confirming Payment ──
  if (isLoading) {
    return (
      <PageShell>
        <div className="space-y-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60 mx-auto" />
          <div className="space-y-1">
            <p className="text-[15px] font-medium text-foreground tracking-tight">
              Confirming your payment
            </p>
            <p className="text-[13px] text-muted-foreground">
              This will only take a moment
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <PageShell>
        <div className="space-y-5">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <p className="text-[15px] font-medium text-foreground tracking-tight">
              Something went wrong
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {error}
            </p>
          </div>
          <Button
            onClick={() => navigate('/dashboard')}
            variant="outline"
            size="sm"
            className="text-xs"
          >
            Go to Dashboard
          </Button>
        </div>
      </PageShell>
    );
  }

  // ── Payment confirmed, booking still finalizing (webhook processing) ──
  if (!booking) {
    return (
      <PageShell>
        <div className="space-y-6">
          <AnimatedCheckmark />
          <div className="space-y-1.5">
            <p className="text-[15px] font-medium text-foreground tracking-tight">
              Payment confirmed
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Your booking is being finalized. You can check your dashboard for details.
            </p>
          </div>
          <Button
            onClick={() => navigate('/dashboard')}
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Go to Dashboard
          </Button>
        </div>
      </PageShell>
    );
  }

  // ── Success: Booking ready — auto-redirects in 3s ──
  const isAuthHold = booking.paymentStatus === 'authorized';

  return (
    <PageShell>
      <div className="space-y-0">
        {/* Animated checkmark */}
        <AnimatedCheckmark />

        {/* Heading — staggered */}
        <div className="mt-6 sc-stagger" style={{ animationDelay: '0.65s' }}>
          <h1 className="text-[17px] font-semibold text-foreground tracking-tight">
            {isAuthHold ? 'Booking Submitted' : 'Payment Confirmed'}
          </h1>
        </div>

        {/* Description — staggered */}
        <div className="mt-2 sc-stagger" style={{ animationDelay: '0.8s' }}>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {isAuthHold
              ? "Your card has been held — you'll only be charged once approved."
              : 'Your booking is pending manager approval.'}
          </p>
        </div>

        {/* Status badge — staggered */}
        <div className="mt-4 sc-stagger" style={{ animationDelay: '0.95s' }}>
          <Badge
            variant="outline"
            className="text-[11px] font-normal text-muted-foreground border-border"
          >
            {isAuthHold ? 'Payment held' : 'Pending approval'}
          </Badge>
        </div>

        {/* Separator — staggered */}
        <div className="sc-stagger" style={{ animationDelay: '1.1s' }}>
          <Separator className="my-6" />
        </div>

        {/* Fetching status + progress bar — staggered */}
        <div className="sc-stagger space-y-3" style={{ animationDelay: '1.25s' }}>
          <p className="text-xs text-muted-foreground">
            Fetching your booking details
          </p>
          <IndeterminateProgress />
        </div>
      </div>
    </PageShell>
  );
}
