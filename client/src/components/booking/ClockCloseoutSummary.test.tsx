vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import ICU from 'i18next-icu';
import { I18nextProvider } from 'react-i18next';
import enChef from '@shared/i18n/locales/en-CA/chef.json';
import frChef from '@shared/i18n/locales/fr-CA/chef.json';
import ukChef from '@shared/i18n/locales/uk/chef.json';
import enManager from '@shared/i18n/locales/en-CA/manager.json';
import frManager from '@shared/i18n/locales/fr-CA/manager.json';
import ukManager from '@shared/i18n/locales/uk/manager.json';
import { makeCloseoutSnapshot, reduceClockCloseout } from '@shared/clock-closeout';
import { ClockCloseoutSummary } from './ClockCloseoutSummary';

const locales = { 'en-CA': { chef: enChef, manager: enManager }, 'fr-CA': { chef: frChef, manager: frManager }, uk: { chef: ukChef, manager: ukManager } };
const booking = { bookingDate: '2026-10-13', startTime: '10:00', endTime: '11:00', status: 'confirmed', checkinStatus: 'not_checked_in' };
const saved = makeCloseoutSnapshot(booking, 'America/St_Johns', { serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15 });
afterEach(cleanup);
describe.each(['en-CA', 'fr-CA', 'uk'] as const)('%s clock closeout copy', language => {
  it.each([false, true])('shows truthful end/unknown/no-inspection states for manager=%s', async manager => {
    const i18n = createInstance(); await i18n.use(ICU).init({ lng: language, resources: locales, defaultNS: manager ? 'manager' : 'chef', interpolation: { escapeValue: false } });
    const closeout = reduceClockCloseout(booking, [], saved, new Date('2026-10-15T14:00:00Z'));
    render(<I18nextProvider i18n={i18n}><ClockCloseoutSummary closeout={closeout} manager={manager} /></I18nextProvider>);
    const copy = locales[language][manager ? 'manager' : 'chef'];
    expect(screen.getByText(copy.clockVisitFinished)).toBeInTheDocument();
    expect(screen.getByText(copy.clockArrivalNotRecorded)).toBeInTheDocument();
    expect(screen.getByText(copy.clockNoInspection)).toBeInTheDocument();
    expect(screen.queryByText(copy.clockManagerInspected)).not.toBeInTheDocument();
  });
  it('formats the saved location deadline through real ICU interpolation', async () => {
    const i18n = createInstance(); await i18n.use(ICU).init({ lng: language, resources: locales, defaultNS: 'chef' });
    const closeout = reduceClockCloseout(booking, [], saved, new Date('2026-10-13T14:00:00Z'));
    const result = render(<I18nextProvider i18n={i18n}><ClockCloseoutSummary closeout={closeout} /></I18nextProvider>);
    expect(result.container.textContent).not.toMatch(/\{time\}|undefined|Invalid Date/);
    expect(result.container.textContent).toContain('2026');
  });
});
