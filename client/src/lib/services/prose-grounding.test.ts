import { describe, expect, it } from 'vitest';
import { buildBM25Index, type BM25Index, type TranscriptChunk } from '#/lib/services/transcript';
import { chooseProseSource, PROSE_AUTO_CITE } from '#/lib/services/prose-grounding';

// The rule under test is a confidence judgement, so the fixtures have to be
// realistic in the one dimension that matters: a transcript index needs
// enough chunks for idf to mean anything. `DISTINCTIVE_DF_RATIO` is 0.2, so
// with 20 chunks a term is "distinctive" only if it appears in at most 4 —
// which is exactly the shape a real video has (a phrase said once, ordinary
// vocabulary said everywhere).
const FILLER_WORDS =
  'guitar fret string note chord scale finger position play practice sound neck';

function chunk(id: number, text: string, timeSec: number): TranscriptChunk {
  return { id, text, startWord: id * 100, timeSec };
}

// Every pre-existing test below passes this for the new `libraryIndexes`
// argument: an empty library is vacuous (see `isLibraryDistinctive`'s
// empty-population stance), so these tests keep exercising exactly what
// they were written to exercise — ranking and within-video distinctiveness
// — unaffected by the corpus-rarity gate covered separately below.
const NO_LIBRARY: ReadonlyMap<string, BM25Index> = new Map();

/** A minimal single-chunk index for library-only fixtures below — these
 * exist purely so `idf[term] !== undefined` can answer "does this OTHER
 * video say this word at all", not to exercise realistic idf shape. */
function libVideo(words: string): BM25Index {
  return buildBM25Index([chunk(0, words, 0)]);
}

/**
 * A video index whose chunks all share the same ordinary vocabulary, plus
 * one chunk carrying `signature` — the phrase a paragraph could only have
 * come from.
 */
function makeVideo(opts: {
  signature: string;
  signatureAt?: number;
  chunks?: number;
  extra?: string;
}): BM25Index {
  const total = opts.chunks ?? 20;
  const at = opts.signatureAt ?? 5;
  const chunks = Array.from({ length: total }, (_, i) =>
    chunk(
      i,
      i === at ? `${FILLER_WORDS} ${opts.signature}` : `${FILLER_WORDS} ${opts.extra ?? ''} ${i}`,
      i * 60,
    ),
  );
  return buildBM25Index(chunks);
}

