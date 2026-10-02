import { describe, expect, it } from 'vitest';
import { canonicalKitchenHref, chefKitchenShareUrl, kitchenPreviewHref } from './kitchen-preview-url';

describe('kitchen preview canonical URL', () => {
  it('uses the location and kitchen slugs without ID query parameters', () => {
    const kitchen = { name: 'Kitchen East', slug: 'kitchen-east' };
    expect(kitchenPreviewHref('sunlight-kitchens-nl', kitchen))
      .toBe('/kitchen/sunlight-kitchens-nl/kitchen-east');
    expect(canonicalKitchenHref('/fr-CA/kitchen-preview/33', 'sunlight-kitchens-nl', kitchen, '?kitchenId=40&ref=discover', '#pricing'))
      .toBe('/fr-CA/kitchen/sunlight-kitchens-nl/kitchen-east?ref=discover#pricing');
  });

  it('shares on the chef host for local, preview, and production', () => {
    const path = '/kitchen/sunlight-kitchens-nl/kitchen-east';
    expect(chefKitchenShareUrl(path, { hostname: 'kitchen.localhost', port: '5001', protocol: 'http:' }, 'en-CA'))
      .toBe('http://chef.localhost:5001/en-CA/kitchen/sunlight-kitchens-nl/kitchen-east');
    expect(chefKitchenShareUrl(path, { hostname: 'dev-kitchen.localcooks.ca', port: '', protocol: 'https:' }, 'en-CA'))
      .toBe('https://dev-chef.localcooks.ca/en-CA/kitchen/sunlight-kitchens-nl/kitchen-east');
    expect(chefKitchenShareUrl(path, { hostname: 'kitchen.localcooks.ca', port: '', protocol: 'https:' }, 'en-CA'))
      .toBe('https://chef.localcooks.ca/en-CA/kitchen/sunlight-kitchens-nl/kitchen-east');
  });
});
