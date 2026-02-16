import { logger } from "../../logger";
import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, requireAdmin } from '../../firebase-auth-middleware';
import { db } from '../../db';
import { platformSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';

const router = Router();

// 🔥 Public Platform Settings Endpoint - Stripe Fee Configuration
// Returns the current fee configuration for client-side display (enterprise-grade)
router.get('/platform-settings/stripe-fees', async (req: Request, res: Response) => {
    try {
        const { getFeeConfig } = await import('../../services/stripe-checkout-fee-service');
        const config = await getFeeConfig();
        
        // Return fee configuration for client-side calculations
        return res.json({
            stripePercentageFee: config.stripePercentageFee,
            stripeFlatFeeCents: config.stripeFlatFeeCents,
            platformCommissionRate: config.platformCommissionRate,
            useStripePlatformPricing: config.useStripePlatformPricing,
            // Human-readable values
            stripePercentageDisplay: `${(config.stripePercentageFee * 100).toFixed(1)}%`,
            stripeFlatFeeDisplay: `$${(config.stripeFlatFeeCents / 100).toFixed(2)}`,
            platformCommissionDisplay: `${(config.platformCommissionRate * 100).toFixed(1)}%`,
        });
    } catch (error) {
        logger.error('Error getting Stripe fee config:', error);
        // Return defaults on error
        return res.json({
            stripePercentageFee: 0.029,
            stripeFlatFeeCents: 30,
            platformCommissionRate: 0,
            useStripePlatformPricing: false,
            stripePercentageDisplay: '2.9%',
            stripeFlatFeeDisplay: '$0.30',
            platformCommissionDisplay: '0%',
        });
    }
});

// 🔥 Public Platform Settings Endpoint (for chefs to see service fee rate)
router.get('/platform-settings/service-fee-rate', async (req: Request, res: Response) => {
    try {
        const [setting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'service_fee_rate'))
            .limit(1);

        if (setting) {
            const rate = parseFloat(setting.value);
            if (!isNaN(rate) && rate >= 0 && rate <= 1) {
                return res.json({
                    key: 'service_fee_rate',
                    value: setting.value,
                    rate: rate,
                    percentage: (rate * 100).toFixed(2),
                    description: setting.description,
                });
            }
        }

        // Return default if not set
        return res.json({
            key: 'service_fee_rate',
            value: '0.05',
            rate: 0.05,
            percentage: '5.00',
            description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
        });
    } catch (error) {
        logger.error('Error getting service fee rate:', error);
        res.status(500).json({
            error: 'Failed to get service fee rate',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// 🔥 Admin Platform Settings Endpoints
// Get service fee rate (admin endpoint with full details)
router.get('/admin/platform-settings/service-fee-rate', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const [setting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'service_fee_rate'))
            .limit(1);

        if (setting) {
            const rate = parseFloat(setting.value);
            if (!isNaN(rate) && rate >= 0 && rate <= 1) {
                return res.json({
                    key: 'service_fee_rate',
                    value: setting.value,
                    rate: rate,
                    percentage: (rate * 100).toFixed(2),
                    description: setting.description,
                    updatedAt: setting.updatedAt,
                });
            }
        }

        // Return default if not set
        return res.json({
            key: 'service_fee_rate',
            value: '0.05',
            rate: 0.05,
            percentage: '5.00',
            description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
        });
    } catch (error) {
        logger.error('Error getting service fee rate:', error);
        res.status(500).json({
            error: 'Failed to get service fee rate',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Update service fee rate
router.put('/admin/platform-settings/service-fee-rate', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { rate } = req.body;

        if (rate === undefined || rate === null) {
            return res.status(400).json({ error: 'Rate is required' });
        }

        const rateValue = typeof rate === 'string' ? parseFloat(rate) : rate;

        if (isNaN(rateValue) || rateValue < 0 || rateValue > 1) {
            return res.status(400).json({ error: 'Rate must be a number between 0 and 1 (e.g., 0.05 for 5%)' });
        }

        // Get user ID
        const userId = req.neonUser!.id;
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        // Check if setting exists
        const [existing] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'service_fee_rate'))
            .limit(1);

        if (existing) {
            // Update existing
            const [updated] = await db
                .update(platformSettings)
                .set({
                    value: rateValue.toString(),
                    updatedBy: userId,
                    updatedAt: new Date(),
                })
                .where(eq(platformSettings.key, 'service_fee_rate'))
                .returning();

            return res.json({
                key: 'service_fee_rate',
                value: updated.value,
                rate: rateValue,
                percentage: (rateValue * 100).toFixed(2),
                description: updated.description,
                updatedAt: updated.updatedAt,
                message: 'Service fee rate updated successfully',
            });
        } else {
            // Create new
            const [created] = await db
                .insert(platformSettings)
                .values({
                    key: 'service_fee_rate',
                    value: rateValue.toString(),
                    description: 'Platform service fee rate as decimal (e.g., 0.05 for 5%). Admin configurable.',
                    updatedBy: userId,
                })
                .returning();

            return res.json({
                key: 'service_fee_rate',
                value: created.value,
                rate: rateValue,
                percentage: (rateValue * 100).toFixed(2),
                description: created.description,
                updatedAt: created.updatedAt,
                message: 'Service fee rate created successfully',
            });
        }
    } catch (error) {
        logger.error('Error updating service fee rate:', error);
        res.status(500).json({
            error: 'Failed to update service fee rate',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// 🔥 Public Platform Settings Endpoint - Overstay Penalty Defaults
// Returns the current overstay penalty defaults for client-side display
router.get('/platform-settings/overstay-penalties', async (req: Request, res: Response) => {
    try {
        const [gracePeriodSetting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'overstay_grace_period_days'))
            .limit(1);
        
        const [penaltyRateSetting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'overstay_penalty_rate'))
            .limit(1);
        
        const [maxDaysSetting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'overstay_max_penalty_days'))
            .limit(1);

        const gracePeriodDays = gracePeriodSetting ? parseInt(gracePeriodSetting.value) : 3;
        const penaltyRate = penaltyRateSetting ? parseFloat(penaltyRateSetting.value) : 0.10;
        const maxPenaltyDays = maxDaysSetting ? parseInt(maxDaysSetting.value) : 30;

        return res.json({
            gracePeriodDays,
            penaltyRate,
            maxPenaltyDays,
            penaltyRatePercent: (penaltyRate * 100).toFixed(0),
            description: 'Platform default overstay penalty settings. Managers can override per storage listing.',
        });
    } catch (error) {
        logger.error('Error getting overstay penalty defaults:', error);
        // Return defaults on error
        return res.json({
            gracePeriodDays: 3,
            penaltyRate: 0.10,
            maxPenaltyDays: 30,
            penaltyRatePercent: '10',
            description: 'Platform default overstay penalty settings. Managers can override per storage listing.',
        });
    }
});

// 🔥 Admin Platform Settings Endpoints - Overstay Penalty Defaults
// Get all overstay penalty defaults (admin)
router.get('/admin/platform-settings/overstay-penalties', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const [gracePeriodSetting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'overstay_grace_period_days'))
            .limit(1);
        
        const [penaltyRateSetting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'overstay_penalty_rate'))
            .limit(1);
        
        const [maxDaysSetting] = await db
            .select()
            .from(platformSettings)
            .where(eq(platformSettings.key, 'overstay_max_penalty_days'))
            .limit(1);

        return res.json({
            gracePeriodDays: {
                key: 'overstay_grace_period_days',
                value: gracePeriodSetting?.value || '3',
                intValue: gracePeriodSetting ? parseInt(gracePeriodSetting.value) : 3,
                description: 'Default grace period before penalties apply (days)',
                updatedAt: gracePeriodSetting?.updatedAt,
            },
            penaltyRate: {
                key: 'overstay_penalty_rate',
                value: penaltyRateSetting?.value || '0.10',
                decimalValue: penaltyRateSetting ? parseFloat(penaltyRateSetting.value) : 0.10,
                percentValue: penaltyRateSetting ? (parseFloat(penaltyRateSetting.value) * 100).toFixed(0) : '10',
                description: 'Default penalty rate as decimal (e.g., 0.10 for 10%)',
                updatedAt: penaltyRateSetting?.updatedAt,
            },
            maxPenaltyDays: {
                key: 'overstay_max_penalty_days',
                value: maxDaysSetting?.value || '30',
                intValue: maxDaysSetting ? parseInt(maxDaysSetting.value) : 30,
                description: 'Default maximum days penalties can accrue',
                updatedAt: maxDaysSetting?.updatedAt,
            },
        });
    } catch (error) {
        logger.error('Error getting overstay penalty settings:', error);
        res.status(500).json({ error: 'Failed to get overstay penalty settings' });
    }
});

// Update overstay penalty defaults
router.put('/admin/platform-settings/overstay-penalties', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { gracePeriodDays, penaltyRate, maxPenaltyDays } = req.body;
        const userId = req.neonUser!.id;

        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        const results: Record<string, any> = {};

        // Update grace period days
        if (gracePeriodDays !== undefined) {
            const days = parseInt(gracePeriodDays);
            if (isNaN(days) || days < 0 || days > 14) {
                return res.status(400).json({ error: 'Grace period must be between 0 and 14 days' });
            }
            
            const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'overstay_grace_period_days')).limit(1);
            if (existing) {
                const [updated] = await db.update(platformSettings).set({ value: days.toString(), updatedBy: userId, updatedAt: new Date() }).where(eq(platformSettings.key, 'overstay_grace_period_days')).returning();
                results.gracePeriodDays = { value: days, updated: true };
            } else {
                await db.insert(platformSettings).values({ key: 'overstay_grace_period_days', value: days.toString(), description: 'Default grace period before penalties apply (days)', updatedBy: userId });
                results.gracePeriodDays = { value: days, created: true };
            }
        }

        // Update penalty rate
        if (penaltyRate !== undefined) {
            const rate = typeof penaltyRate === 'string' ? parseFloat(penaltyRate) : penaltyRate;
            if (isNaN(rate) || rate < 0 || rate > 0.50) {
                return res.status(400).json({ error: 'Penalty rate must be between 0 and 0.50 (0% to 50%)' });
            }
            
            const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'overstay_penalty_rate')).limit(1);
            if (existing) {
                const [updated] = await db.update(platformSettings).set({ value: rate.toString(), updatedBy: userId, updatedAt: new Date() }).where(eq(platformSettings.key, 'overstay_penalty_rate')).returning();
                results.penaltyRate = { value: rate, percent: (rate * 100).toFixed(0), updated: true };
            } else {
                await db.insert(platformSettings).values({ key: 'overstay_penalty_rate', value: rate.toString(), description: 'Default penalty rate as decimal (e.g., 0.10 for 10%)', updatedBy: userId });
                results.penaltyRate = { value: rate, percent: (rate * 100).toFixed(0), created: true };
            }
        }

        // Update max penalty days
        if (maxPenaltyDays !== undefined) {
            const days = parseInt(maxPenaltyDays);
            if (isNaN(days) || days < 1 || days > 90) {
                return res.status(400).json({ error: 'Max penalty days must be between 1 and 90' });
            }
            
            const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'overstay_max_penalty_days')).limit(1);
            if (existing) {
                const [updated] = await db.update(platformSettings).set({ value: days.toString(), updatedBy: userId, updatedAt: new Date() }).where(eq(platformSettings.key, 'overstay_max_penalty_days')).returning();
                results.maxPenaltyDays = { value: days, updated: true };
            } else {
                await db.insert(platformSettings).values({ key: 'overstay_max_penalty_days', value: days.toString(), description: 'Default maximum days penalties can accrue', updatedBy: userId });
                results.maxPenaltyDays = { value: days, created: true };
            }
        }

        return res.json({
            message: 'Overstay penalty defaults updated successfully',
            results,
        });
    } catch (error) {
        logger.error('Error updating overstay penalty defaults:', error);
        res.status(500).json({ error: 'Failed to update overstay penalty defaults' });
    }
});

export const platformRouter = router;
