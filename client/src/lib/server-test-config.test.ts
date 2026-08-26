// Cross-package guard: the SERVER suite's runner config.
//
// Same stance as embeddings.parity.test.ts and mcp-tool-permissions.test.ts —
// read the server's real file off disk, because server/ and client/ cannot
// import each other and the client's vitest is where cross-package invariants
// live.
//
// Why this one exists. server/src/mcp/__suite-integrity.test.ts guards the
// server suite against being muted (`.skip`, `.only`, a deleted target file).
// It cannot guard the ONE case that stops it running at all:
//
//   export default defineConfig({ test: {
//     passWithNoTests: true, include: ['src/**/*.nope.ts'] } });
//
// An `include` that matches nothing plus `passWithNoTests: true` prints
// "No test files found, exiting with code 0" — the whole server suite
// vanishes from `yarn test` and the command stays green. A test inside that
// suite cannot notice, because it never runs. So the check has to live
// outside it, in a suite that does.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG = resolve(process.cwd(), '..', 'server', 'vitest.config.ts');

describe("the server suite's runner cannot be silently disabled", () => {
  const src = readFileSync(CONFIG, 'utf8');

  it('does not allow a no-match run to pass', () => {
    expect(src).toMatch(/passWithNoTests:\s*false/);
    expect(src).not.toMatch(/passWithNoTests:\s*true/);
  });

  it('refuses a committed .only', () => {
    expect(src).toMatch(/allowOnly:\s*false/);
  });

  it('still points at the directory the tests are in', () => {
    // A passing `include` that matches nothing is the other half of the
    // attack; pin the glob rather than merely its presence.
    expect(src).toMatch(/include:\s*\[\s*'src\/\*\*\/\*\.test\.ts'\s*\]/);
  });

  it('read a real config, not an empty string', () => {
    // Guard the guard: a moved or renamed file must fail loudly here rather
    // than make three regexes vacuously true.
    expect(src.length).toBeGreaterThan(200);
    expect(src).toMatch(/defineConfig/);
  });
});
