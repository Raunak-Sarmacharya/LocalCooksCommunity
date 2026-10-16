import { describe, expect, it } from 'vitest';
import { changeRequestHref, changeRequestSlots, replacesFromSearch, type ChangeRequestSource } from './change-request';

const source: ChangeRequestSource = { id: 10, kitchenId: 4, locationId: 3, bookingDate: '2099-01-02T12:00:00.000Z', startTime: '10:00', endTime: '12:00',
  pricingMode: 'hourly', selectedSlots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '11:00', endTime: '12:00' }], specialNotes: 'Bring own pans',
  equipmentBookings: [{ equipmentListingId: 7, status: 'pending' }, { equipmentListingId: 8, status: 'cancelled' }],
  storageBookings: [{ storageListingId: 5, startDate: '2099-01-02T00:00:00.000Z', endDate: '2099-01-03T00:00:00.000Z', status: 'pending' }] };

describe('Change request link', () => {
  it('opens the booking flow for the same kitchen, pre-filled, and names the request it replaces', () => {
    const href = changeRequestHref(source)!;
    const url = new URL(href, 'https://chef.example');
    expect(url.pathname).toBe('/book/3');
    expect(url.searchParams.get('kitchenId')).toBe('4');
    expect(url.searchParams.get('replaces')).toBe('10');
    expect(url.searchParams.get('date')).toBe('2099-01-02');
    expect(url.searchParams.get('slots')).toBe('10:00,11:00');
    expect(url.searchParams.get('notes')).toBe('Bring own pans');
    // Only the equipment and storage still wanted come along.
    expect(url.searchParams.get('equipment')).toBe('7');
    expect(JSON.parse(decodeURIComponent(url.searchParams.get('storage')!))).toEqual([{ storageListingId: 5, startDate: '2099-01-02T00:00:00.000Z', endDate: '2099-01-03T00:00:00.000Z' }]);
  });
  it('has no link without a location to book at', () => {
    expect(changeRequestHref({ ...source, locationId: null })).toBeNull();
  });
  it('leaves out empty notes, equipment and storage', () => {
    const url = new URL(changeRequestHref({ ...source, specialNotes: '  ', equipmentBookings: [], storageBookings: null })!, 'https://chef.example');
    for (const key of ['notes', 'equipment', 'storage']) expect(url.searchParams.has(key)).toBe(false);
  });
  it('rebuilds the hours from start and end when no slots were recorded, including overnight', () => {
    expect(changeRequestSlots({ startTime: '09:00:00', endTime: '12:00:00', selectedSlots: null, pricingMode: 'hourly' })).toEqual(['09:00', '10:00', '11:00']);
    expect(changeRequestSlots({ startTime: '23:00', endTime: '01:00', selectedSlots: [], pricingMode: 'hourly' })).toEqual(['23:00', '00:00']);
  });
  it('lets a full-day booking pick its date again rather than pre-selecting hours', () => {
    expect(changeRequestSlots({ ...source, pricingMode: 'daily' })).toEqual([]);
  });
  it('reads the replaced request from the page address, and ignores anything that is not a booking id', () => {
    expect(replacesFromSearch('?kitchenId=4&replaces=10')).toBe(10);
    for (const search of ['', '?replaces=', '?replaces=0', '?replaces=-1', '?replaces=1.5', '?replaces=abc']) expect(replacesFromSearch(search)).toBeUndefined();
  });
});
