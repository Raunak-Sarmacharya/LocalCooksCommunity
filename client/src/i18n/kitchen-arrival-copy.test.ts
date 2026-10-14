import { expect, it } from 'vitest';
import { createInstance } from 'i18next';
import ICU from 'i18next-icu';
import enChef from '@shared/i18n/locales/en-CA/chef.json';
import frChef from '@shared/i18n/locales/fr-CA/chef.json';
import ukChef from '@shared/i18n/locales/uk/chef.json';
import enManager from '@shared/i18n/locales/en-CA/manager.json';
import frManager from '@shared/i18n/locales/fr-CA/manager.json';
import ukManager from '@shared/i18n/locales/uk/manager.json';

it.each([
  { locale: 'en-CA', chef: enChef, manager: enManager, expected: ['Complete 1 required task to continue', 'Complete 2 required tasks to continue', 'Complete 5 required tasks to continue'] },
  { locale: 'fr-CA', chef: frChef, manager: frManager, expected: ['Terminez 1 tâche obligatoire pour continuer', 'Terminez 2 tâches obligatoires pour continuer', 'Terminez 5 tâches obligatoires pour continuer'] },
  { locale: 'uk', chef: ukChef, manager: ukManager, expected: ['Виконайте 1 обов’язкове завдання, щоб продовжити', 'Виконайте 2 обов’язкові завдання, щоб продовжити', 'Виконайте 5 обов’язкових завдань, щоб продовжити'] },
])('formats kitchen task counts and scope labels with the production ICU plugin in $locale', async ({ locale, chef, manager, expected }) => {
  const i18n = createInstance().use(ICU);
  await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { chef, manager } }, interpolation: { escapeValue: false } });
  expect([1, 2, 5].map(count => i18n.t('chef:kciCompleteRequiredTasks', { count }))).toEqual(expected);
  expect(i18n.t('manager:kitchenScope.usingDefault', { location: 'Harbour' })).toContain('Harbour');
  expect(i18n.t('manager:kitchenScope.previewKitchen', { kitchen: 'Ocean' })).toContain('Ocean');
  expect(i18n.t('chef:kciCompleteRequiredPhotos')).not.toContain('?');
});
