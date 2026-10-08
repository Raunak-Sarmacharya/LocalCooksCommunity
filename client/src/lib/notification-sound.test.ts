import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNotificationSoundPreferences, NotificationSound, type NotificationSoundSummary } from './notification-sound';

const base = Date.parse('2026-10-08T12:00:00Z');
const oscillator = vi.fn();
const contexts: FakeAudioContext[] = [];
class FakeAudioContext {
  state = 'suspended'; currentTime = 0; destination = {}; onstatechange: (() => void) | null = null;
  constructor() { contexts.push(this); }
  resume = vi.fn(async () => { this.state = 'running'; this.onstatechange?.(); });
  close = vi.fn(async () => { this.state = 'closed'; });
  createOscillator() {
    oscillator();
    return { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
}
let lockQueue: Promise<unknown>;
let dispose: (() => void)[];
let originalLocks: PropertyDescriptor | undefined;
function controller(scope = 'chef:one') {
  const sound = new NotificationSound(scope);
  dispose.push(sound.subscribe(() => {}));
  return sound;
}
function summary(seconds: number, ids: number[], changes: Partial<NotificationSoundSummary['recent'][number]> = {}): NotificationSoundSummary {
  vi.setSystemTime(base + seconds * 1_000);
  return { sampledAt: new Date().toISOString(), recent: ids.map(id => ({ id, created_at: new Date().toISOString(), is_read: false, is_archived: false, ...changes })) };
}
async function enable(sound: NotificationSound) {
  sound.setEnabled(true);
  await Promise.resolve();
  oscillator.mockClear();
}
async function settle() { await lockQueue; await Promise.resolve(); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(base);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  localStorage.clear(); contexts.length = 0; oscillator.mockClear(); dispose = []; lockQueue = Promise.resolve();
  originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn((_name: string, callback: () => unknown) => {
      const operation = lockQueue.then(callback); lockQueue = operation.catch(() => {}); return operation;
    }),
  } });
});
afterEach(() => {
  dispose.forEach(fn => fn()); vi.unstubAllGlobals(); vi.useRealTimers();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

describe('notification sound policy', () => {
  it('starts off without constructing audio, and previews explicit opt-in', async () => {
    const sound = controller();
    expect(sound.getSnapshot()).toEqual({ enabled: false, status: 'off' });
    expect(contexts).toHaveLength(0);
    sound.setEnabled(true); await Promise.resolve();
    expect(oscillator).toHaveBeenCalledTimes(2);
    expect(sound.getSnapshot()).toEqual({ enabled: true, status: 'ready' });
  });
  it('silently establishes a baseline, then chimes once for a new batch', async () => {
    const sound = controller(); await enable(sound);
    expect(sound.observe(summary(0, [1]))).toBe(false);
    expect(sound.observe(summary(15, [1, 2, 3]))).toBe(true);
    await settle(); expect(oscillator).toHaveBeenCalledTimes(2);
    sound.observe(summary(30, [1, 2, 3])); await settle();
    expect(oscillator).toHaveBeenCalledTimes(2);
  });
  it('does not derive events from counts or replay read/archive changes', async () => {
    const sound = controller(); await enable(sound);
    sound.observe(summary(0, [1], { is_archived: true }));
    expect(sound.observe(summary(15, [1]))).toBe(false);
    sound.observe(summary(30, [1, 2], { is_read: true }));
    sound.observe(summary(45, [1, 2])); await settle();
    expect(oscillator).not.toHaveBeenCalled();
  });
  it('recognizes new IDs even when the unread count stays the same or IDs arrive out of order', async () => {
    const sound = controller(); await enable(sound);
    sound.observe(summary(0, [10]));
    expect(sound.observe(summary(15, [9]))).toBe(true);
    await settle(); expect(oscillator).toHaveBeenCalledTimes(2);
  });
  it('suppresses stale events, long reconnect backlogs and kitchen switches', async () => {
    const sound = controller('manager:one'); await enable(sound);
    sound.observe(summary(0, [1]), 'kitchen-1');
    sound.observe(summary(15, [2], { created_at: new Date(base - 180_000).toISOString() }), 'kitchen-1');
    sound.observe(summary(30, [3]), 'kitchen-2');
    sound.observe(summary(200, [4]), 'kitchen-2');
    await settle(); expect(oscillator).not.toHaveBeenCalled();
    sound.observe(summary(215, [5]), 'kitchen-2'); await settle();
    expect(oscillator).toHaveBeenCalledTimes(2);
  });
  it('ignores malformed and out-of-order snapshots', async () => {
    const sound = controller(); await enable(sound); sound.observe(summary(0, []));
    expect(sound.observe({ sampledAt: 'invalid', recent: [] })).toBe(false);
    sound.observe(summary(15, [-1, NaN]));
    expect(sound.observe(summary(10, [2]))).toBe(false);
    await settle(); expect(oscillator).not.toHaveBeenCalled();
  });
  it('coordinates simultaneous tabs and consumes burst events during the cooldown', async () => {
    const first = controller(); const second = controller(); await enable(first); await enable(second);
    const initial = summary(0, []); first.observe(initial); second.observe(initial);
    const batch = summary(15, [1]); first.observe(batch); second.observe(batch); await settle();
    expect(oscillator).toHaveBeenCalledTimes(2);
    first.observe(summary(16, [1, 2])); await settle();
    second.observe(summary(17, [1, 2])); await settle();
    expect(oscillator).toHaveBeenCalledTimes(2);
    first.observe(summary(30, [1, 2, 3])); await settle();
    expect(oscillator).toHaveBeenCalledTimes(4);
  });
  it('mutes across same-tab centers, consumes muted events and cancels a pending alert', async () => {
    const first = controller(); const second = controller(); await enable(first); await enable(second);
    first.observe(summary(0, [])); first.observe(summary(15, [1]));
    second.setEnabled(false); await settle();
    expect(first.getSnapshot().enabled).toBe(false); expect(oscillator).not.toHaveBeenCalled();
    first.observe(summary(30, [2])); await enable(first);
    first.observe(summary(45, [2])); await settle(); expect(oscillator).not.toHaveBeenCalled();
  });
  it('remembers opt-in per account while audio activation stays local to each tab', async () => {
    const first = controller(); await enable(first);
    const nextTab = controller();
    expect(nextTab.getSnapshot()).toEqual({ enabled: true, status: 'activation' });
    expect(controller('chef:two').getSnapshot().enabled).toBe(false);
    expect(controller('manager:one').getSnapshot().enabled).toBe(false);
    nextTab.observe(summary(0, [])); nextTab.observe(summary(15, [1])); await settle();
    expect(oscillator).not.toHaveBeenCalled();
    nextTab.test(); await Promise.resolve(); expect(nextTab.getSnapshot().status).toBe('ready');
  });
  it('updates mute from another tab through the storage event', async () => {
    const sound = controller(); await enable(sound);
    localStorage.setItem('localcooks:notification-sound:v1:chef:one', 'off');
    window.dispatchEvent(new StorageEvent('storage', { key: 'localcooks:notification-sound:v1:chef:one' }));
    expect(sound.getSnapshot()).toEqual({ enabled: false, status: 'off' });
  });
  it('does not schedule missed sounds when an interrupted context is reactivated', async () => {
    const sound = controller(); await enable(sound); sound.observe(summary(0, []));
    contexts[0].state = 'interrupted'; contexts[0].onstatechange?.();
    sound.observe(summary(15, [1])); await settle(); expect(oscillator).not.toHaveBeenCalled();
    sound.test(); await Promise.resolve(); oscillator.mockClear();
    sound.observe(summary(30, [1])); await settle(); expect(oscillator).not.toHaveBeenCalled();
  });
  it('fails quietly when coordination or storage is unavailable', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const sound = controller(); sound.setEnabled(true);
    expect(sound.getSnapshot().status).toBe('unavailable'); expect(oscillator).not.toHaveBeenCalled();
  });
  it('handles blocked storage without breaking notifications', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const sound = controller(); expect(sound.getSnapshot().status).toBe('unavailable');
    expect(() => sound.observe(summary(0, []))).not.toThrow();
    vi.restoreAllMocks();
  });
  it('closes audio and prevents queued playback after unmount', async () => {
    const sound = controller(); await enable(sound); sound.observe(summary(0, []));
    sound.observe(summary(15, [1])); dispose[0](); await settle();
    expect(contexts[0].close).toHaveBeenCalled(); expect(oscillator).not.toHaveBeenCalled();
  });
  it('retains only user sound choices across sign-out, leaving delivery and auth state behind', () => {
    localStorage.setItem('localcooks:notification-sound:v1:chef:one', 'on');
    localStorage.setItem('localcooks:notification-sound:v1:manager:two', 'off');
    localStorage.setItem('localcooks:notification-sound:v1:chef:one:played', 'off');
    localStorage.setItem('localcooks:notification-sound:v1:chef:one:probe', '1');
    localStorage.setItem('localcooks:notification-sound:v1:chef:three', 'invalid');
    localStorage.setItem('authToken', 'private');
    const retained = getNotificationSoundPreferences(localStorage);
    localStorage.clear(); retained.forEach(([key, value]) => localStorage.setItem(key, value));
    expect(localStorage.length).toBe(2);
    expect(controller().getSnapshot()).toEqual({ enabled: true, status: 'activation' });
    expect(controller('manager:two').getSnapshot()).toEqual({ enabled: false, status: 'off' });
  });
  it('recovers the cooldown after the device clock moves backwards', async () => {
    const sound = controller(); await enable(sound); sound.observe(summary(0, []));
    localStorage.setItem('localcooks:notification-sound:v1:chef:one:played', JSON.stringify({ ids: [], at: base + 86_400_000 }));
    sound.observe(summary(15, [1])); await settle(); expect(oscillator).toHaveBeenCalledTimes(2);
  });
  it('keeps mute usable after playback coordination fails', async () => {
    const sound = controller(); await enable(sound); sound.observe(summary(0, []));
    localStorage.setItem('localcooks:notification-sound:v1:chef:one:played', 'bad json');
    sound.observe(summary(15, [1])); await settle(); expect(sound.getSnapshot().status).toBe('unavailable');
    sound.setEnabled(false); expect(sound.getSnapshot().enabled).toBe(false);
    expect(localStorage.getItem('localcooks:notification-sound:v1:chef:one')).toBe('off');
  });
});
