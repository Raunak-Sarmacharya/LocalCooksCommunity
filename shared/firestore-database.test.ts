import { describe, expect, it } from 'vitest';
import { firestoreDatabaseId } from './firestore-database';
describe('Firestore environment selection', () => {
  it('retains the default database for existing production configuration', () => {
    expect(firestoreDatabaseId(undefined, 'production')).toBe('(default)');
    expect(firestoreDatabaseId('(default)', 'production')).toBe('(default)');
  });
  it('selects staging explicitly for development and preview', () => {
    expect(firestoreDatabaseId('staging', 'preview')).toBe('staging');
    expect(firestoreDatabaseId('staging', 'development')).toBe('staging');
  });
  it('rejects a production override and unknown database', () => {
    expect(() => firestoreDatabaseId('staging', 'production')).toThrow('Production');
    expect(() => firestoreDatabaseId('other')).toThrow('Unsupported');
  });
});
