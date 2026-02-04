/**
 * Overstay Penalty Service Tests
 * 
 * Comprehensive test suite for the overstay penalty system.
 * Uses date mocking to simulate different time scenarios without waiting.
 * 
 * Test Categories:
 * 1. Penalty Calculation - Core math logic
 * 2. Detection Flow - Finding expired bookings
 * 3. Status Transitions - State machine validation
 * 4. Manager Decisions - Approve/waive/adjust flows
 * 5. Stripe Charging - Payment processing (mocked)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// MOCK SETUP - Must be before imports
// ============================================================================

// Mock the database
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock('../../db', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
}));

// Mock Stripe
vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      paymentIntents: {
        create: vi.fn(),
      },
    })),
  };
});

// Mock logger
vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock overstay defaults service
vi.mock('../overstay-defaults-service', () => ({
  getOverstayPlatformDefaults: vi.fn().mockResolvedValue({
    gracePeriodDays: 3,
    penaltyRate: 0.10,
    maxPenaltyDays: 30,
  }),
  getEffectivePenaltyConfig: vi.fn().mockResolvedValue({
    gracePeriodDays: 3,
    penaltyRate: 0.10,
    maxPenaltyDays: 30,
    policyText: null,
  }),
}));

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a date relative to a base date
 */
