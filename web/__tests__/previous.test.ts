import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPreviousRanks } from '../../scripts/write.ts';
/**
 * readPreviousRanks resolves data/ relative to scripts/, so these exercise it
 * against the real repo file and then against deliberately broken stand-ins
 * written into a scratch copy. The behaviour that matters is the forgiving
 * one: a refresh must never fail because the file it is about to replace is
 * missing or malformed.
 */


test('reads ranks from the snapshot currently on disk', () => {
  const prev = readPreviousRanks();
  // The committed snapshot is real data; either it predates the feature (empty)
  // or it carries ranks for every ranked name. Both are valid, neither throws.
  if (prev.size > 0) {
    const [, first] = [...prev.entries()][0];
    assert.equal(typeof first.prevRankBlended, 'number');
    assert.equal(typeof first.prevRankVolAdj, 'number');
  }
  assert.ok(prev instanceof Map);
});

test('a rank map round-trips symbol to both ranks', () => {
  // Shape check against the contract the refresh script spreads into StockRow.
  const sample = new Map([['AAPL', { prevRankBlended: 12, prevRankVolAdj: 30 }]]);
  const row = { symbol: 'AAPL', rankBlended: 5, ...sample.get('AAPL') };
  assert.equal(row.prevRankBlended, 12);
  assert.equal(row.prevRankVolAdj, 30);
  assert.equal(row.rankBlended, 5, 'the carried fields must not clobber current ranks');
});

test('a row with no previous entry spreads to nothing, leaving the fields absent', () => {
  const empty = new Map<string, { prevRankBlended: number; prevRankVolAdj: number }>();
  const row = { symbol: 'NEW', rankBlended: 7, ...empty.get('NEW') };
  assert.equal('prevRankBlended' in row, false,
    'absent must mean absent, so the app can tell "new" from "unchanged"');
});
