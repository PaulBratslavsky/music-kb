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
  /** Deep-link target for /builder, using the `theory=` shorthand parser
   *  (e.g. "chord:C:maj", "chord:Db:dom7", "chord:F:min"). Omitted for
   *  exotic suggestions that don't map to a known chord quality (we'd
   *  send the user to the default Cmaj instead of a wrong chord). */
  link?: string;
};

export type DiatonicChordSubs = {
  /** Roman numeral, e.g. "I", "ii", "V". */
  numeral: string;
  /** Display name of the original diatonic chord, e.g. "C", "Dm". */
  chord: string;
  /** Common substitutions. */
  subs: ChordSuggestion[];
};

// Deep-link helpers — return the `theory=` shorthand string for /builder.
function linkMaj(T: number, semis: number): string {
  return `chord:${spell(T + semis, true)}:maj`;
}
function linkMin(T: number, semis: number): string {
  return `chord:${spell(T + semis, true)}:min`;
}
function linkDom7(T: number, semis: number): string {
  return `chord:${spell(T + semis, true)}:dom7`;
}
function linkDim(T: number, semis: number): string {
  return `chord:${spell(T + semis, true)}:dim`;
}

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
        { name: Mm(9), why: 'relative minor (vi) — shares the root and 3rd', link: linkMin(T, 9) },
        { name: Mm(4), why: 'iii — shares the 3rd and 5th of the I chord', link: linkMin(T, 4) },
      ],
    },
    {
      numeral: 'ii',
      chord: Mm(2),
      subs: [
        { name: M(5), why: 'IV — shares two notes, same subdominant function', link: linkMaj(T, 5) },
      ],
    },
    {
      numeral: 'iii',
      chord: Mm(4),
      subs: [
        { name: M(0), why: 'I — iii has two notes in common with the tonic', link: linkMaj(T, 0) },
        { name: Mm(9), why: 'vi — same minor function, related roots', link: linkMin(T, 9) },
      ],
    },
    {
      numeral: 'IV',
      chord: M(5),
      subs: [
        { name: Mm(2), why: 'ii — same subdominant family', link: linkMin(T, 2) },
        { name: M(8), why: 'bVI (modal interchange from parallel minor)', link: linkMaj(T, 8) },
      ],
    },
    {
      numeral: 'V',
      chord: M(7),
      subs: [
        { name: M7(1), why: 'tritone sub — bII7 shares the 3rd and 7th of V7', link: linkDom7(T, 1) },
        { name: `${M(11)}°`, why: 'vii° — rootless V7, same leading tone', link: linkDim(T, 11) },
        { name: M7(2), why: 'V/V — D7 delays the resolution, classic ii-V-I setup', link: linkDom7(T, 2) },
      ],
    },
    {
      numeral: 'vi',
      chord: Mm(9),
      subs: [
        { name: M(0), why: 'I — relative major, shares root and 3rd', link: linkMaj(T, 0) },
        { name: M(5), why: 'IV — same notes minus the 3rd, used for a softer landing', link: linkMaj(T, 5) },
      ],
    },
    {
      numeral: 'vii°',
      chord: `${M(11)}°`,
      subs: [
        { name: M7(7), why: 'V7 — same function, fuller voicing', link: linkDom7(T, 7) },
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
    { name: M7(11), why: `V/ii → ${Mm(2)}`, link: linkDom7(T, 11) },
    { name: M7(2),  why: `V/V → ${M(7)}`, link: linkDom7(T, 2) },
    { name: M7(0),  why: `V/IV → ${M(5)} (notice: same root as I, but dominant 7)`, link: linkDom7(T, 0) },
    { name: M7(4),  why: `V/vi → ${Mm(9)}`, link: linkDom7(T, 4) },
    { name: M7(9),  why: `V/ii alt — strong pull to ${Mm(2)}`, link: linkDom7(T, 9) },
  ];
}

