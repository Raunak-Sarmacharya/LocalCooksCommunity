/**
 * @deprecated This file is deprecated and will be removed in a future version.
 * The process-payouts functionality has been moved to server/routes.ts as part of the unified entry point.
 * All API requests now route through api/index.js (bundled from server/index.ts).
 * 
 * This file is kept temporarily for backward compatibility but should not be used.
 * The route is now available at: POST /api/process-payouts (handled by server/routes.ts)
 * 
 * Vercel Cron Job: Process Weekly Payouts
 * 
 * This endpoint is called weekly by Vercel Cron to process payouts for managers.
 * 
 * Note: Stripe Connect Express accounts automatically receive weekly payouts by default.
 * This endpoint can be used to:
 * 1. Monitor payout status
 * 2. Generate payout reports
 * 3. Trigger immediate payouts if needed (requires additional Stripe API calls)
 * 
 * Schedule: Weekly (configure in vercel.json)
 */

const { pool } = require('./server/db');

module.exports = async (req, res) => {
  // Verify this is a cron request (Vercel adds Authorization header)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not available' });
    }

    const { processWeeklyPayouts, getPayoutSummary } = await import('../server/services/payout-processing-service.ts');

    // Get summary first
    const summary = await getPayoutSummary(pool);

    // Process payouts (dry run by default - Stripe handles automatic payouts)
    // Set dryRun to false if you want to trigger immediate payouts
    const results = await processWeeklyPayouts(pool, true);

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    const totalAmount = results.reduce((sum, r) => sum + (r.amount || 0), 0);

    console.log(`Payout processing completed: ${successCount} successful, ${errorCount} errors, $${totalAmount.toFixed(2)} total`);

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        ...summary,
        processedManagers: results.length,
        successfulPayouts: successCount,
        failedPayouts: errorCount,
        totalAmount,
      },
      results: results.map(r => ({
        managerId: r.managerId,
        success: r.success,
        amount: r.amount,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error('Error processing payouts:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process payouts',
      timestamp: new Date().toISOString(),
    });
  }
};
