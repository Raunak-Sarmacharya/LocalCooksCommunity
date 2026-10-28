import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/damage-claims', () => ({ claimRequest: vi.fn(), claimMoney: (cents: number) => `$${(cents / 100).toFixed(2)}` }));
vi.mock('@/components/booking/DamageClaimCards', () => ({ ClaimEvidence: () => null, ClaimTimeline: () => null }));
import { claimShownCents } from './DamageClaimReview';
import { splitReplyEvidence } from './booking-support/DamageClaimPanel';
import { transferLine } from './booking-support/CaseView';

describe('claims queue amount', () => {
  it('shows the final amount, then the approved amount, then the claimed amount', () => {
    expect(claimShownCents({ claimedAmountCents: 12000, approvedAmountCents: 9000, finalAmountCents: 9000 })).toBe(9000);
    expect(claimShownCents({ claimedAmountCents: 12000, approvedAmountCents: 9500, finalAmountCents: null })).toBe(9500);
    expect(claimShownCents({ claimedAmountCents: 12000 })).toBe(12000);
  });
});

describe('admin claim evidence', () => {
  const claim: any = { managerId: 4, kitchenReply: 'Here is the seal photo', lines: [{ document: { fileUrl: 'https://f/invoice.pdf' } }],
    evidence: [{ id: 1, fileUrl: 'https://f/invoice.pdf', uploadedBy: 4, evidenceType: 'invoice' }, { id: 2, fileUrl: 'https://f/seal-photo.pdf', uploadedBy: 4, evidenceType: 'document' },
      { id: 3, fileUrl: 'https://f/before.jpg', uploadedBy: 4, evidenceType: 'photo_after' }] };
  it('separates files sent with the kitchen reply from the rest, listing all of them', () => {
    const { replyEvidence, otherEvidence } = splitReplyEvidence(claim);
    expect(replyEvidence.map(item => item.id)).toEqual([2]);
    expect(otherEvidence.map(item => item.id)).toEqual([1, 3]);
  });
});

describe('admin kitchen transfer line', () => {
  const t = (key: string, options?: Record<string, unknown>) => `${key}:${options?.amount}`;
  it('words sent and expected transfers from the net figures', () => {
    expect(transferLine(t, { transactionId: 1, transferId: 'tr', status: 'recorded', managerRevenueCents: 5750, sent: true, sentAt: null, amountCents: 5494 }, 'CAD')).toContain('bsTransferSentNoDate');
    expect(transferLine(t, { transactionId: 1, transferId: 'tr', status: 'recorded', managerRevenueCents: 5750, sent: true, sentAt: null, amountCents: 5494 }, 'CAD')).toContain('54.94');
    expect(transferLine(t, { transactionId: 2, transferId: null, status: 'not_recorded', managerRevenueCents: 5750, sent: false, amountCents: 5494 }, 'CAD')).toMatch(/^bsTransferExpectedLine/);
  });
});
