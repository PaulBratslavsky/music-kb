// Parity guard for the embedding contract the MCP tools duplicate from the
// client's embeddings service.
//
// server/src/mcp/utils/embeddings.ts carries its own copy of the model name,
// the version integer, the task prefixes, the truncation cap, the
// text-builders and the staleness rule. It has to: `server/` cannot import
// @music-kb/music (TS2307 under its CommonJS + default-resolution tsconfig)
// and it cannot import from `client/` either. A shared JSON at the repo root
// does not work, and fails in the worst way — `server/tsconfig.json` sets
// `rootDir: "."` and only copies `src/**/*.json` into dist, so
// `import contract from '../../../../embedding-contract.json'` TYPECHECKS
// GREEN and then throws MODULE_NOT_FOUND at Strapi boot from dist/ (verified
// by actually doing it). It is doubly dead anyway: a shared repo-root file
// breaches CLAUDE.md's rule that `client` and `server` are independent
// packages. The duplication is permanent. This file is what keeps it honest.
//
// Both sides write into the same four Video columns, and each side decides on
// its own whether the other's vectors are usable. Drift has two shapes:
//
//   FAIL-CLOSED — the version or model label disagrees. Rows get EXCLUDED
//   from semanticSearchVideos / relatedVideos / tag suggestions with no error
//   and no log line, while the MCP relatedVideos tool answers from the same
//   DB using the other verdict. The two backfill paths then ping-pong: the
//   /settings "stale" sweep rewrites the library one way, MCP
//   reindexEmbeddings rewrites it back, and it never converges.
//
//   FAIL-OPEN — what gets embedded changes while the version still says `3`.
//   Now vectors built from a different field set are labelled current and
//   every consumer trusts them COMPLETELY, because the only signal is the
//   integer. This is the dangerous one, and it has two doors:
//     (a) the two builders drift apart — pinned by the mirror tests below;
//     (b) the two builders change TOGETHER and nobody bumps the version —
//         pinned by the content fingerprint below, which is keyed BY version
//         so changing what we embed forces a new entry.
//
// The server file is read as TEXT, never imported: CLAUDE.md's rule is that
// `client` never imports from `server/` (separate installs, separate zod
// instances). Same stance as pitch-label-parity.test.ts, which set this
// precedent, and block-vocabulary.test.ts.
//
// WHAT THIS CANNOT CATCH — read before trusting a green run:
//   1. It compares SOURCE, so it cannot see either process's runtime env.
//      That blind spot used to be fatal, because the server resolved its
//      version from `process.env.EMBEDDING_VERSION` with a silent clamp — so
//      `EMBEDDING_VERSION=4` in server/.env diverged the system with both
//      source files still agreeing, and `'1e3'` clamped to 1 rather than
//      1000. The "no runtime degree of freedom" section is what closes it:
//      the server is asserted to have NO env read for the version at all. If
//      someone re-adds one, this guard silently goes back to being partial,
//      so that section is not optional decoration.
//   2. It compares ONE working tree. `server/.env.example` describes a shared
//      Neon Postgres, i.e. a deployed Strapi against the same DB a local
//      client uses. A server running an OLDER COMMIT than the client diverges
//      with this file green in both trees. Source parity presumes one commit;
//      deploy skew is out of its reach.
//   3. `OLLAMA_EMBEDDING_MODEL` IS still env-readable on both sides (model
//      swapping is a real feature), from two different .env files. Only the
//      DEFAULTS are pinned here. Two hosts serving the same model name at
//      different quantizations is invisible to this test and to the compound
//      key. Worse and related: the client resolves its host from
//      OLLAMA_BASE_URL and the server from OLLAMA_HOST, and neither key
//      appears in server/.env.example — so pointing the client at a remote
//      Ollama leaves the MCP reindex on localhost, writing same-labelled
//      vectors from possibly different weights. That is fail-open severity
//      through a config door; it is tracked separately, not fixed here, and
//      it is named here so the omission is a decision rather than an
//      oversight.
//   4. It does not pin cosineSimilarity. Both bodies are identical today, but
//      cosine is scale-invariant, so drift there cannot change rankings.
//   5. It does not pin the reindex candidate query, the populate lists
//      (server caps at one page of 1000, client walks 5000) or a `fields:`
//      restriction on either query. A narrowed populate would change the
//      embedded text with identical builders AND identical versions.
//   6. Passage embeddings are client-only today. buildPassageContext is
//      duplicated in the server file but imported by NOTHING there (a dead
//      export), and PASSAGE_EMBEDDING_VERSION has no server counterpart at
//      all. The mirror below keeps the dead copy correct for the day it is
//      wired up; it does NOT detect an MCP passage tool arriving with its own
//      version constant. If one lands, it needs a section here.
//
// Motivated by docs/ai-architecture.md "Known gaps #1".

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMBEDDING_VERSION } from '#/lib/env';
import {
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_VERSION,
  embeddingStatus,
} from './embeddings';
import { buildMusicExtractionText, type ExtractedMusicData, type StrapiVideo } from './videos';