describe('chooseProseSource', () => {
  it('attaches when one video carries the paragraph’s distinctive vocabulary', () => {
    const sources = new Map<string, BM25Index>([
      [
        'vidA',
        makeVideo({
          signature:
            'these are the main lanes where patterns repeat cleanly so we chunk the neck into string pairs',
        }),
      ],
      ['vidB', makeVideo({ signature: 'here is how to tune a guitar with a clip on tuner' })],
    ]);

    const decision = chooseProseSource(
      'One video breaks the neck into three primary string pairs — the main lanes where patterns repeat cleanly.',
      sources.keys(),
      sources,
      NO_LIBRARY,
    );

    expect(decision.attach).toBe(true);
    if (!decision.attach) return;
    expect(decision.videoId).toBe('vidA');
    expect(decision.distinctive).toBeGreaterThanOrEqual(PROSE_AUTO_CITE.MIN_DISTINCTIVE_SHARED);
    // The evidence is logged so an attachment can be audited later; if it is
    // empty the run log says "trust me" and nothing more.
    expect(decision.distinctiveTerms.length).toBeGreaterThan(0);
  });

  it('declines prose whose only overlap is the vocabulary every source shares', () => {
    // The real case this threshold was tuned on: "That loop only closes
    // because the alphabet itself loops — the note the fifth position hands
    // off to is the same letter, twelve frets and one full cycle later."
    // Eight terms matched a pentatonic video, all of them fretboard
    // furniture. It is the model's own synthesis and must stay uncited.
    const sources = new Map<string, BM25Index>([
      ['vidA', makeVideo({ signature: 'wildly unrelated material about microphone placement' })],
      ['vidB', makeVideo({ signature: 'wildly unrelated material about amplifier valves' })],
    ]);

    const decision = chooseProseSource(
      'The note the fifth position hands off to is the same note the first position started on, twelve frets later.',
      sources.keys(),
      sources,
      NO_LIBRARY,
    );

    expect(decision.attach).toBe(false);
    if (decision.attach) return;
    expect(decision.reason).toBe('too-few-distinctive-terms');
  });

  it('declines when two sources match the paragraph equally well', () => {
    // Both videos say the same distinctive thing. The paragraph may well be
    // sourced, but nothing here can say WHICH source — and a coin flip
    // between two attributions is the failure this whole feature is built to
    // avoid.
    const signature =
      'power chords are neither major nor minor so the shape works on top of almost any chord';
    const sources = new Map<string, BM25Index>([
      ['vidA', makeVideo({ signature })],
      ['vidB', makeVideo({ signature })],
    ]);

    const decision = chooseProseSource(
      'Power chords are neither major nor minor, so the same shape works on top of almost any chord.',
      sources.keys(),
      sources,
      NO_LIBRARY,
    );

    expect(decision.attach).toBe(false);
    if (decision.attach) return;
    expect(decision.reason).toBe('no-margin-over-runner-up');
  });

  it('still decides with a single source, where there is no runner-up to beat', () => {
    const sources = new Map<string, BM25Index>([
      [
        'only',
        makeVideo({
          signature:
            'these are the main lanes where patterns repeat cleanly so we chunk the neck into string pairs',
        }),
      ],
    ]);

    const attached = chooseProseSource(
      'One video breaks the neck into three primary string pairs — the main lanes where patterns repeat cleanly.',
      sources.keys(),
      sources,
      NO_LIBRARY,
    );
    expect(attached.attach).toBe(true);

    // The margin being vacuous must not make the evidence floor vacuous too.
    const declined = chooseProseSource(
      'The note the fifth position hands off to is the same note the first position started on.',
      sources.keys(),
      sources,
      NO_LIBRARY,
    );
    expect(declined.attach).toBe(false);
  });

  it('declines rather than throwing when a source has no stored index', () => {
    const sources = new Map<string, BM25Index>();
    const decision = chooseProseSource('anything at all', ['vidA', 'vidB'], sources, NO_LIBRARY);
    expect(decision.attach).toBe(false);
    if (decision.attach) return;
    expect(decision.reason).toBe('no-candidate');
  });

  it('declines empty text', () => {
    const sources = new Map<string, BM25Index>([['vidA', makeVideo({ signature: 'anything' })]]);
    expect(chooseProseSource('   ', sources.keys(), sources, NO_LIBRARY).attach).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Library-rarity gate — the fix for the defect an independent review
  // found: within-video rarity alone lets ordinary vocabulary ("will",
  // "change", "scale", "any" in the real case) clear the evidence floor
  // whenever it happens to be said only once in a short winning video.
  // ---------------------------------------------------------------------

  it('declines a term that clears the within-video floor but is common across the rest of the library', () => {
    // `orbital` and `cadence` each occur once in the winning video's 20
    // chunks (within-video-rare) but recur across the wider library, same
    // shape as the real defect. Only `tremolo` and `shimmer` are rare BOTH
    // places — one short of the floor once the library is considered.
    const winner = makeVideo({ signature: 'orbital cadence tremolo shimmer', signatureAt: 5 });
    const sources = new Map<string, BM25Index>([['winner', winner]]);
    const library = new Map<string, BM25Index>([
      ['winner', winner],
      ['lib1', libVideo('orbital cadence')],
      ['lib2', libVideo('orbital cadence')],
      ['lib3', libVideo('orbital other words entirely')],
    ]);

    // Without library context, this exact paragraph attaches — the four
    // terms are all within-video-rare and there is no runner-up to beat.
    const withoutLibrary = chooseProseSource(
      'orbital cadence tremolo shimmer',
      sources.keys(),
      sources,
      NO_LIBRARY,
    );
    expect(withoutLibrary.attach).toBe(true);

    // With the wider library, `orbital` (3/3 other videos) and `cadence`
    // (2/3) are filtered out — only `tremolo` and `shimmer` (0/3) survive,
    // one short of MIN_DISTINCTIVE_SHARED.
    const decision = chooseProseSource('orbital cadence tremolo shimmer', sources.keys(), sources, library);
    expect(decision.attach).toBe(false);
    if (decision.attach) return;
    expect(decision.reason).toBe('too-few-distinctive-terms');
    expect(decision.distinctive).toBe(2);
  });

  it('still attaches when the within-video-distinctive terms are also rare across the library', () => {
    const winner = makeVideo({ signature: 'orbital cadence tremolo shimmer', signatureAt: 5 });
    const sources = new Map<string, BM25Index>([['winner', winner]]);
    // A real library where none of the four terms recur anywhere else —
    // the gate must not punish genuine distinctiveness just for having a
    // wider population to check against.
    const library = new Map<string, BM25Index>([
      ['winner', winner],
      ['lib1', libVideo('completely different vocabulary')],
      ['lib2', libVideo('nothing overlapping here either')],
    ]);

    const decision = chooseProseSource('orbital cadence tremolo shimmer', sources.keys(), sources, library);
    expect(decision.attach).toBe(true);
    if (!decision.attach) return;
    expect(decision.distinctiveTerms.sort()).toEqual(['cadence', 'orbital', 'shimmer', 'tremolo']);
  });

  // The thresholds ARE the design, and they were tuned by reading every
  // attachment they make against the passage it matched. Pinning them means a
  // future edit to any of the four has to be a deliberate one that shows up
  // in a diff, rather than a quiet drift in what this pipeline is willing to
  // claim a video said.
  it('pins the confidence bar', () => {
    expect(PROSE_AUTO_CITE).toEqual({
      MIN_DISTINCTIVE_SHARED: 3,
      SHARED_TERM_MARGIN: 1.4,
      MIN_SCORE: 8,
      LIBRARY_DF_RATIO: 0.4,
    });
  });
});
