/**
 * Average-linkage (UPGMA) agglomerative clustering on a correlation matrix,
 * with dissimilarity d = 1 − r. Produces a dendrogram leaf order (so the
 * reordered matrix shows clusters as contiguous diagonal blocks) and a flat
 * cut into groups.
 *
 * n is ~50, so the naive O(n³) merge loop is instantaneous.
 */

/** Flat-cut dissimilarity threshold: groups merge while avg distance ≤ this (avg r ≳ 0.35). */
export const CUT_THRESHOLD = 0.65;
/** Soft target range for the number of groups; see the clamp note in clusterAverageLinkage. */
export const MIN_GROUPS = 3;
export const MAX_GROUPS = 12;

interface Node {
  /** Original indices of member leaves. */
  members: number[];
  /** Merge height (avg dissimilarity at merge); 0 for leaves. */
  height: number;
  left: Node | null;
  right: Node | null;
}

export interface ClusterResult {
  /** Permutation of 0..n−1: dendrogram leaf order. */
  leafOrder: number[];
  /**
   * Groups as arrays of original indices, in leaf-order sequence;
   * each group is contiguous within leafOrder and the groups tile it.
   */
  groups: number[][];
}

export function clusterAverageLinkage(
  corr: number[][],
  threshold: number = CUT_THRESHOLD,
): ClusterResult {
  const n = corr.length;
  if (n === 0) return { leafOrder: [], groups: [] };
  if (n === 1) return { leafOrder: [0], groups: [[0]] };

  // Dissimilarity; undefined correlations count as uncorrelated.
  const dist = (i: number, j: number): number => {
    const r = corr[i][j];
    return 1 - (Number.isNaN(r) ? 0 : r);
  };

  let active: Node[] = Array.from({ length: n }, (_, i) => ({
    members: [i],
    height: 0,
    left: null,
    right: null,
  }));

  const avgDist = (a: Node, b: Node): number => {
    let s = 0;
    for (const i of a.members) for (const j of b.members) s += dist(i, j);
    return s / (a.members.length * b.members.length);
  };

  while (active.length > 1) {
    let bi = 0;
    let bj = 1;
    let best = Infinity;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const d = avgDist(active[i], active[j]);
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    const a = active[bi];
    const b = active[bj];
    // Deterministic child order: subtree containing the smaller original index first.
    const [left, right] = Math.min(...a.members) <= Math.min(...b.members) ? [a, b] : [b, a];
    const merged: Node = {
      members: [...left.members, ...right.members],
      height: best,
      left,
      right,
    };
    active = active.filter((_, k) => k !== bi && k !== bj);
    active.push(merged);
  }

  const root = active[0];

  const leafOrder: number[] = [];
  const collectLeaves = (node: Node): void => {
    if (!node.left || !node.right) {
      leafOrder.push(node.members[0]);
      return;
    }
    collectLeaves(node.left);
    collectLeaves(node.right);
  };
  collectLeaves(root);

  // Flat cut: maximal subtrees whose merge height ≤ t, visited in leaf order,
  // so groups are contiguous in leafOrder by construction.
  const cut = (t: number): number[][] => {
    const groups: number[][] = [];
    const walk = (node: Node): void => {
      // A leaf is always its own group when not absorbed by an ancestor.
      if (!node.left || !node.right || node.height <= t) {
        groups.push(orderedMembers(node));
        return;
      }
      walk(node.left!);
      walk(node.right!);
    };
    const orderedMembers = (node: Node): number[] => {
      const out: number[] = [];
      const rec = (m: Node): void => {
        if (!m.left || !m.right) {
          out.push(m.members[0]);
          return;
        }
        rec(m.left);
        rec(m.right);
      };
      rec(node);
      return out;
    };
    walk(root);
    return groups;
  };

  // The requested threshold wins when its group count is already in range.
  // Otherwise clamp SOFTLY: move the cut to another merge height, trading off
  // distance from [MIN_GROUPS, MAX_GROUPS] against distance from the natural
  // group count. A hard clamp would happily shatter two tight blocks into
  // singletons just to reach MIN_GROUPS — worse than admitting the data only
  // supports two groups.
  let bestGroups = cut(threshold);
  if (rangeViolation(bestGroups.length) > 0) {
    const requestedK = bestGroups.length;
    // Candidate cuts: below every merge (all singletons) and at each merge height.
    const candidates = [...new Set([-1, ...collectHeights(root)])].sort((x, y) => x - y);
    let bestScore = Infinity;
    for (const t of candidates) {
      const g = cut(t);
      const score = rangeViolation(g.length) + 0.5 * Math.abs(g.length - requestedK);
      if (score < bestScore || (score === bestScore && g.length < bestGroups.length)) {
        bestScore = score;
        bestGroups = g;
      }
    }
  }

  return { leafOrder, groups: bestGroups };
}

function collectHeights(root: Node): number[] {
  const out: number[] = [];
  const rec = (n: Node): void => {
    if (!n.left || !n.right) return;
    out.push(n.height);
    rec(n.left);
    rec(n.right);
  };
  rec(root);
  return out;
}

function rangeViolation(k: number): number {
  if (k < MIN_GROUPS) return MIN_GROUPS - k;
  if (k > MAX_GROUPS) return k - MAX_GROUPS;
  return 0;
}