// Same cwd-relative resolution as pitch-label-parity.test.ts,
// theory-intent-parity.test.ts and authoring-guide.test.ts — this suite runs
// under `yarn --cwd client test`, so process.cwd() is the `client/` package
// root, one level below the repo root that `server/` lives in. A wrong cwd
// throws ENOENT at module load, which is loud.
const REPO_ROOT = resolve(process.cwd(), '..');
const SERVER_EMBEDDINGS_PATH = resolve(REPO_ROOT, 'server/src/mcp/utils/embeddings.ts');
const CLIENT_EMBEDDINGS_PATH = resolve(REPO_ROOT, 'client/src/lib/services/embeddings.ts');
const CLIENT_ENV_PATH = resolve(REPO_ROOT, 'client/src/lib/env.ts');
const CLIENT_VIDEOS_PATH = resolve(REPO_ROOT, 'client/src/lib/services/videos.ts');

const serverSource = readFileSync(SERVER_EMBEDDINGS_PATH, 'utf8');
const clientEmbeddingsSource = readFileSync(CLIENT_EMBEDDINGS_PATH, 'utf8');
const clientEnvSource = readFileSync(CLIENT_ENV_PATH, 'utf8');
const clientVideosSource = readFileSync(CLIENT_VIDEOS_PATH, 'utf8');

// Note the asymmetry, because it is deliberate: the VERSION comes in through a
// normal import (it is a source literal on both sides, so no `process.env` can
// move it), but the MODEL DEFAULT is regexed out of env.ts as text. The
// exported OLLAMA_EMBEDDING_MODEL is env-resolved, and a developer who happens
// to have that variable set in their shell must not be able to turn this test
// red — nor green when the two defaults have actually drifted.

// =============================================================================
// Readers. All of them throw rather than soft-fail: an extractor that quietly
// returns nothing turns every assertion below into a vacuous pass, which is
// the exact silent-green failure this file exists to prevent.
// =============================================================================

/**
 * Comments are stripped before ANY structural match. Two reasons, both real:
 * the server file's header deliberately names `process.env.EMBEDDING_VERSION`
 * in the sentence explaining why it does not read it, and a doc comment
 * carrying an example declaration would otherwise shadow the real constant.
 *
 * Naive on purpose: it does not know about strings, so a `//` inside a string
 * literal eats the rest of that line. Today that hits exactly one line in the
 * server file (`'http://localhost:11434'`, at module scope) and nothing here
 * reads it — verified. If a URL ever moves INTO one of the mirrored bodies,
 * both sides truncate the same way, so the mirror still holds; the content
 * assertions at the bottom are what would notice the loss.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Whitespace + prettier-only trailing commas collapse away so formatting
 * cannot fail this file. The `\s*` sits OUTSIDE the capture group on purpose:
 * with it inside (`/,(\s*[)\]}])/`) the captured whitespace is put straight
 * back, and the music builders — whose arrow wraps across lines on the client
 * and not on the server — differ by one residual space. That was caught by
 * running it, not by reading it.
 */
function collapse(source: string): string {
  return source
    .replace(/,\s*([)\]}])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull exactly one flat literal (`const EMBEDDING_VERSION = 3;`) out of a
 * source file. Global + exactly-one + comment-stripped: `.exec()` on a
 * non-global pattern returns the FIRST match in the file, so a second
 * declaration added later would be read as if it were the only one and this
 * guard would compare a number no code reads.
 */
