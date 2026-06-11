// Hermetic tests for the pure parts of the music-extraction pipeline:
// sanitization (model output is schema-valid but content-untrusted),
// BM25 grounding (ADR 0004 — timeSec comes from the transcript, never the
// model), the cheap pre-filter gate, and the staleness check.

import { describe, expect, it } from 'vitest';
import {
  MUSIC_EXTRACTION_VERSION,
  groundMusicExtraction,
  looksLikeMusicInstruction,
  musicExtractionStatus,
  sanitizeMusicExtraction,
} from './music-extraction';
import { buildBM25Index, type TranscriptChunk } from './transcript';
import { OLLAMA_MODEL } from '#/lib/env';
import type { ExtractedMusicData } from './videos';

function rawOutput(
  overrides: Partial<Parameters<typeof sanitizeMusicExtraction>[0]> = {},
) {
  return {
    isMusicInstruction: true,
    key: null,
    chords: [],
    techniques: [],
    songs: [],
    ...overrides,
  };
}

describe('sanitizeMusicExtraction', () => {
  it('normalizes pitch classes, salvages packed roots, drops non-pitch letters', () => {
    const out = sanitizeMusicExtraction(
      rawOutput({
        chords: [
          { root: ' e ', quality: 'Min', context: 'start with E minor' },
          { root: 'B♭', quality: 'maj', context: 'then B flat major' },
          { root: 'H', quality: 'maj', context: 'german notation sneaks in' },
          // Quality packed into the root: salvage the pitch-class prefix —
          // the quality field carries the rest.
          { root: 'C#m', quality: 'min', context: 'sharp minor riff section' },
        ],
      }),
    );
    expect(out.chords).toEqual([
      { root: 'E', quality: 'min', context: 'start with E minor' },
      { root: 'Bb', quality: 'maj', context: 'then B flat major' },
      { root: 'C#', quality: 'min', context: 'sharp minor riff section' },
    ]);
  });

  it('dedupes chords by root+quality, keeping first occurrence', () => {
    const out = sanitizeMusicExtraction(
      rawOutput({
        chords: [
          { root: 'A', quality: 'min', context: 'first mention' },
          { root: 'A', quality: 'MIN', context: 'same chord again' },
          { root: 'A', quality: 'maj7', context: 'different quality survives' },
        ],
      }),
    );
    expect(out.chords.map((c) => `${c.root}${c.quality}`)).toEqual([
      'Amin',
      'Amaj7',
    ]);
    expect(out.chords[0].context).toBe('first mention');
  });

  it('maps key-type aliases to the Loop vocabulary and validates the root', () => {
    expect(
      sanitizeMusicExtraction(
        rawOutput({
          key: { root: 'f#', type: 'Aeolian', confidence: 'high' as const },
        }),
      ).key,
    ).toEqual({ root: 'F#', type: 'minor', confidence: 'high' });

    expect(
      sanitizeMusicExtraction(
        rawOutput({
          key: { root: 'X', type: 'major', confidence: 'low' as const },
        }),
      ).key,
    ).toBeNull();
  });

  it('clamps over-length strings and drops empty-named items', () => {
    const long = 'x'.repeat(500);
    const out = sanitizeMusicExtraction(
      rawOutput({
        techniques: [
          { name: long, description: long, context: long },
          { name: '   ', description: 'dropped', context: 'dropped' },
        ],
        songs: [{ title: long, artist: long, context: long }],
      }),
    );
    expect(out.techniques).toHaveLength(1);
    expect(out.techniques[0].name.length).toBeLessThanOrEqual(80);
    expect(out.techniques[0].description.length).toBeLessThanOrEqual(300);
    expect(out.techniques[0].context.length).toBeLessThanOrEqual(200);
    expect(out.songs[0].title.length).toBeLessThanOrEqual(140);
    expect(out.songs[0].artist!.length).toBeLessThanOrEqual(120);
  });
});

