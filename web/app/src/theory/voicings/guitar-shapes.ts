import type { ChordQuality, PitchClass } from '../../types';

/**
 * A shape is a movable fingering, defined relative to a "root string".
 *
 * - `rootString` is the string on which the chord's root sits (0 = high E, 5 = low E).
 * - `frets[]` is one entry per string (length 6), in the same indexing.
 *   - A number is the fret offset from the root's fret on the rootString.
 *     For example, an A-shape barre has rootString=4 (A), and the offsets describe
 *     where each other string is fretted relative to the root fret.
 *   - `null` means the string is not played.
 *
 * To realize the shape for a specific root pitch class, we find the lowest fret on
 * the rootString that produces that pitch class (0..11), then offset every other
 * string accordingly. Negative absolute frets shift up by 12 to keep the shape on
 * the fretboard.
 */
export type GuitarShape = {
  name: string;
  rootString: number; // 0 = high E, 5 = low E
  frets: (number | null)[]; // length 6, indexed [highE..lowE]
  /**
   * Optional barre annotation. When present, the GuitarView renders a
   * thick bar across the indicated strings at fret = rootFret + offsetFromRoot.
   *
   * - `offsetFromRoot`: 0 = barre lives at the root fret (the typical case
   *   for E-shape and A-shape barres — the index finger barres at the root).
   * - `fromString`, `toString`: inclusive string-index range the barre
   *   covers (0 = high E, 5 = low E). E-shape barres span 0..5;
   *   A-shape barres span 0..4 (low E is muted).
   *
   * The barre is omitted from rendering when the resolved root fret is 0
   * (no need to barre at the nut — the open strings already cover it).
   */
  barre?: {
    offsetFromRoot: number;
    fromString: number;
    toString: number;
  };
};

/**
 * Convention for offsets:
 *   Each entry is the fret offset relative to the root fret on `rootString`.
 *   Open shapes use negative offsets so the open string (fret 0) appears when the
 *   root is at fret > 0; we shift things into the visible range at realization time.
 *
 * For MVP we ship two shapes per quality where reasonable, anchored on either the
 * low-E string (E-shape barre) or A string (A-shape barre). These are the
 * "movable barre chord" shapes most guitarists know — they cover all 12 roots.
 */

// E-shape barre: index finger barres all 6 strings at the root fret.
const BARRE_E: GuitarShape['barre'] = { offsetFromRoot: 0, fromString: 0, toString: 5 };
// A-shape barre: index finger barres top 5 strings at the root fret;
// low E is muted by the thumb-over technique.
const BARRE_A: GuitarShape['barre'] = { offsetFromRoot: 0, fromString: 0, toString: 4 };