function extractSoleLiteral(
  source: string,
  path: string,
  pattern: RegExp,
  what: string,
): string {
  const matches = [...stripComments(source).matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `${path}: expected exactly one ${what} matching ${pattern}, found ${matches.length}. ` +
        'Did it get renamed, restructured, or declared twice? This guard is now reading ' +
        'the wrong line, or nothing at all.',
    );
  }
  return matches[0][1];
}

/**
 * Pull one function BODY out of a source file.
 *
 * The parameter list is walked by paren depth before we look for the opening
 * brace, rather than taking the first `{` after the name: the client's
 * `buildMusicExtractionText` declares `opts: { compact?: boolean } = {}` in
 * its parameter list (videos.ts), and a naive scan would return that object
 * type as the "body".
 *
 * The body itself is a plain brace-depth scan, which assumes no brace appears
 * inside a string literal. None does today (the template literals here are
 * balanced, and no plain string contains a brace); if one ever does, the scan
 * truncates and the non-vacuity assertions at the bottom of this file fire.
 */
function extractBody(source: string, path: string, fnName: string): string {
  const declaration = new RegExp(`function\\s+${fnName}\\s*[(<]`).exec(source);
  if (!declaration) {
    throw new Error(
      `${path} has no "function ${fnName}" — did it get renamed or inlined? ` +
        'This guard is now checking nothing.',
    );
  }
  let cursor = source.indexOf('(', declaration.index);
  let parens = 0;
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    else if (source[cursor] === ')') {
      parens -= 1;
      if (parens === 0) {
        cursor += 1;
        break;
      }
    }
  }
  const open = source.indexOf('{', cursor);
  if (open === -1) {
    throw new Error(`${path}: found "${fnName}" but no body brace after its parameter list.`);
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${path}: unbalanced braces in the body of "${fnName}".`);
}

// =============================================================================
// Legitimate, permanent divergences.
//
// Each list is SIDE-KEYED, and each `from` is the exact token expected on THAT
// side only. A bidirectional alternation (`/(?:buildMusicText|buildMusic
// ExtractionText)/`) would erase the difference in whichever direction it
// appeared, which hands the neutralization to the other side too and
// manufactures a fail-open hole — e.g. the client starting to call a local
// `buildMusicText` with different behavior would normalize to the same token
// and stay green.
//
// Adding an entry is a decision, not a chore: a new divergence turns this file
// red and someone has to justify it in review. That is the point.
// =============================================================================

type Substitution = { why: string; from: RegExp; to: string };

/** One duplicated function, and what may legitimately differ about it. */
type MirrorSpec = {
  what: string;
  client: string;
  server: string;
  clientSubs: Substitution[];
  serverSubs: Substitution[];
};

// Substitutions are applied AFTER comments are stripped but BEFORE whitespace
// collapses. Order matters: run them on the collapsed one-liner instead and
// the client's `signal:` removal leaves a brace spacing artifact the server
// has no counterpart for.
function mirrorText(body: string, subs: Substitution[]): string {
  let text = stripComments(body);
  for (const sub of subs) text = text.replace(sub.from, sub.to);
  return collapse(text);
}

const MIRRORS: Record<string, MirrorSpec> = {
  buildEmbeddingText: {
    what: 'buildEmbeddingText — the text every stored vector is built from',
    client: extractBody(clientEmbeddingsSource, CLIENT_EMBEDDINGS_PATH, 'buildEmbeddingText'),
    server: extractBody(serverSource, SERVER_EMBEDDINGS_PATH, 'buildEmbeddingText'),
    clientSubs: [
      {
        why: 'the music sub-builder is buildMusicExtractionText on the client (it lives in videos.ts, next to the type it renders)',
        from: /\bbuildMusicExtractionText\b/g,
        to: 'M',
      },
    ],
    serverSubs: [
      {
        why: 'and buildMusicText on the server, which has no videos.ts to put it in',
        from: /\bbuildMusicText\b/g,
        to: 'M',
      },
    ],
  },
  musicText: {
    what: 'the music-extraction block (v3 of the text-builder)',
    client: extractBody(clientVideosSource, CLIENT_VIDEOS_PATH, 'buildMusicExtractionText'),
    server: extractBody(serverSource, SERVER_EMBEDDINGS_PATH, 'buildMusicText'),
    clientSubs: [
      {
        why: "the client's `compact` mode is prompt-context only (ask-library.ts, server-functions/videos.ts) and is NEVER passed on the embed path — buildEmbeddingText calls this with no opts. Resolve it to the false branch: the only branch a vector is ever built from.",
        from: /!opts\.compact && /g,
        to: '',
      },
      {
        why: 'same, for the two compact ternaries (technique rendering and its join separator). Lazy, not greedy: the construct legitimately contains colons (template literals, `Techniques: `).',
        from: /opts\.compact \? [^:]*? : /g,
        to: '',
      },
    ],
    serverSubs: [
      {
        why: "the server tolerates legacy musicExtraction blobs whose arrays are absent; the client's ExtractedMusicData makes them required. Guard shape only — identical emitted text.",
        from: /blob\.(\w+) && (?=blob\.\1\.length)/g,
        to: '',
      },
    ],
  },
  applyPrefix: {
    what: 'applyPrefix — the search_query:/search_document: task prefixes',
    client: extractBody(clientEmbeddingsSource, CLIENT_EMBEDDINGS_PATH, 'applyPrefix'),
    server: extractBody(serverSource, SERVER_EMBEDDINGS_PATH, 'applyPrefix'),
    clientSubs: [],
    serverSubs: [],
  },
  embedText: {
    what: 'embedText — truncation ORDER, the prefix call, and the request body',
    client: extractBody(clientEmbeddingsSource, CLIENT_EMBEDDINGS_PATH, 'embedText'),
    server: extractBody(serverSource, SERVER_EMBEDDINGS_PATH, 'embedText'),
    clientSubs: [
      {
        why: 'the client aborts at 60s; the server has no timeout. A real gap, tracked separately — it changes whether a call HANGS, never what text gets embedded.',
        from: /signal: AbortSignal\.timeout\(60_000\),/g,
        to: '',
      },
    ],
    serverSubs: [],
  },
  buildPassageContext: {
    what: 'buildPassageContext — the per-chunk context anchor (dead on the server today; see "cannot catch" #6)',
    client: extractBody(clientEmbeddingsSource, CLIENT_EMBEDDINGS_PATH, 'buildPassageContext'),
    server: extractBody(serverSource, SERVER_EMBEDDINGS_PATH, 'buildPassageContext'),
    clientSubs: [
      { why: 'the client names its parameter `v`', from: /\bv\./g, to: 'X.' },
    ],
    serverSubs: [
      { why: 'the server names the same parameter `video`', from: /\bvideo\./g, to: 'X.' },
    ],
  },
};

const normalizedClient = Object.fromEntries(
  Object.entries(MIRRORS).map(([k, m]) => [k, mirrorText(m.client, m.clientSubs)]),
) as Record<keyof typeof MIRRORS, string>;
const normalizedServer = Object.fromEntries(
  Object.entries(MIRRORS).map(([k, m]) => [k, mirrorText(m.server, m.serverSubs)]),
) as Record<keyof typeof MIRRORS, string>;

const MAX_EMBED_CHARS = Number(
  extractSoleLiteral(
    clientEmbeddingsSource,
    CLIENT_EMBEDDINGS_PATH,
    /^const MAX_EMBED_CHARS = (\d+);$/gm,
    'MAX_EMBED_CHARS declaration',
  ),
);

// =============================================================================
// §1 — the invalidation key: EMBEDDING_VERSION
// =============================================================================

describe('EMBEDDING_VERSION is the same integer on both sides', () => {
  it('the client literal and the server literal agree', () => {
    const serverVersion = Number(
      extractSoleLiteral(
        serverSource,
        SERVER_EMBEDDINGS_PATH,
        /^const EMBEDDING_VERSION = (\d+);$/gm,
        'EMBEDDING_VERSION declaration',
      ),
    );
    expect(
      serverVersion,
      `EMBEDDING_VERSION is ${serverVersion} in ${SERVER_EMBEDDINGS_PATH} but ` +
        `${EMBEDDING_VERSION} in ${CLIENT_ENV_PATH}. These two label the SAME column ` +
        '(Video.embeddingVersion) and each side reads the other side\'s rows. While they ' +
        'disagree, every vector one side writes is "stale" to the other: semantic search, ' +
        'relatedVideos and tag suggestions silently drop those rows, and the two backfill ' +
        'paths (the /settings stale sweep and the MCP reindexEmbeddings tool) overwrite ' +
        'each other forever without converging. Set both literals to the same number in ' +
        'the same commit.',
    ).toBe(EMBEDDING_VERSION);
    // The value must also reach the consumer, not just the declaration.
    expect(CURRENT_EMBEDDING_VERSION).toBe(EMBEDDING_VERSION);
  });

  it('the server re-exports the literal it declares, unmodified', () => {
    expect(
      stripComments(serverSource),
      `${SERVER_EMBEDDINGS_PATH} no longer exports CURRENT_EMBEDDING_VERSION as a plain ` +
        'alias of its EMBEDDING_VERSION literal. Something now sits between the constant ' +
        'this file checks and the value reindexEmbeddings actually stamps on rows — which ' +
        'is how the old parseInt clamp hid, and it makes the check above meaningless.',
    ).toMatch(/export const CURRENT_EMBEDDING_VERSION = EMBEDDING_VERSION;/);
  });
});

// =============================================================================
// §2 — the invalidation key: OLLAMA_EMBEDDING_MODEL default
// =============================================================================

describe('the OLLAMA_EMBEDDING_MODEL default is the same on both sides', () => {
  it('both sides fall back to the same model name', () => {
    // Regexed out of env.ts rather than imported: the exported constant is
    // env-resolved, so importing it would make this test pass or fail based
    // on the developer's shell.
    const clientDefault = extractSoleLiteral(
      clientEnvSource,
      CLIENT_ENV_PATH,
      /readEnv\('OLLAMA_EMBEDDING_MODEL'\)\s*\?\?\s*'([^']+)'/g,
      'OLLAMA_EMBEDDING_MODEL default',
    );
    const serverDefault = extractSoleLiteral(
      serverSource,
      SERVER_EMBEDDINGS_PATH,
      /process\.env\.OLLAMA_EMBEDDING_MODEL\?\.trim\(\)\s*\|\|\s*'([^']+)'/g,
      'OLLAMA_EMBEDDING_MODEL default',
    );
    expect(
      serverDefault,
      `${SERVER_EMBEDDINGS_PATH} defaults to '${serverDefault}' but ${CLIENT_ENV_PATH} ` +
        `defaults to '${clientDefault}'. embeddingModel is half the compound invalidation ` +
        'key, so with nobody overriding the env var — the normal case, since neither .env ' +
        'nor .env.example mentions it — the MCP reindex stamps one label and the in-app ' +
        'reindex stamps another, and each side reads the other\'s rows as stale forever. ' +
        'Make the two defaults the same string.',
    ).toBe(clientDefault);
  });

  it('the server falls back on an empty-string override, the way readEnv does', () => {
    expect(
      stripComments(serverSource),
      `${SERVER_EMBEDDINGS_PATH} must read OLLAMA_EMBEDDING_MODEL as ` +
        "`process.env.OLLAMA_EMBEDDING_MODEL?.trim() || '<default>'`, not with `??`. " +
        '`??` only falls back on null/undefined, so `OLLAMA_EMBEDDING_MODEL=` (empty, a ' +
        "shape real .env files grow) resolves to '' — every MCP-written row is then " +
        "stamped `embeddingModel: ''` and the client reads all of them as stale, forever, " +
        'with no error anywhere. readEnv() in client/src/lib/env.ts exists precisely to ' +
        'close this hole; this side has to close it the same way.',
    ).toMatch(/process\.env\.OLLAMA_EMBEDDING_MODEL\?\.trim\(\) \|\|/);
  });
});

