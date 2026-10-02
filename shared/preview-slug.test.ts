import { describe, expect, it } from 'vitest';
import { availablePreviewSlug, previewSlugBase } from './preview-slug';

describe('public preview slugs', () => {
  it('keeps names readable and assigns a suffix only for a collision', () => {
    expect(previewSlugBase('Sunlight Kitchens NL', 'location')).toBe('sunlight-kitchens-nl');
    expect(previewSlugBase('Café Kitchen', 'kitchen')).toBe('cafe-kitchen');
    expect(availablePreviewSlug('kitchen-east', ['kitchen-east', 'kitchen-east-2'])).toBe('kitchen-east-3');
  });
});
