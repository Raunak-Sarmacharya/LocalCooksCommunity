import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ select: vi.fn(() => { throw new Error('Harness must not query a real database'); }), send: vi.fn() }));
vi.mock('../db', () => ({ db: { select: state.select } }));
vi.mock('../email', async original => ({ ...await original<typeof import('../email')>(), sendEmail: state.send }));
import { buildTourEmailSamples } from '../../scripts/tour-email-samples';

describe('tour email preview harness', () => {
  it('renders all email families through real renderers without database or outbound calls', async () => {
    const { samples, notificationOnly } = await buildTourEmailSamples();
    expect(samples.length).toBeGreaterThan(50);
    expect(new Set(samples.map(sample => sample.role))).toEqual(new Set(['Chef', 'Manager', 'Local Cooks']));
    expect(new Set(samples.map(sample => sample.group))).toEqual(new Set(['Requests', 'Confirmation', 'Time changes', 'Cancellations', 'Outcomes', 'Corrections', 'Edge cases', 'Delivery recovery', 'Reminders', 'Conversation']));
    expect(notificationOnly).toHaveLength(4);
    expect(samples.map(sample => sample.id)).toEqual(samples.map((_, index) => String(index)));
    for (const sample of samples) {
      expect(sample.to).toMatch(/@example.com$/); expect(sample.subject).toBeTruthy();
      expect(sample.html).toContain('<!DOCTYPE html>'); expect(sample.text).toBeTruthy();
      expect(sample.text + sample.html).not.toContain('PRIVATE HARNESS SENTINEL');
      if (sample.role !== 'Local Cooks') {
        expect(sample.text + sample.html).not.toMatch(/\badmin\b|Recorded actor|Outcome recorded by|cancelled by|You cancelled/i);
      }
    }
    const confirmation = samples.find(sample => sample.scenario === 'Tour confirmed' && sample.role === 'Chef')!;
    expect(confirmation.attachments[0].content).toContain('UID:tour-42@localcooks.com');
    for (const role of ['Chef', 'Manager']) {
      const email = samples.find(sample => sample.scenario === 'Tour confirmed' && sample.role === role)!;
      expect(email.text).toContain(role === 'Chef' ? 'Message manager:' : 'Message chef:');
      expect(email.text).toContain('viewing=42&action=message');
      expect(email.text).toContain('Get directions: https://www.google.com/maps/dir/');
      expect(email.html).toContain('margin:0 auto;width:160px');
      expect(email.html).toContain('display:block !important;width:100% !important');
      expect(email.html.indexOf('&amp;action=reschedule')).toBeLessThan(email.html.indexOf('&amp;action=message'));
    }
    const arrival = samples.find(sample => sample.scenario === 'Before the tour · arrival' && sample.role === 'Chef')!;
    expect(arrival.text).toContain('mailto:morgan%2Btour@example.com?');
    expect(arrival.text).toContain('Kitchen manager: Morgan Lee');
    expect(samples.find(sample => sample.scenario === 'Manager email unavailable · arrival' && sample.role === 'Chef')!.text).not.toContain('mailto:');
    for (const role of ['Chef', 'Manager']) {
      const message = samples.find(sample => sample.scenario === 'Starting tour message' && sample.role === role)!;
      expect(message.text).toContain('Read message and reply'); expect(message.text).toContain('Message: Hi');
      expect(message.subject).toContain(role === 'Chef' ? 'Morgan Lee' : 'Alex Chen');
    }
    expect(state.select).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
  });
});
