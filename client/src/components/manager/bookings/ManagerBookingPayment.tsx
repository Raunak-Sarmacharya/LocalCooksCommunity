/**
 * Manager bookings list data: the row type and the payment summary (one amount, one muted line, the breakdown in a
 * tooltip). Moved from the old data-table columns when the list became an agenda; the money logic is unchanged.
 */
import { mt } from "@/i18n/manager";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveDisplayedKitchenNetPayoutCents } from "@shared/booking-pricing-breakdown";
import type { KitchenPayout } from "@shared/kitchen-payout";
import type { BookingListRow } from "@/lib/booking-list-status";

// Storage/Equipment item types from JSONB fields
export type StorageItem = {
    id: number;
    storageListingId: number;
    storageBookingId?: number;
    name: string;
    storageType: string;
    totalPrice: number; // in cents
    startDate?: string;
    endDate?: string;
    rejected?: boolean; // true if manager rejected this item
    cancellationRequested?: boolean; // true if chef requested cancellation
    status?: string; // synced from storage_bookings table
}

export type EquipmentItem = {
    id: number;
    equipmentListingId: number;
    name: string;
    totalPrice: number; // in cents
    rejected?: boolean; // true if manager rejected this item
}

// Define the Booking type
export type Booking = BookingListRow & {
    payout?: KitchenPayout;
    id: number;
    referenceCode?: string | null;
    kitchenId: number;
    chefId: number;
    bookingDate: string;
    startTime: string;
    endTime: string;
    operatingWindowStartTime?: string | null;
    selectedSlots?: Array<string | { startTime: string; endTime: string }>;
    status: string;
    specialNotes?: string;
    createdAt: string;
    kitchenName?: string;
    chefName?: string;
    locationName?: string;
    locationTimezone?: string;
    storageItems?: StorageItem[];
    equipmentItems?: EquipmentItem[];
    // Price fields
    totalPrice?: number; // in cents - booking subtotal before kitchen tax and platform fee
    transactionAmount?: number; // in cents - actual amount charged via Stripe (from payment_transactions)
    serviceFee?: number; // in cents - platform fee (from payment_transactions)
    managerRevenue?: number; // in cents - what manager actually receives (from payment_transactions)
    hourlyRate?: number; // in cents
    durationHours?: number;
    paymentStatus?: string;
    paymentIntentId?: string;
    transactionId?: number;
    refundAmount?: number; // in cents - amount already refunded
    // Max refundable = manager remaining + platform service fee remaining (Stripe fee sunk)
    refundableAmount?: number; // in cents
    stripeProcessingFee?: number; // in cents - total Stripe processing fee (display only)
    managerRemainingBalance?: number; // in cents - manager's remaining Connect balance
    taxRatePercent?: number; // kitchen's tax rate percentage for revenue calculations
    taxAmount?: number; // in cents - tax = kb.total_price * tax_rate / 100 (same as transaction history)
    netRevenue?: number; // in cents - kitchen subtotal + tax - Stripe fee
    // ── Voided Authorization Context ────────────────────────────────────────
    isVoidedAuthorization?: boolean; // true when PT was canceled before capture — $0 moved
    isAuthorizedHold?: boolean;      // true when payment is held but not yet captured
    originalAuthorizedAmount?: number; // Original auth amount for voided display context (in cents)
    // ── Kitchen Check-In / Check-Out Lifecycle ──────────────────────────────
    checkinStatus?: string | null;          // not_checked_in | checked_in | checkout_requested | checked_out | no_show | checkout_claim_filed
    checkedInAt?: string | null;
    checkoutRequestedAt?: string | null;
    checkedOutAt?: string | null;
    checkoutApprovedAt?: string | null;
    noShowDetectedAt?: string | null;
}