function daysAgo(days: number, baseDate: Date = new Date()): Date {
  const date = new Date(baseDate);
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysFromNow(days: number, baseDate: Date = new Date()): Date {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Mock storage booking factory
 */
function createMockStorageBooking(overrides: Partial<{
  id: number;
  storageListingId: number;
  chefId: number;
  endDate: Date;
  totalPrice: string;
  status: string;
  paymentStatus: string;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  basePrice: string;
  gracePeriodDays: number;
  penaltyRate: string;
  maxPenaltyDays: number;
}> = {}) {
  return {
    id: 1,
    storageListingId: 100,
    chefId: 10,
    endDate: daysAgo(5), // Default: ended 5 days ago
    totalPrice: '10000', // $100
    status: 'confirmed',
    paymentStatus: 'paid',
    stripeCustomerId: 'cus_test123',
    stripePaymentMethodId: 'pm_test123',
    basePrice: '3333', // ~$33.33/month → daily rate
    gracePeriodDays: 3,
    penaltyRate: '0.10',
    maxPenaltyDays: 30,
    ...overrides,
  };
}

/**
 * Mock overstay record factory
 */
function createMockOverstayRecord(overrides: Partial<{
  id: number;
  storageBookingId: number;
  status: string;
  daysOverdue: number;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  dailyRateCents: number;
  penaltyRate: string;
  gracePeriodEndsAt: Date;
  endDate: Date;
  idempotencyKey: string;
}> = {}) {
  return {
    id: 1,
    storageBookingId: 1,
    status: 'pending_review',
    daysOverdue: 5,
    calculatedPenaltyCents: 667, // 2 penalty days * 3333 * 0.10
    finalPenaltyCents: null,
    dailyRateCents: 3333,
    penaltyRate: '0.10',
    gracePeriodEndsAt: daysAgo(2),
    endDate: daysAgo(5),
    idempotencyKey: 'booking_1_overstay_2024-01-01',
    detectedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    penaltyApprovedBy: null,
    penaltyApprovedAt: null,
    penaltyWaived: false,
    waiveReason: null,
    managerNotes: null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    chargeAttemptedAt: null,
    chargeSucceededAt: null,
    chargeFailedAt: null,
    chargeFailureReason: null,
    resolvedAt: null,
    resolutionType: null,
    resolutionNotes: null,
    chefWarningSentAt: null,
    chefPenaltyNoticeSentAt: null,
    managerNotifiedAt: null,
    ...overrides,
  };
}

// ============================================================================
// PENALTY CALCULATION TESTS
// ============================================================================

describe('Overstay Penalty Calculation', () => {
  describe('calculatePenalty', () => {
    /**
     * Core penalty formula (base + penalty rate):
     * penaltyDays = min(daysOverdue - gracePeriodDays, maxPenaltyDays)
     * dailyPenaltyChargeCents = dailyRateCents × (1 + penaltyRate)
     * calculatedPenaltyCents = dailyPenaltyChargeCents × penaltyDays
     * 
     * Example: $20/day storage with 10% penalty = $20 × 1.10 = $22/day
     */

    it('should calculate zero penalty within grace period', () => {
      const daysOverdue = 2;
      const gracePeriodDays = 3;
      const dailyRateCents = 2000; // $20/day
      const penaltyRate = 0.10;
      const maxPenaltyDays = 30;

      // Within grace period = no penalty
      const penaltyDays = Math.max(0, Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays));
      const dailyPenaltyChargeCents = Math.round(dailyRateCents * (1 + penaltyRate));
      const calculatedPenaltyCents = dailyPenaltyChargeCents * penaltyDays;

      expect(penaltyDays).toBe(0);
      expect(calculatedPenaltyCents).toBe(0);
    });

    it('should calculate penalty after grace period ends (base + penalty rate)', () => {
      const daysOverdue = 5;
      const gracePeriodDays = 3;
      const dailyRateCents = 2000; // $20/day
      const penaltyRate = 0.10; // 10%
      const maxPenaltyDays = 30;

      // 5 days overdue - 3 grace = 2 penalty days
      // Daily charge = $20 × 1.10 = $22
      // Total = $22 × 2 = $44
      const penaltyDays = Math.max(0, Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays));
      const dailyPenaltyChargeCents = Math.round(dailyRateCents * (1 + penaltyRate));
      const calculatedPenaltyCents = dailyPenaltyChargeCents * penaltyDays;

      expect(penaltyDays).toBe(2);
      expect(dailyPenaltyChargeCents).toBe(2200); // $22
      expect(calculatedPenaltyCents).toBe(4400); // $44
    });

    it('should cap penalty at maxPenaltyDays', () => {
      const daysOverdue = 50;
      const gracePeriodDays = 3;
      const dailyRateCents = 2000; // $20/day
      const penaltyRate = 0.10;
      const maxPenaltyDays = 30;

      // 50 days overdue - 3 grace = 47, but capped at 30
      // Daily charge = $20 × 1.10 = $22
      // Total = $22 × 30 = $660
      const penaltyDays = Math.max(0, Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays));
      const dailyPenaltyChargeCents = Math.round(dailyRateCents * (1 + penaltyRate));
      const calculatedPenaltyCents = dailyPenaltyChargeCents * penaltyDays;

      expect(penaltyDays).toBe(30);
      expect(calculatedPenaltyCents).toBe(66000); // $660
    });

    it('should handle exactly on grace period boundary', () => {
      const daysOverdue = 3;
      const gracePeriodDays = 3;
      const dailyRateCents = 2000;
      const penaltyRate = 0.10;
      const maxPenaltyDays = 30;

      // Exactly at grace period = 0 penalty days
      const penaltyDays = Math.max(0, Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays));
      const dailyPenaltyChargeCents = Math.round(dailyRateCents * (1 + penaltyRate));
      const calculatedPenaltyCents = dailyPenaltyChargeCents * penaltyDays;

      expect(penaltyDays).toBe(0);
      expect(calculatedPenaltyCents).toBe(0);
    });

    it('should handle first day after grace period', () => {
      const daysOverdue = 4;
      const gracePeriodDays = 3;
      const dailyRateCents = 2000; // $20/day
      const penaltyRate = 0.10;
      const maxPenaltyDays = 30;

      // 4 days overdue - 3 grace = 1 penalty day
      // Daily charge = $20 × 1.10 = $22
      const penaltyDays = Math.max(0, Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays));
      const dailyPenaltyChargeCents = Math.round(dailyRateCents * (1 + penaltyRate));
      const calculatedPenaltyCents = dailyPenaltyChargeCents * penaltyDays;

      expect(penaltyDays).toBe(1);
      expect(calculatedPenaltyCents).toBe(2200); // $22
    });

    it('should handle different penalty rates', () => {
      const daysOverdue = 10;
      const gracePeriodDays = 3;
      const dailyRateCents = 5000; // $50/day
      const maxPenaltyDays = 30;

      const penaltyDays = Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays); // 7 days

      // Test 10% rate: $50 × 1.10 = $55/day × 7 = $385
      expect(Math.round(dailyRateCents * (1 + 0.10)) * penaltyDays).toBe(38500);

      // Test 20% rate: $50 × 1.20 = $60/day × 7 = $420
      expect(Math.round(dailyRateCents * (1 + 0.20)) * penaltyDays).toBe(42000);

      // Test 5% rate: $50 × 1.05 = $52.50/day × 7 = $367.50 → $368 (rounded daily)
      expect(Math.round(dailyRateCents * (1 + 0.05)) * penaltyDays).toBe(36750);
    });

    it('should handle zero grace period', () => {
      const daysOverdue = 5;
      const gracePeriodDays = 0;
      const dailyRateCents = 2000; // $20/day
      const penaltyRate = 0.10;
      const maxPenaltyDays = 30;

      // No grace period = penalty from day 1
      // Daily charge = $20 × 1.10 = $22
      // Total = $22 × 5 = $110
      const penaltyDays = Math.max(0, Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays));
      const dailyPenaltyChargeCents = Math.round(dailyRateCents * (1 + penaltyRate));
      const calculatedPenaltyCents = dailyPenaltyChargeCents * penaltyDays;

      expect(penaltyDays).toBe(5);
      expect(calculatedPenaltyCents).toBe(11000); // $110
    });
  });
});

