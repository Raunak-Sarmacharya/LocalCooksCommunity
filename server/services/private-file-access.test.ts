import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ logoUrl: '', termsUrl: '', applications: [] as any[], termsConditions: [] as any[] }));
vi.mock('../db', () => ({ db: { select: (fields: any) => {
  const chain: any = { from: () => chain, innerJoin: () => chain, where: (condition: any) => { if (fields?.termsUrl) state.termsConditions.push(condition); return chain; }, limit: () => chain,
    then: (resolve: any) => resolve(fields?.logoUrl ? [{ logoUrl: state.logoUrl }] : fields?.termsUrl ? [{ termsUrl: state.termsUrl }] : fields?.application ? state.applications : []) };
  return chain;
} } }));
import { canReadPrivateFile } from './private-file-access';
const logo = 'https://files.localcooks.ca/location-logos/353_file_1790536347939_LoCo_Red.png';
beforeEach(() => { state.logoUrl = logo; state.termsUrl = ''; state.applications = []; state.termsConditions = []; });
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
