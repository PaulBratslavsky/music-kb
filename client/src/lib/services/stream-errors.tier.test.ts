import { describe, it, expect, vi } from 'vitest';
import { withFriendlyErrors } from './stream-errors';
import { friendlyOllamaError } from './ollama-errors';

// Proves withFriendlyErrors routes by TIER rather than hardcoding the local mapper.
// Kept because it is the only test here that would FAIL if the fix regressed: the
// sibling fixture tests assert parser shapes and pass either way.
// Originally actually routes by tier rather than hardcoding Ollama.
// The message below is one friendlyOllamaError REWRITES (it matches /timed ?out/i),
// so if the frontier path were still going through the local mapper the assertion
// would fail loudly rather than coincidentally pass.
const RAW = 'Request timed out after 60000ms';

function streamOf(chunk: any) {
  return (async function* () { yield chunk; })();
}

function fakeModel(tier: 'local' | 'frontier') {
  return {
    tier,
    model: tier === 'frontier' ? 'claude-sonnet-5' : 'gemma4-kb:latest',
    friendlyError: tier === 'frontier'
      ? () => 'FRONTIER-MAPPER'
      : friendlyOllamaError,
    redact: (s: string) => s,
  } as any;
}

describe('withFriendlyErrors routes by tier', () => {
  it('frontier RUN_ERROR uses the frontier mapper, not friendlyOllamaError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out: any[] = [];
    for await (const c of withFriendlyErrors(fakeModel('frontier'), streamOf({ type: 'RUN_ERROR', message: RAW }), 't')) out.push(c);
    expect(out[0].message).toBe('FRONTIER-MAPPER');
    expect(out[0].message).not.toBe(friendlyOllamaError(RAW));
  });

  it('local RUN_ERROR still gets the Ollama recovery hint', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out: any[] = [];
    for await (const c of withFriendlyErrors(fakeModel('local'), streamOf({ type: 'RUN_ERROR', message: RAW }), 't')) out.push(c);
    expect(out[0].message).toBe(friendlyOllamaError(RAW));
  });

  it('drops the provider payload rather than putting it on the wire', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out: any[] = [];
    for await (const c of withFriendlyErrors(fakeModel('frontier'), streamOf({ type: 'RUN_ERROR', message: RAW, rawEvent: { secret: 'provider-body' } }), 't')) out.push(c);
    expect(out[0]).not.toHaveProperty('rawEvent');
  });
});
