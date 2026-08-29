/**
 * The argument guard on scripts/mock.ts.
 *
 * The script writes over data/, which holds the committed real snapshot. It
 * used to ignore its arguments entirely, so `tsx scripts/mock.ts --help` — a
 * request for usage — silently replaced 503 real charts with 120 fabricated
 * ones. Everything here exists to keep that from happening again.
 *
 * The refusal cases run against the real repo and assert nothing under data/
 * moved. The one case that must actually generate runs the same script from a
 * copied source tree, where `import.meta.dirname` puts DATA_DIR inside a temp
 * directory — proving the generator still works without risking the snapshot.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(repo, 'scripts', 'mock.ts');
const DATA = join(repo, 'data');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[]): Run {
  try {
    const stdout = execFileSync('npx', ['tsx', script, ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/**
 * A fingerprint of data/ — every file's path, size and modification time.
 * Size alone would miss an identical-length rewrite; mtime alone is noisy.
 */
function fingerprint(dir: string): string {
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(d, entry.name);
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(full, rel + '/');
      else {
        const st = statSync(full);
        out.push(`${rel} ${st.size} ${st.mtimeMs}`);
      }
    }
  };
  walk(dir, '');
  return out.join('\n');
}

describe('mock.ts refuses to touch the real snapshot', () => {
  // Each case asserts the exit status, that the message is actionable, and
  // that data/ is byte-for-byte where it was.
  const refusals: Array<[name: string, args: string[], expect: RegExp]> = [
    ['no arguments', [], /refusing to overwrite data\/ without --force/],
    ['an unknown flag', ['--wat'], /unknown argument: --wat/],
    ['an unknown flag alongside --force', ['--force', '--nope'], /unknown argument: --nope/],
    ['a bare word', ['data'], /unknown argument: data/],
  ];

  for (const [name, args, expected] of refusals) {
    test(`${name} exits non-zero and changes nothing`, () => {
      const before = fingerprint(DATA);
      const r = run(SCRIPT, args);
      assert.notEqual(r.status, 0, `expected a non-zero exit for ${JSON.stringify(args)}`);
      assert.match(r.stderr, expected);
      assert.match(r.stderr, /Usage: tsx scripts\/mock\.ts --force/, 'the error should show usage');
      assert.equal(fingerprint(DATA), before, 'data/ must be untouched');
    });
  }
});

describe('--help', () => {
  for (const flag of ['--help', '-h']) {
    test(`${flag} prints usage, exits zero, and changes nothing`, () => {
      const before = fingerprint(DATA);
      const r = run(SCRIPT, [flag]);
      assert.equal(r.status, 0, `expected a clean exit, stderr: ${r.stderr}`);
      assert.match(r.stdout, /Usage: tsx scripts\/mock\.ts --force/);
      assert.doesNotMatch(r.stdout, /mock snapshot written/, 'help must not generate anything');
      assert.equal(fingerprint(DATA), before, 'data/ must be untouched');
    });
  }
});

describe('--force', () => {
  test('generates a full mock snapshot', () => {
    // Run the same script from a copied source tree: write.ts resolves DATA_DIR
    // from its own location, so the output lands in the temp tree rather than
    // over the committed snapshot.
    const before = fingerprint(DATA);
    const sandbox = mkdtempSync(join(tmpdir(), 'texas-mock-'));
    try {
      for (const dir of ['scripts', 'shared']) {
        cpSync(join(repo, dir), join(sandbox, dir), { recursive: true });
      }
      rmSync(join(sandbox, 'scripts', '__tests__'), { recursive: true, force: true });

      const r = run(join(sandbox, 'scripts', 'mock.ts'), ['--force']);
      assert.equal(r.status, 0, `--force should succeed, stderr: ${r.stderr}`);
      assert.match(r.stdout, /mock snapshot written: \d+ stocks, asOf \d{4}-\d{2}-\d{2}/);

      // The generated tree is the shape the app consumes.
      const out = join(sandbox, 'data');
      const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
      assert.equal(meta.source, 'mock', 'a mock snapshot must mark itself');
      assert.ok(meta.rankedCount > 0);
      const rankings = JSON.parse(readFileSync(join(out, 'rankings.json'), 'utf8'));
      assert.equal(rankings.stocks.length, meta.rankedCount);
      assert.equal(readdirSync(join(out, 'charts')).length, meta.rankedCount);
      JSON.parse(readFileSync(join(out, 'correlation.json'), 'utf8'));
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
    assert.equal(fingerprint(DATA), before, 'the real snapshot must still be untouched');
  });
});
