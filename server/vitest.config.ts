// The server's test runner.
//
// Deliberately minimal — the survey that scoped this confirmed vitest needs
// no config at all to RUN here (Vite transforms the test files regardless of
// the package's CommonJS `type`, and `environment: 'node'` is already the
// default). Everything below exists to close a specific hole an adversarial
// audit walked through, not to configure the runner.
//
// The audit's finding: with the bare default, six separate edits made the
// suite pass while testing nothing — `it.only` on a trivial case, `.skip` on
// the highest-value describe block, and deleting lesson-blocks.test.ts
// outright once any second test file existed. All exited 0.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.only` normally still exits 0 outside CI, which silently reduces the
    // suite to one test on a developer's machine and in any runner that does
    // not set CI. Never allow it: a committed `.only` is a mistake, not a
    // workflow.
    allowOnly: false,
    // An `include` that matches nothing must be a failure, not a pass. This is
    // vitest's default, pinned here so it cannot be flipped without the diff
    // being obvious.
    passWithNoTests: false,
    include: ['src/**/*.test.ts'],
  },
});
