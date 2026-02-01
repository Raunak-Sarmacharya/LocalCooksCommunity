/**
 * Overstay Penalty Service - Integration Tests
 * 
 * These tests call the ACTUAL service methods with a real database connection.
 * They verify the complete flow works end-to-end.
 * 
 * Prerequisites:
 * - DATABASE_URL must be set to a test database
 * - Run: npm run test:server -- --run overstay-penalty-service.integration.test.ts
 * 
 * IMPORTANT: These tests create and clean up real database records.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

// Check for real DATABASE_URL BEFORE any imports that might use it
// The vitest-setup.ts overrides it with a dummy value, so we need to check .env directly
import 'dotenv/config';

// Skip if no real database connection (check after dotenv loads)
const SKIP_INTEGRATION = !process.env.DATABASE_URL || 
  process.env.DATABASE_URL.includes('dummy') || 
  process.env.DATABASE_URL.includes('localhost:5432/dummy');

// Import db and schema AFTER checking - these will use the real DATABASE_URL from .env
import { db } from '../../db';
import { 
  storageBookings, 
  storageListings, 
  storageOverstayRecords,
  storageOverstayHistory,
} from '@shared/schema';

// Test data tracking for cleanup
let testStorageListingId: number | null = null;
const testStorageBookingIds: number[] = [];
const testOverstayRecordIds: number[] = [];

// Hardcoded test user IDs (must exist in database)
const testChefId = 292;
const testManagerId = 280;

// Helper to create dates
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

describe.skipIf(SKIP_INTEGRATION)('Overstay Penalty Service - Integration', () => {
  
  beforeAll(async () => {
    // Find or use existing test data
    // We'll use existing data if available to avoid complex setup
    
    // Find a storage listing
    const [listing] = await db
      .select({ id: storageListings.id })
      .from(storageListings)
      .where(eq(storageListings.isActive, true))
      .limit(1);
    
    if (listing) {
      testStorageListingId = listing.id;
    }
  });

  afterAll(async () => {
    // Clean up test data in reverse order (foreign keys)
    
    // Delete overstay history
    for (const id of testOverstayRecordIds) {
      await db
        .delete(storageOverstayHistory)
        .where(eq(storageOverstayHistory.overstayRecordId, id));
    }

    // Delete overstay records
    for (const id of testOverstayRecordIds) {
      await db
        .delete(storageOverstayRecords)
        .where(eq(storageOverstayRecords.id, id));
    }

    // Delete test bookings
    for (const id of testStorageBookingIds) {
      await db
        .delete(storageBookings)
        .where(eq(storageBookings.id, id));
    }
  });

  describe('detectOverstays', () => {
    it('should detect an expired storage booking and create overstay record', async () => {
      // Skip if no test data available
      if (!testStorageListingId || !testChefId) {
        console.log('Skipping: No storage listing or chef available for testing');
        return;
      }

      // Import the service
      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      // Create a test booking that ended 5 days ago
      const endDate = daysAgo(5);
      const startDate = daysAgo(35); // 30-day booking

      const [booking] = await db
        .insert(storageBookings)
        .values({
          storageListingId: testStorageListingId,
          chefId: testChefId,
          startDate,
          endDate,
          totalPrice: '10000', // $100
          pricingModel: 'daily',
          status: 'confirmed',
          paymentStatus: 'paid',
        })
        .returning();

      testStorageBookingIds.push(booking.id);

      // Run detection
      const results = await overstayPenaltyService.detectOverstays();

      // Find our booking in results
      const ourResult = results.find(r => r.bookingId === booking.id);

      expect(ourResult).toBeDefined();
      expect(ourResult!.daysOverdue).toBe(5);
      expect(ourResult!.status).toMatch(/grace_period|pending_review/);

      // Verify overstay record was created in database
      const [overstayRecord] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.storageBookingId, booking.id))
        .limit(1);

      expect(overstayRecord).toBeDefined();
      expect(overstayRecord.daysOverdue).toBe(5);
      
      testOverstayRecordIds.push(overstayRecord.id);
    });

    it('should be idempotent - running detection twice should not create duplicates', async () => {
      if (!testStorageListingId || !testChefId) {
        console.log('Skipping: No storage listing or chef available for testing');
        return;
      }

      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      // Create a test booking
      const endDate = daysAgo(7);
      const startDate = daysAgo(37);

      const [booking] = await db
        .insert(storageBookings)
        .values({
          storageListingId: testStorageListingId,
          chefId: testChefId,
          startDate,
          endDate,
          totalPrice: '10000',
          pricingModel: 'daily',
          status: 'confirmed',
          paymentStatus: 'paid',
        })
        .returning();

      testStorageBookingIds.push(booking.id);

      // Run detection twice
      await overstayPenaltyService.detectOverstays();
      await overstayPenaltyService.detectOverstays();

      // Count overstay records for this booking
      const records = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.storageBookingId, booking.id));

      expect(records.length).toBe(1); // Should only have one record

      testOverstayRecordIds.push(records[0].id);
    });

    it('should update daysOverdue on subsequent detection runs', async () => {
      if (!testStorageListingId || !testChefId) {
        console.log('Skipping: No storage listing or chef available for testing');
        return;
      }

      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      // Create a test booking that ended 10 days ago
      const endDate = daysAgo(10);
      const startDate = daysAgo(40);

      const [booking] = await db
        .insert(storageBookings)
        .values({
          storageListingId: testStorageListingId,
          chefId: testChefId,
          startDate,
          endDate,
          totalPrice: '10000',
          pricingModel: 'daily',
          status: 'confirmed',
          paymentStatus: 'paid',
        })
        .returning();

      testStorageBookingIds.push(booking.id);

      // Run detection
      await overstayPenaltyService.detectOverstays();

      // Get the record
      const [record] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.storageBookingId, booking.id))
        .limit(1);

      expect(record).toBeDefined();
      expect(record.daysOverdue).toBe(10);

      testOverstayRecordIds.push(record.id);
    });
  });

  describe('processManagerDecision', () => {
    it('should approve a pending overstay and set finalPenaltyCents', async () => {
      if (!testStorageListingId || !testChefId) {
        console.log('Skipping: No storage listing or chef available for testing');
        return;
      }

      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      // Create a test booking
      const endDate = daysAgo(8);
      const startDate = daysAgo(38);

      const [booking] = await db
        .insert(storageBookings)
        .values({
          storageListingId: testStorageListingId,
          chefId: testChefId,
          startDate,
          endDate,
          totalPrice: '10000',
          pricingModel: 'daily',
          status: 'confirmed',
          paymentStatus: 'paid',
        })
        .returning();

      testStorageBookingIds.push(booking.id);

      // Run detection to create overstay record
      await overstayPenaltyService.detectOverstays();

      // Get the record
      const [record] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.storageBookingId, booking.id))
        .limit(1);

      testOverstayRecordIds.push(record.id);

      // Skip if still in grace period
      if (record.status === 'grace_period') {
        console.log('Skipping approval test: record still in grace period');
        return;
      }

      // Approve the penalty (use real manager ID for FK constraint)
      const result = await overstayPenaltyService.processManagerDecision({
        overstayRecordId: record.id,
        managerId: testManagerId || testChefId || 1,
        action: 'approve',
        managerNotes: 'Integration test approval',
      });

      expect(result.success).toBe(true);

      // Verify the record was updated
      const [updatedRecord] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.id, record.id))
        .limit(1);

      expect(updatedRecord.status).toBe('penalty_approved');
      expect(updatedRecord.finalPenaltyCents).toBe(updatedRecord.calculatedPenaltyCents);
      expect(updatedRecord.penaltyApprovedBy).toBe(testManagerId);
    });

    it('should waive a pending overstay with reason', async () => {
      if (!testStorageListingId || !testChefId) {
        console.log('Skipping: No storage listing or chef available for testing');
        return;
      }

      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      // Create a test booking
      const endDate = daysAgo(6);
      const startDate = daysAgo(36);

      const [booking] = await db
        .insert(storageBookings)
        .values({
          storageListingId: testStorageListingId,
          chefId: testChefId,
          startDate,
          endDate,
          totalPrice: '10000',
          pricingModel: 'daily',
          status: 'confirmed',
          paymentStatus: 'paid',
        })
        .returning();

      testStorageBookingIds.push(booking.id);

      // Run detection
      await overstayPenaltyService.detectOverstays();

      // Get the record
      const [record] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.storageBookingId, booking.id))
        .limit(1);

      testOverstayRecordIds.push(record.id);

      // Skip if still in grace period
      if (record.status === 'grace_period') {
        console.log('Skipping waive test: record still in grace period');
        return;
      }

      // Waive the penalty (use real manager ID for FK constraint)
      const result = await overstayPenaltyService.processManagerDecision({
        overstayRecordId: record.id,
        managerId: testManagerId || testChefId || 1,
        action: 'waive',
        waiveReason: 'First-time customer - integration test',
        managerNotes: 'Integration test waive',
      });

      expect(result.success).toBe(true);

      // Verify the record was updated
      const [updatedRecord] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.id, record.id))
        .limit(1);

      expect(updatedRecord.status).toBe('penalty_waived');
      expect(updatedRecord.penaltyWaived).toBe(true);
      expect(updatedRecord.finalPenaltyCents).toBe(0);
      expect(updatedRecord.waiveReason).toBe('First-time customer - integration test');
    });

    it('should adjust penalty amount when manager specifies different amount', async () => {
      if (!testStorageListingId || !testChefId) {
        console.log('Skipping: No storage listing or chef available for testing');
        return;
      }

      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      // Create a test booking
      const endDate = daysAgo(9);
      const startDate = daysAgo(39);

      const [booking] = await db
        .insert(storageBookings)
        .values({
          storageListingId: testStorageListingId,
          chefId: testChefId,
          startDate,
          endDate,
          totalPrice: '10000',
          pricingModel: 'daily',
          status: 'confirmed',
          paymentStatus: 'paid',
        })
        .returning();

      testStorageBookingIds.push(booking.id);

      // Run detection
      await overstayPenaltyService.detectOverstays();

      // Get the record
      const [record] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.storageBookingId, booking.id))
        .limit(1);

      testOverstayRecordIds.push(record.id);

      // Skip if still in grace period
      if (record.status === 'grace_period') {
        console.log('Skipping adjust test: record still in grace period');
        return;
      }

      // Adjust the penalty to a specific amount (use real manager ID for FK constraint)
      const adjustedAmount = 500; // $5.00
      const result = await overstayPenaltyService.processManagerDecision({
        overstayRecordId: record.id,
        managerId: testManagerId || testChefId || 1,
        action: 'adjust',
        finalPenaltyCents: adjustedAmount,
        managerNotes: 'Reduced penalty - integration test',
      });

      expect(result.success).toBe(true);

      // Verify the record was updated
      const [updatedRecord] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.id, record.id))
        .limit(1);

      expect(updatedRecord.status).toBe('penalty_approved');
      expect(updatedRecord.finalPenaltyCents).toBe(adjustedAmount);
    });
  });

  describe('getOverstayHistory', () => {
    it('should return audit history for an overstay record', async () => {
      if (!testStorageListingId || !testChefId) {
        console.log('Skipping: No storage listing or chef available for testing');
        return;
      }

      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      // Create a test booking
      const endDate = daysAgo(4);
      const startDate = daysAgo(34);

      const [booking] = await db
        .insert(storageBookings)
        .values({
          storageListingId: testStorageListingId,
          chefId: testChefId,
          startDate,
          endDate,
          totalPrice: '10000',
          pricingModel: 'daily',
          status: 'confirmed',
          paymentStatus: 'paid',
        })
        .returning();

      testStorageBookingIds.push(booking.id);

      // Run detection
      await overstayPenaltyService.detectOverstays();

      // Get the record
      const [record] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.storageBookingId, booking.id))
        .limit(1);

      testOverstayRecordIds.push(record.id);

      // Get history
      const history = await overstayPenaltyService.getOverstayHistory(record.id);

      expect(history.length).toBeGreaterThan(0);
      expect(history[0].overstayRecordId).toBe(record.id);
      expect(history[0].eventType).toBe('status_change');
      expect(history[0].eventSource).toBe('cron');
    });
  });

  describe('getPendingOverstayReviews', () => {
    it('should return pending overstays with booking and chef details', async () => {
      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      const reviews = await overstayPenaltyService.getPendingOverstayReviews();

      // Should return an array (may be empty if no pending reviews)
      expect(Array.isArray(reviews)).toBe(true);

      // If there are reviews, verify structure
      if (reviews.length > 0) {
        const review = reviews[0];
        expect(review).toHaveProperty('overstayId');
        expect(review).toHaveProperty('storageBookingId');
        expect(review).toHaveProperty('status');
        expect(review).toHaveProperty('daysOverdue');
        expect(review).toHaveProperty('calculatedPenaltyCents');
        expect(review).toHaveProperty('storageName');
        expect(review).toHaveProperty('kitchenName');
      }
    });
  });

  describe('getOverstayStats', () => {
    it('should return statistics about overstay records', async () => {
      const { overstayPenaltyService } = await import('../overstay-penalty-service');

      const stats = await overstayPenaltyService.getOverstayStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('pendingReview');
      expect(stats).toHaveProperty('inGracePeriod');
      expect(stats).toHaveProperty('approved');
      expect(stats).toHaveProperty('waived');
      expect(stats).toHaveProperty('charged');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('resolved');
      expect(stats).toHaveProperty('totalPenaltiesCollected');
      expect(stats).toHaveProperty('totalPenaltiesWaived');

      // All values should be numbers
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.pendingReview).toBe('number');
    });
  });
});

describe.skipIf(SKIP_INTEGRATION)('Overstay Penalty - Edge Cases', () => {
  it('should handle booking that just expired (1 day overdue)', async () => {
    if (!testStorageListingId || !testChefId) {
      console.log('Skipping: No storage listing or chef available for testing');
      return;
    }

    const { overstayPenaltyService } = await import('../overstay-penalty-service');

    // Create a booking that ended yesterday
    const endDate = daysAgo(1);
    const startDate = daysAgo(31);

    const [booking] = await db
      .insert(storageBookings)
      .values({
        storageListingId: testStorageListingId!,
        chefId: testChefId!,
        startDate,
        endDate,
        totalPrice: '10000',
        pricingModel: 'daily',
        status: 'confirmed',
        paymentStatus: 'paid',
      })
      .returning();

    testStorageBookingIds.push(booking.id);

    // Run detection
    const results = await overstayPenaltyService.detectOverstays();
    const ourResult = results.find(r => r.bookingId === booking.id);

    expect(ourResult).toBeDefined();
    expect(ourResult!.daysOverdue).toBe(1);
    expect(ourResult!.isInGracePeriod).toBe(true); // Should be in grace period
    expect(ourResult!.calculatedPenaltyCents).toBe(0); // No penalty during grace

    // Get record for cleanup
    const [record] = await db
      .select()
      .from(storageOverstayRecords)
      .where(eq(storageOverstayRecords.storageBookingId, booking.id))
      .limit(1);

    if (record) {
      testOverstayRecordIds.push(record.id);
    }
  });

  it('should not detect cancelled bookings', async () => {
    if (!testStorageListingId || !testChefId) {
      console.log('Skipping: No storage listing or chef available for testing');
      return;
    }

    const { overstayPenaltyService } = await import('../overstay-penalty-service');

    // Create a cancelled booking that ended 5 days ago
    const endDate = daysAgo(5);
    const startDate = daysAgo(35);

    const [booking] = await db
      .insert(storageBookings)
      .values({
        storageListingId: testStorageListingId!,
        chefId: testChefId!,
        startDate,
        endDate,
        totalPrice: '10000',
        pricingModel: 'daily',
        status: 'cancelled', // CANCELLED
        paymentStatus: 'refunded',
      })
      .returning();

    testStorageBookingIds.push(booking.id);

    // Run detection
    const results = await overstayPenaltyService.detectOverstays();
    const ourResult = results.find(r => r.bookingId === booking.id);

    // Should NOT detect cancelled bookings
    expect(ourResult).toBeUndefined();
  });

  it('should not detect pending bookings', async () => {
    if (!testStorageListingId || !testChefId) {
      console.log('Skipping: No storage listing or chef available for testing');
      return;
    }

    const { overstayPenaltyService } = await import('../overstay-penalty-service');

    // Create a pending booking that ended 5 days ago
    const endDate = daysAgo(5);
    const startDate = daysAgo(35);

    const [booking] = await db
      .insert(storageBookings)
      .values({
        storageListingId: testStorageListingId!,
        chefId: testChefId!,
        startDate,
        endDate,
        totalPrice: '10000',
        pricingModel: 'daily',
        status: 'pending', // PENDING (not confirmed)
        paymentStatus: 'pending',
      })
      .returning();

    testStorageBookingIds.push(booking.id);

    // Run detection
    const results = await overstayPenaltyService.detectOverstays();
    const ourResult = results.find(r => r.bookingId === booking.id);

    // Should NOT detect pending bookings
    expect(ourResult).toBeUndefined();
  });
});
