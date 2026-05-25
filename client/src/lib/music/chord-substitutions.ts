// Chord substitution helpers for a major-key tonic.
//
// All math is done in semitones (0..11 chromatic). The Circle of Fifths
// uses its own circle-position indexing; convert with `pcSemitoneFromCircleIdx`.
// Display names use the same sharp/flat convention as the rest of the app
// (sharp-side keys spell with sharps, flat-side with flats).
//
// Substitution catalog (all relative to major-key tonic T):
//
//  Diatonic-function subs (chords that can take each other's place because
//  they share scale tones and harmonic function):
//    I  ↔ vi, iii          (relative + mediant — all contain T's third)
//    ii ↔ IV               (share two notes; same subdominant function)
//    iii ↔ I, vi
//    IV ↔ ii, bVI          (bVI from parallel minor)
//    V  ↔ vii°, bII7       (tritone sub: bII7 shares 3rd+7th with V7)
//    vi ↔ I, IV
//    vii° ↔ V7             (dominant replacement)
//
//  Secondary dominants (V7 of any chord X, treating X as a temporary tonic):
//    V/ii  = (T+9) 7        (E7 → Am in C major)
//    V/iii = (T+11) 7       (B7 → C#m... wait, only when iii is a target)
//    V/IV  = T7             (C7 → F)
//    V/V   = (T+2) 7        (D7 → G7)
//    V/vi  = (T+4) 7        (E7 → Am)
//
//  Modal interchange (chords borrowed from the parallel MINOR key):
//    bIII  = T+3 major      (E♭ in C)
//    bVI   = T+8 major      (A♭ in C)
//    bVII  = T+10 major     (B♭ in C)
//    iv    = T+5 minor      (Fm in C — the "saddened IV")

const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Use sharps for keys on the sharp side of the circle (C..F#), flats for
// the rest. This matches how a printed circle of fifths spells each key.
function prefersSharps(tonicSemitone: number, keyCircleIdx: number | null): boolean {
  // If we know the tonic's circle index, sharp side is 0..6 (C..F#).
  if (keyCircleIdx != null) return keyCircleIdx <= 6;
  // Fallback when working without a circle index — guess from the tonic.
  return tonicSemitone <= 6;
}

function spell(semitone: number, useSharps: boolean): string {
  const idx = ((semitone % 12) + 12) % 12;
  return (useSharps ? PC_SHARP : PC_FLAT)[idx];
}

// Map circle-of-fifths index (0=C, 1=G, 2=D, ...) → chromatic semitone.
const CIRCLE_TO_SEMI: Record<number, number> = {
  0: 0,  // C
  1: 7,  // G
  2: 2,  // D
  3: 9,  // A
  4: 4,  // E
  5: 11, // B
  6: 6,  // F#
  7: 1,  // C# / Db
  8: 8,  // G# / Ab
  9: 3,  // D# / Eb
  10: 10, // A# / Bb
  11: 5,  // F
};

export function pcSemitoneFromCircleIdx(circleIdx: number): number {
  return CIRCLE_TO_SEMI[circleIdx] ?? 0;
}

export type ChordSuggestion = {
  /** Display name, e.g. "Am", "D♭7", "Fm". */
  name: string;
  /** Short rationale shown to the user. */
  why: string;
};

export type DiatonicChordSubs = {
  /** Roman numeral, e.g. "I", "ii", "V". */
  numeral: string;
  /** Display name of the original diatonic chord, e.g. "C", "Dm". */
  chord: string;
  /** Common substitutions. */
  subs: ChordSuggestion[];
};

/** Substitution catalog for each diatonic chord of the given major-key tonic. */
export function diatonicSubs(tonicCircleIdx: number): DiatonicChordSubs[] {
  const T = pcSemitoneFromCircleIdx(tonicCircleIdx);
  const useSharps = prefersSharps(T, tonicCircleIdx);
  const M = (s: number) => spell(T + s, useSharps);
  const Mm = (s: number) => `${spell(T + s, useSharps)}m`;
  const M7 = (s: number) => `${spell(T + s, useSharps)}7`;

  return [
    {
      numeral: 'I',
      chord: M(0),
      subs: [
        { name: Mm(9), why: 'relative minor (vi) — shares the root and 3rd' },
        { name: Mm(4), why: 'iii — shares the 3rd and 5th of the I chord' },
      ],
    },
    {
      numeral: 'ii',
      chord: Mm(2),
      subs: [
        { name: M(5), why: 'IV — shares two notes, same subdominant function' },
      ],
    },
    {
      numeral: 'iii',
      chord: Mm(4),
      subs: [
        { name: M(0), why: 'I — iii has two notes in common with the tonic' },
        { name: Mm(9), why: 'vi — same minor function, related roots' },
      ],
    },
    {
      numeral: 'IV',
      chord: M(5),
      subs: [
        { name: Mm(2), why: 'ii — same subdominant family' },
        { name: M(8), why: 'bVI (modal interchange from parallel minor)' },
      ],
    },
    {
      numeral: 'V',
      chord: M(7),
      subs: [
        { name: M7(1), why: 'tritone sub — bII7 shares the 3rd and 7th of V7' },
        { name: `${M(11)}°`, why: 'vii° — rootless V7, same leading tone' },
        { name: M7(2), why: 'V/V — D7 delays the resolution, classic ii-V-I setup' },
      ],
    },
    {
      numeral: 'vi',
      chord: Mm(9),
      subs: [
        { name: M(0), why: 'I — relative major, shares root and 3rd' },
        { name: M(5), why: 'IV — same notes minus the 3rd, used for a softer landing' },
      ],
    },
    {
      numeral: 'vii°',
      chord: `${M(11)}°`,
      subs: [
        { name: M7(7), why: 'V7 — same function, fuller voicing' },
      ],
    },
  ];
}

/** Secondary dominants targeting each non-tonic diatonic chord. */
export function secondaryDominants(tonicCircleIdx: number): ChordSuggestion[] {
  const T = pcSemitoneFromCircleIdx(tonicCircleIdx);
  const useSharps = prefersSharps(T, tonicCircleIdx);
  const M7 = (s: number) => `${spell(T + s, useSharps)}7`;
  const Mm = (s: number) => `${spell(T + s, useSharps)}m`;
  const M = (s: number) => spell(T + s, useSharps);
  return [
    { name: M7(11), why: `V/ii → ${Mm(2)}` },
    { name: M7(2),  why: `V/V → ${M(7)}` },
    { name: M7(0),  why: `V/IV → ${M(5)} (notice: same root as I, but dominant 7)` },
    { name: M7(4),  why: `V/vi → ${Mm(9)}` },
    { name: M7(9),  why: `V/ii alt — strong pull to ${Mm(2)}` },
  ];
}

/** Borrowed chords from the parallel minor — adds "color" without changing key. */
export function modalInterchange(tonicCircleIdx: number): ChordSuggestion[] {
  const T = pcSemitoneFromCircleIdx(tonicCircleIdx);
  const useSharps = prefersSharps(T, tonicCircleIdx);
  const M = (s: number) => spell(T + s, useSharps);
  const Mm = (s: number) => `${spell(T + s, useSharps)}m`;
  return [
    { name: M(3),  why: 'bIII — bright minor-key flavor (think: Beatles)' },
    { name: M(8),  why: 'bVI — wistful, classic "moment of doubt"' },
    { name: M(10), why: 'bVII — open, modal, rock-leaning (Mixolydian feel)' },
    { name: Mm(5), why: 'iv — the "saddened IV", common in ballads and outros' },
  ];
}
