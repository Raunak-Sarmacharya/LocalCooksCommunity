import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture' } } }));
import { AdminInvitationsSection } from './AdminInvitationsSection';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const soon = new Date(Date.now() + 5 * 3_600_000).toISOString(), later = new Date(Date.now() + 40 * 3_600_000).toISOString();
const invitation = (id: string, name: string, status: string, expiresAt: string) => ({ id, version: 3, status, kitchen: { name: 'Harbour' }, chef: { id: 5, name },
  date: '2026-11-02', startTime: '09:00', endTime: '12:00', timezone: 'America/St_Johns', dayCount: 1, pricing: { totalCents: 9000 },
  expiresAt, createdAt: '2026-10-28T12:00:00Z', bookingId: null, note: null });

it('lists open invitations soonest-to-expire first, hides closed ones, and needs a reason before giving more time', async () => {
  const posts: Array<{ url: string; body: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    if (init?.method === 'POST') { posts.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ...invitation('b', 'Sam', 'sent', later), version: 4 }) }; }
    return { ok: !String(url).includes('test-clock'), json: async () => ({ invitations: [invitation('a', 'Ana', 'accepted', later), invitation('b', 'Sam', 'sent', later), invitation('c', 'Lee', 'sent', soon)] }) };
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminInvitationsSection /></QueryClientProvider>);
  await screen.findByText('Lee');
  const names = screen.getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[0].textContent);
  expect(names).toEqual(['Lee', 'Sam']);
  fireEvent.click(screen.getByLabelText('Include closed'));
  expect(screen.getByText('Ana')).toBeInTheDocument();

  fireEvent.click(within(screen.getAllByRole('row').find(row => row.textContent?.includes('Sam'))!).getByRole('button', { name: 'Open' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Give more time' }));
  fireEvent.click(screen.getByRole('button', { name: '7 days' }));
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Customer asked on the phone' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(posts).toEqual([{ url: '/api/admin/invitations/b/extend', body: { reason: 'Customer asked on the phone', version: 3, hours: 168 } }]));
});
