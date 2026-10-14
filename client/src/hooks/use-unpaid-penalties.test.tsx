import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock('@/hooks/use-outstanding-dues', () => ({ useOutstandingDues: () => ({ data: { hasOutstandingDues: true,
  totalCount: state.items.length, totalOwedCents: 3000, items: state.items }, isLoading: false }) }));
import { useUnpaidPenaltiesCheck } from './use-unpaid-penalties';
describe('legacy booking gate no longer blocks claims immediately', () => {
  it('does not block on a freshly approved claim; the separate seven-day server guard owns eligibility', () => {
    state.items = [{ type: 'damage_claim', amountCents: 2000 }];
    expect(renderHook(() => useUnpaidPenaltiesCheck()).result.current.data).toBeNull();
  });
  it('preserves overstay enforcement without counting claim amounts', () => {
    state.items = [{ type: 'damage_claim', amountCents: 2000 }, { type: 'overstay_penalty', amountCents: 1000 }];
    expect(renderHook(() => useUnpaidPenaltiesCheck()).result.current.data).toEqual({ hasUnpaidPenalties: true, totalCount: 1, totalOwedCents: 1000 });
  });
});