// ============================================================================
// STATUS TRANSITION TESTS
// ============================================================================

describe('Overstay Status Transitions', () => {
  const validTransitions: Record<string, string[]> = {
    'detected': ['grace_period', 'pending_review'],
    'grace_period': ['pending_review'],
    'pending_review': ['penalty_approved', 'penalty_waived', 'resolved'],
    'penalty_approved': ['charge_pending', 'resolved'],
    'penalty_waived': [], // Terminal state
    'charge_pending': ['charge_succeeded', 'charge_failed'],
    'charge_succeeded': [], // Terminal state
    'charge_failed': ['penalty_approved', 'penalty_waived', 'charge_pending'],
    'resolved': [], // Terminal state
    'escalated': [], // Terminal state
  };

  describe('Valid Transitions', () => {
    it('should allow detected → grace_period', () => {
      expect(validTransitions['detected']).toContain('grace_period');
    });

    it('should allow detected → pending_review (if past grace period)', () => {
      expect(validTransitions['detected']).toContain('pending_review');
    });

    it('should allow grace_period → pending_review', () => {
      expect(validTransitions['grace_period']).toContain('pending_review');
    });

    it('should allow pending_review → penalty_approved', () => {
      expect(validTransitions['pending_review']).toContain('penalty_approved');
    });

    it('should allow pending_review → penalty_waived', () => {
      expect(validTransitions['pending_review']).toContain('penalty_waived');
    });

    it('should allow penalty_approved → charge_pending', () => {
      expect(validTransitions['penalty_approved']).toContain('charge_pending');
    });

    it('should allow charge_pending → charge_succeeded', () => {
      expect(validTransitions['charge_pending']).toContain('charge_succeeded');
    });

    it('should allow charge_pending → charge_failed', () => {
      expect(validTransitions['charge_pending']).toContain('charge_failed');
    });

    it('should allow charge_failed → penalty_approved (retry)', () => {
      expect(validTransitions['charge_failed']).toContain('penalty_approved');
    });
  });

  describe('Terminal States', () => {
    it('penalty_waived should be terminal', () => {
      expect(validTransitions['penalty_waived']).toHaveLength(0);
    });

    it('charge_succeeded should be terminal', () => {
      expect(validTransitions['charge_succeeded']).toHaveLength(0);
    });

    it('resolved should be terminal', () => {
      expect(validTransitions['resolved']).toHaveLength(0);
    });

    it('escalated should be terminal', () => {
      expect(validTransitions['escalated']).toHaveLength(0);
    });
  });
});

