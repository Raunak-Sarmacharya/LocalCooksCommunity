import type Stripe from 'stripe';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchens, locations, storageBookings, storageListings, storageOverstayQuotes,
  equipmentBookings, equipmentListings, paymentTransactions } from '@shared/schema';
import { bookingCaptureTerms } from '@shared/booking-capture-terms';
import { bookingAddonPrices } from '@shared/booking-addon-prices';
import { capturedComponentAllocations } from '@shared/captured-component-allocations';
import { parseCheckoutCancellationPolicy, parseCheckoutSlots } from './checkout-metadata';
import { fulfillKitchenCheckout, KitchenHoldMissingError, KitchenSlotUnavailableError } from './kitchen-checkout-holds';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { generateReferenceCode } from '../reference-code';
import { storageListingAwaitingRemoval } from './booking-linked-cancellation';

/** New sessions commit the booking, quoted items, payment ledger and delivery evidence together. */
export async function fulfillQuotedKitchenBooking(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent, stripe: Stripe) {
  const metadata = session.metadata || {};
  const prices = bookingAddonPrices(metadata);
  const terms = bookingCaptureTerms(metadata, intent.amount);
  const kitchenId = Number(metadata.kitchen_id), chefId = Number(metadata.chef_id);
  if (!prices || !Number.isSafeInteger(kitchenId) || !Number.isSafeInteger(chefId) || session.amount_total !== intent.amount
    || session.currency !== 'cad' || !['requires_capture', 'succeeded'].includes(intent.status)) throw new Error('Checkout payment evidence is incomplete');
  const [existing] = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.paymentIntentId, intent.id)).limit(1);
  if (existing) return existing.id; // Every new booking is committed atomically below.
  const bookingDate = new Date(metadata.booking_date);
  const storageDates = JSON.parse(metadata.selected_storage || '[]') as { storageListingId: number; startDate: string; endDate: string }[];
  if (storageDates.length !== prices.s.length || !Number.isFinite(bookingDate.getTime())) throw new Error('Checkout dates are incomplete');
  const authorized = intent.status === 'requires_capture';
  const paymentStatus = authorized ? 'authorized' as const : 'paid' as const;
  const customerId = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  const paymentMethodId = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
  try {
    const booking = await fulfillKitchenCheckout(metadata.hold_id, session.id, kitchenId, metadata.booking_date.slice(0, 10),
      parseCheckoutSlots(metadata.selected_slots, metadata.start_time, metadata.end_time), metadata.window_start_time || metadata.start_time,
      () => db.transaction(async tx => {
        const [context] = await tx.select({ managerId: locations.managerId }).from(kitchens)
          .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, kitchenId)).limit(1);
        if (!context?.managerId) throw new Error('Checkout manager not found');
        const [parent] = await tx.insert(kitchenBookings).values({ referenceCode: await generateReferenceCode('kitchen_booking'),
          chefId, kitchenId, bookingDate, startTime: metadata.start_time, endTime: metadata.end_time,
          operatingWindowStartTime: metadata.window_start_time || null,
          selectedSlots: parseCheckoutSlots(metadata.selected_slots, metadata.start_time, metadata.end_time),
          pricingMode: metadata.pricing_mode === 'daily' ? 'daily' : 'hourly', status: 'pending', paymentStatus,
          paymentIntentId: intent.id, totalPrice: String(terms.subtotal), serviceFee: String(terms.commission),
          hourlyRate: metadata.hourly_rate_cents, durationHours: metadata.duration_hours,
          cancellationPolicyHours: parseCheckoutCancellationPolicy(metadata.cancellation_policy_hours),
          specialNotes: metadata.special_notes || null, stripeCustomerId: customerId, stripePaymentMethodId: paymentMethodId }).returning();
        const storageItems: Record<string, unknown>[] = [], equipmentItems: Record<string, unknown>[] = [];
        for (const [listingId, price] of prices.s) {
          const [listing] = await tx.select({ ...getTableColumns(storageListings), awaitingRemoval: storageListingAwaitingRemoval }).from(storageListings)
            .where(and(eq(storageListings.id, listingId), eq(storageListings.kitchenId, kitchenId))).limit(1);
          if (listing?.awaitingRemoval) throw new KitchenSlotUnavailableError();
          const dates = storageDates.find(item => item.storageListingId === listingId);
          if (!listing || !dates || !Number.isFinite(Date.parse(dates.startDate)) || !Number.isFinite(Date.parse(dates.endDate))) throw new Error('Quoted storage is unavailable');
          const [quote] = await tx.select().from(storageOverstayQuotes).where(and(eq(storageOverstayQuotes.id, metadata[`storage_quote_${listingId}`] || ''),
            eq(storageOverstayQuotes.chefId, chefId), eq(storageOverstayQuotes.storageListingId, listingId))).limit(1);
          if (!quote) throw new Error('Accepted storage terms are unavailable');
          const [item] = await tx.insert(storageBookings).values({ referenceCode: await generateReferenceCode('storage_booking'),
            kitchenBookingId: parent.id, chefId, storageListingId: listingId, startDate: new Date(dates.startDate), endDate: new Date(dates.endDate),
            status: 'pending', paymentStatus, paymentIntentId: intent.id, totalPrice: String(price), pricingModel: listing.pricingModel,
            overstayTerms: { ...(quote.terms as object), acceptedAt: new Date().toISOString() },
            stripeCustomerId: customerId, stripePaymentMethodId: paymentMethodId }).returning();
          storageItems.push({ id: item.id, storageBookingId: item.id, storageListingId: listingId, name: listing.name,
            storageType: listing.storageType, totalPrice: price, startDate: dates.startDate, endDate: dates.endDate });
        }
        for (const [listingId, price] of prices.e) {
          const [listing] = await tx.select().from(equipmentListings).where(and(eq(equipmentListings.id, listingId), eq(equipmentListings.kitchenId, kitchenId))).limit(1);
          if (!listing) throw new Error('Quoted equipment is unavailable');
          const [item] = await tx.insert(equipmentBookings).values({ kitchenBookingId: parent.id, chefId, equipmentListingId: listingId,
            startDate: bookingDate, endDate: bookingDate, status: 'pending', paymentStatus, paymentIntentId: intent.id,
            totalPrice: String(price), pricingModel: 'daily', damageDeposit: String(listing.damageDeposit || '0') }).returning();
          equipmentItems.push({ id: item.id, equipmentBookingId: item.id, equipmentListingId: listingId, name: listing.equipmentType, totalPrice: price });
        }
        await tx.update(kitchenBookings).set({ storageItems, equipmentItems }).where(eq(kitchenBookings.id, parent.id));
        await tx.insert(paymentTransactions).values({ bookingId: parent.id, bookingType: 'kitchen', chefId, managerId: context.managerId,
          amount: String(intent.amount), baseAmount: String(terms.subtotal + terms.tax), taxAmount: String(terms.tax), serviceFee: String(terms.commission),
          managerRevenue: String(terms.subtotal + terms.tax), netAmount: String(intent.amount), paymentIntentId: intent.id,
          status: authorized ? 'authorized' : 'succeeded', stripeStatus: intent.status,
          metadata: { checkout_session_id: session.id, fee_model: metadata.fee_model, taxRatePercent: terms.rate,
            platformCommission: terms.commission, storage_items: storageItems, equipment_items: equipmentItems,
            componentAllocationVersion: 'original-tax-largest-remainder-v1', capturedComponentAllocations: capturedComponentAllocations([
              { kind: 'kitchen', bookingId: parent.id, subtotalCents: terms.subtotal - [...storageItems, ...equipmentItems].reduce((sum, item) => sum + Number(item.totalPrice), 0) },
              ...storageItems.map(item => ({ kind: 'storage' as const, bookingId: Number(item.storageBookingId), subtotalCents: Number(item.totalPrice) })),
              ...equipmentItems.map(item => ({ kind: 'equipment' as const, bookingId: Number(item.equipmentBookingId), subtotalCents: Number(item.totalPrice) })),
            ], terms.tax) } });
        await queueBookingLifecycleEvent(tx, parent.id, 'requested', 'Kitchen booking requested',
          authorized ? `Booking #${parent.id} awaits manager approval. Payment is authorized and has not been captured.`
            : `Booking #${parent.id} awaits manager approval. The original checkout payment was received.`, chefId);
        return parent;
      }));
    return booking.id;
  } catch (error) {
    if (!(error instanceof KitchenHoldMissingError || error instanceof KitchenSlotUnavailableError)) throw error;
    // An inventory conflict has a verified financial outcome, with stable retry keys.
    if (intent.status === 'requires_capture') await stripe.paymentIntents.cancel(intent.id);
    else await stripe.refunds.create({ payment_intent: intent.id, reason: 'requested_by_customer' },
      { idempotencyKey: `kitchen_inventory_conflict_${session.id}` });
    return null;
  }
}
