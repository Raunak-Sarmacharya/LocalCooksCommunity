import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTourClock } from './use-tour-clock';

afterEach(() => { vi.useRealTimers(); });

it('refreshes an open dashboard at the scheduled boundary without waiting for polling', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  const end = Date.now() + 1_000;
  const { result, unmount } = renderHook(() => {
    useTourClock(Date.now() < end ? end : undefined);
    return Date.now() >= end;
  });
  expect(result.current).toBe(false);
  act(() => { vi.advanceTimersByTime(999); });
  expect(result.current).toBe(false);
  act(() => { vi.advanceTimersByTime(1); });
  expect(result.current).toBe(true);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
