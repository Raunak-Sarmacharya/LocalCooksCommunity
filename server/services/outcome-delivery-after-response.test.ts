import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ waitUntil: vi.fn(), select: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: h.waitUntil }));
vi.mock('../db', () => ({ db: { select: h.select } }));
vi.mock('../email', () => ({}));
vi.mock('./notification.service', () => ({ notificationService: {} }));

import { attemptOutcomeDeliveryAfterResponse } from './outcome-delivery';

describe('attemptOutcomeDeliveryAfterResponse', () => {
  it('hands the delivery attempt to waitUntil and returns without waiting for it', () => {
    let release!: () => void;
    h.select.mockReturnValue(new Promise<void>(resolve => { release = resolve; }) as never);
    expect(attemptOutcomeDeliveryAfterResponse()).toBeUndefined();
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
    expect(h.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    release();
  });

  it('never rejects, so a failed attempt cannot break the finished request', async () => {
    h.select.mockImplementation(() => { throw new Error('db down'); });
    attemptOutcomeDeliveryAfterResponse();
    await expect(h.waitUntil.mock.calls.at(-1)![0]).resolves.toBeUndefined();
  });
});