// =============================================================================
// §3 — the server has no runtime degree of freedom.
//
// This is the section that makes §1 TOTAL rather than partial. A vitest
// process cannot observe Strapi's process.env, and server/.env is gitignored,
// so the only way source parity can pin the version is if the version cannot
// come from anywhere but source.
// =============================================================================

describe('the server resolves its version from source alone', () => {
  it('does not read EMBEDDING_VERSION from the environment', () => {
    expect(
      stripComments(serverSource),
      `${SERVER_EMBEDDINGS_PATH} reads EMBEDDING_VERSION from process.env again. That ` +
        'reopens the hole this whole guard was built to close: the client\'s version is a ' +
        'source literal, so an env override on the server can only ever DIVERGE the two — ' +
        'there is no configuration it expresses that is not a bug. `EMBEDDING_VERSION=4` in ' +
        'server/.env would split the library with both source files still agreeing, and ' +
        'this file would stay green while it happened. (The header comment in that file ' +
        'names the variable on purpose to explain the ban; comments are stripped before ' +
        'this match, so prose is safe and only code fails.)',
    ).not.toMatch(/process\.env\.EMBEDDING_VERSION/);
  });

  it('declares the version as a bare literal, with nothing computing it', () => {
    // Positive form on purpose. A blanket ban on `parseInt` / `Number.isFinite`
    // would outlaw two general-purpose idioms across the whole file and fail a
    // future unrelated use with a message about embedding versions. This
    // subsumes it: no IIFE, clamp, parse or fallback can match this shape.
    expect(
      stripComments(serverSource),
      `${SERVER_EMBEDDINGS_PATH} no longer declares EMBEDDING_VERSION as a bare ` +
        '`const EMBEDDING_VERSION = <digits>;` on its own line. Anything computed — a ' +
        'parseInt, a clamp, an IIFE, a fallback — means the number this file reads is not ' +
        'necessarily the number Strapi runs with. The previous shape did exactly that and ' +
        "silently pinned the server to v1 for `EMBEDDING_VERSION=1e3`, because " +
        "parseInt('1e3', 10) === 1.",
    ).toMatch(/^const EMBEDDING_VERSION = \d+;$/m);
  });
});