export const GUITAR_SHAPES: Partial<Record<ChordQuality, GuitarShape[]>> = {
  // Power chord (root + 5th + octave). The rock/punk/metal staple — also
  // ambiguous (no 3rd means it works in major and minor contexts). Three
  // movable shapes, one per low-string root:
  //   • E-string root: lowE(0), A(2 = 5th), D(2 = octave) — frets [_,_,_,2,2,0]
  //   • A-string root: A(0), D(2 = 5th), G(2 = octave)   — frets [_,_,2,2,0,_]
  //   • D-string root: D(0), G(2 = 5th), B(3 = octave + kink offset) —
  //                    the +1 fret shift on the B string compensates for
  //                    the G→B major-3rd kink in standard tuning.
  '5': [
    {
      name: 'E-string power chord',
      rootString: 5,
      frets: [null, null, null, 2, 2, 0],
    },
    {
      name: 'A-string power chord',
      rootString: 4,
      frets: [null, null, 2, 2, 0, null],
    },
    {
      name: 'D-string power chord',
      rootString: 3,
      frets: [null, 3, 2, 0, null, null],
    },
  ],
  // Major
  maj: [
    {
      name: 'E-shape barre',
      rootString: 5,
      frets: [0, 0, 1, 2, 2, 0],
      barre: BARRE_E,
    },
    {
      name: 'A-shape barre',
      rootString: 4,
      frets: [0, 2, 2, 2, 0, null],
      barre: BARRE_A,
    },
  ],
  // Minor
  min: [
    {
      name: 'Em-shape barre',
      rootString: 5,
      frets: [0, 0, 0, 2, 2, 0],
      barre: BARRE_E,
    },
    {
      name: 'Am-shape barre',
      rootString: 4,
      frets: [0, 1, 2, 2, 0, null],
      barre: BARRE_A,
    },
  ],
  // Dominant 7
  dom7: [
    {
      name: 'E7-shape barre',
      rootString: 5,
      frets: [0, 0, 1, 0, 2, 0],
      barre: BARRE_E,
    },
    {
      name: 'A7-shape barre',
      rootString: 4,
      frets: [0, 2, 0, 2, 0, null],
      barre: BARRE_A,
    },
  ],
  // Major 7
  maj7: [
    {
      name: 'Emaj7-shape barre',
      rootString: 5,
      frets: [0, 0, 1, 1, 2, 0],
      barre: BARRE_E,
    },
    {
      name: 'Amaj7-shape barre',
      rootString: 4,
      frets: [0, 2, 1, 2, 0, null],
      barre: BARRE_A,
    },
  ],
  // Minor 7
  min7: [
    {
      name: 'Em7-shape barre',
      rootString: 5,
      frets: [0, 0, 0, 0, 2, 0],
      barre: BARRE_E,
    },
    {
      name: 'Am7-shape barre',
      rootString: 4,
      frets: [0, 1, 0, 2, 0, null],
      barre: BARRE_A,
    },
  ],
  // Major 6: root, 3, 5, 6. E6 open = 0 2 2 1 2 0 (high→low) — barre form
  // moves the same shape up the neck.
  '6': [
    {
      name: 'E-shape 6 barre',
      rootString: 5,
      frets: [0, 2, 1, 2, 2, 0],
      barre: BARRE_E,
    },
    {
      name: 'A-shape 6 barre',
      rootString: 4,
      frets: [2, 2, 2, 2, 0, null],
      barre: BARRE_A,
    },
  ],
  // Minor 6: root, b3, 5, 6. Em6 open = 0 2 0 2 2 0; Am6 open = x 2 1 2 2 0.
  m6: [
    {
      name: 'Em6-shape barre',
      rootString: 5,
      frets: [0, 2, 0, 2, 2, 0],
      barre: BARRE_E,
    },
    {
      name: 'Am6-shape barre',
      rootString: 4,
      frets: [2, 1, 2, 2, 0, null],
      barre: BARRE_A,
    },
  ],
  // Half-diminished (m7b5). The A-string barre form is the practical one:
  // Bm7b5 = x 2 3 2 3 x → relative to root on A fret 2: [null,1,0,1,0,null].
  // The high-E string is muted by the fingering, not by the bar.
  m7b5: [
    {
      name: 'A-shape m7♭5 barre',
      rootString: 4,
      frets: [null, 1, 0, 1, 0, null],
      barre: BARRE_A,
    },
  ],
  // "Hendrix chord" — 7♯9. Root on A string. Voicing: root, major 3rd
  // on D, ♭7 on G, ♯9 on B. The major 3rd + ♯9 (= ♭3 enharmonic) clash
  // is the signature sound — "Purple Haze" opening, "Foxy Lady".
  // Relative to root on A: [null, 1, 0, -1, 0, null].
  '7#9': [
    {
      name: 'Hendrix chord (A-string root)',
      rootString: 4,
      frets: [null, 1, 0, -1, 0, null],
      barre: { offsetFromRoot: 0, fromString: 2, toString: 4 },
    },
  ],
  // Diminished triad on D-string root. Intervals: 1, b3, b5 → uses top 4 strings.
  // Verified: for C dim (root=C on D string fret 10), produces C/Eb/Gb.
  dim: [
    {
      name: 'D-string dim triad',
      rootString: 3,
      frets: [null, -3, -2, 0, null, null],
    },
  ],
  // Augmented triad on D-string root. Intervals: 1, 3, #5, R+oct on top 4 strings.
  // Verified: for C aug (root=C on D string fret 10), produces C/E/G#/C.
  aug: [
    {
      name: 'D-string aug triad',
      rootString: 3,
      frets: [-2, -1, -1, 0, null, null],
    },
  ],
  sus2: [
    // sus2: root, 2, 5. Asus2: x 0 2 2 0 0 → high→low: 0,0,2,2,0,null
    {
      name: 'A-shape sus2',
      rootString: 4,
      frets: [0, 0, 2, 2, 0, null],
    },
  ],
  sus4: [
    // sus4: root, 4, 5. Asus4: x 0 2 2 3 0 → high→low: 0,3,2,2,0,null
    {
      name: 'A-shape sus4',
      rootString: 4,
      frets: [0, 3, 2, 2, 0, null],
    },
  ],
};

