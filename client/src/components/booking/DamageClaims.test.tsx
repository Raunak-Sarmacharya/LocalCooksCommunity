import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => { const { useBookingTranslation } = await import('@/test/booking-i18n'); return { useTranslation: (ns: any) => useBookingTranslation(ns) }; });
const state = vi.hoisted(() => ({ context: {} as any, bodies: [] as any[], claims: [] as any[], confirm: vi.fn() }));
vi.mock('@/hooks/useSessionFileUpload', () => ({ useSessionFileUpload: () => ({ isUploading: false, uploadFile: async (file: File) => ({ success: true, url: `https://example.invalid/${file.name}` }) }) }));
vi.mock('@/lib/api', () => ({ apiClient: {
  get: async (path: string) => new Response(JSON.stringify(path.includes('filing-context') ? state.context : path.includes('booking-hold')
    ? { held: true, claims: [{ id: 1, bookingId: 7, kitchenName: 'Maya’s kitchen' }] } : { claims: state.claims })),
  post: async (path: string, body: any) => { state.bodies.push({ path, body });
    return new Response(JSON.stringify(path.endsWith('/pay') ? { clientSecret: 'mock_secret', hasSavedCard: true, card: { brand: 'visa', last4: '4242' } }
      : { success: true }), { status: 200 }); },
} }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock('@stripe/react-stripe-js', () => ({ Elements: ({ children }: any) => children, CardElement: () => <div>Card entry</div>,
  useElements: () => ({ getElement: () => ({}) }), useStripe: () => ({ confirmCardPayment: state.confirm }) }));
import { DamageClaimSheet } from './DamageClaimSheet';
import { ClaimEvidence, DamageClaimCard, DamageClaimBookingHoldBanner } from './DamageClaimCards';
import DamageClaimPayment from './DamageClaimPayment';
import { DamageClaimPanel } from '@/components/admin/booking-support/DamageClaimPanel';
import { DamageClaimQueue } from '@/components/manager/damage-claims/DamageClaimQueue';
import type { DamageClaimCardData } from '@/lib/damage-claims';
const claim = (extra: Partial<DamageClaimCardData> = {}): DamageClaimCardData => ({ id: 1, referenceCode: 'DC-ONE', bookingId: 7, visitId: 9, chefId: 5, managerId: 2,
  status: 'submitted', claimVersion: 2, description: 'Tray broken during the visit.', amountCents: 2000, claimedAmountCents: 2000, lines: [],
  visitEvidence: { before: [], after: [], checkinNotes: '', checkoutNotes: '', timezone: 'America/St_Johns', endedAt: '2026-10-14T18:00:00Z', kitchenName: 'Maya’s kitchen' },
  chefResponse: null, deadline: '2026-10-17T18:00:00Z', upheldAt: null, publicMessage: null, kitchenPaid: false, fundedBy: 'chef', chefOwes: true,
  chefVisible: true, reviewRequest: null, kitchenReply: null, paymentBusy: false, compensationPending: false, evidence: [], history: [], ...extra });
const mount = (element: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{element}</QueryClientProvider>);
beforeEach(() => { state.bodies = []; state.claims = []; state.context = { allowed: true, deadline: '2026-10-17T18:00:00Z', endedAt: '2026-10-14T18:00:00Z',
  timezone: 'America/St_Johns', kitchenName: 'Maya’s kitchen', before: [], after: [] }; state.confirm.mockReset(); state.confirm.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_mock'); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('manager guided filing', () => {
  it('requires a document per cost and sends only after the review-first consequence screen', async () => {
    mount(<DamageClaimSheet bookingId={7} visitId={9} chefName="Sam" />);
    fireEvent.click(screen.getByRole('button', { name: 'Report damage or extra cleaning' }));
    fireEvent.change(await screen.findByLabelText('What happened?'), { target: { value: 'Tray broken during the visit.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('What does this cost cover?'), { target: { value: 'Replace tray' } });
    fireEvent.change(screen.getByLabelText('Amount (CAD)'), { target: { value: '20' } });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Receipt, invoice or quote (required)'), { target: { files: [new File(['quote'], 'quote.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Local Cooks reviews this before contacting Sam/)).toBeInTheDocument();
    expect(screen.getByText(/Your payout for this booking isn’t affected/)).toBeInTheDocument();
    expect(state.bodies).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Local Cooks' }));
    await waitFor(() => expect(state.bodies).toHaveLength(1));
    expect(state.bodies[0]).toMatchObject({ path: '/manager/damage-claims/file', body: { bookingId: 7, visitId: 9, lines: [{ amountCents: 2000, document: { fileName: 'quote.pdf' } }] } });
  });
  it('amounts over the cap open a prefilled support case and never file a money claim', async () => {
    mount(<DamageClaimSheet bookingId={7} chefName="Sam" />); fireEvent.click(screen.getByRole('button', { name: 'Report damage or extra cleaning' }));
    fireEvent.change(await screen.findByLabelText('What happened?'), { target: { value: 'Repair an expensive damaged oven.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('What does this cost cover?'), { target: { value: 'Oven repair' } });
    fireEvent.change(screen.getByLabelText('Amount (CAD)'), { target: { value: '300' } });
    expect(screen.getByText('For amounts over $250, Local Cooks handles it with you.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Contact Local Cooks' }));
    await waitFor(() => expect(state.bodies).toHaveLength(1));
    expect(state.bodies[0].path).toBe('/manager/damage-claims/support'); expect(state.bodies[0].body.description).toContain('Oven repair: 300 CAD');
  });
  it('uses the storage filing-context and file endpoints when storageRentalId is set', async () => {
    state.context = { ...state.context, noBaseline: true, before: ['https://example.invalid/before.jpg'], after: ['https://example.invalid/after.jpg'] };
    const { testI18n } = await import('@/test/booking-i18n');
    const storage = (await import('@shared/i18n/locales/en-CA/storage.json')).default;
    testI18n.addResourceBundle('en-CA', 'storage', storage);
    mount(<DamageClaimSheet storageRentalId={43} chefName="Sam" />);
    fireEvent.click(screen.getByRole('button', { name: 'Report damage or extra cleaning' }));
    expect(await screen.findByText('No move-in photos were taken.')).toBeInTheDocument();
    expect(screen.getByText(/move-in and move-out photos and notes are attached automatically/)).toBeInTheDocument();
    expect(screen.getByText('At move-in')).toBeInTheDocument();
    expect(screen.getByText('At move-out')).toBeInTheDocument();
    expect(screen.queryByText('At arrival')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Shelf dented during the rental.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('What does this cost cover?'), { target: { value: 'Replace shelf' } });
    fireEvent.change(screen.getByLabelText('Amount (CAD)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Receipt, invoice or quote (required)'), { target: { files: [new File(['quote'], 'quote.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Local Cooks' }));
    await waitFor(() => expect(state.bodies).toHaveLength(1));
    expect(state.bodies[0]).toMatchObject({
      path: '/manager/storage-rentals/43/claims',
      body: { lines: [{ amountCents: 2000, document: { fileName: 'quote.pdf' } }] },
    });
    expect(state.bodies[0].body.bookingId).toBeUndefined();
    expect(state.bodies[0].body.storageRentalId).toBeUndefined();
  });
});
describe('chef response and kitchen reply', () => {
  it('shows the kitchen-local deadline, Pay/Dispute, and requires a dispute note', async () => {
    mount(<DamageClaimCard claim={claim()} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pay $20.00' })).toBeInTheDocument();
    expect(screen.getByText(/3:30\s?p\.m\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    expect(screen.getByRole('button', { name: 'Send dispute' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why do you disagree?'), { target: { value: 'It was cracked when I arrived.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send dispute' }));
    await waitFor(() => expect(state.bodies[0]).toMatchObject({ path: '/chef/damage-claims/1/dispute', body: { note: 'It was cracked when I arrived.', photos: [] } }));
  });
  it('a kitchen review request has a reply/upload instead of chef payment controls', async () => {
    mount(<DamageClaimCard manager claim={claim({ status: 'awaiting_kitchen', chefVisible: false, reviewRequest: 'Please add a replacement quote.' })} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Pay $20.00' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reply to Local Cooks' }));
    fireEvent.change(screen.getByLabelText('What would you like Local Cooks to know?'), { target: { value: 'Here is the replacement quote.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(state.bodies[0].path).toBe('/manager/damage-claims/1/review-reply'));
  });
  it('names the saved card and charges nothing until Pay; then confirms on-session and verifies on the server', async () => {
    const paid = vi.fn(); mount(<DamageClaimPayment claim={claim()} onClose={vi.fn()} onPaid={paid} />);
    const button = await screen.findByRole('button', { name: 'Pay $20.00 with Visa •••• 4242' });
    expect(state.confirm).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(paid).toHaveBeenCalled());
    expect(state.confirm).toHaveBeenCalledWith('mock_secret', {});
    expect(state.bodies.map(item => item.path)).toEqual(['/chef/damage-claims/1/pay', '/chef/damage-claims/1/sync']);
  });
  it('does not repeat the pause banner where the page already shows it with a Pay button (QA walk Oct 28)', async () => {
    for (const path of ['/book/47', '/booking/7']) {
      window.history.pushState({}, '', path);
      const view = mount(<DamageClaimBookingHoldBanner />);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(screen.queryByTestId('claim-booking-hold')).toBeNull();
      view.unmount();
    }
    window.history.pushState({}, '', '/dashboard');
    mount(<DamageClaimBookingHoldBanner />);
    expect(await screen.findByTestId('claim-booking-hold')).toBeInTheDocument();
  });
  it('explains the booking hold and preserves existing bookings', async () => {
    mount(<DamageClaimBookingHoldBanner />);
    expect(await screen.findByText(/You have an unpaid charge from Maya’s kitchen/)).toBeInTheDocument();
    expect(screen.getByText('Your existing bookings are unchanged.')).toBeInTheDocument();
  });
  it('lets the chef change cards on the payment screen after bank confirmation fails', async () => {
    state.confirm.mockResolvedValueOnce({ error: { message: 'Please use another card.' } });
    mount(<DamageClaimPayment claim={claim()} onClose={vi.fn()} onPaid={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $20.00 with Visa •••• 4242' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please use another card.');
    fireEvent.click(screen.getByRole('button', { name: 'Use another card' }));
    expect(await screen.findByText('Card entry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay $20.00' }));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(2));
    expect(state.bodies.map(item => item.path)).toContain('/chef/damage-claims/1/cancel-payment');
    expect(state.bodies.findLast(item => item.path.endsWith('/pay')).body.newCard).toBe(true);
    expect(state.confirm.mock.calls[1][1]).toEqual({ payment_method: { card: {} } });
  });
});
describe('admin review-first panel', () => {
  it('shows side-by-side evidence and first-review actions; requires private and shared reasons before sending a reduced amount', async () => {
    state.claims = [claim({ status: 'in_review', chefVisible: false })];
    mount(<DamageClaimPanel bookingId={7} />);
    expect(await screen.findByText('The chef hasn’t been contacted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to chef' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uphold', exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send to chef' }));
    expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled();
    expect(screen.getByText(/To save, add a reason, an internal note \(at least 10 characters\),? and a message/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Approved amount (CAD, up to $250)'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'receipt' } });
    fireEvent.change(screen.getByLabelText('Internal note (staff only)'), { target: { value: 'Internal evidence review completed.' } });
    fireEvent.change(screen.getByLabelText('Message to the kitchen'), { target: { value: 'The receipt supports a reduced amount of $15.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
    await waitFor(() => expect(state.bodies[0]).toMatchObject({ path: '/admin/booking-support/7/claims/actions', body: {
      type: 'claim_send', amountCents: 1500, reasonCode: 'receipt', note: 'Internal evidence review completed.', publicMessage: 'The receipt supports a reduced amount of $15.' } }));
  });
  it('offers final decision actions after dispute without a first-review send action', async () => {
    state.claims = [claim({ status: 'under_review', chefResponse: 'It was broken at arrival.' })];
    mount(<DamageClaimPanel bookingId={7} />);
    expect(await screen.findByRole('button', { name: 'Uphold', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reduce and uphold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to chef' })).not.toBeInTheDocument();
    expect(screen.getByText('It was broken at arrival.')).toBeInTheDocument();
  });
});

it('shows the missing move-in photo note in the shared chef and staff evidence view', async () => {
  const { testI18n } = await import('@/test/booking-i18n');
  const storage = (await import('@shared/i18n/locales/en-CA/storage.json')).default;
  testI18n.addResourceBundle('en-CA', 'storage', storage);
  const value = claim(); value.visitEvidence = { ...value.visitEvidence!, noBaseline: true, baselineNote: 'No move-in photos were taken.' };
  mount(<ClaimEvidence claim={value} />);
  expect(screen.getByText('No move-in photos were taken.')).toBeInTheDocument();
});

describe('tracking claims', () => {
  it('each claim names its booking, day, chef and filing date, linking to the booking', () => {
    mount(<DamageClaimCard manager claim={claim({ bookingReference: 'KB-7DWHMT', day: { number: 1, total: 2, date: '2026-10-18' }, createdAt: '2026-10-18T23:30:00Z',
      visitEvidence: { ...claim().visitEvidence!, chefName: 'Sam Chef' } })} onChanged={() => {}} />);
    const line = screen.getByTestId('claim-context');
    expect(line).toHaveTextContent(/KB-7DWHMT · Day 1 of 2 · Sun, Oct 18 · Sam Chef · Filed Oct 18 · DC-ONE/);
    expect(screen.getByRole('link', { name: 'KB-7DWHMT' })).toHaveAttribute('href', '/manager/booking/7');
  });
  it('the kitchen claims page lists open claims first, then closed ones', async () => {
    state.claims = [claim({ id: 1, status: 'resolved' }), claim({ id: 2, status: 'submitted' }), claim({ id: 3, status: 'in_review' })];
    mount(<DamageClaimQueue />);
    expect(await screen.findByTestId('claims-open')).toHaveTextContent('Open (2)');
    expect(screen.getByTestId('claims-closed')).toHaveTextContent('Closed (1)');
  });
});
