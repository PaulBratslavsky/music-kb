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
export const GUITAR_SHAPES: Partial<Record<ChordQuality, GuitarShape[]>> = {
  // Major
  maj: [
    // E-shape barre: root on low E. Frets [highE,B,G,D,A,E]
    {
      name: 'E-shape barre',
      rootString: 5,
      frets: [0, 0, 1, 2, 2, 0],
    },
    // A-shape barre: root on A. Open A-shape positions: x 0 2 2 2 0 → relative to root on A
    {
      name: 'A-shape barre',
      rootString: 4,
      frets: [0, 2, 2, 2, 0, null],
    },
  ],
  // Minor
  min: [
    // Em-shape barre: root on low E
    {
      name: 'Em-shape barre',
      rootString: 5,
      frets: [0, 0, 0, 2, 2, 0],
    },
    // Am-shape barre: root on A. Am open: x 0 2 2 1 0
    {
      name: 'Am-shape barre',
      rootString: 4,
      frets: [0, 1, 2, 2, 0, null],
    },
  ],
  // Dominant 7
  dom7: [
    // E7-shape barre: root on low E. E7 open: 0 2 0 1 2 0  (high→low: 0,0,1,0,2,0)
    {
      name: 'E7-shape barre',
      rootString: 5,
      frets: [0, 0, 1, 0, 2, 0],
    },
    // A7-shape barre: root on A. A7 open: x 0 2 0 2 0 → relative
    {
      name: 'A7-shape barre',
      rootString: 4,
      frets: [0, 2, 0, 2, 0, null],
    },
  ],
  // Major 7
  maj7: [
    // Emaj7-shape: 0,4,1,1,2,0 (Emaj7 open) → high→low: 0,0,1,1,2,0
    {
      name: 'Emaj7-shape barre',
      rootString: 5,
      frets: [0, 0, 1, 1, 2, 0],
    },
    // Amaj7-shape: x 0 2 1 2 0 → high→low: 0,2,1,2,0,null
    {
      name: 'Amaj7-shape barre',
      rootString: 4,
      frets: [0, 2, 1, 2, 0, null],
    },
  ],
  // Minor 7
  min7: [
    // Em7-shape: 0,2,0,0,2,0 → high→low: 0,0,0,0,2,0
    {
      name: 'Em7-shape barre',
      rootString: 5,
      frets: [0, 0, 0, 0, 2, 0],
    },
    // Am7-shape: x 0 2 0 1 0 → high→low: 0,1,0,2,0,null
    {
      name: 'Am7-shape barre',
      rootString: 4,
      frets: [0, 1, 0, 2, 0, null],
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