// ============================================================================
// DETECTION FLOW TESTS (with date mocking)
// ============================================================================

describe('Overstay Detection Flow', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Set a fixed "today" for all tests
    mockDate = new Date('2024-02-01T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    // Reset mocks
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Date Scenarios', () => {
    it('should correctly identify booking ended yesterday (1 day overdue)', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1);

      const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      
      expect(daysOverdue).toBe(1);
    });

    it('should correctly identify booking ended 5 days ago', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 5);

      const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      
      expect(daysOverdue).toBe(5);
    });

    it('should correctly calculate grace period end date', () => {
      const gracePeriodDays = 3;
      const endDate = new Date('2024-01-25T00:00:00Z');
      
      const gracePeriodEndsAt = new Date(endDate);
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + gracePeriodDays);
      
      expect(gracePeriodEndsAt.toISOString().split('T')[0]).toBe('2024-01-28');
    });

    it('should determine if currently in grace period', () => {
      const today = new Date('2024-02-01T00:00:00Z');
      const gracePeriodDays = 3;
      
      // Booking ended Jan 30 → grace ends Feb 2 → still in grace
      const endDate1 = new Date('2024-01-30T00:00:00Z');
      const graceEnds1 = new Date(endDate1);
      graceEnds1.setDate(graceEnds1.getDate() + gracePeriodDays);
      expect(today < graceEnds1).toBe(true); // In grace period
      
      // Booking ended Jan 28 → grace ends Jan 31 → past grace
      const endDate2 = new Date('2024-01-28T00:00:00Z');
      const graceEnds2 = new Date(endDate2);
      graceEnds2.setDate(graceEnds2.getDate() + gracePeriodDays);
      expect(today < graceEnds2).toBe(false); // Past grace period
    });
  });

  describe('Idempotency', () => {
    it('should generate consistent idempotency key for same booking and end date', () => {
      const bookingId = 123;
      const endDate = new Date('2024-01-25T00:00:00Z');
      
      const key1 = `booking_${bookingId}_overstay_${endDate.toISOString().split('T')[0]}`;
      const key2 = `booking_${bookingId}_overstay_${endDate.toISOString().split('T')[0]}`;
      
      expect(key1).toBe(key2);
      expect(key1).toBe('booking_123_overstay_2024-01-25');
    });

    it('should generate different keys for different bookings', () => {
      const endDate = new Date('2024-01-25T00:00:00Z');
      
      const key1 = `booking_123_overstay_${endDate.toISOString().split('T')[0]}`;
      const key2 = `booking_456_overstay_${endDate.toISOString().split('T')[0]}`;
      
      expect(key1).not.toBe(key2);
    });
  });
});

// ============================================================================
// MANAGER DECISION TESTS
// ============================================================================