// =============================================================================
// §4 — what gets embedded (the fail-open surface)
// =============================================================================

const mirrorFailure = (key: keyof typeof MIRRORS) =>
  `${MIRRORS[key].what} has drifted between ${CLIENT_EMBEDDINGS_PATH} (and videos.ts) ` +
  `and ${SERVER_EMBEDDINGS_PATH}. These are policy-mirrors: the MCP reindex and the ` +
  'in-app reindex must build the SAME string, or vectors written by one come from a ' +
  'different field set than vectors written by the other — while both are still labelled ' +
  `embeddingVersion ${EMBEDDING_VERSION}, so nothing flags them stale and every consumer ` +
  'trusts them completely. Mirror the edit into the other file. If the difference is a ' +
  'legitimate, permanent divergence, add it to CLIENT_SUBS/SERVER_SUBS in this file with ' +
  'a reason — deliberately, so it gets reviewed. If you changed WHAT is embedded, bump ' +
  'EMBEDDING_VERSION in client/src/lib/env.ts AND server/src/mcp/utils/embeddings.ts in ' +
  'the same commit.';

describe('both sides build the same text from the same row', () => {
  for (const key of Object.keys(MIRRORS) as Array<keyof typeof MIRRORS>) {
    it(`${MIRRORS[key].what} is a mirror on both sides`, () => {
      expect(normalizedServer[key], mirrorFailure(key)).toBe(normalizedClient[key]);
    });
  }

  it('the client renders the music block exactly as expected on a full fixture', () => {
    // The one behavioral anchor, so the normalizer can never be the only thing
    // standing between the reader and a wrong string.
    const fixture: ExtractedMusicData = {
      version: 1,
      model: 'test',
      generatedAt: '2026-01-01T00:00:00.000Z',
      key: { root: 'E', type: 'minor', confidence: 'high' },
      chords: [
        { root: 'E', quality: 'minor', context: 'x' },
        { root: 'G', quality: 'major', context: 'x' },
      ],
      techniques: [
        { name: 'travis picking', description: 'alternating bass', context: 'x' },
      ],
      songs: [{ title: 'Dust in the Wind', artist: 'Kansas', context: 'x' }],
    };
    expect(buildMusicExtractionText(fixture)).toBe(
      'Key: E minor\n' +
        'Chords: E minor, G major\n' +
        // The dash between name and description is an EM DASH (U+2014), not a
        // hyphen. It is a character a careless edit silently replaces, and it
        // is inside the embedded text on both sides.
        'Techniques: travis picking — alternating bass\n' +
        'Songs: Dust in the Wind by Kansas',
    );
  });
});

