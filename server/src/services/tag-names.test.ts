// One rule for what a tag is called, and one for its slug (issue #14).
//
// A tag can be created three ways — the REST share flow (through the
// document-service middleware in src/index.ts), the MCP tools, and the seed
// script — and each used to carry its own copy of these rules. They had
// drifted: the middleware's slug stripped `_` and `&` before turning
// separators into dashes ("hip_hop" -> "hiphop", where the others gave
// "hip-hop"), and every MCP tool looked a name up WITHOUT collapsing
// whitespace while the middleware stored it collapsed — so "jazz  blues"
// never matched "jazz blues".
import { describe, expect, it } from 'vitest';
import { normalizeTagName, slugifyTagName } from './tag-names';
import { norm as seedNorm, slugify as seedSlugify } from '../../scripts/seed-music-tags.mjs';

describe('normalizeTagName', () => {
  it.each([
    ['Jazz', 'jazz'],
    ['  jazz  ', 'jazz'],
    ['jazz  blues', 'jazz blues'], // the case that threw
    ['Jazz \t\n Blues', 'jazz blues'],
    ['hip_hop', 'hip_hop'], // names keep their punctuation; only slugs lose it
    ['R&B', 'r&b'],
  ])('%j -> %j', (raw, expected) => {
    expect(normalizeTagName(raw)).toBe(expected);
  });

  it('is idempotent — a stored name normalizes to itself', () => {
    for (const raw of ['jazz  blues', ' R&B ', 'Hip Hop']) {
      const once = normalizeTagName(raw);
      expect(normalizeTagName(once)).toBe(once);
    }
  });
});

describe('slugifyTagName', () => {
  it.each([
    ['jazz', 'jazz'],
    ['jazz blues', 'jazz-blues'],
    ['hip_hop', 'hip-hop'], // was "hiphop" on the REST path
    ['r&b', 'r-b'], // was "rb" on the REST path
    ["rock 'n' roll", 'rock-n-roll'],
    ["don't", 'dont'],
    ['don’t', 'don-t'], // curly: a different name, so a different slug
    ['rock ‘n’ roll', 'rock-n-roll'], // left + right single quotes: punctuation, so dashes
    ['--edgy--', 'edgy'],
    ['   ', 'tag'],
    ['!!!', 'tag'],
  ])('%j -> %j', (name, expected) => {
    expect(slugifyTagName(name)).toBe(expected);
  });

  it('caps the slug at 60 characters', () => {
    expect(slugifyTagName('a'.repeat(80))).toHaveLength(60);
  });

  it('two spellings that normalize to the same name share a slug', () => {
    expect(slugifyTagName(normalizeTagName('Jazz  Blues'))).toBe(
      slugifyTagName(normalizeTagName('jazz blues')),
    );
  });
});

describe('the seed script keeps the same rules', () => {
  // It is plain `.mjs` run by node, so it cannot import this TypeScript module
  // and keeps its own copy. This holds the copy to the real rules.
  const SAMPLES = [
    'Jazz',
    '  jazz  blues ',
    'Jazz \t Blues',
    'hip_hop',
    'R&B',
    "rock 'n' roll",
    'don’t',
    'rock ‘n’ roll',
    '--edgy--',
    '   ',
    'a'.repeat(80),
  ];

  it.each(SAMPLES)('%j', (raw) => {
    expect(seedNorm(raw)).toBe(normalizeTagName(raw));
    expect(seedSlugify(seedNorm(raw))).toBe(slugifyTagName(normalizeTagName(raw)));
  });
});
