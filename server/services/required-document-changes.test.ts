import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('./location-access-notices', () => ({ queueAccessNotice: vi.fn() }));

import { newlyRequiredKeys } from './required-document-changes';

describe('documents that become Required', () => {
  const doc = (required: boolean, expires = true) => ({ id: 'lic', label: 'Business licence', required, document: true, expires });
  it('finds a new or upgraded document, and ignores ones already required or only tracked', () => {
    expect(newlyRequiredKeys({}, { tier2_custom_fields: [doc(true)] })).toEqual(['custom:lic']);
    expect(newlyRequiredKeys({ tier2_custom_fields: [doc(false)] }, { tier2_custom_fields: [doc(true)] })).toEqual(['custom:lic']);
    expect(newlyRequiredKeys({ tier2_custom_fields: [doc(true)] }, { tier2_custom_fields: [doc(true, false)] })).toEqual([]);
    expect(newlyRequiredKeys({}, { tier2_custom_fields: [doc(false)] })).toEqual([]);
    expect(newlyRequiredKeys({ insurance_tracked: true }, { tier2_insurance_document_required: true })).toEqual(['insurance']);
  });
});
