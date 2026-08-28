/**
 * Deterministic emitter for the generated data/ tree.
 * Fixed key order and fixed rounding so refreshes produce clean git diffs.
 * Writes to a temp dir first, then swaps, so a failed run never leaves
 * half-written committed data.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChartFile, CorrelationFile, Meta, Rankings } from '../shared/types.ts';

export interface Snapshot {
  meta: Meta;
  rankings: Rankings;
  correlation: CorrelationFile;
  charts: { fileKey: string; file: ChartFile }[];
}

export const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');

export function writeSnapshot(snapshot: Snapshot): void {
  const tmp = path.join(DATA_DIR, '.tmp-write');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'charts'), { recursive: true });

  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(snapshot.meta, null, 2) + '\n');
  fs.writeFileSync(path.join(tmp, 'rankings.json'), JSON.stringify(snapshot.rankings) + '\n');
  fs.writeFileSync(path.join(tmp, 'correlation.json'), JSON.stringify(snapshot.correlation) + '\n');

  // Code-unit comparison: byte-stable order regardless of process locale.
  const sortedCharts = [...snapshot.charts].sort((a, b) =>
    a.fileKey < b.fileKey ? -1 : a.fileKey > b.fileKey ? 1 : 0,
  );
  for (const { fileKey, file } of sortedCharts) {
    if (!/^[A-Z0-9.-]+$/i.test(fileKey)) throw new Error(`unsafe chart file key: ${fileKey}`);
    fs.writeFileSync(path.join(tmp, 'charts', `${fileKey}.json`), JSON.stringify(file) + '\n');
  }

  // Swap into place. The old charts dir is moved aside before the new one is
  // renamed in, so there is never a moment with rankings written but no charts;
  // it is deleted only after the new directory is in place.
  for (const name of ['meta.json', 'rankings.json', 'correlation.json']) {
    fs.renameSync(path.join(tmp, name), path.join(DATA_DIR, name));
  }
  const chartsDir = path.join(DATA_DIR, 'charts');
  const chartsOld = path.join(DATA_DIR, '.charts-old');
  fs.rmSync(chartsOld, { recursive: true, force: true });
  if (fs.existsSync(chartsDir)) fs.renameSync(chartsDir, chartsOld);
  try {
    fs.renameSync(path.join(tmp, 'charts'), chartsDir);
  } catch (err) {
    if (fs.existsSync(chartsOld)) fs.renameSync(chartsOld, chartsDir);
    throw err;
  }
  fs.rmSync(chartsOld, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