// =============================================================================
// §5 — what gets embedded has not changed without a version bump.
//
// §4 proves the two sides AGREE. It cannot prove they are still building what
// v3 vectors were built from — mirror an edit into both files correctly and §4
// stays green while every stored vector silently becomes a different text
// space. That is CLAUDE.md's "bump EMBEDDING_VERSION when changing the
// text-builder" gotcha, and this is its guard.
//
// The fingerprint is keyed BY VERSION, so changing what gets embedded means
// adding an entry, which means bumping the version. It is taken over the
// CLIENT side only: §4 has already established the server equals it, and it
// fails first with a message you can read.
// =============================================================================

const EMBEDDED_CONTENT_FINGERPRINTS: Record<number, string> = {
  3: 'ca579232182e0a89ad2b8127a6757bf4cb8efb04c11b85a95b5010663503f4c6',
};

describe('the embedded-text contract is pinned to its version', () => {
  it('what gets embedded has not changed without a version bump', () => {
    const fingerprint = createHash('sha256')
      .update(normalizedClient.buildEmbeddingText)
      .update(normalizedClient.musicText)
      .update(normalizedClient.applyPrefix)
      .update(normalizedClient.embedText)
      .update(String(MAX_EMBED_CHARS))
      .digest('hex');
    expect(
      fingerprint,
      'The text that gets embedded has changed, but EMBEDDING_VERSION is still ' +
        `${EMBEDDING_VERSION}. Every vector already in the library was built from the OLD ` +
        `text and is still labelled ${EMBEDDING_VERSION}, so embeddingStatus() reports ` +
        "'current' for all of them, nothing will ever recompute them, and /feed semantic " +
        'search and relatedVideos silently mix two vector spaces. Diff ' +
        `${CLIENT_EMBEDDINGS_PATH} and ${CLIENT_VIDEOS_PATH} to see what moved. Then: ` +
        'bump EMBEDDING_VERSION in BOTH client/src/lib/env.ts and ' +
        'server/src/mcp/utils/embeddings.ts, and add a new entry here:\n' +
        `  ${EMBEDDING_VERSION + 1}: '${fingerprint}',\n` +
        'If — and only if — the edit was a pure refactor that cannot change a single ' +
        `emitted byte, update the ${EMBEDDING_VERSION} entry in place instead and say so ` +
        'in the commit message.',
    ).toBe(EMBEDDED_CONTENT_FINGERPRINTS[EMBEDDING_VERSION]);
  });

  it('both sides truncate at the same MAX_EMBED_CHARS', () => {
    const serverMax = Number(
      extractSoleLiteral(
        serverSource,
        SERVER_EMBEDDINGS_PATH,
        /^const MAX_EMBED_CHARS = (\d+);$/gm,
        'MAX_EMBED_CHARS declaration',
      ),
    );
    expect(
      serverMax,
      `MAX_EMBED_CHARS is ${serverMax} on the server and ${MAX_EMBED_CHARS} on the client. ` +
        'Long summaries would then be cut at different points and produce different ' +
        'vectors from the same row, with both labelled current.',
    ).toBe(MAX_EMBED_CHARS);
  });
});

