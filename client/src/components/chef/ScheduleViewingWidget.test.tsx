import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleViewingWidget from './ScheduleViewingWidget';

const session = vi.hoisted(() => ({ user: null as any, currentUser: null as any, loading: false, signup: vi.fn(), lookup: { state: 'new', methods: [] as string[] },
  sendSignUpCode: vi.fn(), signUpWithEmailCode: vi.fn(), sendSignInCode: vi.fn(), signInWithEmailCode: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { get currentUser() { return session.currentUser; } } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: session.user, loading: session.loading, refreshUserData: async () => {}, updateUserVerification: async () => {},
  signup: session.signup, logout: vi.fn(), sendSignInCode: session.sendSignInCode, signInWithEmailCode: session.signInWithEmailCode, signInWithGoogle: vi.fn(), login: vi.fn(),
  sendSignUpCode: session.sendSignUpCode, signUpWithEmailCode: session.signUpWithEmailCode }) }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (callback: () => void) => callback(), gate: null }) }));
vi.mock('@/lib/login-challenge', () => ({ resolveAuthIdentifier: async () => session.lookup }));
vi.mock('@/components/layout/Header', () => ({ default: () => null }));
vi.mock('@/layouts/chef-shell-context', () => ({ useIsChefShell: () => true }));
vi.mock('@/components/ui/calendar', () => ({ Calendar: ({ onSelect }: any) => <button onClick={() => onSelect(new Date(2099, 9, 7))}>Choose date</button> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue || key, i18n: { language: 'en-CA' } }) }));
vi.mock('@/i18n/chef-ns', () => ({ ct: (key: string) => key }));

vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange, disabled }: any) => <input id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> }));

// Required labels carry an aria-hidden "*": the accessible name drops it, label text keeps it.
const USE = 'What will you use the kitchen for?', HOURS = 'About how many hours a week?', START = /^When would you like to start\?/;
const bookCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/viewings/book');
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
  session.lookup = { state: 'new', methods: [] };
  for (const mock of [session.signup, session.sendSignUpCode, session.signUpWithEmailCode, session.sendSignInCode, session.signInWithEmailCode]) mock.mockReset().mockResolvedValue(undefined);
  window.history.replaceState({}, '', '/request-tour/2?kitchenId=4');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/book') ? {} : null })));
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });

describe('required tour intake', () => {
  it('requires descriptions for Other and restores custom answers after reload', async () => {
    signIn(); const view = mount(); await reachIntake(); fillIntake(true);
    choose(USE, 'Other');
    choose(HOURS, 'Other');
    // Send stays pressable and names what's missing (owner, Oct 26).
    fireEvent.click(send());
    expect(screen.getByText('Choose what you’ll use the kitchen for.')).toBeInTheDocument();
    expect(screen.getByText('Choose about how many hours a week.')).toBeInTheDocument();
    expect(bookCalls()).toHaveLength(0);
    const descriptions = screen.getAllByLabelText('Please describe');
    fireEvent.change(descriptions[0], { target: { value: 'Recipe development' } });
    fireEvent.change(descriptions[1], { target: { value: 'Weekends, depending on orders' } });
    expect(screen.queryByText('Choose what you’ll use the kitchen for.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose about how many hours a week.')).not.toBeInTheDocument();
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
    expect(send()).toBeEnabled();
    choose(USE, 'Meal preparation');
    choose(HOURS, '11–20');
    fireEvent.change(screen.getByLabelText(START), { target: { value: answers.targetStartDate } });
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
    fireEvent.click(send());
    expect(screen.getByText('Choose Yes or No.')).toBeInTheDocument();
    expect(screen.queryByText('Choose what you’ll use the kitchen for.')).not.toBeInTheDocument();
    expect(bookCalls()).toHaveLength(0);
    choose('Do you have a food handler certificate?', 'No');
    expect(screen.queryByText('Choose Yes or No.')).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByTestId('tour-request-submit'));
    expect(screen.getByText('Pick a start date, or tick Not decided yet.')).toBeInTheDocument();
    expect(bookCalls()).toHaveLength(0);
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
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    expect(screen.getByText('Choose what you’ll use the kitchen for.')).toBeInTheDocument();
    expect(bookCalls()).toHaveLength(0);
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

type Route = (url: string, init?: any) => { ok?: boolean; body: unknown } | undefined;
function serve(route: Route) {
  vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
    const hit = route(String(url), init);
    return { ok: hit?.ok ?? true, json: async () => hit ? hit.body : null } as any;
  });
}
const typeCode = (code: string) => fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: code } });