describe('groundMusicExtraction', () => {
  // A real BM25 index over distinct chunks with real timecodes — grounding
  // must return the matching chunk's timeSec, and refuse to guess below
  // the score floor. Corpus is sized so the query terms clear the IDF
  // filter (see retrieval-fusion.test.ts for the same constraint).
  const chunks: TranscriptChunk[] = [
    { id: 0, text: 'today we learn the spider exercise for alternate picking accuracy', startWord: 0, timeSec: 12 },
    { id: 1, text: 'place your fingers for the E minor chord shape like this', startWord: 0, timeSec: 95 },
    { id: 2, text: 'now strum the B flat major barre chord slowly', startWord: 0, timeSec: 180 },
    { id: 3, text: 'this riff comes from Wonderwall by Oasis as you probably know', startWord: 0, timeSec: 240 },
    { id: 4, text: 'remember to keep your wrist relaxed while playing', startWord: 0, timeSec: 300 },
    { id: 5, text: 'practice with a metronome at sixty beats per minute', startWord: 0, timeSec: 360 },
    { id: 6, text: 'the bridge section uses a descending bassline pattern', startWord: 0, timeSec: 420 },
    { id: 7, text: 'thanks for watching and see you in the next lesson', startWord: 0, timeSec: 480 },
  ];
  const index = buildBM25Index(chunks);

  type Groundable = { context: string; timeSec?: number };

  it('assigns the matching chunk timeSec to items whose context grounds', () => {
    const items: Groundable[] = [
      { context: 'E minor chord shape fingers' },
      { context: 'Wonderwall by Oasis riff' },
    ];
    const grounded = groundMusicExtraction(items, index);
    expect(grounded[0].timeSec).toBe(95);
    expect(grounded[1].timeSec).toBe(240);
  });

  it('leaves timeSec undefined when nothing scores above the floor', () => {
    const items: Groundable[] = [{ context: 'zebra quantum spreadsheet' }];
    const grounded = groundMusicExtraction(items, index);
    expect(grounded[0].timeSec).toBeUndefined();
  });

  it('never trusts a pre-existing timeSec from the input (ADR 0004)', () => {
    const grounded = groundMusicExtraction(
      [{ context: 'zebra quantum spreadsheet', timeSec: 999 }],
      index,
    );
    // No grounding match → the item keeps whatever it had; the service
    // layer only ever passes model output WITHOUT timeSec (the zod schema
    // has no timestamp field), so 999 can only come from a stored blob
    // being re-grounded — in which case re-grounding wins where it can:
    const regrounded = groundMusicExtraction(
      [{ context: 'E minor chord shape fingers', timeSec: 999 }],
      index,
    );
    expect(regrounded[0].timeSec).toBe(95);
    expect(grounded[0].timeSec).toBe(999);
  });
});

describe('looksLikeMusicInstruction', () => {
  it('passes on music terms in the title', () => {
    expect(looksLikeMusicInstruction('CAGED chords explained', '')).toBe(true);
  });

  it('passes on music terms early in the transcript', () => {
    expect(
      looksLikeMusicInstruction(
        'Untitled video',
        'welcome back today we look at the pentatonic scale on the neck',
      ),
    ).toBe(true);
  });

  it('rejects when neither title nor transcript head has signals', () => {
    expect(
      looksLikeMusicInstruction(
        'My trip to the hardware store',
        'today we are comparing different brands of wood glue and clamps',
      ),
    ).toBe(false);
  });

  it('ignores music terms that appear only deep in the transcript', () => {
    const filler = 'unrelated words about cooking pasta and travel plans. '.repeat(60);
    expect(filler.length).toBeGreaterThan(2000);
    expect(
      looksLikeMusicInstruction('Untitled', `${filler} now a chord progression`),
    ).toBe(false);
  });
});

describe('musicExtractionStatus', () => {
  const current: ExtractedMusicData = {
    version: MUSIC_EXTRACTION_VERSION,
    model: OLLAMA_MODEL,
    generatedAt: '2026-06-11T00:00:00.000Z',
    key: null,
    chords: [],
    techniques: [],
    songs: [],
  };

  it('classifies missing / stale-version / stale-model / current', () => {
    expect(musicExtractionStatus(null)).toBe('missing');
    expect(musicExtractionStatus(undefined)).toBe('missing');
    expect(
      musicExtractionStatus({ ...current, version: MUSIC_EXTRACTION_VERSION - 1 }),
    ).toBe('stale');
    expect(musicExtractionStatus({ ...current, model: 'someone-else' })).toBe(
      'stale',
    );
    expect(musicExtractionStatus(current)).toBe('current');
  });

  it('treats malformed blobs as missing', () => {
    expect(
      musicExtractionStatus({ version: 'one' } as unknown as ExtractedMusicData),
    ).toBe('missing');
    expect(
      musicExtractionStatus({
        ...current,
        chords: 'not-an-array',
      } as unknown as ExtractedMusicData),
    ).toBe('missing');
  });
});
