import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture' } } }));
import { AdminStorageRentalsSection } from './AdminStorageRentalsSection';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const rental = { id: 7, ref: 'SB-7', kitchen: { name: 'Harbour' }, listing: { name: 'Shelf' }, chef: { name: 'Morgan' }, state: 'active',
  unitLabel: '1', startOn: '2026-10-01', paidThrough: '2026-10-30', terms: [{ totalCents: 3550 }], adminActions: ['goodwill_refund'],
  payments: [{ amountCents: 3550, refundedCents: 0, payoutAmountCents: 3317, status: 'succeeded', payoutStatus: 'paid' }],
  flags: [], supportActions: [], problems: [], claims: [], holdover: [], notices: [] };
it('loads the table and drawer, requires a reason and previews a funded refund before confirmation', async () => {
  const fetchMock = vi.fn(async (url: any, init?: any) => ({ ok: true, json: async () => String(url).includes('/actions/preview') ? { amountCents: 500, date: '2026-10-16' }
    : String(url).includes('/7') ? rental : [rental] }));
  vi.stubGlobal('fetch', fetchMock);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminStorageRentalsSection /></QueryClientProvider>);
  expect(await screen.findByText('Harbour')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'stViewUnit' }));
  await screen.findByLabelText('stAdminAction');
  expect(screen.getAllByText('stState_active').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('stAdminSubtitle')).toBeInTheDocument();
  expect(screen.getByText('stAdminSection_payments')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('stAdminAction'));
  fireEvent.click(screen.getByRole('option', { name: 'stAdminAction_goodwill_refund' }));
  expect(screen.getByRole('button', { name: 'stPreview' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('stAdminReason'), { target: { value: 'Kitchen agreed to a refund.' } });
  fireEvent.change(screen.getByLabelText('stAmountLabel'), { target: { value: '5.00' } });
  fireEvent.click(screen.getByLabelText('stFundedBy'));
  fireEvent.click(screen.getByRole('option', { name: 'stFunded_local_cooks' }));
  fireEvent.click(screen.getByRole('button', { name: 'stPreview' }));
  expect(await screen.findByText(/\$5.00/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/actions'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'stConfirm' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/actions') && JSON.parse(init?.body || '{}').fundedBy === 'local_cooks')).toBe(true));
  const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/actions'))!;
  expect(JSON.parse(post[1]?.body || '{}')).toMatchObject({ type: 'goodwill_refund', amountCents: 500, reason: 'Kitchen agreed to a refund.', operationKey: expect.any(String) });
});
