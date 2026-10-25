import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleViewingWidget from './ScheduleViewingWidget';

const session = vi.hoisted(() => ({ user: null as any, currentUser: null as any, loading: false }));
vi.mock('@/lib/firebase', () => ({ auth: { get currentUser() { return session.currentUser; } } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: session.user, loading: session.loading, refreshUserData: async () => {} }) }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (callback: () => void) => callback(), gate: null }) }));
vi.mock('@/components/auth/KitchenJourneyAuth', () => ({ default: () => <p>Account authentication</p> }));
vi.mock('@/components/layout/Header', () => ({ default: () => null }));
vi.mock('@/layouts/chef-shell-context', () => ({ useIsChefShell: () => true }));
vi.mock('@/components/ui/calendar', () => ({ Calendar: ({ onSelect }: any) => <button onClick={() => onSelect(new Date(2099, 9, 7))}>Choose date</button> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue || key, i18n: { language: 'en-CA' } }) }));
vi.mock('@/i18n/chef-ns', () => ({ ct: (key: string) => key }));

vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange, disabled }: any) => <input id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> }));

const USE = 'What will you use the kitchen for?', HOURS = 'About how many hours a week?', START = 'When would you like to start?';
function choose(group: string, option: string) {
  fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('radio', { name: option }));
}

const slot = { scheduledAt: '2099-10-07T11:30:00Z', startTime: '11:30', endTime: '12:00' };
const answers = { intendedUse: 'meal_prep', estimatedWeeklyHours: '11-20', hasLicense: false, targetStartDate: '2099-11-01' };
const clients: QueryClient[] = [];
function signIn(uid = 'chef-a', verified = true) {
  session.user = { uid, email: 'chef@example.com', isVerified: verified };
  session.currentUser = { uid, emailVerified: verified, getIdToken: async () => 'token', reload: async () => {} };
}
function mount(kitchenId = 4) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => ({ slots: [slot], settings: null }) } } });
  clients.push(client);
  const element = (id: number) => <QueryClientProvider client={client}><ScheduleViewingWidget locationId={2} targetedKitchenId={id} presentation="page" /></QueryClientProvider>;
  const result = render(element(kitchenId));
  return { ...result, rerenderKitchen: (id = kitchenId) => result.rerender(element(id)) };
}
async function reachIntake() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
  const time = await screen.findByRole('button', { pressed: false });
  // Picking a date shows its times in place; picking a time selects it without moving on.
  expect(time).toHaveTextContent('9:00 a.m.');
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  fireEvent.click(time);
  expect(time).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/Wed, Oct 7 · 9:00.+9:30 a\.m\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('group', { name: USE })).toBeInTheDocument();
}
const send = () => screen.queryByTestId('tour-request-submit') ?? screen.getByRole('button', { name: 'Continue' });
function fillIntake(notDecided = false) {
  choose(USE, 'Meal preparation');
  choose(HOURS, '11–20');
  choose('Do you have a food handler certificate?', 'No');
  if (notDecided) fireEvent.click(screen.getByRole('checkbox', { name: 'Not decided yet' }));
  else fireEvent.change(screen.getByLabelText(START), { target: { value: answers.targetStartDate } });
}
function saveDraft(intakeData: any, step = 'confirm', ownerUid?: string) {
  localStorage.setItem('viewing_booking_4', JSON.stringify({ date: '2099-10-07T00:00:00Z', slot, step, chefNotes: 'See ovens', intakeData, ownerUid }));
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear(); sessionStorage.clear(); session.user = null; session.currentUser = null; session.loading = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/book') ? {} : null })));
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });

