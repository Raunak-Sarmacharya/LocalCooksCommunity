import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ logoUrl: '', termsUrl: '', applications: [] as any[], termsConditions: [] as any[], storagePhotos: [] as string[], photoRows: [] as unknown[], photoQueries: [] as any[] }));
vi.mock('../db', () => ({ db: { execute: async (query: any) => { state.photoQueries.push(query); return { rows: state.photoRows }; }, select: (fields: any) => {
  const chain: any = { from: () => chain, innerJoin: () => chain, where: (condition: any) => { if (fields?.termsUrl) state.termsConditions.push(condition); return chain; }, limit: () => chain,
    then: (resolve: any) => resolve(fields?.photos ? [{ photos: state.storagePhotos }] : fields?.logoUrl ? [{ logoUrl: state.logoUrl }] : fields?.termsUrl ? [{ termsUrl: state.termsUrl }] : fields?.application ? state.applications : []) };
  return chain;
} } }));
import { canReadPrivateFile } from './private-file-access';
const logo = 'https://files.localcooks.ca/location-logos/353_file_1790536347939_LoCo_Red.png';
beforeEach(() => { state.logoUrl = logo; state.termsUrl = ''; state.applications = []; state.termsConditions = []; state.storagePhotos = []; state.photoRows = []; state.photoQueries = []; });

it('serves a storage listing photo like other listing images, and nothing else from that folder', async () => {
  const photo = 'https://files.localcooks.ca/storage-photos/379_file_1792445963015_walk-in-cooler.jpg';
  state.storagePhotos = [photo];
  expect(await canReadPrivateFile(undefined, photo)).toBe(true);
  expect(await canReadPrivateFile(undefined, photo.replace('walk-in-cooler', 'other'))).toBe(false);
});
it('allows stored location branding without authentication but denies arbitrary files', async () => {
  expect(await canReadPrivateFile(undefined, logo)).toBe(true);
  expect(await canReadPrivateFile(undefined, logo.replace('LoCo_Red', 'other'))).toBe(false);
  expect(await canReadPrivateFile(undefined, 'https://files.localcooks.ca/documents/private.png')).toBe(false);
  state.logoUrl = '';
  expect(await canReadPrivateFile(undefined, logo)).toBe(false);
});

it('allows a chef to read exact listed kitchen terms before submitting a request', async () => {
  const url = 'https://files.localcooks.ca/documents/371_file_1791484771230_invoice-96__3_.pdf';
  state.termsUrl = url;
  expect(await canReadPrivateFile({ id: 22, role: 'chef' }, url)).toBe(true);
  const query = new PgDialect().sqlToQuery(state.termsConditions[0]);
  expect(query.params).toEqual([url, true, true, 'active']);
  expect(query.sql).toContain('"locations"."kitchen_terms_url"');
  expect(query.sql).not.toContain('"kitchens"."kitchen_terms_url"');
  expect(query.sql).not.toContain('coalesce');
  expect(query.sql).toContain('"kitchens"."listing_status"');
  expect(await canReadPrivateFile(undefined, url)).toBe(false);
  expect(await canReadPrivateFile({ id: 22, role: 'chef' }, url.replace('invoice', 'license'))).toBe(false);
  state.termsUrl = '';
  expect(await canReadPrivateFile({ id: 22, role: 'chef' }, url)).toBe(false);
});

it.each(['customFieldsData', 'tier2_custom_fields_data'])('allows only application participants to read a stored %s upload', async field => {
  const url = 'https://files.localcooks.ca/documents/22_customFile_portfolio.pdf';
  state.applications = [{ managerId: 371, application: { chefId: 22,
    customFieldsData: field === 'customFieldsData' ? { portfolio: url } : {},
    tier_data: field === 'tier2_custom_fields_data' ? { tier2_custom_fields_data: { portfolio: url } } : {},
  } }];
  expect(await canReadPrivateFile({ id: 371, role: 'manager' }, url)).toBe(true);
  expect(await canReadPrivateFile({ id: 99, role: 'manager' }, url)).toBe(false);
  expect(await canReadPrivateFile({ id: 99, role: 'chef' }, url)).toBe(false);
  expect(await canReadPrivateFile(undefined, url)).toBe(false);
});

it('booking condition photos: readable by the people on that booking (customer and the kitchen manager), checked against the stored photo lists', async () => {
  const photo = 'https://files.localcooks.ca/checkin-photos/380_file_1792667567388_space-photo.png';
  // The kitchen manager (379) is not the uploader; the grant comes from the booking query.
  expect(await canReadPrivateFile({ id: 379, role: 'manager' }, photo)).toBe(false);
  state.photoRows = [{ '?column?': 1 }];
  expect(await canReadPrivateFile({ id: 379, role: 'manager' }, photo)).toBe(true);
  const query = new PgDialect().sqlToQuery(state.photoQueries.at(-1));
  expect(query.sql).toMatch(/storage_bookings[\s\S]*handover_photo_urls/);
  expect(query.sql).toMatch(/kitchen_booking_visits/);
  expect(query.params).toContain(379);
  expect(query.params).toContain(JSON.stringify([photo]));
  expect(await canReadPrivateFile(undefined, photo)).toBe(false);
});
