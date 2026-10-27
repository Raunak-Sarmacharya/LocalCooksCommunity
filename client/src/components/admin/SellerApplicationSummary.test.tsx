import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SellerApplicationSummary } from './SellerApplicationReview';
afterEach(cleanup);
const base = { id: 1, status: 'approved', kitchenPreference: 'commercial', commercialKitchen: 'localcooks', documentsRequested: [], foodTypes: [] } as any;

it.each([
  [{ status: 'inReview' }, 'Call them'],
  [{ documentsRequested: ['foodSafety'] }, 'Create their shop'],
  [{ phpShopCreated: true }, 'Send their sign-in email'],
  [{ phpShopCreated: true, verificationEmailSentAt: '2026-10-27' }, 'They connect payouts'],
])('admin next step: %o → %s', (extra, next) => {
  render(<SellerApplicationSummary application={{ ...base, ...extra }} />);
  expect(screen.getByText(next)).toBeTruthy();
});
