import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({
  application: null as any, applicationError: null as any, applicationLoading: false,
  navigate: vi.fn(), refetch: vi.fn(), chat: vi.fn(), listed: true, tour: null as any, crumbs: [] as any[],
}));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef' }, loading: false }) }));
vi.mock('@/hooks/use-chef-kitchen-applications', () => ({ useChefKitchenApplicationForLocation: () => ({
  application: state.application, error: state.applicationError, isLoading: state.applicationLoading, refetch: state.refetch,
}) }));
vi.mock('@/hooks/use-tour-request-access', () => ({ useTourRequestAccess: () => ({
  data: { canRequest: !state.tour, tour: state.tour }, isLoading: false, error: null,
}) }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({}) }));
vi.mock('@/services/chat-service', () => ({ getConversationForApplication: state.chat }));
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: any) => ({
  data: queryKey[0].includes('/details') ? { id: 46, name: 'Moonlight Kitchens', address: '14 McDougall St', kitchenTermsUrl: '/terms.pdf', canAcceptApplications: state.listed }
    : queryKey[0].includes('/requirements') ? { requireBusinessName: true, requireFoodHandlerCert: true, requireUsageFrequency: true, requireFoodSafetyUpload: true, requireFoodHandlerExpiry: true, tier2_food_establishment_cert_required: true, tier2_food_establishment_expiry_required: false }
    : queryKey[0].includes('/is-active') ? { toursAvailable: true }
    : [{ id: 53, locationId: 46, name: 'Kitchen North', imageUrl: '/kitchen.jpg' }],
  isLoading: false, error: null, refetch: state.refetch,
}) }));
vi.mock('wouter', () => ({ useLocation: () => ['/kitchen-requirements/46', state.navigate] }));
vi.mock('@/layouts/chef-shell-context', () => ({ useChefShellChrome: ({ breadcrumbs }: any) => { state.crumbs = breadcrumbs; return true; } }));
vi.mock('@/layouts/ChefDashboardLayout', () => ({ default: ({ children }: any) => children }));
vi.mock('@/components/layout/Header', () => ({ default: () => null }));
vi.mock('@/components/ui/smart-image', () => ({ SmartImage: (props: any) => <img {...props} /> }));
vi.mock('@/components/common/SecureDocumentLink', () => ({ SecureDocumentLink: ({ label }: any) => <span>{label}</span> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === 'string' ? options : options?.defaultValue || key }) }));
import KitchenRequirementsPage from './KitchenRequirementsPage';

beforeEach(() => {
  state.application = null; state.applicationError = null; state.applicationLoading = false; state.listed = true; state.tour = null;
  state.navigate.mockClear(); state.refetch.mockClear(); state.chat.mockReset(); localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/kitchen-requirements/46?kitchenId=53'); window.scrollTo = vi.fn();
});
afterEach(cleanup);