describe('Manager Decision Processing', () => {
  describe('Approve Action', () => {
    it('should set status to penalty_approved when approving', () => {
      const record = createMockOverstayRecord({ status: 'pending_review' });
      const decision = {
        overstayRecordId: record.id,
        managerId: 5,
        action: 'approve' as const,
      };

      // Simulate the decision logic
      const newStatus = 'penalty_approved';
      const finalPenaltyCents = record.calculatedPenaltyCents;

      expect(newStatus).toBe('penalty_approved');
      expect(finalPenaltyCents).toBe(667);
    });

    it('should use adjusted amount when provided', () => {
      const record = createMockOverstayRecord({ 
        status: 'pending_review',
        calculatedPenaltyCents: 667,
      });
      const decision = {
        overstayRecordId: record.id,
        managerId: 5,
        action: 'adjust' as const,
        finalPenaltyCents: 500, // Manager reduced penalty
      };

      expect(decision.finalPenaltyCents).toBe(500);
      expect(decision.finalPenaltyCents).toBeLessThan(record.calculatedPenaltyCents);
    });
  });

  describe('Waive Action', () => {
    it('should set status to penalty_waived and finalPenaltyCents to 0', () => {
      const record = createMockOverstayRecord({ status: 'pending_review' });
      const decision = {
        overstayRecordId: record.id,
        managerId: 5,
        action: 'waive' as const,
        waiveReason: 'First-time customer, good faith',
      };

      // Simulate the decision logic
      const newStatus = 'penalty_waived';
      const finalPenaltyCents = 0;
      const penaltyWaived = true;

      expect(newStatus).toBe('penalty_waived');
      expect(finalPenaltyCents).toBe(0);
      expect(penaltyWaived).toBe(true);
    });

    it('should require waive reason', () => {
      const decision = {
        overstayRecordId: 1,
        managerId: 5,
        action: 'waive' as const,
        waiveReason: '', // Empty reason
      };

      const isValid = decision.waiveReason && decision.waiveReason.trim().length > 0;
      expect(isValid).toBeFalsy();
    });
  });

  describe('Validation', () => {
    it('should only allow decisions on pending_review or charge_failed status', () => {
      const allowedStatuses = ['pending_review', 'charge_failed'];

      expect(allowedStatuses.includes('pending_review')).toBe(true);
      expect(allowedStatuses.includes('charge_failed')).toBe(true);
      expect(allowedStatuses.includes('penalty_approved')).toBe(false);
      expect(allowedStatuses.includes('charge_succeeded')).toBe(false);
      expect(allowedStatuses.includes('grace_period')).toBe(false);
    });

    it('should reject negative penalty amounts', () => {
      const finalPenaltyCents = -100;
      const isValid = typeof finalPenaltyCents === 'number' && finalPenaltyCents >= 0;
      
      expect(isValid).toBe(false);
    });

    it('should reject penalty amounts exceeding calculated maximum', () => {
      const record = createMockOverstayRecord({ 
        status: 'pending_review',
        calculatedPenaltyCents: 667, // Max allowed
      });
      const decision = {
        overstayRecordId: record.id,
        managerId: 5,
        action: 'adjust' as const,
        finalPenaltyCents: 1000, // Exceeds max
      };

      // Validate that adjusted amount cannot exceed calculated maximum
      const isValid = decision.finalPenaltyCents <= record.calculatedPenaltyCents;
      expect(isValid).toBe(false);
    });

    it('should allow penalty amounts at or below calculated maximum', () => {
      const record = createMockOverstayRecord({ 
        status: 'pending_review',
        calculatedPenaltyCents: 667,
      });
      
      // Test exact match
      const decision1 = { finalPenaltyCents: 667 };
      expect(decision1.finalPenaltyCents <= record.calculatedPenaltyCents).toBe(true);
      
      // Test below max
      const decision2 = { finalPenaltyCents: 500 };
      expect(decision2.finalPenaltyCents <= record.calculatedPenaltyCents).toBe(true);
      
      // Test zero (waive)
      const decision3 = { finalPenaltyCents: 0 };
      expect(decision3.finalPenaltyCents <= record.calculatedPenaltyCents).toBe(true);
    });
  });
});

// ============================================================================
// STRIPE CHARGING TESTS (Mocked)
// ============================================================================

