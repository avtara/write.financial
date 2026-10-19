// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { matchesQuery, searchWords } from './search.ts';

describe('searchWords', () => {
  it('splits on spaces, #, -, and _, lowercased and without diacritics', () => {
    expect(searchWords('  #Dana-Darurat  Kafé_ok ')).toEqual(['dana', 'darurat', 'kafe', 'ok']);
    expect(searchWords(' # ')).toEqual([]);
  });
});

describe('matchesQuery', () => {
  it('needs every word somewhere in the texts', () => {
    expect(matchesQuery('bca tah', ['BCA Tahapan', 'Bank Central Asia'])).toBe(true);
    expect(matchesQuery('central bca', ['BCA Tahapan', 'Bank Central Asia'])).toBe(true);
    expect(matchesQuery('bca jago', ['BCA Tahapan'])).toBe(false);
    expect(matchesQuery('kafe', ['Kafé Tuku'])).toBe(true);
  });

  it('matches everything without words', () => {
    expect(matchesQuery('', ['Ringkasan'])).toBe(true);
  });
});