// =============================================================================
// §6 — what counts as stale
// =============================================================================

describe('the staleness rule is the same on both sides', () => {
  // Fixtures are derived from the imported constants, never hardcoded:
  // embeddingStatus compares against CURRENT_EMBEDDING_MODEL, which IS
  // env-resolved, so a literal 'nomic-embed-text' here would go red for any
  // developer with OLLAMA_EMBEDDING_MODEL exported in their shell.
  const currentRow = {
    summaryEmbedding: [0.1, 0.2],
    embeddingModel: CURRENT_EMBEDDING_MODEL,
    embeddingVersion: CURRENT_EMBEDDING_VERSION,
  };
  const asVideo = (row: Partial<typeof currentRow>) =>
    ({ ...currentRow, ...row }) as unknown as StrapiVideo;

  it('the client predicate returns the four expected verdicts', () => {
    expect(embeddingStatus(asVideo({ summaryEmbedding: undefined }))).toBe('missing');
    expect(embeddingStatus(asVideo({ summaryEmbedding: [] }))).toBe('missing');
    expect(
      embeddingStatus(asVideo({ embeddingModel: `${CURRENT_EMBEDDING_MODEL}-other` })),
    ).toBe('stale');
    expect(
      embeddingStatus(asVideo({ embeddingVersion: CURRENT_EMBEDDING_VERSION + 1 })),
    ).toBe('stale');
    expect(embeddingStatus(asVideo({}))).toBe('current');
  });

  it('the server predicate still applies all three rules', () => {
    // Structural, not behavioral: we cannot execute the server function from
    // here. The two bodies are equivalent but not textually identical (the
    // client folds model and version into one `||`), so this checks that each
    // rule is still PRESENT rather than mirroring the text. Dropping any one
    // of them is fail-open — the server would call a vector from the wrong
    // model or the wrong version 'current' and reindexEmbeddings would skip it.
    const body = collapse(
      stripComments(extractBody(serverSource, SERVER_EMBEDDINGS_PATH, 'embeddingStatus')),
    );
    expect(body, "the server's missing-vector guard is gone").toMatch(
      /summaryEmbedding\.length === 0.*return 'missing'/,
    );
    expect(body, "the server no longer compares embeddingModel to CURRENT_EMBEDDING_MODEL").toMatch(
      /embeddingModel !== CURRENT_EMBEDDING_MODEL/,
    );
    expect(
      body,
      "the server no longer compares embeddingVersion to CURRENT_EMBEDDING_VERSION",
    ).toMatch(/embeddingVersion !== CURRENT_EMBEDDING_VERSION/);
  });
});

