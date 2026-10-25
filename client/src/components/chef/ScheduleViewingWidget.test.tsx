import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleViewingWidget from './ScheduleViewingWidget';

const session = vi.hoisted(() => ({ user: null as any, currentUser: null as any, loading: false, signup: vi.fn(), lookup: { state: 'new', methods: [] as string[] }, sendVerification: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { get currentUser() { return session.currentUser; } } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: session.user, loading: session.loading, refreshUserData: async () => {}, updateUserVerification: async () => {},
  signup: session.signup, logout: vi.fn(), sendSignInCode: vi.fn(async () => {}), signInWithEmailCode: vi.fn(), signInWithGoogle: vi.fn(), login: vi.fn() }) }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (callback: () => void) => callback(), gate: null }) }));
vi.mock('@/lib/login-challenge', () => ({ resolveAuthIdentifier: async () => session.lookup }));
vi.mock('@/lib/send-verification-email', () => ({ sendVerificationEmailWithFallback: session.sendVerification }));
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
  document.elementFromPoint = (() => null) as any; // input-otp (the sign-in code) measures the page
  localStorage.clear(); sessionStorage.clear(); session.user = null; session.currentUser = null; session.loading = false;
  session.signup.mockReset(); session.sendVerification.mockReset().mockResolvedValue({ channel: 'server' }); session.lookup = { state: 'new', methods: [] };
  window.history.replaceState({}, '', '/request-tour/2?kitchenId=4');
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
    // Two screens for everyone: the second screen always ends in Request tour.
    expect(send()).toHaveTextContent('Request tour');

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

  it('an older draft on the account step opens the second screen and never submits on verification', async () => {
    signIn('chef-a', false); saveDraft(answers, 'account', 'chef-a');
    const view = mount();
    expect(await screen.findByTestId('tour-request-submit')).toBeEnabled();
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

const held = { scheduledAt: slot.scheduledAt, chefNotes: 'See ovens', intakeData: answers };
type Route = (url: string, init?: any) => { ok?: boolean; body: unknown } | undefined;
function serve(route: Route) {
  vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
    const hit = route(String(url), init);
    return { ok: hit?.ok ?? true, json: async () => hit ? hit.body : String(url).includes('tour-draft') ? { draft: null } : null } as any;
  });
}
const calls = (part: string, method?: string) => vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).includes(part) && (!method || (init as any)?.method === method));

describe('signed-out tour request (one page, like Request to apply)', () => {
  function typeEmail(email: string) {
    const input = screen.getByLabelText('Email');
    fireEvent.change(input, { target: { value: email } });
    fireEvent.blur(input);
  }
  it('a new email asks name and mobile, one agreement, creates the account on send, holds the request, then sends it once verified', async () => {
    let draft: unknown = null;
    serve((url, init) => {
      if (url === '/api/viewings/tour-draft' && init?.method === 'PUT') { draft = JSON.parse(String(init.body)); return { body: { saved: true } }; }
      if (url.startsWith('/api/viewings/tour-draft/')) return { body: { draft: draft && held } };
      if (url === '/api/viewings/book') return { body: { id: 91 } };
    });
    session.signup.mockImplementation(async () => { signIn('new-chef', false); session.user.email = 'sam@example.com'; });
    const view = mount(); await reachIntake(); fillIntake();
    typeEmail('sam@example.com');
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sam Rivera' } });
    fireEvent.change(screen.getByLabelText('Mobile phone'), { target: { value: '709 555 0142' } });
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    expect(await screen.findByText('Agree to the terms to send your request.')).toBeInTheDocument();
    expect(session.signup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Local Cooks/ }));
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(session.signup).toHaveBeenCalledWith('sam@example.com', expect.any(String), 'Sam Rivera', 'chef', true, expect.stringContaining('709')));
    await waitFor(() => expect(draft).toMatchObject({ locationId: 2, targetedKitchenId: 4, scheduledAt: slot.scheduledAt, intakeData: answers }));
    view.rerenderKitchen();
    expect(await screen.findByText('Confirm your email to send your tour request')).toBeInTheDocument();
    expect(calls('/api/viewings/book')).toHaveLength(0);
    // The link is tapped (here or on another device): the saved copy waits for the chef to send it.
    signIn('new-chef', true); view.rerenderKitchen();
    expect(await screen.findByText('Your tour request is ready')).toBeInTheDocument();
    expect(calls('/api/viewings/book')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(calls('/api/viewings/book')).toHaveLength(1));
    expect(JSON.parse(String(calls('/api/viewings/book')[0][1]?.body))).toEqual({ fromDraft: true, locationId: 2, targetedKitchenId: 4 });
    await waitFor(() => expect(window.location.search).toBe('?view=viewings&viewing=91'));
  });

  it('an existing email signs in inline, with no agreement and no account step', async () => {
    session.lookup = { state: 'existing', methods: ['password'] };
    mount(); await reachIntake(); fillIntake();
    typeEmail('chef@example.com');
    expect(await screen.findByText('Welcome back.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /I agree to Local Cooks/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    expect(await screen.findByText('Sign in above to send your request.')).toBeInTheDocument();
    expect(session.signup).not.toHaveBeenCalled();
  });

  it('a signed-in account without a verified email gets a held request and a new link', async () => {
    serve((url, init) => url === '/api/viewings/tour-draft' && init?.method === 'PUT' ? { body: { saved: true } } : undefined);
    signIn('chef-a', false); mount(); await reachIntake(); fillIntake();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(calls('/api/viewings/tour-draft', 'PUT')).toHaveLength(1));
    expect(session.sendVerification).toHaveBeenCalledWith(expect.objectContaining({ email: 'chef@example.com', returnUrl: '/request-tour/2?kitchenId=4' }));
    expect(session.signup).not.toHaveBeenCalled();
  });

  it('a held request whose time was taken returns to day and time with the date and answers kept', async () => {
    serve(url => url.startsWith('/api/viewings/tour-draft/') ? { body: { draft: held } }
      : url === '/api/viewings/book' ? { ok: false, body: { code: 'SLOT_TAKEN' } } : undefined);
    signIn(); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('That time was just taken. Pick another time.')).toBeInTheDocument();
    await waitFor(() => expect(calls('/api/viewings/tour-draft/4', 'DELETE')).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { pressed: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByLabelText(START)).toHaveValue(answers.targetStartDate);
    expect(screen.getByLabelText(/Anything you want to see or ask/)).toHaveValue('See ovens');
  });

  it('a held request at a kitchen already toured is dropped and opens that tour with a notice', async () => {
    serve(url => url.startsWith('/api/viewings/tour-draft/') ? { body: { draft: held } }
      : url === '/api/viewings/book' ? { ok: false, body: { code: 'TOUR_REQUEST_BLOCKED', tourId: 95 } } : undefined);
    signIn(); saveDraft(answers, 'details', 'chef-a'); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(window.location.search).toBe('?view=viewings&viewing=95&notice=already'));
    await waitFor(() => expect(calls('/api/viewings/tour-draft/4', 'DELETE')).toHaveLength(1));
    expect(localStorage.getItem('viewing_booking_4')).toBeNull();
  });
});
