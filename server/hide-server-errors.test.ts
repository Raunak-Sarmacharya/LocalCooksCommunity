import { describe, expect, it, vi } from 'vitest';
vi.mock('./logger.js', () => ({ logger: { error: vi.fn() } }));
import { hideServerErrors, SERVER_ERROR_MESSAGE } from './hide-server-errors';

const run = (status: number, body: unknown) => {
  const sent: unknown[] = [];
  const res: any = { statusCode: status, json: (value: unknown) => { sent.push(value); return res; } };
  hideServerErrors({ method: 'POST', originalUrl: '/api/x' } as any, res, () => {});
  res.json(body);
  return sent[0];
};

describe('hideServerErrors', () => {
  it('replaces an internal 5xx message and drops details', () => {
    expect(run(500, { error: 'Failed query: delete from "kitchen_checkout_holds"', details: 'stack', code: 'x' }))
      .toEqual({ error: SERVER_ERROR_MESSAGE, code: 'x' });
  });
  it('leaves 4xx messages and successful bodies alone', () => {
    expect(run(409, { error: 'This invitation is no longer payable.' })).toEqual({ error: 'This invitation is no longer payable.' });
    expect(run(200, { url: 'https://checkout.stripe.com/x' })).toEqual({ url: 'https://checkout.stripe.com/x' });
  });
});