// =============================================================================
// §7 — guard the guard.
//
// A length floor is not enough here: 300 characters of mangled text satisfies
// one, and if a substitution over-fires SYMMETRICALLY both sides reduce to the
// same wrong string and §4 passes with it. So these assert on the CONTENT of
// the post-substitution bodies — the exact strings that must survive
// normalization for the comparisons above to mean anything.
// =============================================================================

describe('the readers above actually read something', () => {
  it('buildEmbeddingText still names every field it concatenates', () => {
    for (const token of [
      'videoTitle',
      'summaryTitle',
      'summaryDescription',
      'summaryOverview',
      'keyTakeaways',
      'sections',
      'Tags: ',
      'M(video.musicExtraction)',
    ]) {
      for (const [side, text] of [
        ['client', normalizedClient.buildEmbeddingText],
        ['server', normalizedServer.buildEmbeddingText],
      ] as const) {
        expect(
          text,
          `the ${side} buildEmbeddingText body no longer mentions "${token}" after ` +
            'normalization. Either the builder genuinely dropped a field (bump ' +
            'EMBEDDING_VERSION) or extractBody/the substitutions mangled it — in which ' +
            'case the mirror test above is comparing garbage to garbage.',
        ).toContain(token);
      }
    }
  });

  it('the music builder still emits all four labels', () => {
    for (const token of ['Key: ', 'Chords: ', 'Techniques: ', 'Songs: ']) {
      expect(normalizedClient.musicText).toContain(token);
      expect(normalizedServer.musicText).toContain(token);
    }
  });

  it('applyPrefix still carries both task prefixes', () => {
    for (const text of [normalizedClient.applyPrefix, normalizedServer.applyPrefix]) {
      expect(text).toContain('search_query: ');
      expect(text).toContain('search_document: ');
    }
  });

  it('embedText still truncates before it prefixes, and posts to /api/embeddings', () => {
    for (const text of [normalizedClient.embedText, normalizedServer.embedText]) {
      // Order is the vector-relevant fact: slice the raw text, THEN prefix.
      // Prefix-then-slice would change every embedded string near the cap.
      expect(text).toContain('applyPrefix(trimmed.slice(0, MAX_EMBED_CHARS - 32), task)');
      expect(text).toContain('/api/embeddings');
    }
  });

  it('the fingerprint is taken over four non-empty bodies', () => {
    for (const key of ['buildEmbeddingText', 'musicText', 'applyPrefix', 'embedText'] as const) {
      expect(normalizedClient[key].length, `${key} normalized to nothing`).toBeGreaterThan(40);
    }
    expect(EMBEDDED_CONTENT_FINGERPRINTS[EMBEDDING_VERSION]).toMatch(/^[0-9a-f]{64}$/);
  });
});
