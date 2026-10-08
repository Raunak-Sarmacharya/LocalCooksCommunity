import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminTourRepeatPermissionPanel, ChefTourRepeatPermissionPanel } from './TourRepeatPermissionPanel';
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'chef-1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer fixture' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
let client: QueryClient;
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const version = '2026-10-08T10:00:00Z';
function mount(element: React.ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
it('requires a reason and reuses the same request key when retrying a failed admin grant', async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (_path: string, options?: RequestInit) => ({
    ok: options?.method !== 'POST' || ++attempts > 1,
    json: async () => options?.method === 'POST' ? { error: 'Fixture temporary failure' } : { grants: [], canGrant: true, updatedAt: version },
  }));
  vi.stubGlobal('fetch', fetcher);
  mount(<AdminTourRepeatPermissionPanel id={77} version={version} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Allow another tour' }));
  const save = screen.getByRole('button', { name: 'Save permission' }); expect(save).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Permission reason' }), { target: { value: 'Kitchen equipment has changed.' } });
  fireEvent.click(save);
  await waitFor(() => expect(attempts).toBe(1));
  await waitFor(() => expect(save).toBeEnabled()); fireEvent.click(save);
  await waitFor(() => expect(attempts).toBe(2));
  const posts = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(String(options?.body)));
  expect(posts[0]).toMatchObject({ reason: 'Kitchen equipment has changed.', expectedUpdatedAt: version });
  expect(posts[1].requestKey).toBe(posts[0].requestKey);
});
it('shows provenance and revokes only the unused permission selected by the admin', async () => {
  const grant = { id: 5, reason: 'Kitchen equipment has changed.', grantedBy: 9, grantedAt: version, expiresAt: '2099-01-01T00:00:00Z',
    usedAt: null, usedByTourId: null, revokedAt: null, revokedBy: null, revokeReason: null };
  const fetcher = vi.fn(async (_path: string, options?: RequestInit) => ({ ok: true, json: async () => options?.method === 'POST'
    ? grant : { grants: [grant], canGrant: false, updatedAt: version } }));
  vi.stubGlobal('fetch', fetcher); mount(<AdminTourRepeatPermissionPanel id={77} version={version} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke unused permission' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Permission reason' }), { target: { value: 'The kitchen change was cancelled.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save permission' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([path, options]) => path === '/api/viewings/admin/77/repeat-authorizations/5/revoke' && options?.method === 'POST')).toBe(true));
  expect(screen.getByText(/Granted by admin/)).toHaveTextContent('#9');
});
it('does not offer grants when the admin cannot grant or permissions fail to load', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Cannot load permissions' }) })));
  mount(<AdminTourRepeatPermissionPanel id={77} version={version} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load permissions');
  expect(screen.queryByRole('button', { name: 'Allow another tour' })).not.toBeInTheDocument();
});
it('shows the chef a normal request link without exposing the private admin reason', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ canRequest: true, reason: null, tour: null,
    authorization: { id: 5, expiresAt: '2099-01-01T00:00:00Z', recovery: false } }) })));
  mount(<ChefTourRepeatPermissionPanel kitchenId={4} locationId={2} />);
  expect(await screen.findByRole('link', { name: 'Request another tour' })).toHaveAttribute('href', '/request-tour/2?kitchenId=4');
  expect(screen.getByText(/Local Cooks has allowed another tour/)).toBeInTheDocument();
  expect(screen.queryByText('Kitchen equipment has changed.')).not.toBeInTheDocument();
});
