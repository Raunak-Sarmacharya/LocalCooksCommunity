export interface NotificationSoundSummary {
  sampledAt: string;
  recent: { id: number; created_at: string; is_read: boolean; is_archived: boolean }[];
}

export type SoundStatus = 'off' | 'ready' | 'activation' | 'unavailable';
export interface SoundState { enabled: boolean; status: SoundStatus }
const COOLDOWN_MS = 5_000;
const FRESH_MS = 120_000;
const preferenceEvent = 'localcooks:notification-sound-preference';
export const NOTIFICATION_SOUND_PREFERENCE_PREFIX = 'localcooks:notification-sound:v1:';

/** Only on/off choices survive sign-out; delivery ledgers and audio activation are session state. */
export function getNotificationSoundPreferences(storage: Storage): [string, string][] {
  const preferences: [string, string][] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(NOTIFICATION_SOUND_PREFERENCE_PREFIX)) continue;
    if (!/^(chef|manager):[^:]+$/.test(key.slice(NOTIFICATION_SOUND_PREFERENCE_PREFIX.length))) continue;
    const value = storage.getItem(key);
    if (value === 'on' || value === 'off') preferences.push([key, value]);
  }
  return preferences;
}

/** One controller per mounted center; browser locks serialize playback across centers and tabs. */
export class NotificationSound {
  private readonly key: string;
  private state: SoundState = { enabled: false, status: 'off' };
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private tones = new Set<OscillatorNode>();
  private seen = new Map<number, number>();
  private lastSample = 0;
  private stream = '';
  private attached = false;
  private supported = false;

  constructor(private readonly scope: string) {
    this.key = `${NOTIFICATION_SOUND_PREFERENCE_PREFIX}${scope}`;
  }

  getSnapshot = () => this.state;

  private publish() {
    const status: SoundStatus = !this.supported ? 'unavailable' : !this.state.enabled ? 'off'
      : this.context?.state === 'running' ? 'ready' : 'activation';
    if (status !== this.state.status) this.state = { ...this.state, status };
    this.listeners.forEach(listener => listener());
  }

  private readPreference = () => {
    try {
      this.state = { ...this.state, enabled: localStorage.getItem(this.key) === 'on' };
      if (!this.state.enabled) this.stopTones();
    } catch {
      this.supported = false;
      this.state = { enabled: false, status: 'unavailable' };
    }
    this.publish();
  };

