import { describe, expect, it } from 'vitest';
import { publicTour, hasTourConfirmation, publicTourCancellationReason } from './tour-outcome';
describe('tour evidence and note visibility', () => {
  it.each(['Cancelled by chef', 'Cancelled by manager', 'Cancelled by admin', 'Cancelled by Local Cooks'])('hides the legacy actor label %s without changing the source record', reason => {
    const original = { status: 'cancelled', cancellationReason: reason };
    expect(publicTour(original).cancellationReason).toBeNull();
    expect(original.cancellationReason).toBe(reason);
    expect(publicTourCancellationReason('Kitchen closed due to repairs')).toBe('Kitchen closed due to repairs');
  });
  it('does not expose legacy notes in public records or audit history', () => {
    const original = { status: 'confirmed', managerNotes: 'ADMIN PRIVATE', sharedManagerNotes: 'Message to chef',
      outcomeHistory: [null, { from: 'confirmed', to: 'completed', notes: 'ADMIN HISTORY', sharedNotes: 'Attended' }] };
    expect(JSON.stringify(publicTour(original))).not.toContain('ADMIN');
    expect(publicTour(original)).toMatchObject({ sharedManagerNotes: 'Message to chef', outcomeHistory: [{ sharedNotes: 'Attended' }] });
    expect(original.managerNotes).toBe('ADMIN PRIVATE');
  });
  it('requires confirmation evidence rather than interpreting old terminal labels', () => {
    expect(hasTourConfirmation({ status: 'pending' })).toBe(false);
    expect(hasTourConfirmation({ status: 'completed' })).toBe(false);
    expect(hasTourConfirmation({ status: 'no_show', outcomeHistory: [{ from: 'pending', to: 'no_show' }] })).toBe(false);
    expect(hasTourConfirmation({ status: 'confirmed' })).toBe(true);
    expect(hasTourConfirmation({ status: 'no_show', outcomeHistory: [{ from: 'confirmed', to: 'no_show' }] })).toBe(true);
  });
});
