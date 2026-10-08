import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChefNotificationCenter from '../chef/ChefNotificationCenter';
import NotificationCenter from '../manager/NotificationCenter';

const account = vi.hoisted(() => ({ uid: 'one' }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: account.uid }, loading: false }) }));
vi.mock('@/lib/firebase', () => ({ auth: { get currentUser() { return { uid: account.uid, getIdToken: async () => 'test' }; } } }));
vi.mock('@/hooks/use-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const oscillator = vi.fn();
class Audio {
  state = 'suspended'; currentTime = 0; destination = {}; onstatechange: (() => void) | null = null;
  resume = async () => { this.state = 'running'; this.onstatechange?.(); };
  close = async () => { this.state = 'closed'; };
  createOscillator = () => { oscillator(); return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {} }; };
  createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} });
}
const base = Date.now();
function summary(second: number, id?: number) {
  return { count: id ? 1 : 0, sampledAt: new Date(base + second * 1_000).toISOString(), recent: id ? [{ id, created_at: new Date(base + second * 1_000).toISOString(), is_read: false, is_archived: false }] : [] };
}
let locks: PropertyDescriptor | undefined;
beforeEach(() => {
  account.uid = 'one'; localStorage.clear(); oscillator.mockClear();
  vi.stubGlobal('AudioContext', Audio);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  let queue = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_key: string, callback: () => void) => queue = queue.then(callback) } });
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => ({ ok: true, json: async () => String(input).includes('unread-count') ? summary(0) : { notifications: [], pagination: { total: 0 } } })));
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  if (locks) Object.defineProperty(navigator, 'locks', locks); else Reflect.deleteProperty(navigator, 'locks');
});

describe('chef and manager sound integration', () => {
  it.each(['chef', 'manager'] as const)('provides accessible opt-in and mute in the %s dropdown', async role => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>{role === 'chef' ? <ChefNotificationCenter /> : <NotificationCenter />}</QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: /^notifications/i }));
    const enable = await screen.findByRole('button', { name: 'Enable sound' });
    expect(enable).toHaveAccessibleDescription(/Sound is off/); fireEvent.click(enable);
    await waitFor(() => expect(oscillator).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAccessibleDescription(/Sound is on/);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(screen.getByRole('button', { name: 'Enable sound' })).toHaveAccessibleDescription(/Sound is off/);
    client.clear();
  });
  it.each(['chef', 'manager'] as const)('alerts from a shared %s query even when a second center supplies the query function', async role => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      {role === 'chef' ? <><ChefNotificationCenter variant="page" /><ChefNotificationCenter /></>
        : <><NotificationCenter variant="page" /><NotificationCenter /></>}
    </QueryClientProvider>);
    const key = role === 'chef' ? ['/api/chef/notifications/unread-count', 'one'] : ['/api/manager/notifications/unread-count', undefined, 'one'];
    await waitFor(() => expect(client.getQueryData(key)).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Enable sound' }));
    await waitFor(() => expect(oscillator).toHaveBeenCalledTimes(2)); oscillator.mockClear();
    client.setQueryData(key, summary(15, 2));
    await waitFor(() => expect(oscillator).toHaveBeenCalledTimes(2));
    client.setQueryData(key, { count: 0 }); client.setQueryData(key, summary(15, 2));
    await new Promise(resolve => setTimeout(resolve, 20)); expect(oscillator).toHaveBeenCalledTimes(2);
    client.clear();
  });
  it('keeps admin free of sound controls and background sound polling', async () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><NotificationCenter variant="page" endpoint="/api/admin/notifications" linkRole={null} /></QueryClientProvider>);
    expect(screen.queryByText('Notification sound')).not.toBeInTheDocument();
    await waitFor(() => expect(client.getQueryCache().getAll().length).toBeGreaterThan(0));
    expect(client.getQueryCache().getAll().find(query => query.queryKey[0] === '/api/admin/notifications/unread-count')?.options.refetchIntervalInBackground).toBe(false);
    client.clear();
  });
});
