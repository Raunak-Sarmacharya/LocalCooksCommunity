import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TrackingWorkflowHelp } from './TrackingWorkflowHelp';
vi.mock('@/i18n/manager', async () => {
  const { default: words } = await import('@shared/i18n/locales/en-CA/manager.json');
  return { mt: (key: string, options: Record<string, unknown> = {}) =>
    ((words as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(options[name] ?? `{${name}}`)) };
});
afterEach(cleanup);
it('uses the manager arrival override, including zero, and never advertises an inspection auto-clear', () => {
  render(<TrackingWorkflowHelp settings={{ timeWindowSettings: { checkinWindowMinutesBefore: 0 },
    platformDefaults: { checkinWindowMinutesBefore: 20, checkoutReviewWindowMinutes: 90 } }} />);
  expect(screen.getByText(/Arrival opens 0 min before the visit/)).toBeInTheDocument();
  expect(screen.getByText(/Managers set arrival timing/)).toBeInTheDocument();
  expect(screen.getByText(/never as approval/)).toBeInTheDocument();
  expect(screen.queryByText(/auto-clear|review: 90/)).not.toBeInTheDocument();
});
it('uses the independent storage review window and explains removal responsibility', () => {
  render(<TrackingWorkflowHelp storage settings={{ storageDefaults: { checkoutReviewWindowMinutes: 180 },
    platformDefaults: { checkoutReviewWindowMinutes: 90 } }} />);
  expect(screen.getByText(/Checkout review: 180 min/)).toBeInTheDocument();
  expect(screen.getByText(/You inspect and confirm removal/)).toBeInTheDocument();
  expect(screen.queryByText(/90 min/)).not.toBeInTheDocument();
});
it('shows role guidance without inventing numerical windows before settings arrive', () => {
  render(<TrackingWorkflowHelp />);
  expect(screen.getByText(/Customers record arrival/)).toBeInTheDocument();
  expect(screen.queryByText(/min before/)).not.toBeInTheDocument();
});