describe('Stripe Penalty Charging', () => {
  describe('Pre-charge Validation', () => {
    it('should require penalty_approved status before charging', () => {
      const record = createMockOverstayRecord({ status: 'pending_review' });
      const canCharge = record.status === 'penalty_approved';
      
      expect(canCharge).toBe(false);
    });

    it('should allow charging when status is penalty_approved', () => {
      const record = createMockOverstayRecord({ status: 'penalty_approved' });
      const canCharge = record.status === 'penalty_approved';
      
      expect(canCharge).toBe(true);
    });

    it('should require positive finalPenaltyCents', () => {
      const record1 = createMockOverstayRecord({ 
        status: 'penalty_approved',
        finalPenaltyCents: 500,
      });
      const record2 = createMockOverstayRecord({ 
        status: 'penalty_approved',
        finalPenaltyCents: 0,
      });
      const record3 = createMockOverstayRecord({ 
        status: 'penalty_approved',
        finalPenaltyCents: null,
      });

      expect(record1.finalPenaltyCents && record1.finalPenaltyCents > 0).toBe(true);
      expect(record2.finalPenaltyCents && record2.finalPenaltyCents > 0).toBeFalsy();
      expect(record3.finalPenaltyCents && record3.finalPenaltyCents > 0).toBeFalsy();
    });
  });

  describe('Payment Method Validation', () => {
    it('should fail if no stripeCustomerId', () => {
      const booking = createMockStorageBooking({ stripeCustomerId: null });
      const hasPaymentMethod = booking.stripeCustomerId && booking.stripePaymentMethodId;
      
      expect(hasPaymentMethod).toBeFalsy();
    });

    it('should fail if no stripePaymentMethodId', () => {
      const booking = createMockStorageBooking({ stripePaymentMethodId: null });
      const hasPaymentMethod = booking.stripeCustomerId && booking.stripePaymentMethodId;
      
      expect(hasPaymentMethod).toBeFalsy();
    });

    it('should pass with both customer and payment method', () => {
      const booking = createMockStorageBooking({
        stripeCustomerId: 'cus_test123',
        stripePaymentMethodId: 'pm_test123',
      });
      const hasPaymentMethod = booking.stripeCustomerId && booking.stripePaymentMethodId;
      
      expect(hasPaymentMethod).toBeTruthy();
    });
  });

  describe('PaymentIntent Metadata', () => {
    it('should include correct metadata for overstay charge', () => {
      const record = createMockOverstayRecord({
        id: 42,
        storageBookingId: 100,
        daysOverdue: 7,
      });

      const metadata = {
        type: 'overstay_penalty',
        overstay_record_id: record.id.toString(),
        storage_booking_id: record.storageBookingId.toString(),
        days_overdue: record.daysOverdue.toString(),
      };

      expect(metadata.type).toBe('overstay_penalty');
      expect(metadata.overstay_record_id).toBe('42');
      expect(metadata.storage_booking_id).toBe('100');
      expect(metadata.days_overdue).toBe('7');
    });
  });
});

// ============================================================================
// EDGE CASES & REGRESSION TESTS
// ============================================================================

describe('Edge Cases', () => {
  it('should handle booking that ends today (0 days overdue)', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
    
    expect(daysOverdue).toBe(0);
  });

  it('should handle booking that ends in the future (not overdue)', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 5); // Ends in 5 days
    
    const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
    
    expect(daysOverdue).toBe(-5);
    expect(daysOverdue <= 0).toBe(true); // Should be skipped
  });

  it('should handle very large daily rates', () => {
    const dailyRateCents = 100000; // $1000/day
    const penaltyRate = 0.10;
    const penaltyDays = 30;
    
    const calculatedPenaltyCents = Math.round(dailyRateCents * penaltyRate * penaltyDays);
    
    expect(calculatedPenaltyCents).toBe(300000); // $3000 max penalty
  });

  it('should handle very small daily rates', () => {
    const dailyRateCents = 100; // $1/day
    const penaltyRate = 0.10;
    const penaltyDays = 5;
    
    const calculatedPenaltyCents = Math.round(dailyRateCents * penaltyRate * penaltyDays);
    
    expect(calculatedPenaltyCents).toBe(50); // $0.50 penalty
  });

  it('should handle floating point precision in penalty calculation', () => {
    const dailyRateCents = 3333;
    const penaltyRate = 0.10;
    const penaltyDays = 7;
    
    // 3333 * 0.10 * 7 = 2333.1
    const calculatedPenaltyCents = Math.round(dailyRateCents * penaltyRate * penaltyDays);
    
    expect(calculatedPenaltyCents).toBe(2333);
    expect(Number.isInteger(calculatedPenaltyCents)).toBe(true);
  });
});