/**
 * Open-position chord shapes — the first fingerings a guitar beginner learns.
 *
 * Unlike `GuitarShape`, these are NOT movable: `frets` holds the ABSOLUTE fret
 * number on each string (0 = open string), indexed `[highE, B, G, D, A, lowE]`.
 * `null` = string not played (muted). They're keyed by quality → root pitch
 * class because an "open C" fingering only exists at C — moving it turns it into
 * a barre chord (which is what `GUITAR_SHAPES` already covers).
 *
 * `guitarVoicing` surfaces the open shape as voicing index 0 when one exists for
 * the selected root, so e.g. selecting C major shows the familiar x32010 (which
 * includes the E on the D string, 2nd fret). The barre shapes follow as the
 * next voicing options.
 *
 * Each shape below was verified by computing every played string's pitch class.
 */
export type OpenChordShape = {
  name: string;
  /** Absolute frets, indexed [highE, B, G, D, A, lowE]. null = muted. */
  frets: (number | null)[];
};

export const OPEN_CHORD_SHAPES: Partial<
  Record<ChordQuality, Partial<Record<PitchClass, OpenChordShape>>>
> = {
  maj: {
    // x 3 2 0 1 0 → C E G C E (E on D-string fret 2)
    C: { name: 'Open C', frets: [0, 1, 0, 2, 3, null] },
    // x 0 2 2 2 0 → A E A C# E
    A: { name: 'Open A', frets: [0, 2, 2, 2, 0, null] },
    // 3 2 0 0 0 3 → G B D G B G
    G: { name: 'Open G', frets: [3, 0, 0, 0, 2, 3] },
    // 0 2 2 1 0 0 → E B E G# B E
    E: { name: 'Open E', frets: [0, 0, 1, 2, 2, 0] },
    // x x 0 2 3 2 → D A D F#
    D: { name: 'Open D', frets: [2, 3, 2, 0, null, null] },
  },
  min: {
    // x 0 2 2 1 0 → A E A C E
    A: { name: 'Open Am', frets: [0, 1, 2, 2, 0, null] },
    // 0 2 2 0 0 0 → E B E G B E
    E: { name: 'Open Em', frets: [0, 0, 0, 2, 2, 0] },
    // x x 0 2 3 1 → D A D F
    D: { name: 'Open Dm', frets: [1, 3, 2, 0, null, null] },
  },
  dom7: {
    // 0 2 0 1 0 0 → E B D G# B E
    E: { name: 'Open E7', frets: [0, 0, 1, 0, 2, 0] },
    // x 0 2 0 2 0 → A E G C# E
    A: { name: 'Open A7', frets: [0, 2, 0, 2, 0, null] },
    // x x 0 2 1 2 → D A C F#
    D: { name: 'Open D7', frets: [2, 1, 2, 0, null, null] },
    // 3 2 0 0 0 1 → G B D G B F
    G: { name: 'Open G7', frets: [1, 0, 0, 0, 2, 3] },
    // x 3 2 3 1 0 → C E Bb C E
    C: { name: 'Open C7', frets: [0, 1, 3, 2, 3, null] },
    // x 2 1 2 0 2 → B D# A B F#
    B: { name: 'Open B7', frets: [2, 0, 2, 1, 2, null] },
  },
};
