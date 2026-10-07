import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTourRequestsSection } from './AdminTourRequestsSection';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../HistoricalVisitReviews', () => ({ HistoricalVisitReviews: () => null }));
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/');
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
describe('admin tour incident links', () => {
  it('reviews an overdue forwarded request with current overlap acknowledgement and a shared reason before confirmation', async () => {
    const version = '2026-10-01T10:00:00Z';
    const rows = [{ viewing: { id: 88, status: 'pending', scheduledAt: '2099-10-08T12:00:00Z', durationMinutes: 30, createdAt: version, adminReviewedAt: version, updatedAt: version }, chefName: 'Fixture visitor', managerName: 'Fixture owner' }];
    const fetcher = vi.fn(async (url: string, options?: any) => ({ ok: true, json: async () => url.includes('delivery-status') ? [] : url.includes('decision-context') ? { updatedAt: version, scheduledAt: rows[0].viewing.scheduledAt, overlapReviewKey: 'fixture-review', overlaps: [{ bookingId: 2, reference: 'KB-2', start: '2099-10-08T12:00:00Z' }] } : options?.method === 'PATCH' ? { id: 88, status: 'confirmed' } : rows }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/admin?section=tour-requests&viewing=88');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminTourRequestsSection /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review and confirm overdue request' }));
    await screen.findByText(/KB-2/);
    const confirm = screen.getByRole('button', { name: 'Confirm tour' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Shared confirmation reason' }), { target: { value: 'Manager agreed by phone' } });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
    const write = fetcher.mock.calls.find(([, options]) => options?.method === 'PATCH')![1];
    expect(JSON.parse(write.body)).toEqual({ status: 'confirmed', takeoverReason: 'Manager agreed by phone', expectedUpdatedAt: version, overlapReviewKey: 'fixture-review', acceptBookingOverlap: true });
    client.clear();
  });
  it('opens History for a reported no-show and retains inspect/correct controls without a mandatory queue', async () => {
    const rows = [{ viewing: { id: 77, status: 'no_show', scheduledAt: '2026-01-01T15:00:00Z', durationMinutes: 30,
      createdAt: '2025-12-01T12:00:00Z', updatedAt: '2026-01-01T16:00:00Z', managerNotes: 'Admin-only evidence',
      outcomeHistory: [{ from: 'confirmed', to: 'no_show', recordedAt: '2026-01-01T16:00:00Z', actorRole: 'manager' }] }, chefName: 'Fixture chef', locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('delivery-status') ? [] : rows })));
    window.history.replaceState({}, '', '/admin?section=tour-requests&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminTourRequestsSection /></QueryClientProvider>);
    expect(await screen.findByRole('button', { name: 'Correct outcome' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History (1)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Admin-only evidence')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
  });
});
