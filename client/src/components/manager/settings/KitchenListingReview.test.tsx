import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildListingChecklist, type KitchenReadinessReview } from '@shared/kitchen-listing-readiness';
import { kitchenListingReadinessKey } from '@/lib/manager-kitchens-navigation';
import KitchenListingReview from './KitchenListingReview';

vi.mock('@/lib/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-status-button', () => ({ useStatusButton: () => ({ status: 'idle', execute: vi.fn() }) }));
vi.mock('@/i18n/manager', async () => {
  const { default: words } = await import('@shared/i18n/locales/en-CA/manager.json');
  return { mt: (key: string, options: Record<string, unknown> = {}) =>
    ((words as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(options[name] ?? `{${name}}`)) };
});
afterEach(cleanup);

function show(notesSaved = true, storage = false) {
  const onNavigate = vi.fn();
  const review: KitchenReadinessReview = {
    checklist: buildListingChecklist({ hasDescription: true, hasRate: true, licenseApproved: true,
      hasAvailability: true, hasCoverPhoto: true, stripeConnected: true, hasApplicationRequirements: true,
      hasVisitSetup: notesSaved, hasBookingRules: true,
      hasGalleryImages: true, hasTerms: true, toursEnabled: false, hasEquipment: true, hasStorage: storage }),
    details: { kitchenName: 'Test Kitchen', locationName: 'Test Location', description: 'A kitchen',
      hourlyRateCents: 2500, dailyRateCents: null, extraTimeRateCents: null, coverPhotoUrl: 'cover.jpg', galleryImageCount: 1,
      availabilityDayCount: 7, licenseStatus: 'approved', stripeAccountId: 'acct_test',
      hasApplicationRequirements: true, termsUploadedAt: null, toursEnabled: false,
      cancellationPolicyHours: 24, dailyBookingLimit: 2, minimumBookingWindowHours: 1, minimumBookingHours: 1,
      visitSetup: { checkinEnabled: true, checkoutEnabled: true, arrivalNotesSaved: notesSaved, departureNotesSaved: notesSaved, arrivalRequirementCount: 0,
        departureRequirementCount: 0, checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 } },
    listingStatus: 'draft', adminHidden: false,
  };
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(kitchenListingReadinessKey(7), review);
  render(<QueryClientProvider client={client}><KitchenListingReview kitchenId={7} onNavigate={onNavigate} /></QueryClientProvider>);
  return onNavigate;
}

describe('listing review arrival/departure responsibilities', () => {
  it('keeps optional duties and listing status visible without the long workflow information card', () => {
    show();
    expect(screen.queryByText(/The chef checks in on arrival/)).not.toBeInTheDocument();
    expect(screen.queryByText('Kitchen booking arrival and departure')).not.toBeInTheDocument();
    expect(screen.getByText(/Required duties\/photos: 0 on arrival, 0 on departure/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List this kitchen' })).toBeEnabled();
  });

  it('takes an unmet kitchen switch to the reviewed kitchen, rather than another kitchen or shared duties', () => {
    const navigate = show(false);
    expect(screen.getByRole('button', { name: 'List this kitchen' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));
    expect(navigate).toHaveBeenCalledWith('kitchens', 7, 'arrival-departure');
  });

  it('takes missing shared stages to the same highlighted tracking card with the kitchen context', () => {
    const navigate = show(false);
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));
    expect(navigate).toHaveBeenCalledWith('kitchens', 7, 'arrival-departure');
  });
});

it('can list a ready kitchen while its storage is not configured', () => {
  show(true, true);
  expect(screen.queryByText('Storage arrival and departure setup')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'List this kitchen' })).toBeEnabled();
});
