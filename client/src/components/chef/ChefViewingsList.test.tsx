import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChefViewingsList from './ChefViewingsList';
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef' } }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue || key }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
describe('chef tour notification links', () => {
  it('opens the linked past outcome and excludes internal notes', async () => {
    const rows = [{ viewing: { id: 77, status: 'no_show', noShowReason: 'visitor_absent', scheduledAt: '2026-01-01T15:00:00Z', updatedAt: '2026-01-01T16:00:00Z', createdAt: '2025-12-01T12:00:00Z', durationMinutes: 30,
      managerNotes: 'ADMIN PRIVATE', sharedManagerNotes: 'Please contact Support if this is incorrect', outcomeHistory: [{ from: 'confirmed', to: 'no_show', recordedAt: '2026-01-01T16:00:00Z', notes: 'PRIVATE HISTORY' }] }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => rows })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Visit details' })).toBeInTheDocument();
    expect(screen.getByText('Please contact Support if this is incorrect')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN PRIVATE')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE HISTORY')).not.toBeInTheDocument();
  });
});
