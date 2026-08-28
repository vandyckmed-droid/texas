import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterAverageLinkage, MAX_GROUPS, MIN_GROUPS } from '../cluster.ts';

/** Block-diagonal correlation matrix from group sizes. */
function blockMatrix(sizes: number[], intra: number, inter: number): number[][] {
  const n = sizes.reduce((a, b) => a + b, 0);
  const group: number[] = [];
  sizes.forEach((s, gi) => {
    for (let k = 0; k < s; k++) group.push(gi);
  });
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : group[i] === group[j] ? intra : inter)),
  );
}

const sortedGroups = (groups: number[][]) =>
  groups.map((g) => [...g].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);

test('recovers planted blocks exactly', () => {
  // 3 blocks + clamp floor satisfied: intra dist 0.1 ≤ 0.65 < inter dist 1.0.
  const corr = blockMatrix([5, 4, 3], 0.9, 0.0);
  const { leafOrder, groups } = clusterAverageLinkage(corr);
  assert.deepEqual(sortedGroups(groups), [
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11],
  ]);
  assert.deepEqual([...leafOrder].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i));
});

test('groups are contiguous in leaf order and tile it', () => {
  const corr = blockMatrix([6, 5, 4, 3], 0.8, 0.1);
  const { leafOrder, groups } = clusterAverageLinkage(corr);
  const flattened = groups.flat();
  assert.deepEqual(flattened, leafOrder, 'concatenated groups equal leaf order');
});

test('clamp: too many natural groups collapses toward MAX_GROUPS', () => {
  // 20 blocks of 2 (intra r=0.9) with varied weak inter correlations, so merge
  // heights are distinct as in real data. The 0.65 cut alone gives 20 groups
  // (> MAX); the clamp must raise the cut into the target range.
  const corr = blockMatrix(new Array(20).fill(2), 0.9, 0.3);
  for (let i = 0; i < corr.length; i++) {
    for (let j = i + 1; j < corr.length; j++) {
      if (corr[i][j] === 0.3) {
        const jitter = 0.2 * Math.sin(i * 7 + j * 13); // deterministic, |·| ≤ 0.2
        corr[i][j] = corr[j][i] = 0.3 + jitter;
      }
    }
  }
  const { groups } = clusterAverageLinkage(corr);
  assert.ok(groups.length <= MAX_GROUPS, `got ${groups.length} groups`);
  assert.ok(groups.length >= MIN_GROUPS, `got ${groups.length} groups`);
});

test('soft clamp: a single homogeneous block is not arbitrarily shattered', () => {
  // All-equal high correlation offers no natural subgrouping; the soft clamp
  // keeps it coarse rather than inventing groups.
  const corr = blockMatrix([12], 0.95, 0.95);
  const { groups } = clusterAverageLinkage(corr);
  assert.ok(groups.length >= 1 && groups.length <= MAX_GROUPS, `got ${groups.length} groups`);
  assert.equal(groups.flat().length, 12);
});

test('soft clamp: two tight natural blocks stay two groups (no singleton explosion)', () => {
  const corr = blockMatrix([4, 4], 0.9, 0.0);
  const { groups } = clusterAverageLinkage(corr);
  assert.deepEqual(sortedGroups(groups), [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ]);
});

test('NaN correlations are treated as uncorrelated, no crash', () => {
  const corr = blockMatrix([4, 4], 0.9, 0.0);
  corr[0][5] = NaN;
  corr[5][0] = NaN;
  const { groups, leafOrder } = clusterAverageLinkage(corr);
  assert.equal(leafOrder.length, 8);
  assert.deepEqual(sortedGroups(groups), [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ]);
});

test('degenerate sizes', () => {
  assert.deepEqual(clusterAverageLinkage([]), { leafOrder: [], groups: [] });
  assert.deepEqual(clusterAverageLinkage([[1]]), { leafOrder: [0], groups: [[0]] });
});