/** Borrowed chords from the parallel minor — adds "color" without changing key. */
export function modalInterchange(tonicCircleIdx: number): ChordSuggestion[] {
  const T = pcSemitoneFromCircleIdx(tonicCircleIdx);
  const useSharps = prefersSharps(T, tonicCircleIdx);
  const M = (s: number) => spell(T + s, useSharps);
  const Mm = (s: number) => `${spell(T + s, useSharps)}m`;
  return [
    { name: M(3),  why: 'bIII — bright minor-key flavor (think: Beatles)', link: linkMaj(T, 3) },
    { name: M(8),  why: 'bVI — wistful, classic "moment of doubt"', link: linkMaj(T, 8) },
    { name: M(10), why: 'bVII — open, modal, rock-leaning (Mixolydian feel)', link: linkMaj(T, 10) },
    { name: Mm(5), why: 'iv — the "saddened IV", common in ballads and outros', link: linkMin(T, 5) },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Minor-key substitutions                                                   */
/* -------------------------------------------------------------------------- */
//
// A minor key borrows the same seven chords as its relative major, but the
// reharm vocabulary is genuinely different because the tonic moved. Two
// things drive almost all of it:
//
//   1. The natural-minor v is MINOR, so it has no leading tone. Raising its
//      third (harmonic minor) gives a real V — which is why so much minor
//      music does exactly that.
//   2. bIII, bVI and bVII are diatonic here rather than borrowed, so the
//      "colour" chords of a major key are the everyday chords of a minor
//      one. Interchange therefore works the other way: a minor key borrows
//      from the parallel MAJOR (a Picardy third, a major IV).

/** Substitutes for each diatonic chord of the natural minor key. */
export function minorDiatonicSubs(tonicCircleIdx: number): DiatonicChordSubs[] {
  // The relative-minor tonic sits 9 semitones above its relative major.
  const T = (pcSemitoneFromCircleIdx(tonicCircleIdx) + 9) % 12;
  const useSharps = prefersSharps(T, tonicCircleIdx);
  const M = (s: number) => spell(T + s, useSharps);
  const Mm = (s: number) => `${spell(T + s, useSharps)}m`;
  const M7 = (s: number) => `${spell(T + s, useSharps)}7`;
  const Mdim = (s: number) => `${spell(T + s, useSharps)}°`;

  return [
    {
      numeral: 'i',
      chord: Mm(0),
      subs: [
        { name: M(3), why: 'bIII — relative major, shares the 3rd and 5th', link: linkMaj(T, 3) },
        { name: Mm(5), why: 'iv — same minor colour, a step of tension away', link: linkMin(T, 5) },
      ],
    },
    {
      numeral: 'ii°',
      chord: Mdim(2),
      subs: [
        { name: Mm(5), why: 'iv — shares two notes, same subdominant job and far easier to play', link: linkMin(T, 5) },
        { name: M7(7), why: 'V7 — the diminished chord is a rootless dominant; this states it outright', link: linkDom7(T, 7) },
      ],
    },
    {
      numeral: 'bIII',
      chord: M(3),
      subs: [
        { name: Mm(0), why: 'i — relative minor, shares the root and 3rd', link: linkMin(T, 0) },
        { name: M(8), why: 'bVI — the other major chord in the key, softer landing', link: linkMaj(T, 8) },
      ],
    },
    {
      numeral: 'iv',
      chord: Mm(5),
      subs: [
        { name: Mdim(2), why: 'ii° — same subdominant family', link: linkDim(T, 2) },
        { name: M(5), why: 'IV — borrowed from the parallel major; lifts the mood without leaving', link: linkMaj(T, 5) },
      ],
    },
    {
      numeral: 'v',
      chord: Mm(7),
      subs: [
        { name: M7(7), why: 'V7 — raise the 3rd for a leading tone. THE minor-key move', link: linkDom7(T, 7) },
        { name: M(10), why: 'bVII — the modal alternative; resolves down instead of pulling up', link: linkMaj(T, 10) },
        { name: Mdim(11), why: 'vii° — rootless V7, same leading tone', link: linkDim(T, 11) },
      ],
    },
    {
      numeral: 'bVI',
      chord: M(8),
      subs: [
        { name: Mm(5), why: 'iv — shares two notes, same direction of pull', link: linkMin(T, 5) },
        { name: M(3), why: 'bIII — the other bright chord; brighter still', link: linkMaj(T, 3) },
      ],
    },
    {
      numeral: 'bVII',
      chord: M(10),
      subs: [
        { name: M7(7), why: 'V7 — swap the modal cadence for the dominant one', link: linkDom7(T, 7) },
        { name: M(3), why: 'bIII — shares two notes, keeps the modal feel', link: linkMaj(T, 3) },
      ],
    },
  ];
}

/** Secondary dominants in a minor key — each targets a diatonic chord. */
export function minorSecondaryDominants(tonicCircleIdx: number): ChordSuggestion[] {
  const T = (pcSemitoneFromCircleIdx(tonicCircleIdx) + 9) % 12;
  const useSharps = prefersSharps(T, tonicCircleIdx);
  const M7 = (s: number) => `${spell(T + s, useSharps)}7`;
  const M = (s: number) => spell(T + s, useSharps);
  const Mm = (s: number) => `${spell(T + s, useSharps)}m`;
  return [
    { name: M7(7),  why: `V7 → ${Mm(0)} — the raised-third dominant; the defining minor-key sound`, link: linkDom7(T, 7) },
    { name: M7(10), why: `V/bIII → ${M(3)}`, link: linkDom7(T, 10) },
    { name: M7(0),  why: `V/iv → ${Mm(5)} (same root as i, but dominant 7)`, link: linkDom7(T, 0) },
    { name: M7(3),  why: `V/bVI → ${M(8)}`, link: linkDom7(T, 3) },
    { name: M7(5),  why: `V/bVII → ${M(10)}`, link: linkDom7(T, 5) },
  ];
}

/** Borrowed from the PARALLEL MAJOR — the mirror of major-key interchange. */
export function minorModalInterchange(tonicCircleIdx: number): ChordSuggestion[] {
  const T = (pcSemitoneFromCircleIdx(tonicCircleIdx) + 9) % 12;
  const useSharps = prefersSharps(T, tonicCircleIdx);
  const M = (s: number) => spell(T + s, useSharps);
  const Mm = (s: number) => `${spell(T + s, useSharps)}m`;
  return [
    { name: M(0),  why: 'I — the Picardy third: end a minor piece on a major tonic', link: linkMaj(T, 0) },
    { name: M(5),  why: 'IV — major subdominant, the Dorian brightener', link: linkMaj(T, 5) },
    { name: M(7),  why: 'V — raised third from harmonic minor; the strongest way home', link: linkMaj(T, 7) },
    { name: Mm(2), why: 'ii — replaces the awkward ii°, borrowed for a smooth ii-V', link: linkMin(T, 2) },
  ];
}