/** One amount and one muted line; the breakdown is one hover/focus away. */
export function ManagerPaymentSummary({ booking }: { booking: Booking }) {
  const isVoided = booking.isVoidedAuthorization === true;
  const isAuthHold = booking.isAuthorizedHold === true;
  const originalAuthAmount = booking.originalAuthorizedAmount;

  // Use actual Stripe transaction data when available
  const transactionAmount = booking.transactionAmount;
  const managerRevenue = booking.managerRevenue;
  
  const subtotal = booking.totalPrice ?? 0;
  const taxRatePercent = booking.taxRatePercent ?? 0;
  const taxAmount = booking.taxAmount ?? (taxRatePercent > 0
      ? Math.round(subtotal * taxRatePercent / 100)
      : 0);
  const serviceFee = booking.serviceFee ?? 0;
  // PT amount is authoritative after checkout. Before that, reconstruct
  // exactly what the chef sees: subtotal + kitchen tax + platform fee.
  const displayAmount = transactionAmount ?? (subtotal + taxAmount + serviceFee);

  // ENTERPRISE STANDARD: Prefer Stripe-synced managerRevenue; reconstruct
  // when pre-transfer gross is still stored or fees are known.
  const netAmount = resolveDisplayedKitchenNetPayoutCents({
      kitchenNetPayoutCents: managerRevenue,
      kitchenBaseSubtotalCents: subtotal,
      kitchenHstAmountCents: taxAmount,
      paymentProcessorFeeCents: booking.stripeProcessingFee ?? 0,
      platformFeeAmountCents: serviceFee,
      chargeAmountCents: transactionAmount ?? (subtotal + taxAmount + serviceFee),
  }).netPayoutCents;

  // Derive the effective Stripe fee: if stripeProcessingFee is synced, use it.
  // Otherwise, if manager revenue is known, derive Stripe's fee from the
  // kitchen-owned amount. Never treat the platform fee as a manager deduction
  // unless the charge omitted fee-on-top (handled in the shared resolver).
  const stripeFee = (booking.stripeProcessingFee ?? 0) > 0
      ? (booking.stripeProcessingFee ?? 0)
      : (managerRevenue != null && managerRevenue > 0 && displayAmount > 0)
          ? Math.max(0, subtotal + taxAmount - managerRevenue)
          : 0;
  
  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  // ── VOIDED AUTHORIZATION: No money captured, hold released ────────────
  if (isVoided) {
      return (
          <TooltipProvider>
              <Tooltip>
                  <TooltipTrigger asChild>
                      <div className="text-right cursor-help">
                          <div className="font-medium text-sm text-muted-foreground">{mt("noCharge")}</div>
                          <div className="text-xs text-muted-foreground">{mt("holdReleased")}</div>
                      </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                      <div className="space-y-1 text-sm">
                          <p className="font-medium text-blue-700">{mt("authorizationVoided")}</p>
                          {originalAuthAmount != null && originalAuthAmount > 0 && (
                              <div className="flex justify-between gap-4 text-muted-foreground">
                                  <span>{mt("originalHold")}</span>
                                  <span className="font-mono line-through">{formatPrice(originalAuthAmount)}</span>
                              </div>
                          )}
                          <div className="flex justify-between gap-4 font-medium">
                              <span>{mt("amountCharged2")}</span>
                              <span className="font-mono">$0.00</span>
                          </div>
                          <p className="text-xs text-muted-foreground pt-1">{mt("thePaymentHoldWasReleasedBeforeCaptureNoChargeWasMadeAndNoSt")}</p>
                      </div>
                  </TooltipContent>
              </Tooltip>
          </TooltipProvider>
      );
  }

  // ── AUTHORIZED HOLD: Pending capture (manager hasn't acted yet) ──────
  if (isAuthHold) {
      return (
          <TooltipProvider>
              <Tooltip>
                  <TooltipTrigger asChild>
                      <div className="text-right cursor-help">
                          <div className="font-medium text-sm">{formatPrice(displayAmount)}</div>
                          <div className="text-xs text-muted-foreground">{mt("paymentHeld2")}</div>
                      </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                      <div className="space-y-1 text-sm">
                          <p className="font-medium text-blue-700">{mt("paymentHoldNotYetCharged")}</p>
                          <div className="flex justify-between gap-4">
                              <span>{mt("holdAmount")}</span>
                              <span className="font-medium font-mono">{formatPrice(displayAmount)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground pt-1">
                              {mt("paymentHoldTakeActionHint")}
                          </p>
                      </div>
                  </TooltipContent>
              </Tooltip>
          </TooltipProvider>
      );
  }

  // ── NO PAYMENT DATA: Fallback ────────────────────────────────────────
  if (displayAmount === 0 && !(booking.refundAmount ?? 0)) {
      return null; // Nothing to show is shown as nothing (§7), not a dash.
  }

  // ── CAPTURED PAYMENT: Show actual Stripe data with revenue breakdown ──
  // Show actual Stripe data if we have transaction data, otherwise show pending
  const hasTransactionData = transactionAmount !== null && transactionAmount !== undefined;
  const bookingStatus = booking.status;
  const refundAmount = booking.refundAmount ?? 0;
  const paymentStatus = booking.paymentStatus;
  const isCancelled = bookingStatus === 'cancelled';
  const isRefunded = paymentStatus === 'refunded' || paymentStatus === 'partially_refunded';
  const hasRefund = refundAmount > 0;

  if (hasRefund) {
      return <TooltipProvider><Tooltip><TooltipTrigger asChild><div className="text-right cursor-help">
          <div className="font-medium text-sm">{mt("r2YouReceive", { amount: formatPrice(bookingReceiveCents(booking)) })}</div>
          <div className="text-xs text-muted-foreground">{mt("r2Refunded", { amount: formatPrice(refundAmount) })}</div>
      </div></TooltipTrigger><TooltipContent className="max-w-xs">
          <div className="space-y-1 text-sm">
              <p>{mt("totalCharged2")} {formatPrice(displayAmount)}</p>
              <p>{mt("refundedToChef")} {formatPrice(refundAmount)}</p>
              <p>{mt("r2YouReceive", { amount: formatPrice(bookingReceiveCents(booking)) })}</p>
          </div>
      </TooltipContent></Tooltip></TooltipProvider>;
  }

  // Cancelled bookings awaiting refund: show pending refund state
  if (isCancelled && !hasRefund && hasTransactionData && !isRefunded) {
      return (
          <TooltipProvider>
              <Tooltip>
                  <TooltipTrigger asChild>
                      <div className="text-right cursor-help">
                          <div className="font-medium text-sm">{formatPrice(displayAmount)}</div>
                          <div className="text-xs text-muted-foreground">{mt("refundPending")}</div>
                      </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                      <div className="space-y-1 text-sm">
                          <p className="font-medium">{mt("cancelledAwaitingRefund")}</p>
                          <div className="flex justify-between gap-4">
                              <span>{mt("amountCharged")}</span>
                              <span className="font-medium">{formatPrice(displayAmount)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground pt-1">
                              {mt("useIssueRefundFromActions")}
                          </p>
                      </div>
                  </TooltipContent>
              </Tooltip>
          </TooltipProvider>
      );
  }

  return (
      <TooltipProvider>
          <Tooltip>
              <TooltipTrigger asChild>
                  <div className="text-right cursor-help">
                      <div className="font-medium text-sm">{formatPrice(displayAmount)}</div>
                      {hasTransactionData ? (
                          <div className="text-xs text-muted-foreground">{mt("youReceiveAmount", { amount: formatPrice(netAmount) })}</div>
                      ) : (
                          <div className="text-xs text-muted-foreground">{mt("awaitingPayment")}</div>
                      )}
                  </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                  <div className="space-y-1 text-sm">
                      <div className="flex justify-between gap-4">
                          <span>{mt("totalCharged2")}</span>
                          <span className="font-medium">{formatPrice(displayAmount)}</span>
                      </div>
                      {hasTransactionData && (
                          <div className="flex justify-between gap-4 text-muted-foreground">
                              <span>{mt("bookingSubtotal")}</span>
                              <span>{formatPrice(subtotal)}</span>
                          </div>
                      )}
                      {hasTransactionData && taxAmount > 0 && (
                          <div className="flex justify-between gap-4 text-amber-600">
                              <span>{mt("taxPercentLabel", { percent: taxRatePercent })}</span>
                              <span>+{formatPrice(taxAmount)}</span>
                          </div>
                      )}
                      {hasTransactionData && serviceFee > 0 && (
                          <div className="flex justify-between gap-4 text-blue-600">
                              <span>{mt("localCooksServiceFee")}</span>
                              <span>-{formatPrice(serviceFee)}</span>
                          </div>
                      )}
                      {hasTransactionData && stripeFee > 0 && (
                          <div className="flex justify-between gap-4 text-red-600">
                              <span>{mt("stripeFee2")}</span>
                              <span>-{formatPrice(stripeFee)}</span>
                          </div>
                      )}
                      {hasTransactionData && (
                          <div className="border-t pt-1 flex justify-between gap-4 font-semibold text-green-600">
                              <span>{mt("youReceive")}</span>
                              <span>{formatPrice(netAmount)}</span>
                          </div>
                      )}
                      {!hasTransactionData && (
                          <p className="text-xs text-muted-foreground">{mt("paymentDataWillBeAvailableAfterCheckoutCompletes")}</p>
                      )}
                  </div>
              </TooltipContent>
          </Tooltip>
      </TooltipProvider>
  );
}

/** The existing payout projection owns refund allocation; chef refunds can include platform money. */
export function bookingReceiveCents(booking: Booking): number {
  const installments = booking.payout?.installments;
  const visitId = booking.scheduleRevision ? booking.visitStates?.[0]?.id : undefined;
  if (installments && visitId != null) return installments.filter(item => item.visitId === visitId).reduce((sum, item) => sum + item.amountCents, 0);
  return booking.payout?.amountCents ?? booking.managerRemainingBalance ?? 0;
}