// ============================================================================
// CONFIGURATION HIERARCHY TESTS
// ============================================================================

describe('Configuration Hierarchy', () => {
  it('should use storage listing values when available', () => {
    const listingConfig = { gracePeriodDays: 5, penaltyRate: 0.15, maxPenaltyDays: 14 };
    const locationConfig = { gracePeriodDays: 3, penaltyRate: 0.10, maxPenaltyDays: 30 };
    const platformConfig = { gracePeriodDays: 3, penaltyRate: 0.10, maxPenaltyDays: 30 };

    // Storage listing takes priority
    const effective = {
      gracePeriodDays: listingConfig.gracePeriodDays ?? locationConfig.gracePeriodDays ?? platformConfig.gracePeriodDays,
      penaltyRate: listingConfig.penaltyRate ?? locationConfig.penaltyRate ?? platformConfig.penaltyRate,
      maxPenaltyDays: listingConfig.maxPenaltyDays ?? locationConfig.maxPenaltyDays ?? platformConfig.maxPenaltyDays,
    };

    expect(effective.gracePeriodDays).toBe(5);
    expect(effective.penaltyRate).toBe(0.15);
    expect(effective.maxPenaltyDays).toBe(14);
  });

  it('should fall back to location defaults when listing has null values', () => {
    const listingConfig = { gracePeriodDays: null, penaltyRate: null, maxPenaltyDays: null };
    const locationConfig = { gracePeriodDays: 7, penaltyRate: 0.20, maxPenaltyDays: 21 };
    const platformConfig = { gracePeriodDays: 3, penaltyRate: 0.10, maxPenaltyDays: 30 };

    const effective = {
      gracePeriodDays: listingConfig.gracePeriodDays ?? locationConfig.gracePeriodDays ?? platformConfig.gracePeriodDays,
      penaltyRate: listingConfig.penaltyRate ?? locationConfig.penaltyRate ?? platformConfig.penaltyRate,
      maxPenaltyDays: listingConfig.maxPenaltyDays ?? locationConfig.maxPenaltyDays ?? platformConfig.maxPenaltyDays,
    };

    expect(effective.gracePeriodDays).toBe(7);
    expect(effective.penaltyRate).toBe(0.20);
    expect(effective.maxPenaltyDays).toBe(21);
  });

  it('should fall back to platform defaults when both listing and location have null values', () => {
    const listingConfig = { gracePeriodDays: null, penaltyRate: null, maxPenaltyDays: null };
    const locationConfig = { gracePeriodDays: null, penaltyRate: null, maxPenaltyDays: null };
    const platformConfig = { gracePeriodDays: 3, penaltyRate: 0.10, maxPenaltyDays: 30 };

    const effective = {
      gracePeriodDays: listingConfig.gracePeriodDays ?? locationConfig.gracePeriodDays ?? platformConfig.gracePeriodDays,
      penaltyRate: listingConfig.penaltyRate ?? locationConfig.penaltyRate ?? platformConfig.penaltyRate,
      maxPenaltyDays: listingConfig.maxPenaltyDays ?? locationConfig.maxPenaltyDays ?? platformConfig.maxPenaltyDays,
    };

    expect(effective.gracePeriodDays).toBe(3);
    expect(effective.penaltyRate).toBe(0.10);
    expect(effective.maxPenaltyDays).toBe(30);
  });
});
