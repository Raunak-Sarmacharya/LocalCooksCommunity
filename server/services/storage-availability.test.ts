import { expect, it } from 'vitest';
import { listingAvailability } from './storage-availability';

const today = '2026-10-16';

it('a listing with no occupied units is available now', () => {
  expect(listingAvailability(1, [], today)).toEqual({ state: 'now' });
});

it('a listing whose only unit is taken returns the day it frees up', () => {
  expect(listingAvailability(1, [{ unitIndex: 1, from: '2026-10-10', to: '2026-10-20' }], today)).toEqual({ state: 'from', from: '2026-10-20' });
});

it('a listing with several units stays available while one is taken', () => {
  expect(listingAvailability(3, [{ unitIndex: 1, from: '2026-10-10', to: '2026-10-20' }], today)).toEqual({ state: 'now' });
});

it('a removal-review unit holds the listing open-ended', () => {
  expect(listingAvailability(1, [{ unitIndex: 1, from: '2026-09-01', to: null }], today)).toEqual({ state: 'full' });
});

it('reports the earliest free day across taken units', () => {
  expect(listingAvailability(2, [{ unitIndex: 1, from: '2026-10-10', to: '2026-10-25' }, { unitIndex: 2, from: '2026-10-10', to: '2026-10-20' }], today))
    .toEqual({ state: 'from', from: '2026-10-20' });
});
