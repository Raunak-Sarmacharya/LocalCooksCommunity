/**
 * Session extensions add a second kitchen payment_transactions row on the SAME booking id (own PaymentIntent).
 * These readers must show the booking once, count each payment once, and never treat the extension as the booking's payment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ queries: [] as string[], params: [] as unknown[][], respond: (_text: string): any[] => [] }));
const capture = (query: any) => {
  const { sql: text, params } = new PgDialect().sqlToQuery(query);
  state.queries.push(text); state.params.push(params);
  return { rows: state.respond(text) };
};
vi.mock('../db', () => ({ db: { execute: async (query: any) => capture(query) } }));
vi.mock('./outcome-delivery', () => ({ queuePaymentOutcome: vi.fn() }));
vi.mock('./stripe-service', () => ({ calculateRefundBreakdown: () => ({ maxRefundableToCustomer: 0 }) }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { summarizePayoutStatementBookings } from './payout-statement-service';
import { getTransactionHistory } from './revenue-service';
import { getRevenueMetricsFromTransactions } from './revenue-service-v2';
import { findPaymentTransactionByBooking, syncStripeAmountsToBookings } from './payment-transactions-service';
import { ManagerRepository } from '../domains/managers/manager.repository';

const db = { execute: async (query: any) => capture(query) };
// Booking: $100 subtotal + $13 HST + $7 commission. Extension: +30 min, $25 + $3.25 HST + $1.75 commission.
const parentMeta = { approvedSubtotal: 10000, approvedTax: 1300, platformCommission: 700 };
const extensionMeta = { type: 'session_extension', sessionExtensionId: 5, approvedSubtotal: 2500, approvedTax: 325, platformCommission: 175, capturedAmount: 3000 };
beforeEach(() => { state.queries = []; state.params = []; state.respond = () => []; });

describe('manager lists show a booking with an extension once', () => {
  it('the invoice list joins only the booking\'s own payment', async () => {
    await new ManagerRepository().findInvoices(2, {} as any);
    const invoice = state.queries.find(text => text.includes('FROM kitchen_bookings kb'))!;
    expect(invoice).toMatch(/pt\.payment_intent_id = kb\.payment_intent_id/);
  });
  it('the payout statement lists the booking once and sums parent + extension once each', () => {
    const booking = { id: 10, bookingDate: '2026-10-14', kitchenName: 'Harbour', chefName: 'Alex', totalPrice: 10000, serviceFee: 700, taxRatePercent: 13 };
    const summary = summarizePayoutStatementBookings([
      { ...booking, transactionAmount: '12000', baseAmount: '11300', taxAmount: '1300', transactionServiceFee: '700', managerRevenue: '10942', stripeProcessingFee: '358', transactionMetadata: parentMeta },
      { ...booking, transactionAmount: '3000', baseAmount: '2825', taxAmount: '325', transactionServiceFee: '175', managerRevenue: '2708', stripeProcessingFee: '117', transactionMetadata: extensionMeta },
    ]);
    expect(summary.totalBookings).toBe(1); expect(summary.bookings).toHaveLength(1);
    expect(summary.totalEarnings).toBeCloseTo(125); // $100 + $25 subtotals, each once
    expect(summary.totalNetEarnings).toBeCloseTo(109.42 + 27.08);
    expect(summary.resolvedAmounts.get(10)).toEqual({ subtotal: 125, tax: 16.25, managerRevenue: expect.closeTo(136.5, 5) });
  });
});

describe('revenue counts the booking and its extension once each', () => {
  const row = { id: 10, booking_date: '2026-10-14', kb_total_price: '10000', service_fee: '700', tax_rate_percent: '13', payment_status: 'paid', status: 'completed',
    payment_intent_id: 'pi_booking', kitchen_name: 'Harbour', location_id: 3, created_at: '2026-10-01T00:00:00Z' };
  it('transaction history resolves the extension against its own subtotal and labels it', async () => {
    state.respond = text => text.includes('FROM kitchen_bookings kb') ? [
      { ...row, pt_amount: '12000', pt_base_amount: '11300', pt_tax_amount: '1300', actual_stripe_fee: '358', pt_service_fee: '700', pt_manager_revenue: '10942',
        transaction_id: 99, transaction_status: 'succeeded', pt_payment_intent_id: 'pi_booking', pt_booking_type: 'kitchen', pt_metadata: parentMeta },
      { ...row, pt_amount: '3000', pt_base_amount: '2825', pt_tax_amount: '325', actual_stripe_fee: '117', pt_service_fee: '175', pt_manager_revenue: '2708',
        transaction_id: 101, transaction_status: 'succeeded', pt_payment_intent_id: 'pi_ext', pt_booking_type: 'kitchen', pt_metadata: extensionMeta },
    ] : [];
    const { transactions } = await getTransactionHistory(2, db);
    const booking = transactions.find(item => item.transactionId === 99)!, extension = transactions.find(item => item.transactionId === 101)!;
    expect(booking).toMatchObject({ totalPrice: 10000, taxAmount: 1300, chargeAmount: 12000, paymentIntentId: 'pi_booking' });
    expect(booking.description).toBeUndefined();
    expect(extension).toMatchObject({ totalPrice: 2500, taxAmount: 325, chargeAmount: 3000, serviceFee: 175, paymentIntentId: 'pi_ext', description: 'Extra time - Harbour' });
    expect(transactions.filter(item => item.transactionId != null).reduce((sum, item) => sum + item.chargeAmount, 0)).toBe(15000);
  });
  it('dashboard tax uses the extension\'s own approved tax, never the booking\'s tax a second time', async () => {
    state.respond = text => text.includes('table_exists') ? [{ table_exists: true }] : text.includes('total_bookings') ? [{ total_bookings: '1', bookings_with_transactions: '1' }]
      : text.includes('COUNT(*)') ? [{ count: '2' }] : [{}];
    await getRevenueMetricsFromTransactions(2, db).catch(() => undefined);
    const tax = state.queries.find(text => text.includes('calculated_tax_amount'))!;
    expect(tax).toMatch(/pt\.metadata \? 'sessionExtensionId'\)\s+AND \(pt\.metadata->>'approvedTax'\) IS NOT NULL/);
    // Totals are per payment row (never a booking join), so the extension charge is counted once.
    const totals = state.queries.find(text => text.includes('total_revenue'))!;
    expect(totals).toMatch(/FROM payment_transactions pt\s+WHERE/);
  });
});

describe('the booking\'s own payment is never an extension charge', () => {
  it('lookup by booking excludes separate charges and prefers the booking PaymentIntent', async () => {
    await findPaymentTransactionByBooking(10, 'kitchen', db);
    expect(state.queries[0]).toContain("?| ARRAY['sessionExtensionId', 'kitchenChangeId', 'damage_claim_id', 'overstay_record_id']");
    expect(state.queries[0]).toMatch(/payment_intent_id IS NOT DISTINCT FROM \(SELECT payment_intent_id FROM kitchen_bookings WHERE id = \$\d+\)\) DESC/);
  });
  it('Stripe fee sync for an extension charge never overwrites the booking fee columns', async () => {
    state.respond = text => text.includes('FROM payment_transactions pt') ? [{ id: 101, booking_id: 10, booking_type: 'kitchen', base_amount: '2825', service_fee: '175', metadata: extensionMeta }] : [];
    await syncStripeAmountsToBookings('pi_ext', { stripeAmount: 3000, stripeNetAmount: 2708, stripeProcessingFee: 117, stripePlatformFee: 175 }, db);
    expect(state.queries.some(text => text.includes('UPDATE kitchen_bookings'))).toBe(false);
  });
  it('Stripe fee sync for the booking payment only updates the booking that owns that PaymentIntent', async () => {
    state.respond = text => text.includes('FROM payment_transactions pt') ? [{ id: 99, booking_id: 10, booking_type: 'kitchen', base_amount: '11300', service_fee: '700', metadata: {} }] : [];
    await syncStripeAmountsToBookings('pi_booking', { stripeAmount: 12000, stripeNetAmount: 10942, stripeProcessingFee: 358, stripePlatformFee: 700 }, db);
    const update = state.queries.findIndex(text => text.includes('UPDATE kitchen_bookings'));
    expect(state.queries[update]).toMatch(/WHERE id = \$\d+ AND payment_intent_id = \$\d+/);
    expect(state.params[update]).toContain('pi_booking');
  });
});

describe('manager dashboard pending payments', () => {
  it('counts captured payouts held until after closeout (net of processing fee), and returns the value', async () => {
    state.respond = text => text.includes('table_exists') ? [{ table_exists: true }] : text.includes('total_bookings') ? [{ total_bookings: '1', bookings_with_transactions: '1' }]
      : text.includes('COUNT(*)') ? [{ count: '1' }] : text.includes('as pending_payments') ? [{ pending_payments: '5494' }] : [{}];
    const metrics = await getRevenueMetricsFromTransactions(2, db).catch(() => undefined);
    const totals = state.queries.find(text => text.includes('as pending_payments'))!;
    expect(totals).toContain("pt.payout_timing = 'after_closeout' AND pt.transfer_id IS NULL");
    expect(totals).toMatch(/manager_revenue::numeric, 0\) - COALESCE\(pt\.stripe_processing_fee/);
    if (metrics) expect(metrics.pendingPayments).toBe(5494);
  });
});
