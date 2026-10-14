import i18n from 'i18next';
import ICU from 'i18next-icu';
import chef from '@shared/i18n/locales/en-CA/chef.json';
import manager from '@shared/i18n/locales/en-CA/manager.json';
import booking from '@shared/i18n/locales/en-CA/booking.json';

void i18n.use(ICU).init({ lng: 'en-CA', fallbackLng: 'en-CA', resources: { 'en-CA': { chef, manager, booking } }, initAsync: false });

export function useBookingTranslation(namespace: 'chef' | 'manager' | 'booking' = 'chef') {
  return { t: i18n.getFixedT('en-CA', namespace), i18n };
}

export { i18n as testI18n };
