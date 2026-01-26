import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { db, pool } from "../db";
import { users, kitchenBookings, storageBookings, equipmentBookings } from "@shared/schema";
import { eq, and, ne, notInArray } from "drizzle-orm";
import { logger } from "../logger";
import { errorResponse } from "../api-response";

const router = Router();

// ===================================
// STRIPE WEBHOOK ENDPOINTS
// ===================================

// Stripe webhook handler for payment events
router.post("/stripe", async (req: Request, res: Response) => {
    try {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

        if (!stripeSecretKey) {
            return res.status(500).json({ error: 'Stripe not configured' });
        }

        const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2025-12-15.clover',
        });

        if (!webhookSecret) {
            if (process.env.NODE_ENV === 'production') {
                logger.error('❌ CRITICAL: STRIPE_WEBHOOK_SECRET is required in production!');
                return res.status(500).json({ error: 'Webhook configuration error' });
            }
            logger.warn('⚠️ STRIPE_WEBHOOK_SECRET not configured - webhook verification disabled (development only)');
        }

        let event: Stripe.Event;

        // Verify webhook signature if secret is configured
        if (webhookSecret && sig) {
            try {
                event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
            } catch (err: any) {
                logger.error('⚠️ Webhook signature verification failed:', err.message);
                return res.status(400).json({ error: `Webhook Error: ${err.message}` });
            }
        } else {
            // In development, handle it as body cast if no secret
            event = req.body as Stripe.Event;
        }

        // Handle different event types
        // Store event.id for use in handlers
        const webhookEventId = event.id;

        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, webhookEventId);
                break;
            case 'payment_intent.succeeded':
                await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, webhookEventId);
                break;
            case 'payment_intent.payment_failed':
                await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, webhookEventId);
                break;
            case 'payment_intent.canceled':
                await handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent, webhookEventId);
                break;
            case 'charge.refunded':
                await handleChargeRefunded(event.data.object as Stripe.Charge, webhookEventId);
                break;
            case 'account.updated':
                await handleAccountUpdated(event.data.object as Stripe.Account, webhookEventId);
                break;
            default:
                // Handle charge.partially_refunded and other charge events
                if (event.type.startsWith('charge.')) {
                    await handleChargeRefunded(event.data.object as Stripe.Charge, webhookEventId);
                } else {
                    logger.info(`Unhandled event type: ${event.type}`);
                }
        }

        res.json({ received: true });
    } catch (err: any) {
        logger.error('Unhandled webhook error:', err);
        return errorResponse(res, err);
    }
});

