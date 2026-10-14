import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import locale from '../../../../shared/i18n/locales/en-CA/booking.json';
import { BookingFeedbackCard } from './BookingFeedbackCard';
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { uid: 'fixture', getIdToken: async () => 'token' } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string, params: any = {}) => {
  const value = key.split('.').reduce((obj: any, part) => obj?.[part], locale);
  return typeof value === 'string' ? value.replace(/\{(\w+)\}/g, (_: string, name: string) => String(params[name] ?? '')) : key;
} }) }));
const clients: QueryClient[] = [];
const initial = { available: true, response: null, requestedAt: '2026-10-01T12:00:00Z', closesAt: '2026-10-15T12:00:00Z' };
function mount(role: 'chef' | 'manager' = 'chef', data: any = initial, success = true) {
  let current = data;
  const fetcher = vi.fn(async (_url: string, options?: any) => {
    if (options?.method === 'POST' && success) current = { ...current, available: false, response: { id: 1, createdAt: '2026-10-02T12:00:00Z', ...JSON.parse(options.body) } };
    return { ok: options?.method === 'POST' ? success : true, json: async () => current };
  }); vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const view = render(<QueryClientProvider client={client}><BookingFeedbackCard bookingId={42} role={role} otherPartyName="Harbour Kitchen" timezone="America/St_Johns" /></QueryClientProvider>);
  return { fetcher, ...view };
}
afterEach(() => { cleanup(); clients.forEach(c => c.clear()); clients.length = 0; mobile.value = false; vi.unstubAllGlobals(); });
describe('private booking feedback card', () => {
  it('fetches its own private state, shows inline stars and submits optional chips and a trimmed note', async () => {
    const { fetcher } = mount();
    fireEvent.click(await screen.findByRole('radio', { name: '4 out of 5 stars' }));
    expect(screen.getByText("Only Local Cooks sees this. Harbour Kitchen won't see your answers.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clean and ready' }));
    fireEvent.change(screen.getByLabelText('Anything Local Cooks should know?'), { target: { value: '  Nice kitchen  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('Thanks — this helps us keep Local Cooks great.');
    expect(screen.getByText('Nice kitchen')).toBeInTheDocument();
    const call = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(call[0]).toBe('/api/bookings/42/feedback');
    expect(call[1]).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer token' } });
    expect(JSON.parse(call[1].body)).toEqual({ rating: 4, tags: ['clean_ready'], comment: 'Nice kitchen' });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
  it('uses manager endpoints and the manager chip allow-list', async () => {
    const { fetcher } = mount('manager'); fireEvent.click(await screen.findByRole('radio', { name: '5 out of 5 stars' }));
    expect(fetcher.mock.calls[0][0]).toBe('/api/manager/bookings/42/feedback');
    expect(screen.getByRole('button', { name: 'Left it clean' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clean and ready' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Anything Local Cooks should know?')).toHaveAttribute('maxlength', '1000');
  });
  it('moves ratings with arrow keys and retains forty-four-pixel targets', async () => {
    mount(); const star = await screen.findByRole('radio', { name: '1 out of 5 stars' });
    expect(star).toHaveClass('h-11', 'w-11'); fireEvent.keyDown(star, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: '2 out of 5 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '2 out of 5 stars' })).toHaveFocus();
  });
  it('renders nothing for an unanswered closed window', async () => {
    const { container, fetcher } = mount('chef', { ...initial, available: false });
    await waitFor(() => expect(fetcher).toHaveBeenCalled()); expect(container).toBeEmptyDOMElement();
  });
  it('shows only an immutable own answer after the window closes', async () => {
    mount('chef', { ...initial, available: false, response: { rating: 2, tags: ['not_clean'], comment: 'Own private answer', createdAt: '2026-10-02T12:00:00Z' }, responses: [{ comment: 'Other private answer' }] });
    await screen.findByText('Own private answer'); expect(screen.queryByText('Other private answer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send feedback' })).not.toBeInTheDocument();
    expect(screen.getByText(/You sent feedback on/)).toBeInTheDocument();
  });
  it('shows a mobile sheet after tapping a star', async () => {
    mobile.value = true; mount(); fireEvent.click(await screen.findByRole('radio', { name: '3 out of 5 stars' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Send feedback' })).toBeInTheDocument();
  });
  it('keeps the form and a localized error on failed submission', async () => {
    mount('chef', initial, false); fireEvent.click(await screen.findByRole('radio', { name: '4 out of 5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t send your feedback. Please try again.');
  });
  it('validates the note before making a submission request', async () => {
    const { fetcher } = mount(); fireEvent.click(await screen.findByRole('radio', { name: '4 out of 5 stars' }));
    fireEvent.change(screen.getByLabelText('Anything Local Cooks should know?'), { target: { value: 'x'.repeat(1001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your feedback answers and try again.');
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
});
