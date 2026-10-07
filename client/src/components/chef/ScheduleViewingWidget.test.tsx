import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleViewingWidget from './ScheduleViewingWidget';

const session = vi.hoisted(() => ({ user: null as any, currentUser: null as any, loading: false }));
vi.mock('@/lib/firebase', () => ({ auth: { get currentUser() { return session.currentUser; } } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: session.user, loading: session.loading, refreshUserData: async () => {} }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/use-email-verification-guard', () => ({ useEmailVerificationGuard: () => ({ guard: (callback: () => void) => callback(), gate: null }) }));
vi.mock('@/components/auth/KitchenJourneyAuth', () => ({ default: () => <p>Account authentication</p> }));
vi.mock('@/components/kitchen-application/KitchenJourneyLayout', () => ({ default: ({ children }: any) => <div>{children}</div>, KitchenJourneySteps: () => null }));
vi.mock('@/components/kitchen-application/KitchenJourneyTimeSlot', () => ({ default: ({ onClick }: any) => <button onClick={onClick}>Choose slot</button> }));
vi.mock('@/components/ui/calendar', () => ({ Calendar: ({ onSelect }: any) => <button onClick={() => onSelect(new Date(2099, 9, 7))}>Choose date</button> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : key }) }));
vi.mock('@/i18n/chef-ns', () => ({ ct: (key: string) => key }));

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
  fireEvent.click(await screen.findByRole('button', { name: 'Choose slot' }));
  expect(screen.getByLabelText('What do you plan to use the kitchen for?')).toBeInTheDocument();
}
function fillIntake(notDecided = false) {
  fireEvent.change(screen.getByLabelText('What do you plan to use the kitchen for?'), { target: { value: 'meal_prep' } });
  fireEvent.change(screen.getByLabelText('About how many hours per week would you need?'), { target: { value: '11-20' } });
  fireEvent.click(screen.getByRole('radio', { name: 'No' }));
  if (notDecided) fireEvent.click(screen.getByRole('checkbox', { name: 'Not decided yet' }));
  else fireEvent.change(screen.getByLabelText('When would you like to start renting?'), { target: { value: answers.targetStartDate } });
}
function saveDraft(intakeData: any, step = 'confirm', ownerUid?: string) {
  localStorage.setItem('viewing_booking_4', JSON.stringify({ date: '2099-10-07T00:00:00Z', slot, step, chefNotes: 'See ovens', intakeData, ownerUid }));
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); session.user = null; session.currentUser = null; session.loading = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/book') ? {} : null })));
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });

describe('required tour intake', () => {
  it('requires descriptions for Other and restores custom answers after reload', async () => {
    signIn(); const view = mount(); await reachIntake(); fillIntake(true);
    fireEvent.change(screen.getByLabelText('What do you plan to use the kitchen for?'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('About how many hours per week would you need?'), { target: { value: 'other' } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    const descriptions = screen.getAllByLabelText('Please describe');
    fireEvent.change(descriptions[0], { target: { value: 'Recipe development' } });
    fireEvent.change(descriptions[1], { target: { value: 'Weekends, depending on orders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Recipe development')).toBeInTheDocument();
    expect(screen.getByText('Weekends, depending on orders')).toBeInTheDocument();
    view.unmount(); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit answers' }));
    expect(screen.getAllByRole('combobox').slice(0, 2).map(input => (input as HTMLSelectElement).value)).toEqual(['other', 'other']);
    expect(screen.getAllByLabelText('Please describe')[1]).toHaveValue('Weekends, depending on orders');
  });
  it.each(['guest', 'verified chef'])('requires explicit answers for %s after choosing a slot', async actor => {
    if (actor === 'verified chef') signIn();
    mount(); await reachIntake();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What do you plan to use the kitchen for?'), { target: { value: 'meal_prep' } });
    fireEvent.change(screen.getByLabelText('About how many hours per week would you need?'), { target: { value: '11-20' } });
    fireEvent.change(screen.getByLabelText('When would you like to start renting?'), { target: { value: answers.targetStartDate } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it.each([false, true])('submits the four answers, including No and date undecided=%s, only on confirmation', async notDecided => {
    signIn(); mount(); await reachIntake(); fillIntake(notDecided);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(false);
    fireEvent.click(screen.getByTestId('tour-request-submit'));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(true));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/viewings/book')!;
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({ intakeData: { ...answers, targetStartDate: notDecided ? 'not_decided' : answers.targetStartDate } });
    expect(await screen.findByText('Your tour request is pending. We’ll notify you when it’s confirmed or declined.')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText(/review it first|forwarded|sent for review|under review/i)).not.toBeInTheDocument();
  });

  it('retains guest answers through reload and verified auth handoff without automatically submitting', async () => {
    const view = mount(); await reachIntake(); fillIntake(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Account authentication')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('viewing_booking_4')!).intakeData.hasLicense).toBe(false));
    view.unmount(); signIn(); mount();
    expect(await screen.findByTestId('tour-request-submit')).toBeEnabled();
    expect(screen.getByText('Not decided yet')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/viewings/book')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Edit answers' }));
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Not decided yet' })).toBeChecked();
  });

  it('restores legacy confirmation with missing answers to intake', async () => {
    signIn(); saveDraft({}); mount();
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.queryByTestId('tour-request-submit')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit answers' }));
    fireEvent.change(screen.getByLabelText('What do you plan to use the kitchen for?'), { target: { value: 'other' } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
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
    expect(screen.getByLabelText('What do you plan to use the kitchen for?')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
  });

  it('retains answers when a slot is taken and another time is selected', async () => {
    signIn(); saveDraft(answers); mount();
    vi.mocked(fetch).mockImplementation(async (url: any) => ({ ok: !url.includes('/book'), json: async () => url.includes('/book') ? { code: 'SLOT_TAKEN' } : null }) as any);
    fireEvent.click(await screen.findByTestId('tour-request-submit'));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose slot' }));
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByLabelText('When would you like to start renting?')).toHaveValue(answers.targetStartDate);
  });
});
