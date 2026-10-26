import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as any, lookup: { state: 'new', methods: [] as string[] },
  sendSignUpCode: vi.fn(), signUpWithEmailCode: vi.fn(), sendSignInCode: vi.fn(), signInWithEmailCode: vi.fn(), login: vi.fn(), form: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { get currentUser() { return session.user ? { getIdToken: async () => 'token' } : null; } } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: session.user, refreshUserData: async () => {}, logout: vi.fn(), signInWithGoogle: vi.fn(),
  login: session.login, sendSignInCode: session.sendSignInCode, signInWithEmailCode: session.signInWithEmailCode,
  sendSignUpCode: session.sendSignUpCode, signUpWithEmailCode: session.signUpWithEmailCode }) }));
vi.mock('@/lib/login-challenge', () => ({ resolveAuthIdentifier: async () => session.lookup }));
vi.mock('@/layouts/chef-shell-context', () => ({ useIsChefShell: () => true }));
vi.mock('@/components/layout/Header', () => ({ default: () => null }));
vi.mock('./PreferredDaysPicker', () => ({ PreferredDaysPicker: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === 'string' ? options : options?.defaultValue?.replace(/\{(\w+)\}/g, (_: string, name: string) => options[name]) || key, i18n: { language: 'en-CA' } }) }));
// The application form is its own tested unit: here it only shows "Your details" and hands over its FormData.
vi.mock('./KitchenApplicationForm', () => ({ default: (props: any) => { session.form(props); return <div>
  {props.onePage.details}
  <button type="button" onClick={() => { const data = new FormData(); data.append('locationId', '4'); return props.onePage.submit ? props.onePage.submit(data) : props.onSuccess(); }}>Send request</button>
</div>; } }));
import { RequestToCookPage } from './RequestToCookPage';
import { RequestDetails } from './RequestDetails';

const location = { id: 4, name: 'Harbour Kitchen', address: 'Water St' };
let client: QueryClient;
function mount(emailVerified = false) {
  const onSent = vi.fn();
  render(<QueryClientProvider client={client}><RequestToCookPage location={location} kitchenId={null} emailVerified={emailVerified} onCancel={vi.fn()} onSent={onSent} /></QueryClientProvider>);
  return onSent;
}
async function fillNewChef() {
  const email = screen.getByLabelText(/^Email/);
  fireEvent.change(email, { target: { value: 'sam@example.com' } }); fireEvent.blur(email);
  fireEvent.change(await screen.findByLabelText(/^Full name/), { target: { value: 'Sam Rivera' } });
  fireEvent.change(screen.getByLabelText(/^Mobile phone/), { target: { value: '709 555 0142' } });
}
const posts = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/firebase/chef/kitchen-applications');

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.elementFromPoint = (() => null) as any; // input-otp measures the page
  session.user = null; session.lookup = { state: 'new', methods: [] }; session.form.mockClear();
  for (const mock of [session.sendSignUpCode, session.signUpWithEmailCode, session.sendSignInCode, session.signInWithEmailCode, session.login]) mock.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

describe('Request to apply without a confirmed email (code first, owner Oct 26)', () => {
  it('a new email gets a code; only after it is the account created and the request sent, with the same form data', async () => {
    session.signUpWithEmailCode.mockImplementation(async () => { session.user = { uid: 'new-chef', email: 'sam@example.com' }; });
    const onSent = mount();
    await fillNewChef();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(session.sendSignUpCode).toHaveBeenCalledWith('sam@example.com', 'en-CA', { fullName: 'Sam Rivera', phone: expect.stringContaining('709') }));
    expect(await screen.findByTestId('email-code-step')).toBeInTheDocument();
    expect(session.signUpWithEmailCode).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('draft'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '123456' } });
    await waitFor(() => expect(session.signUpWithEmailCode).toHaveBeenCalledWith(expect.objectContaining({ email: 'sam@example.com', code: '123456', fullName: 'Sam Rivera', termsAccepted: true })));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0][1]!.body as FormData).get('locationId')).toBe('4');
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it('a refused request after the code shows the kitchen’s reason and does not report it as sent', async () => {
    session.signUpWithEmailCode.mockImplementation(async () => { session.user = { uid: 'new-chef', email: 'sam@example.com' }; });
    vi.mocked(fetch).mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'You have already applied to this kitchen.' }) }) as any);
    const onSent = mount();
    await fillNewChef();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByTestId('email-code-step');
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '123456' } });
    expect(await screen.findByText('You have already applied to this kitchen.')).toBeInTheDocument();
    expect(onSent).not.toHaveBeenCalled();
  });

  it('a signed-in chef with a confirmed email sends through the form as usual (no code)', () => {
    session.user = { uid: 'chef-a', email: 'chef@example.com' };
    const onSent = mount(true);
    expect(session.form.mock.calls.at(-1)?.[0].onePage.submit).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(onSent).toHaveBeenCalled();
    expect(session.sendSignInCode).not.toHaveBeenCalled();
  });
});

describe('Your details', () => {
  it('marks the required fields for the eye and for screen readers', async () => {
    render(<RequestDetails showErrors={false} onChange={vi.fn()} />);
    const email = screen.getByLabelText(/^Email/);
    expect(email).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('*', { selector: 'label[for="rd-email"] span' })).toHaveAttribute('aria-hidden');
    fireEvent.change(email, { target: { value: 'sam@example.com' } }); fireEvent.blur(email);
    expect(await screen.findByLabelText(/^Full name/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^Mobile phone/)).toHaveAttribute('aria-required', 'true');
  });

  it('an existing email gets no code until the visitor asks for one (owner, Oct 26)', async () => {
    session.lookup = { state: 'existing', methods: ['password', 'google'] };
    render(<RequestDetails showErrors={false} onChange={vi.fn()} />);
    const email = screen.getByLabelText(/^Email/);
    fireEvent.change(email, { target: { value: 'chef@example.com' } }); fireEvent.blur(email);
    const ask = await screen.findByRole('button', { name: 'Email me a code' });
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
    expect(session.sendSignInCode).not.toHaveBeenCalled();
    fireEvent.click(ask);
    await waitFor(() => expect(session.sendSignInCode).toHaveBeenCalledWith('chef@example.com'));
    expect(session.sendSignInCode).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Sign-in code')).toBeInTheDocument();
  });

  it('a kitchen account email is turned away before any code is sent', async () => {
    session.lookup = { state: 'existing', methods: ['password'], portalAllowed: false } as any;
    render(<RequestDetails showErrors={false} onChange={vi.fn()} />);
    const email = screen.getByLabelText(/^Email/);
    fireEvent.change(email, { target: { value: 'manager@example.com' } }); fireEvent.blur(email);
    expect(await screen.findByText(/used for a kitchen account/)).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('button', { name: 'Email me a code' })).not.toBeInTheDocument();
    expect(session.sendSignInCode).not.toHaveBeenCalled();
  });

  it('signing in with a password inside the request form never submits the request form', async () => {
    session.lookup = { state: 'existing', methods: ['password'] };
    const outerSubmit = vi.fn((event: any) => event.preventDefault());
    render(<form onSubmit={outerSubmit}><RequestDetails showErrors={false} onChange={vi.fn()} /></form>);
    const email = screen.getByLabelText(/^Email/);
    fireEvent.change(email, { target: { value: 'chef@example.com' } }); fireEvent.blur(email);
    fireEvent.click(await screen.findByRole('button', { name: 'Use password' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(session.login).toHaveBeenCalledWith('chef@example.com', 'secret-pass'));
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' });
    expect(outerSubmit).not.toHaveBeenCalled();
  });
});
