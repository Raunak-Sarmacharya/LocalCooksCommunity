import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import KitchenDiscovery from './KitchenDiscovery';

vi.mock('@/hooks/use-chef-kitchen-applications', () => ({ useChefKitchenApplicationsStatus: () => ({ applications: [], hasAnyApproved: false, approvedCount: 0, pendingCount: 0, isLoading: false }) }));
vi.mock('@/components/chef/ChefViewingsList', () => ({ default: () => <h1>TOUR-77 · Harbour kitchen</h1> }));
vi.mock('@/components/chef/ChefKitchenApplications', () => ({ default: () => <div>Kitchen applications table</div> }));
vi.mock('@/pages/KitchenComparisonPage', () => ({ KitchenBrowser: () => <h1>Kitchens in St. John’s</h1> }));
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key, i18n: { language: 'en-CA' } }) }));
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

it('switches chef tabs with a linked tour without changing hook order or duplicating the detail header', () => {
  window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['/api/public/kitchens'], []);
  const page = (defaultTab: string) => <QueryClientProvider client={client}><KitchenDiscovery defaultTab={defaultTab} /></QueryClientProvider>;
  const rendered = render(page('discover'));
  expect(screen.getByRole('heading', { name: 'Kitchens in St. John’s' })).toBeInTheDocument();
  rendered.rerender(page('tours'));
  expect(screen.getByRole('heading', { name: 'TOUR-77 · Harbour kitchen' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Your kitchen tours' })).not.toBeInTheDocument();
  rendered.rerender(page('applications'));
  // My kitchens carries its own title now (owner-approved mock, Oct 26): no second header above it.
  expect(screen.getByText('Kitchen applications table')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'My Kitchen Applications' })).not.toBeInTheDocument();
  client.clear();
});
