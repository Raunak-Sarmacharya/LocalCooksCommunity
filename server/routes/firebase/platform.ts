import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, requireAdmin } from '../../firebase-auth-middleware';
import { db } from '../../db';
import { platformSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';

const router = Router();

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
        console.error('Error getting service fee rate:', error);
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
        console.error('Error getting service fee rate:', error);
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
        console.error('Error updating service fee rate:', error);
        res.status(500).json({
            error: 'Failed to update service fee rate',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export const platformRouter = router;