  private storageChanged = (event: StorageEvent) => {
    if (event.key === this.key || event.key === null) this.readPreference();
  };
  private preferenceChanged = (event: Event) => {
    if ((event as CustomEvent<string>).detail === this.key) this.readPreference();
  };
  private activate = (event: Event) => {
    if (event.isTrusted && this.state.enabled) this.startAudio(false);
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.attached) {
      this.attached = true;
      // Without shared storage and an atomic lock, duplicate alerts cannot be prevented.
      this.supported = typeof window.AudioContext === 'function' && !!navigator.locks?.request;
      try {
        const probe = `${this.key}:probe`;
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
      } catch { this.supported = false; }
      this.readPreference();
      window.addEventListener('storage', this.storageChanged);
      window.addEventListener(preferenceEvent, this.preferenceChanged);
      document.addEventListener('pointerdown', this.activate);
      document.addEventListener('keydown', this.activate);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size) return;
      this.attached = false;
      window.removeEventListener('storage', this.storageChanged);
      window.removeEventListener(preferenceEvent, this.preferenceChanged);
      document.removeEventListener('pointerdown', this.activate);
      document.removeEventListener('keydown', this.activate);
      this.stopTones();
      if (this.context) {
        this.context.onstatechange = null;
        void this.context.close().catch(() => {});
        this.context = null;
      }
      this.seen.clear();
      this.lastSample = 0;
    };
  };

  setEnabled = (enabled: boolean) => {
    if ((enabled && !this.supported) || !this.attached) return;
    try {
      localStorage.setItem(this.key, enabled ? 'on' : 'off');
      this.state = { ...this.state, enabled };
      window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: this.key }));
      if (enabled) this.startAudio(true);
      else this.stopTones();
      this.publish();
    } catch {
      this.supported = false;
      this.state = { enabled: false, status: 'unavailable' };
      this.stopTones();
      this.publish();
    }
  };

  test = () => { if (this.state.enabled) this.startAudio(true); };

  private startAudio(preview: boolean) {
    if (!this.supported || !this.attached) return;
    const started = Date.now();
    try {
      // Creation and resume happen synchronously inside the trusted user gesture.
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContext();
        this.context.onstatechange = () => this.publish();
      }
      const context = this.context;
      const finish = () => {
        if (!this.attached || context !== this.context) return;
        this.publish();
        if (preview && this.state.enabled && Date.now() - started < 2_000) this.chime();
      };
      if (context.state === 'running') finish();
      else void context.resume().then(finish).catch(() => this.publish());
    } catch {
      this.supported = false;
      this.publish();
    }
  }

  private stopTones() {
    this.tones.forEach(tone => { try { tone.stop(); } catch { /* already ended */ } });
    this.tones.clear();
  }

  private chime(): boolean {
    if (!this.state.enabled || this.context?.state !== 'running') return false;
    try {
      this.stopTones();
      // A gentle, original two-note chime; no remote asset, codec or loading dependency.
      for (const [frequency, delay] of [[660, 0], [880, 0.13]]) {
        const tone = this.context.createOscillator();
        const gain = this.context.createGain();
        const start = this.context.currentTime + delay;
        tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.08, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
        tone.connect(gain);
        gain.connect(this.context.destination);
        this.tones.add(tone);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); this.tones.delete(tone); };
        tone.start(start);
        tone.stop(start + 0.25);
      }
      return true;
    } catch {
      this.stopTones();
      this.supported = false;
      this.publish();
      return false;
    }
  }

  /** Only server-stamped samples advance this observer; optimistic updates/rollbacks do not. */
  observe = (summary: NotificationSoundSummary, stream = ''): boolean => {
    if (!this.attached || !Array.isArray(summary.recent)) return false;
    const sampledAt = Date.parse(summary.sampledAt);
    if (!Number.isFinite(sampledAt) || (stream === this.stream && sampledAt <= this.lastSample)) return false;
    const baseline = stream !== this.stream || !this.lastSample || sampledAt - this.lastSample > FRESH_MS;
    this.stream = stream;
    const ids: number[] = [];
    for (const item of summary.recent) {
      if (!item || typeof item !== 'object') continue;
      const createdAt = Date.parse(item.created_at);
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || !Number.isFinite(createdAt)) continue;
      if (createdAt > sampledAt || sampledAt - createdAt > FRESH_MS) continue;
      if (!this.seen.has(item.id) && item.is_read === false && item.is_archived === false) ids.push(item.id);
      this.seen.set(item.id, createdAt);
    }
    this.lastSample = sampledAt;
    this.seen.forEach((createdAt, id) => { if (sampledAt - createdAt > FRESH_MS) this.seen.delete(id); });
    if (baseline || !ids.length) return false;
    if (this.state.status === 'ready') void this.claimAndPlay(ids);
    return true;
  };

  private async claimAndPlay(ids: number[]) {
    const received = Date.now();
    try {
      await navigator.locks.request(`${this.key}:playback`, () => {
        // Never replay a queued event after mute, logout, browser interruption or a long lock wait.
        if (!this.attached || Date.now() - received > 5_000 || this.context?.state !== 'running') return;
        if (localStorage.getItem(this.key) !== 'on') return;
        const ledgerKey = `${this.key}:played`;
        const raw = localStorage.getItem(ledgerKey);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        const ledger = parsed && typeof parsed === 'object' ? parsed as { ids?: unknown; at?: unknown } : {};
        const previous = Array.isArray(ledger.ids) ? ledger.ids.filter(id => Number.isSafeInteger(id)) as number[] : [];
        if (ids.every(id => previous.includes(id))) return;
        const at = typeof ledger.at === 'number' && Number.isFinite(ledger.at) ? ledger.at : 0;
        const now = Date.now();
        const play = now < at || now - at >= COOLDOWN_MS;
        // Consume the whole batch during the cooldown; no deferred burst of sounds.
        localStorage.setItem(ledgerKey, JSON.stringify({ ids: Array.from(new Set([...previous, ...ids])).slice(-256), at: play ? now : at }));
        if (play) this.chime();
      });
    } catch {
      // Fail closed: a storage/coordination failure must not create a chorus across tabs.
      this.supported = false;
      this.publish();
    }
  }
}
