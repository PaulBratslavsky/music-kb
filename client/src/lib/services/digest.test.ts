// Pins `synthesizeDigest`'s model plumbing. There was no digest.test.ts
// before the surface-keyed model refactor, which is why the two traps below
// went unnoticed for as long as they did:
//
//  1. The old code chose modelOptions with `override ? {} : samplingOptions(…)`
//     — ARGUMENT PRESENCE used as a proxy for "frontier". It held only
//     because the sole caller passed the argument only on frontier. Any
//     subsumption that kept the ternary while always passing a model would
//     silently drop `temperature: 0.3` from every standalone /digest
//     synthesis, running it at Ollama's default — the exact drift
//     DIGEST_SYSTEM's prompt notes and `looksLikeSchemaKey` exist to
//     defend against. The discriminator is `model.tier` now.
//
//  2. `synthesizeDigest` is the ONE non-lesson service that can legitimately
//     run on the frontier tier, by inheritance from a frontier lesson. Its
//     own default is local and cannot be otherwise (`resolveModel`'s return
//     type), so the whole guarantee rests on non-lesson callers not passing
//     an override. That is now asserted rather than assumed.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/ai', () => ({ chat: vi.fn() }));

import { chat } from '@tanstack/ai';
import { OLLAMA_MODEL } from '#/lib/env';
import { synthesizeDigest, synthesizeDigestArticle } from './digest';
import type { StrapiVideo } from './videos';

const mockedChat = vi.mocked(chat);

function video(id: string): StrapiVideo {
  return {
    id: 1,
    documentId: `doc-${id}`,
    youtubeVideoId: id,
    videoTitle: `Video ${id}`,
    videoAuthor: 'Someone',
    summaryStatus: 'generated',
    summaryTitle: `T ${id}`,
    summaryOverview: `O ${id}`,
    keyTakeaways: [],
    sections: [],
  } as unknown as StrapiVideo;
}

const VIDEOS = [video('yt-A'), video('yt-B')];

const DIGEST_OUT = {
  title: 'A real title',
  description: 'A real description',
  overallTheme: 'theme',
  sharedThemes: [],
  uniqueInsights: [],
  contradictions: [],
  viewingOrder: [],
  bottomLine: 'bottom line',
};