describe('tour request without a confirmed email (code first, owner Oct 26)', () => {
  function typeEmail(email: string) {
    const input = screen.getByLabelText(/^Email/);
    fireEvent.change(input, { target: { value: email } });
    fireEvent.blur(input);
  }
  async function newChefReady() {
    mount(); await reachIntake(); fillIntake();
    typeEmail('sam@example.com');
    fireEvent.change(await screen.findByLabelText(/^Full name/), { target: { value: 'Sam Rivera' } });
    fireEvent.change(screen.getByLabelText(/^Mobile phone/), { target: { value: '709 555 0142' } });
  }

  it('a new email: Send emails a code; the account is created only after the code, then the request goes at once', async () => {
    serve(url => url === '/api/viewings/book' ? { body: { id: 91 } } : undefined);
    session.signUpWithEmailCode.mockImplementation(async () => { signIn('new-chef', true); session.user.email = 'sam@example.com'; });
    await newChefReady();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    expect(await screen.findByText('Agree to the terms to send your request.')).toBeInTheDocument();
    expect(session.sendSignUpCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Local Cooks/ }));
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(session.sendSignUpCode).toHaveBeenCalledWith('sam@example.com', 'en-CA', { fullName: 'Sam Rivera', phone: expect.stringContaining('709') }));
    // Nothing exists yet: no account, no saved request, nothing sent.
    expect(await screen.findByTestId('email-code-step')).toHaveTextContent('Then we create your account and send your request.');
    expect(session.signup).not.toHaveBeenCalled();
    expect(session.signUpWithEmailCode).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('draft'))).toBe(false);
    expect(bookCalls()).toHaveLength(0);
    typeCode('123456');
    await waitFor(() => expect(session.signUpWithEmailCode).toHaveBeenCalledWith(expect.objectContaining({
      email: 'sam@example.com', code: '123456', fullName: 'Sam Rivera', phone: expect.stringContaining('709'), termsAccepted: true })));
    await waitFor(() => expect(bookCalls()).toHaveLength(1));
    expect(JSON.parse(String(bookCalls()[0][1]?.body))).toMatchObject({ locationId: 2, targetedKitchenId: 4, scheduledAt: slot.scheduledAt, intakeData: answers });
    await waitFor(() => expect(window.location.search).toBe('?view=viewings&viewing=91'));
  });

  it('a wrong code says so and creates nothing; Change details returns to the filled form', async () => {
    session.signUpWithEmailCode.mockRejectedValue(new Error('code-wrong'));
    await newChefReady();
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Local Cooks/ }));
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await screen.findByTestId('email-code-step');
    typeCode('000000');
    expect(await screen.findByText('That code isn’t right. Try again.')).toBeInTheDocument();
    expect(bookCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Change details' }));
    expect(screen.queryByTestId('email-code-step')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Sam Rivera');
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
  });

  it('an address that already has an account is not sent a sign-up code', async () => {
    session.sendSignUpCode.mockRejectedValue(new Error('account-exists'));
    await newChefReady();
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Local Cooks/ }));
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    expect(await screen.findByText('This email already has an account. Re-enter it above to sign in.')).toBeInTheDocument();
    expect(screen.queryByTestId('email-code-step')).not.toBeInTheDocument();
  });

  it('a mobile number already on another account is named before any code is sent', async () => {
    session.sendSignUpCode.mockRejectedValue(Object.assign(new Error('Phone number already registered'), { code: 'PHONE_EXISTS' }));
    await newChefReady();
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Local Cooks/ }));
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    // Under the phone field itself (the chef is at the send button, far from any page-level message).
    expect(await screen.findByText(/This number is already on another Local Cooks account/)).toHaveAttribute('id', 'rd-phone-error');
    expect(screen.getByLabelText(/^Mobile phone/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('email-code-step')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Mobile phone/), { target: { value: '709 555 0199' } });
    expect(screen.queryByText(/This number is already on another Local Cooks account/)).not.toBeInTheDocument();
  });

  it('an existing email signs in inline, with no agreement and no account step', async () => {
    session.lookup = { state: 'existing', methods: ['password'] };
    mount(); await reachIntake(); fillIntake();
    typeEmail('chef@example.com');
    expect(await screen.findByText('Welcome back.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /I agree to Local Cooks/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    expect(await screen.findByText('Sign in above to send your request.')).toBeInTheDocument();
    expect(session.sendSignUpCode).not.toHaveBeenCalled();
  });

  it('a signed-in account without a confirmed email gets a code to its own address, then the request goes', async () => {
    serve(url => url === '/api/viewings/book' ? { body: { id: 92 } } : undefined);
    session.signInWithEmailCode.mockImplementation(async () => signIn('chef-a', true));
    signIn('chef-a', false); mount(); await reachIntake(); fillIntake();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(session.sendSignInCode).toHaveBeenCalledWith('chef@example.com'));
    expect(await screen.findByTestId('email-code-step')).toHaveTextContent('to confirm it and send your request');
    expect(session.sendSignUpCode).not.toHaveBeenCalled();
    typeCode('654321');
    await waitFor(() => expect(session.signInWithEmailCode).toHaveBeenCalledWith('chef@example.com', '654321'));
    await waitFor(() => expect(bookCalls()).toHaveLength(1));
  });

  it('a kitchen already toured opens that tour with a notice', async () => {
    serve(url => url === '/api/viewings/book' ? { ok: false, body: { code: 'TOUR_REQUEST_BLOCKED', tourId: 95 } } : undefined);
    signIn(); mount(); await reachIntake(); fillIntake();
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(window.location.search).toBe('?view=viewings&viewing=95&notice=already'));
    expect(localStorage.getItem('viewing_booking_4')).toBeNull();
  });
});
