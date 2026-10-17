import { useEffect, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  locations: [{ id: 7, name: 'Downtown' }, { id: 8, name: 'Uptown' }],
  kitchens: [{ id: 1, locationId: 7, name: 'First' }, { id: 2, locationId: 7, name: 'Second' }, { id: 3, locationId: 8, name: 'Third' }],
  kitchenDirty: false, setupDirty: false, save: vi.fn(async () => true), selected: 2,
}));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: null }) }));
vi.mock('../hooks/use-manager-dashboard', () => ({ useManagerDashboard: () => ({ locations: h.locations, kitchens: h.kitchens, bookings: [] }) }));
vi.mock('@/hooks/use-onboarding-status', () => ({ useOnboardingStatus: () => ({ hasKitchens: true, missingSteps: [], improvementSteps: [], setupSteps: [] }), invalidateOnboardingStatus: vi.fn(), SETUP_STEP_WIZARD_STEP: {} }));
vi.mock('@/hooks/use-manager-getting-started', () => ({ useManagerGettingStarted: () => ({ items: [] }), invalidateGettingStarted: vi.fn() }));
vi.mock('@/components/manager/onboarding/ManagerOnboardingContext', () => ({ useManagerOnboarding: () => ({ startNewLocation: vi.fn() }) }));
vi.mock('@/hooks/useSessionFileUpload', () => ({ useSessionFileUpload: () => ({}) }));
vi.mock('@/hooks/use-presigned-document-url', () => ({ usePresignedDocumentUrl: () => ({}) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('wouter', () => ({ useLocation: () => ['/manager/dashboard', vi.fn()], useSearch: () => window.location.search }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }), useMutation: () => ({}), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/layouts/DashboardLayout', () => ({ default: ({ children, onLocationChange, breadcrumbs }: any) => <><button onClick={() => onLocationChange(h.locations[1])}>Switch location</button>{breadcrumbs?.map((b: any, i: number) => <span key={i} data-testid='breadcrumb'>{b.label}</span>)}{children}</> }));
vi.mock('@/components/manager/UnsavedChangesDialog', () => ({ UnsavedChangesDialog: ({ open, onDiscard, onSave, onClose, onOpenChange }: any) => open ? <div role="dialog"><button onClick={onDiscard}>Discard</button><button onClick={onSave}>Save and leave</button><button onClick={() => { onClose?.(); onOpenChange?.(false); }}>Stay</button></div> : null }));
vi.mock('@/components/manager/settings', () => ({
  KitchensManagement: ({ location, initialKitchenId, onNavigate, onDirtyChange, saveRef }: any) => {
    useEffect(() => onDirtyChange(h.kitchenDirty), [onDirtyChange]);
    useImperativeHandle(saveRef, () => ({ saveAllChanges: h.save }));
    return <div><span>Kitchen {initialKitchenId} at {location.id}</span><button onClick={() => onNavigate('settings-checkin-checkout', h.selected)}>Open setup</button></div>;
  },
  CheckinCheckoutSettings: ({ location, kitchenContext, onReturnToKitchen, onDirtyChange, saveRef }: any) => {
    useEffect(() => onDirtyChange(h.setupDirty), [onDirtyChange]);
    useImperativeHandle(saveRef, () => ({ save: h.save }));
    return <div><span>Setup {kitchenContext?.name ?? 'shared'} at {location.id}</span>{onReturnToKitchen && <button onClick={onReturnToKitchen}>Back to kitchen</button>}</div>;
  },
  LicenseSettings: () => null, BookingRulesSettings: () => null, LocationSettings: () => null,
  KitchenListingReview: () => null, FacilityDocsSettings: () => null, StorageCheckinCheckoutSettings: () => null,
}));
vi.mock('./KitchenAvailabilityManagement', () => ({ default: () => null }));
vi.mock('./ManagerBookingsPanel', () => ({ default: () => null }));
vi.mock('./ManagerStorageBookingsPage', () => ({ default: () => null }));
vi.mock('@/components/manager/ViewingsDashboard', () => ({ default: () => null }));
vi.mock('./ManagerKitchenApplications', () => ({ ManagerKitchenApplicationsContent: () => null }));
vi.mock('@/components/dashboard/KitchenDashboardOverview', () => ({ default: () => null }));
vi.mock('@/components/manager/damage-claims/DamageClaimQueue', () => ({ DamageClaimQueue: () => null }));
vi.mock('./ManagerRevenueDashboard', () => ({ default: () => null }));
vi.mock('@/components/chat/UnifiedChatView', () => ({ default: () => null }));
vi.mock('@/components/manager/LocationRequirementsSettings', () => ({ default: () => null }));
vi.mock('@/components/manager/locations/NeedsPrerequisite', () => ({ NeedsKitchen: () => null, NeedsLocation: () => null }));
vi.mock('@/components/manager/ManagerProfileSettings', () => ({ default: () => null }));
vi.mock('@/components/manager/OnboardingStatusBanner', () => ({ OnboardingStatusBanner: () => null }));
vi.mock('@/components/manager/NotificationCenter', () => ({ default: () => null }));
vi.mock('@/components/manager/ManagerSupportPage', () => ({ default: () => null }));
import ManagerBookingDashboard from './ManagerBookingDashboard';
beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue(true); h.kitchenDirty = false; h.setupDirty = false; h.selected = 2; window.history.replaceState({}, '', '/manager/dashboard?view=kitchens&kit=2&locationId=7&section=arrival-departure'); });
afterEach(cleanup);
it('opens shared setup for the selected second kitchen and returns to the same kitchen section', () => {
  render(<ManagerBookingDashboard />);
  fireEvent.click(screen.getByText('Open setup'));
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('kit')).toBe('2');
  fireEvent.click(screen.getByText('Back to kitchen'));
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('section')).toBe('arrival-departure');
});
it('holds kitchen edits and retains the full destination after discard', () => {
  h.kitchenDirty = true; render(<ManagerBookingDashboard />);
  fireEvent.click(screen.getByText('Open setup'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.queryByText('Setup Second at 7')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Stay'));
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Open setup')); fireEvent.click(screen.getByText('Discard'));
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
});
it('holds dirty setup, blocks failed save, then returns with kitchen and section after successful save', async () => {
  h.setupDirty = true; render(<ManagerBookingDashboard />);
  fireEvent.click(screen.getByText('Open setup')); fireEvent.click(screen.getByText('Back to kitchen'));
  h.save.mockResolvedValue(false);
  await act(async () => fireEvent.click(screen.getByText('Save and leave')));
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  h.save.mockResolvedValue(true);
  await act(async () => fireEvent.click(screen.getByText('Save and leave')));
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('section')).toBe('arrival-departure');
});
it('waits for setup persistence before leaving', async () => {
  h.setupDirty = true;
  let finish!: (saved: boolean) => void;
  h.save.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
  render(<ManagerBookingDashboard />);
  fireEvent.click(screen.getByText('Open setup')); fireEvent.click(screen.getByText('Back to kitchen'));
  fireEvent.click(screen.getByText('Save and leave'));
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
  await act(async () => finish(true));
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
});
it('reloads a direct setup link in the second location and preserves its kitchen on return', () => {
  window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&kit=3&locationId=8');
  render(<ManagerBookingDashboard />);
  expect(screen.getByText('Setup Third at 8')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Back to kitchen'));
  expect(screen.getByText('Kitchen 3 at 8')).toBeInTheDocument();
  cleanup(); render(<ManagerBookingDashboard />);
  expect(screen.getByText('Kitchen 3 at 8')).toBeInTheDocument();
});
it('uses shared location context for a foreign kitchen ID instead of displaying that kitchen', () => {
  window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&kit=3&locationId=7');
  render(<ManagerBookingDashboard />);
  expect(screen.getByText('Setup shared at 7')).toBeInTheDocument();
  expect(screen.queryByText('Back to kitchen')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('breadcrumb').at(-1)).toHaveTextContent('setupUx.tasksStep');
});

it('holds dirty direct-tab instructions and their kitchen context on browser history navigation', async () => {
  h.kitchenDirty = true;
  render(<ManagerBookingDashboard />);
  act(() => {
    window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&kit=3&locationId=8');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('kit')).toBe('2');
  fireEvent.click(screen.getByText('Stay'));
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  act(() => {
    window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&kit=3&locationId=8');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  h.save.mockResolvedValueOnce(false);
  await act(async () => fireEvent.click(screen.getByText('Save and leave')));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  h.save.mockResolvedValueOnce(true);
  await act(async () => fireEvent.click(screen.getByText('Save and leave')));
  expect(screen.getByText('Setup Third at 8')).toBeInTheDocument();
});

it('holds dirty customer tasks on history return until save persists', async () => {
  window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&kit=2&locationId=7');
  h.setupDirty = true;
  let finish!: (saved: boolean) => void;
  h.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ManagerBookingDashboard />);
  act(() => {
    window.history.replaceState({}, '', '/manager/dashboard?view=kitchens&kit=2&locationId=7&section=arrival-departure');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Save and leave'));
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
  await act(async () => finish(true));
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('section')).toBe('arrival-departure');
});

it('guards location switching before changing task context or kitchen identity', () => {
  window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&kit=2&locationId=7');
  h.setupDirty = true;
  render(<ManagerBookingDashboard />);
  fireEvent.click(screen.getByText('Switch location'));
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('locationId')).toBe('7');
  fireEvent.click(screen.getByText('Stay'));
  fireEvent.click(screen.getByText('Switch location'));
  fireEvent.click(screen.getByText('Discard'));
  expect(screen.getByText('Setup shared at 8')).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('kit')).toBeNull();
});
it('resynchronizes kitchen and location when browser history changes context', () => {
  render(<ManagerBookingDashboard />);
  fireEvent.click(screen.getByText('Open setup'));
  act(() => { window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&kit=3&locationId=8'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(screen.getByText('Setup Third at 8')).toBeInTheDocument();
});

it('preserves the kitchen destination through failed then successful kitchen save-and-leave', async () => {
  h.kitchenDirty = true;
  render(<ManagerBookingDashboard />);
  fireEvent.click(screen.getByText('Open setup'));
  h.save.mockResolvedValue(false);
  await act(async () => fireEvent.click(screen.getByText('Save and leave')));
  expect(screen.getByText('Kitchen 2 at 7')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Open setup'));
  h.save.mockResolvedValue(true);
  await act(async () => fireEvent.click(screen.getByText('Save and leave')));
  expect(screen.getByText('Setup Second at 7')).toBeInTheDocument();
});

it('keeps a direct shared setup link without a kitchen usable and guarded on return', () => {
  window.history.replaceState({}, '', '/manager/dashboard?view=settings-checkin-checkout&locationId=7');
  h.setupDirty = true;
  render(<ManagerBookingDashboard />);
  expect(screen.getByText('Setup shared at 7')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Back to kitchen'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Discard'));
  expect(new URLSearchParams(window.location.search).get('view')).toBe('kitchens');
  expect(new URLSearchParams(window.location.search).get('kit')).toBeNull();
});