beforeEach(() => {
  mockedChat.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('synthesizeDigest — model plumbing', () => {
  it('defaults to the LOCAL digest-synthesis surface and keeps temperature 0.3', async () => {
    mockedChat.mockResolvedValueOnce(DIGEST_OUT);

    const result = await synthesizeDigest(VIDEOS);

    expect(result.success).toBe(true);
    const call = mockedChat.mock.calls[0][0] as {
      adapter: { name: string; model: string };
      modelOptions: unknown;
    };
    // A real Ollama adapter, asserted by identity rather than by a label.
    expect(call.adapter.name).toBe('ollama');
    expect(call.adapter.model).toBe(OLLAMA_MODEL);
    // The regression this file exists for: sampling must survive.
    expect(call.modelOptions).toEqual({ model: OLLAMA_MODEL, options: { temperature: 0.3 } });
  });

  it('runs on an inherited frontier model when one is passed, and sends NO sampling knobs', async () => {
    mockedChat.mockResolvedValueOnce(DIGEST_OUT);
    const frontierAdapter = { name: 'anthropic', model: 'claude-sonnet-5' };
    const inherited = {
      tier: 'frontier' as const,
      adapter: frontierAdapter,
      model: 'claude-sonnet-5' as const,
      modelOptions: () => ({}),
      friendlyError: () => 'Frontier AI request failed.',
      redact: (raw: string) => raw,
      toJSON: () => ({ tier: 'frontier' as const, model: 'claude-sonnet-5' }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await synthesizeDigest(VIDEOS, inherited as any);

    expect(result.success).toBe(true);
    const call = mockedChat.mock.calls[0][0] as { adapter: unknown; modelOptions: unknown };
    expect(call.adapter).toBe(frontierAdapter);
    // Frontier rejects `temperature` with a 400 invalid_request_error.
    expect(call.modelOptions).toEqual({});
  });

  it('scrubs an inherited model\'s error text before logging and returning it', async () => {
    // `redact` is an identity function on the local tier, so this path is
    // invisible unless a frontier model is passed. It is the only scrub
    // between an Anthropic error payload and this service's log line.
    mockedChat.mockRejectedValueOnce(new Error('boom SECRET boom'));
    const inherited = {
      tier: 'frontier' as const,
      adapter: { name: 'anthropic' },
      model: 'claude-sonnet-5' as const,
      modelOptions: () => ({}),
      friendlyError: () => 'Frontier AI request failed.',
      redact: (raw: string) => raw.split('SECRET').join('[redacted]'),
      toJSON: () => ({ tier: 'frontier' as const, model: 'claude-sonnet-5' }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await synthesizeDigest(VIDEOS, inherited as any);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).not.toContain('SECRET');
    expect(result.error).toContain('[redacted]');
  });

  it('validates before resolving, so a bad OLLAMA_BASE_URL cannot turn a guard into a throw', async () => {
    // Resolution happens inside the try, not in a default parameter —
    // a default is evaluated before these guards and constructing an
    // adapter runs `new URL(host)`, which throws on a malformed host.
    const one = await synthesizeDigest([video('solo')]);
    expect(one).toEqual({ success: false, error: 'Need at least 2 videos to create a digest.' });
    expect(mockedChat).not.toHaveBeenCalled();

    const needsSummaries = await synthesizeDigest([
      video('yt-A'),
      { ...video('yt-B'), summaryStatus: 'pending' } as StrapiVideo,
    ]);
    expect(needsSummaries.success).toBe(false);
    if (needsSummaries.success) return;
    // Echoed verbatim, naming the offending video — this is why
    // lesson-generation.ts keeps `friendlyOllamaError` on the digest
    // failure branch rather than the frontier mapper, which would can this
    // into "Frontier AI request failed."
    expect(needsSummaries.error).toContain('Video yt-B');
    expect(mockedChat).not.toHaveBeenCalled();
  });
});

describe('synthesizeDigestArticle — its own surface key', () => {
  it('resolves digest-article locally and takes no model parameter', async () => {
    mockedChat.mockResolvedValueOnce('# An article\n\nBody.');

    const result = await synthesizeDigestArticle(VIDEOS);

    expect(result.success).toBe(true);
    const call = mockedChat.mock.calls[0][0] as {
      adapter: { name: string; model: string };
      modelOptions: unknown;
    };
    expect(call.adapter.name).toBe('ollama');
    expect(call.adapter.model).toBe(OLLAMA_MODEL);
    expect(call.modelOptions).toEqual({ model: OLLAMA_MODEL, options: { temperature: 0.3 } });
    // A single "digest" surface key would have promoted this function the
    // moment synthesizeDigest became reachable from a frontier lesson. It is
    // unreachable from lesson generation and must stay so.
    expect(synthesizeDigestArticle.length).toBe(1);
  });
});

describe('the frontier override has exactly one caller', () => {
  it('only lesson-generation.ts passes a second argument to synthesizeDigest', () => {
    // The local-first guarantee for digest synthesis is "its own default is
    // local, and the only frontier path is an explicit argument from the one
    // module allowed to build a frontier adapter". That is only true while
    // no other caller passes one — generateDigestByIds and the /digest
    // server functions must hit the default.
    const SRC_ROOT = new URL('../../', import.meta.url).pathname;
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    };

    const withSecondArg: string[] = [];
    let callSites = 0;
    for (const f of walk(SRC_ROOT)) {
      // Line comments FIRST — see stripComments' note in
      // model-policy.test.ts: a `//   /*.json:` line comment otherwise opens
      // a fake block comment and swallows the rest of the file.
      const src = readFileSync(f, 'utf8')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      // The lookbehind skips the declaration in digest.ts itself — its
      // parameter list obviously contains a comma.
      for (const m of src.matchAll(/(?<!function\s)\bsynthesizeDigest\(([^;]*?)\)[;,\s]/gs)) {
        callSites++;
        if (m[1].includes(',')) withSecondArg.push(f.slice(SRC_ROOT.length));
      }
    }
    expect(callSites).toBeGreaterThanOrEqual(2); // guard on the guard
    expect(withSecondArg).toEqual(['lib/services/lesson-generation.ts']);
  });
});