it('introduces the actual selected kitchen and routes a new request to that kitchen', () => {
  render(<KitchenRequirementsPage />);
  expect(screen.getByRole('heading', { name: 'Kitchen North', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Your path to kitchen access' })).toBeInTheDocument();
  expect(screen.getByText('Food Establishment Certificate')).toBeInTheDocument();
  expect(screen.queryByText(/Food Establishment Certificate · expiry date/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request to apply', exact: true }));
  expect(state.navigate).toHaveBeenCalledWith('/apply-kitchen/46?kitchenId=53');
});

it.each([
  [{ status: 'inReview', current_tier: 1 }, 'Your request is in review', 'View application', '/dashboard?view=kitchen-requests'],
  [{ status: 'approved', current_tier: 1 }, 'Your request is approved', 'Submit kitchen documents', '/apply-kitchen/46?kitchenId=53'],
  [{ status: 'inReview', current_tier: 2 }, 'Your request is approved', 'Submit kitchen documents', '/apply-kitchen/46?kitchenId=53'],
  [{ status: 'approved', current_tier: 2, tier2_completed_at: '2026-10-09' }, 'Your documents are in review', 'View application', '/dashboard?view=kitchen-requests'],
  [{ status: 'approved', current_tier: 3 }, 'You’re ready to book', 'Choose booking times', '/book/46?kitchenId=53'],
  [{ status: 'approved', current_tier: 3, locationListed: false }, 'Your kitchen access is approved', 'View application', '/dashboard?view=kitchen-requests'],
  [{ status: 'rejected', current_tier: 2 }, 'Ready to apply again?', 'Apply again', '/apply-kitchen/46?kitchenId=53'],
])('shows the correct next action for %j', (application, title, action, href) => {
  state.application = application;
  render(<KitchenRequirementsPage />);
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: action, exact: true }));
  expect(state.navigate).toHaveBeenCalledWith(href);
});

it('shows an existing tour without offering a duplicate request', () => {
  state.tour = { id: 83, kind: 'completed' };
  render(<KitchenRequirementsPage />);
  expect(screen.queryByRole('button', { name: 'Request tour' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View your tour' }));
  expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=viewings&viewing=83');
});

it('does not show another kitchen’s saved dates or promise that dates are reserved', () => {
  sessionStorage.setItem('kitchen_dates_99', JSON.stringify({ from: '2026-11-10' }));
  const { unmount } = render(<KitchenRequirementsPage />);
  expect(screen.queryByText('Saved booking preferences')).not.toBeInTheDocument();
  unmount();
  localStorage.setItem('kitchen_dates_53', JSON.stringify({ from: '2026-11-10' }));
  render(<KitchenRequirementsPage />);
  expect(screen.getByText('Saved booking preferences')).toBeInTheDocument();
  expect(screen.getByText(/reserved only when you complete a booking/)).toBeInTheDocument();
});

it('waits for application state and provides retry on failure instead of offering a duplicate request', () => {
  state.applicationLoading = true;
  const { rerender } = render(<KitchenRequirementsPage />);
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Request to apply' })).not.toBeInTheDocument();
  state.applicationLoading = false; state.applicationError = new Error('Unavailable');
  rerender(<KitchenRequirementsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(state.refetch).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Request to apply' })).not.toBeInTheDocument();
});

it('does not start requests when the kitchen is paused', () => {
  state.listed = false;
  render(<KitchenRequirementsPage />);
  expect(screen.getByRole('heading', { name: 'Requests are currently paused' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Request to apply' })).not.toBeInTheDocument();
});

it('uses a complete breadcrumb trail for the selected kitchen without a standalone back button', () => {
  render(<KitchenRequirementsPage />);
  expect(state.crumbs.map(crumb => crumb.label)).toEqual(['Discover Kitchens', 'Moonlight Kitchens', 'Kitchen North', 'Kitchen access']);
  expect(state.crumbs[2].href).toBe('/kitchen/46/kitchen-north');
  state.crumbs[2].onClick();
  expect(state.navigate).toHaveBeenCalledWith('/kitchen/46/kitchen-north');
  expect(screen.queryByRole('button', { name: 'Back to kitchen listing' })).not.toBeInTheDocument();
  expect(screen.queryByText(/manager.*review|Local Cooks.*review/)).not.toBeInTheDocument();
});

it('opens the current application directly from a waiting state', () => {
  state.application = { id: 57, status: 'inReview', current_tier: 1 };
  render(<KitchenRequirementsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'View application' }));
  expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=kitchen-requests&application=57');
});

it.each([
  { status: 'approved', current_tier: 1 },
  { status: 'approved', current_tier: 2, tier2_completed_at: '2026-10-09' },
  { status: 'approved', current_tier: 3 },
])('offers kitchen coordination after request approval: %j', async application => {
  state.application = { ...application, id: 57, chat_conversation_id: 'chef/kitchen', location: { managerName: 'Morgan Manager' } };
  render(<KitchenRequirementsPage />);
  expect(screen.getByRole('heading', { name: 'Coordinate with kitchen' })).toBeInTheDocument();
  expect(screen.getByText('Morgan Manager')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Message kitchen manager' }));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=messages&conversation=chef%2Fkitchen'));
  expect(state.chat).not.toHaveBeenCalled();
});

it.each([null, { status: 'inReview', current_tier: 1 }, { status: 'rejected', current_tier: 2, tier2_completed_at: '2026-10-09' }, { status: 'cancelled', current_tier: 3 }])('does not offer coordination for an unapproved or closed request: %j', application => {
  state.application = application;
  render(<KitchenRequirementsPage />);
  expect(screen.queryByRole('button', { name: 'Message kitchen manager' })).not.toBeInTheDocument();
});

it('resolves missing conversation ids and allows retry when messaging is unavailable', async () => {
  state.application = { id: 57, status: 'approved', current_tier: 1 };
  state.chat.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ id: 'shared-57' });
  render(<KitchenRequirementsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Message kitchen manager' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open kitchen messages');
  expect(state.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Message kitchen manager' }));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=messages&conversation=shared-57'));
  expect(state.chat).toHaveBeenCalledWith(57);
});
