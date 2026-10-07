import { describe, expect, it } from 'vitest';
import { tourApplicationDefaults, type TourApplicationReference } from './tour-application';
const reference: TourApplicationReference = { intendedUse: 'Meal preparation', estimatedWeeklyHours: '10', hasLicense: true,
  targetStartDate: 'not_decided', chefNotes: 'Chef note', sharedManagerNotes: 'Shared note', additionalInfo: '' };
describe('tour application prefill precedence', () => {
  it('fills only intended use; licence, hours and timing do not impersonate application answers', () => {
    expect(tourApplicationDefaults({ businessDescription: '', usageFrequency: '', sessionDuration: '', foodSafetyLicense: 'no' }, reference))
      .toEqual({ businessDescription: 'Meal preparation', usageFrequency: '', sessionDuration: '', foodSafetyLicense: 'no' });
  });
  it('preserves any saved application answer, including an intentionally blank description', () => {
    expect(tourApplicationDefaults({ businessDescription: '' }, reference, true)).toEqual({ businessDescription: '' });
    expect(tourApplicationDefaults({ businessDescription: 'Existing profile description' }, reference)).toEqual({ businessDescription: 'Existing profile description' });
  });
});
