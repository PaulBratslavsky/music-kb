// Guard-the-guard for the server suite.
//
// An adversarial audit found six ways to make this suite green while it
// tested nothing. vitest.config.ts closes two of them (`allowOnly`,
// `passWithNoTests`); the rest are edits to the test files themselves, which
// only a test that READS those files can see:
//
//   - `describe.skip` on the theory-diagram block silently drops 24 of 77
//     tests, and the run still reports success.
//   - `it.skip` on the two single-point-of-failure gates does the same for
//     the assertions that matter most.
//   - Deleting lesson-blocks.test.ts entirely passes, as long as some other
//     test file exists to keep `passWithNoTests` satisfied.
//
// So this file asserts the suite's own shape: the target files are present,
// nothing in them is skipped, and the assertion count has not collapsed.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

/** Files whose disappearance or muting must fail the run. */
const REQUIRED = [
  { path: 'mcp/tools/lesson-blocks.test.ts', minCases: 35 },
];

describe('server suite integrity', () => {
  for (const { path, minCases } of REQUIRED) {
    const full = join(SRC, path);

    it(`${path} still exists`, () => {
      expect(existsSync(full), `${path} is gone — deleting it passes silently`).toBe(true);
    });

    it(`${path} has nothing skipped or focused`, () => {
      const src = readFileSync(full, 'utf8');
      const muted = [
        ...src.matchAll(/\b(?:describe|it|test)\.(skip|only|todo|fails)\b/g),
        ...src.matchAll(/^\s*(xit|xdescribe|fit|fdescribe)\s*\(/gm),
      ].map((m) => m[0].trim());
      expect(muted, `${path} contains muted or focused tests`).toEqual([]);
    });

    it(`${path} still declares at least ${minCases} cases`, () => {
      // A blunt floor, not an exact count — it should not fight normal
      // additions, only notice a collapse. Counts DECLARATIONS, which is
      // lower than vitest's reported total because `it.each` expands one
      // declaration into many (39 declarations -> 77 tests today).
      const src = readFileSync(full, 'utf8');
      const cases = [...src.matchAll(/^\s*(?:it|test)\b/gm)].length;
      expect(cases).toBeGreaterThanOrEqual(minCases);
    });
  }
});