describe('required tour intake', () => {
  it('requires descriptions for Other and restores custom answers after reload', async () => {
    signIn(); const view = mount(); await reachIntake(); fillIntake(true);
    choose(USE, 'Other');
    choose(HOURS, 'Other');
    expect(send()).toBeDisabled();
    const descriptions = screen.getAllByLabelText('Please describe');
    fireEvent.change(descriptions[0], { target: { value: 'Recipe development' } });
    fireEvent.change(descriptions[1], { target: { value: 'Weekends, depending on orders' } });
    expect(send()).toBeEnabled();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('viewing_booking_4')!).intakeData.estimatedWeeklyHours).toBe('Weekends, depending on orders'));
    view.unmount(); mount();
    expect(await screen.findByTestId('tour-request-submit')).toBeEnabled();
    expect(within(screen.getByRole('group', { name: USE })).getByRole('radio', { name: 'Other' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: HOURS })).getByRole('radio', { name: 'Other' })).toBeChecked();
    expect(screen.getAllByLabelText('Please describe')[1]).toHaveValue('Weekends, depending on orders');
  });

  it.each(['guest', 'verified chef'])('requires explicit answers for %s after choosing a slot', async actor => {
    if (actor === 'verified chef') signIn();
    mount(); await reachIntake();
    expect(send()).toBeDisabled();
    choose(USE, 'Meal preparation');
    choose(HOURS, '11–20');
    fireEvent.change(screen.getByLabelText(START), { target: { value: answers.targetStartDate } });
    expect(send()).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
    choose('Do you have a food handler certificate?', 'No');
    expect(send()).toBeEnabled();
    expect(send()).toHaveTextContent(actor === 'guest' ? 'Continue' : 'Request tour');
  });

  it.each([false, true])('submits the four answers, including No and date undecided=%s, only on Request tour', async notDecided => {
    signIn(); mount(); await reachIntake(); fillIntake(notDecided);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(false);
    expect(screen.queryByText(/confirmation notification/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(true));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/viewings/book')!;
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({ intakeData: { ...answers, targetStartDate: notDecided ? 'not_decided' : answers.targetStartDate } });
    expect(await screen.findByText('Your tour request is pending. We’ll notify you when it’s confirmed or declined.')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText(/review it first|forwarded|sent for review|under review/i)).not.toBeInTheDocument();
  });

  it('Change returns to day and time keeping the date and time', async () => {
    signIn(); mount(); await reachIntake(); fillIntake();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('9:00 a.m.');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
  });

  it('retains guest answers through reload and verified auth handoff without automatically submitting', async () => {
    const view = mount(); await reachIntake(); fillIntake(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Account authentication')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('viewing_booking_4')!).intakeData.hasLicense).toBe(false));
    view.unmount(); signIn(); mount();
    expect(await screen.findByTestId('tour-request-submit')).toBeEnabled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(false);
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Not decided yet' })).toBeChecked();
  });

  it('restores a legacy confirmation draft with missing answers to the details screen', async () => {
    signIn(); saveDraft({}); mount();
    expect(await screen.findByTestId('tour-request-submit')).toBeDisabled();
  });

  it('waits for auth hydration before restoring an owned draft', async () => {
    saveDraft(answers, 'confirm', 'chef-a'); session.loading = true;
    const view = mount();
    // Even a slot selection before auth settles cannot overwrite the owned draft.
    await reachIntake();
    expect(JSON.parse(localStorage.getItem('viewing_booking_4')!).intakeData).toEqual(answers);
    signIn(); session.loading = false; view.rerenderKitchen();
    expect(await screen.findByTestId('tour-request-submit')).toBeEnabled();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(true));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/viewings/book')!;
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({ intakeData: answers, chefNotes: 'See ovens' });
    await waitFor(() => expect(localStorage.getItem('viewing_booking_4')).toBeNull());
    expect(sessionStorage.getItem('viewing_booking_4')).toBeNull();
  });

  it('keeps required answers while waiting for verification and never submits on verification', async () => {
    signIn('chef-a', false); saveDraft(answers, 'account', 'chef-a');
    const view = mount();
    expect(await screen.findByText('Account authentication')).toBeInTheDocument();
    signIn(); view.rerenderKitchen();
    expect(await screen.findByTestId('tour-request-submit')).toBeEnabled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(false);
    choose(USE, 'Other');
    expect(screen.getByTestId('tour-request-submit')).toBeDisabled();
  });

  it('does not restore another user’s answers or carry them to another kitchen', async () => {
    signIn('chef-b'); saveDraft(answers, 'confirm', 'chef-a');
    const view = mount(); expect(await screen.findByRole('button', { name: 'Choose date' })).toBeInTheDocument();
    await reachIntake(); fillIntake();
    view.rerenderKitchen(8);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose date' })).toBeInTheDocument());
    expect(localStorage.getItem('viewing_booking_8')).toBeNull();
  });

  it('drops the old user’s draft when the signed-in identity changes', async () => {
    signIn(); saveDraft(answers, 'confirm', 'chef-a');
    const view = mount(); expect(await screen.findByTestId('tour-request-submit')).toBeEnabled();
    signIn('chef-b'); view.rerenderKitchen();
    expect(await screen.findByRole('button', { name: 'Choose date' })).toBeInTheDocument();
    expect(screen.queryByTestId('tour-request-submit')).not.toBeInTheDocument();
    await reachIntake();
    expect(screen.getByRole('radio', { name: 'Meal preparation' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
  });

  it('returns to day and time with answers kept when a slot is taken', async () => {
    signIn(); saveDraft(answers); mount();
    vi.mocked(fetch).mockImplementation(async (url: any) => ({ ok: !url.includes('/book'), json: async () => url.includes('/book') ? { code: 'SLOT_TAKEN' } : null }) as any);
    fireEvent.click(await screen.findByTestId('tour-request-submit'));
    fireEvent.click(await screen.findByRole('button', { pressed: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByLabelText(START)).toHaveValue(answers.targetStartDate);
  });
});