// Webhook event handlers
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, webhookEventId: string) {
    if (!pool) {
        logger.error('Database pool not available for webhook');
        return;
    }

    try {
        const { updateTransactionBySessionId } = await import('../services/stripe-checkout-transactions-service');

        // Retrieve full session with expanded line_items and payment_intent
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            logger.error('Stripe secret key not available');
            return;
        }

        const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2025-12-15.clover',
        });

        const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ['line_items', 'payment_intent'],
        });

        // Extract payment intent and charge IDs
        const paymentIntent = expandedSession.payment_intent;
        let paymentIntentId: string | undefined;
        let chargeId: string | undefined;

        if (typeof paymentIntent === 'object' && paymentIntent !== null) {
            paymentIntentId = paymentIntent.id;
            // Get charge ID from payment intent
            if (paymentIntent.latest_charge) {
                chargeId = typeof paymentIntent.latest_charge === 'string'
                    ? paymentIntent.latest_charge
                    : paymentIntent.latest_charge.id;
            }
        } else if (typeof paymentIntent === 'string') {
            paymentIntentId = paymentIntent;
            // Fetch payment intent to get charge ID
            try {
                const pi = await stripe.paymentIntents.retrieve(paymentIntent);
                if (pi.latest_charge) {
                    chargeId = typeof pi.latest_charge === 'string'
                        ? pi.latest_charge
                        : pi.latest_charge.id;
                }
            } catch (error) {
                logger.warn('Could not fetch payment intent details:', { error });
            }
        }

        // Update transaction record
        const updateParams: any = {
            status: 'completed',
            completedAt: new Date(),
            metadata: {
                webhook_event_id: webhookEventId,
                session_mode: expandedSession.mode,
            },
        };

        if (paymentIntentId) {
            updateParams.stripePaymentIntentId = paymentIntentId;
        }

        if (chargeId) {
            updateParams.stripeChargeId = chargeId;
        }

        const updatedTransaction = await updateTransactionBySessionId(
            session.id,
            updateParams,
            db
        );

        if (updatedTransaction) {
            logger.info(`[Webhook] Updated transaction for Checkout session ${session.id}:`, {
                paymentIntentId,
                chargeId,
                amount: `$${(updatedTransaction.total_customer_charged_cents / 100).toFixed(2)}`,
                managerReceives: `$${(updatedTransaction.manager_receives_cents / 100).toFixed(2)}`,
            });
        } else {
            logger.warn(`[Webhook] Transaction not found for Checkout session ${session.id}`);
        }
    } catch (error: any) {
        logger.error(`[Webhook] Error handling checkout.session.completed:`, error);
    }
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent, webhookEventId: string) {
    if (!pool) {
        logger.error('Database pool not available for webhook');
        return;
    }

    try {
        const { findPaymentTransactionByIntentId, updatePaymentTransaction } = await import('../services/payment-transactions-service');
        const { getStripePaymentAmounts } = await import('../services/stripe-service');

        // Update payment_transactions table
        const transaction = await findPaymentTransactionByIntentId(paymentIntent.id, db);
        if (transaction) {
            // Get manager's Stripe Connect account ID if available
            let managerConnectAccountId: string | undefined;
            try {
                const [manager] = await db
                    .select({ stripeConnectAccountId: users.stripeConnectAccountId })
                    .from(users)
                    .where(
                        and(
                            eq(users.id, transaction.manager_id as number),
                            ne(users.stripeConnectAccountId, '')
                        )
                    )
                    .limit(1);

                if (manager?.stripeConnectAccountId) {
                    managerConnectAccountId = manager.stripeConnectAccountId;
                }
            } catch (error) {
                logger.warn(`[Webhook] Could not fetch manager Connect account:`, { error });
            }

            // Fetch actual Stripe amounts
            const stripeAmounts = await getStripePaymentAmounts(paymentIntent.id, managerConnectAccountId);

            const updateParams: any = {
                status: 'succeeded',
                stripeStatus: paymentIntent.status,
                chargeId: typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id,
                paidAt: new Date(),
                lastSyncedAt: new Date(),
                webhookEventId: webhookEventId,
                metadata: paymentIntent.metadata, // Sync metadata (includes tax_cents, tax_rate_percent) from Stripe
            };

            // If we got Stripe amounts, sync them to override calculated amounts
            if (stripeAmounts) {
                updateParams.stripeAmount = stripeAmounts.stripeAmount;
                updateParams.stripeNetAmount = stripeAmounts.stripeNetAmount;
                updateParams.stripeProcessingFee = stripeAmounts.stripeProcessingFee;
                updateParams.stripePlatformFee = stripeAmounts.stripePlatformFee;
                logger.info(`[Webhook] Syncing Stripe amounts for ${paymentIntent.id}:`, {
                    amount: `$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
                    netAmount: `$${(stripeAmounts.stripeNetAmount / 100).toFixed(2)}`,
                    processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
                    platformFee: `$${(stripeAmounts.stripePlatformFee / 100).toFixed(2)}`,
                });
            }

            await updatePaymentTransaction(transaction.id, updateParams, db);
            logger.info(`[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}${stripeAmounts ? ' with Stripe amounts' : ''}`);

            // Sync Stripe amounts to all related booking tables
            if (stripeAmounts) {
                const { syncStripeAmountsToBookings } = await import('../services/payment-transactions-service');
                await syncStripeAmountsToBookings(paymentIntent.id, stripeAmounts, db);
            }
        }

        // Also update booking tables payment status for backward compatibility
        // Wrap in transaction for integrity
        await db.transaction(async (tx) => {
            await tx.update(kitchenBookings)
                .set({
                    paymentStatus: 'paid',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(kitchenBookings.paymentIntentId, paymentIntent.id),
                        ne(kitchenBookings.paymentStatus, 'paid')
                    )
                );

            await tx.update(storageBookings)
                .set({
                    paymentStatus: 'paid',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(storageBookings.paymentIntentId, paymentIntent.id),
                        ne(storageBookings.paymentStatus, 'paid')
                    )
                );

            await tx.update(equipmentBookings)
                .set({
                    paymentStatus: 'paid',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(equipmentBookings.paymentIntentId, paymentIntent.id),
                        ne(equipmentBookings.paymentStatus, 'paid')
                    )
                );
        });

        logger.info(`[Webhook] Updated booking payment status to 'paid' for PaymentIntent ${paymentIntent.id}`);
    } catch (error: any) {
        logger.error(`[Webhook] Error updating payment status for ${paymentIntent.id}:`, error);
    }
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent, webhookEventId: string) {
    if (!pool) {
        logger.error('Database pool not available for webhook');
        return;
    }

    try {
        const { findPaymentTransactionByIntentId, updatePaymentTransaction } = await import('../services/payment-transactions-service');

        // Update payment_transactions table
        const transaction = await findPaymentTransactionByIntentId(paymentIntent.id, db);
        if (transaction) {
            await updatePaymentTransaction(transaction.id, {
                status: 'failed',
                stripeStatus: paymentIntent.status,
                failureReason: paymentIntent.last_payment_error?.message || 'Payment failed',
                lastSyncedAt: new Date(),
                webhookEventId: webhookEventId,
            }, db);
            logger.info(`[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}`);
        }

        // Also update booking tables for backward compatibility
        await db.transaction(async (tx) => {
            const excludedStatuses: ("pending" | "paid" | "refunded" | "failed" | "partially_refunded")[] = ['paid', 'refunded', 'partially_refunded'];

            await tx.update(kitchenBookings)
                .set({
                    paymentStatus: 'failed',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(kitchenBookings.paymentIntentId, paymentIntent.id),
                        notInArray(kitchenBookings.paymentStatus, excludedStatuses)
                    )
                );

            await tx.update(storageBookings)
                .set({
                    paymentStatus: 'failed',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(storageBookings.paymentIntentId, paymentIntent.id),
                        notInArray(storageBookings.paymentStatus, excludedStatuses)
                    )
                );

            await tx.update(equipmentBookings)
                .set({
                    paymentStatus: 'failed',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(equipmentBookings.paymentIntentId, paymentIntent.id),
                        notInArray(equipmentBookings.paymentStatus, excludedStatuses)
                    )
                );
        });

        logger.info(`[Webhook] Updated booking payment status to 'failed' for PaymentIntent ${paymentIntent.id}`);
    } catch (error: any) {
        logger.error(`[Webhook] Error updating payment status for ${paymentIntent.id}:`, error);
    }
}

async function handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent, webhookEventId: string) {
    if (!pool) {
        logger.error('Database pool not available for webhook');
        return;
    }

    try {
        const { findPaymentTransactionByIntentId, updatePaymentTransaction } = await import('../services/payment-transactions-service');

        // Update payment_transactions table
        const transaction = await findPaymentTransactionByIntentId(paymentIntent.id, db);
        if (transaction) {
            await updatePaymentTransaction(transaction.id, {
                status: 'canceled',
                stripeStatus: paymentIntent.status,
                lastSyncedAt: new Date(),
                webhookEventId: webhookEventId,
            }, db);
            logger.info(`[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}`);
        }

        // Also update booking tables for backward compatibility
        await db.transaction(async (tx) => {
            const excludedStatuses: ("pending" | "paid" | "refunded" | "failed" | "partially_refunded")[] = ['paid', 'refunded', 'partially_refunded'];

            await tx.update(kitchenBookings)
                .set({
                    paymentStatus: 'failed', // Map cancel to failed for backward compatibility
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(kitchenBookings.paymentIntentId, paymentIntent.id),
                        notInArray(kitchenBookings.paymentStatus, excludedStatuses)
                    )
                );

            await tx.update(storageBookings)
                .set({
                    paymentStatus: 'failed',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(storageBookings.paymentIntentId, paymentIntent.id),
                        notInArray(storageBookings.paymentStatus, excludedStatuses)
                    )
                );

            await tx.update(equipmentBookings)
                .set({
                    paymentStatus: 'failed',
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(equipmentBookings.paymentIntentId, paymentIntent.id),
                        notInArray(equipmentBookings.paymentStatus, excludedStatuses)
                    )
                );
        });

        logger.info(`[Webhook] Updated booking payment status for PaymentIntent ${paymentIntent.id}`);
    } catch (error: any) {
        logger.error(`[Webhook] Error updating payment status for ${paymentIntent.id}:`, error);
    }
}

async function handleChargeRefunded(charge: Stripe.Charge, webhookEventId: string) {
    if (!pool) {
        logger.error('Database pool not available for webhook');
        return;
    }

    try {
        const { findPaymentTransactionByIntentId, updatePaymentTransaction } = await import('../services/payment-transactions-service');

        // Find booking by payment intent ID from charge
        const paymentIntentId = typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id;

        if (!paymentIntentId) {
            logger.warn(`[Webhook] Charge ${charge.id} has no payment_intent`);
            return;
        }

        // Check if it's a full or partial refund
        const isPartial = charge.amount_refunded < charge.amount;
        const refundStatus = isPartial ? 'partially_refunded' : 'refunded';
        const refundAmountCents = charge.amount_refunded;

        // Update payment_transactions table
        const transaction = await findPaymentTransactionByIntentId(paymentIntentId, db);
        if (transaction) {
            await updatePaymentTransaction(transaction.id, {
                status: refundStatus,
                refundAmount: refundAmountCents,
                refundId: charge.refunds?.data?.[0]?.id,
                refundedAt: new Date(),
                lastSyncedAt: new Date(),
                webhookEventId: webhookEventId,
            }, db);
            logger.info(`[Webhook] Updated payment_transactions for refund on PaymentIntent ${paymentIntentId}`);
        }

        // Also update booking tables for backward compatibility
        await db.transaction(async (tx) => {
            await tx.update(kitchenBookings)
                .set({
                    paymentStatus: refundStatus,
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(kitchenBookings.paymentIntentId, paymentIntentId),
                        eq(kitchenBookings.paymentStatus, 'paid')
                    )
                );

            await tx.update(storageBookings)
                .set({
                    paymentStatus: refundStatus,
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(storageBookings.paymentIntentId, paymentIntentId),
                        eq(storageBookings.paymentStatus, 'paid')
                    )
                );

            await tx.update(equipmentBookings)
                .set({
                    paymentStatus: refundStatus,
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(equipmentBookings.paymentIntentId, paymentIntentId),
                        eq(equipmentBookings.paymentStatus, 'paid')
                    )
                );
        });

        logger.info(`[Webhook] Updated booking payment status to '${refundStatus}' for PaymentIntent ${paymentIntentId}`);
    } catch (error: any) {
        logger.error(`[Webhook] Error updating refund status for charge ${charge.id}:`, error);
    }
}

async function handleAccountUpdated(account: Stripe.Account, webhookEventId: string) {
    if (!pool) {
        logger.error('Database pool not available for webhook');
        return;
    }

    try {
        const { getAccountStatus } = await import('../services/stripe-connect-service');
        
        // We can just check the account object directly from the event, 
        // but using the service ensures consistent logic if we have it there.
        // For efficiency, let's process the event object directly first.
        
        const chargesEnabled = account.charges_enabled;
        const payoutsEnabled = account.payouts_enabled;
        const detailsSubmitted = account.details_submitted;
        
        const onboardingStatus = detailsSubmitted ? 'complete' : 'in_progress';
        
        // Find which manager owns this account
        const [manager] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.stripeConnectAccountId, account.id))
            .limit(1);
            
        if (manager) {
            await db.update(users)
                .set({ 
                    stripeConnectOnboardingStatus: onboardingStatus,
                    updatedAt: new Date()
                })
                .where(eq(users.id, manager.id));
                
            logger.info(`[Webhook] Updated onboarding status to '${onboardingStatus}' for manager ${manager.id} (Account: ${account.id})`);
        } else {
            logger.warn(`[Webhook] Received account.updated for unknown account ${account.id}`);
        }
        
    } catch (error: any) {
        logger.error(`[Webhook] Error handling account.updated for ${account.id}:`, error);
    }
}

export default router;
