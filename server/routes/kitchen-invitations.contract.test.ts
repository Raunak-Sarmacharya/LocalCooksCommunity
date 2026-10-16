import { describe, expect, it } from 'vitest';
import router from './kitchen-invitations';

const contract = [
  ['post', '/manager/invitations/preview'],
  ['post', '/manager/invitations'],
  ['get', '/manager/invitations/eligible-chefs'],
  ['get', '/manager/invitations'],
  ['post', '/manager/invitations/:id/withdraw'],
  ['post', '/manager/invitations/:id/replace'],
  ['get', '/chef/invitations'],
  ['get', '/chef/invitations/:id'],
  ['post', '/chef/invitations/:id/decline'],
  ['post', '/chef/invitations/:id/checkout'],
  ['get', '/admin/invitations'],
  ['post', '/admin/invitations/:id/withdraw'],
  ['post', '/admin/invitations/:id/extend'],
  ['post', '/admin/invitations/:id/resend'],
] as const;

describe('kitchen invitation API contract', () => {
  it.each(contract)('registers %s %s exactly once', (method, path) => {
    const matches = (router as any).stack.filter((layer: any) =>
      layer.route?.path === path && layer.route?.methods?.[method]);
    expect(matches).toHaveLength(1);
  });

  it('keeps recipient reads under the chef role gate', () => {
    const layer = (router as any).stack.find((entry: any) => entry.route?.path === '/chef/invitations/:id' && entry.route.methods.get);
    expect(layer.route.stack[0].name).toBe('requireChef');
  });
});
