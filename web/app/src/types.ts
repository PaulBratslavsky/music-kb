export type PitchClass =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F'
  | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export const PITCH_CLASSES: PitchClass[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

export type Note = {
  pitchClass: PitchClass;
  octave: number;
};

export type ChordQuality =
  // Power chord (root + 5th only, no 3rd)
  | '5'
  // Triads
  | 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4'
  // Sixths
  | '6' | 'm6'
  // Sevenths
  | 'maj7' | 'min7' | 'dom7' | 'm7b5' | 'dim7' | 'mMaj7' | '7sus4'
  // Add chords
  | 'add9' | 'madd9'
  // Ninths
  | '9' | 'maj9' | 'm9'
  // 11ths / 13ths
  | '11' | 'm11' | '13' | 'm13'
  // Altered dominants
  | '7b5' | '7#5' | '7b9' | '7#9' | 'alt';

export const CHORD_QUALITIES: ChordQuality[] = [
  '5',
  'maj', 'min', 'dim', 'aug', 'sus2', 'sus4',
  '6', 'm6',
  'maj7', 'min7', 'dom7', 'm7b5', 'dim7', 'mMaj7', '7sus4',
  'add9', 'madd9',
  '9', 'maj9', 'm9',
  '11', 'm11', '13', 'm13',
  '7b5', '7#5', '7b9', '7#9', 'alt',
];

export type ChordSelection = {
  root: PitchClass;
  quality: ChordQuality;
  inversion: number;
  voicingIndex: number;
};

export type ScaleType =
  | 'major' | 'minor' | 'harmonicMinor' | 'melodicMinor'
  | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian'
  | 'majorPentatonic' | 'minorPentatonic' | 'blues';

export const SCALE_TYPES: ScaleType[] = [
  'major', 'minor', 'harmonicMinor', 'melodicMinor',
  'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian',
  'majorPentatonic', 'minorPentatonic', 'blues',
];

export type ScaleSelection = {
  root: PitchClass;
  type: ScaleType;
};

/**
 * 'all'  = show every scale note across the neck.
 * '2oct' = one compact two-octave position anchored on the 6th-string tonic
 *          (guitarscale.org's "2 octaves" view). Works for every scale,
 *          including modes.
 * 1-5    = a guitarscale.org box ("Shape"); only for scales the site ships
 *          box images for (major + minor/harm/mel/pentatonic/blues).
 */
export type ScalePosition = 'all' | '2oct' | 1 | 2 | 3 | 4 | 5;
export const SCALE_POSITIONS: ScalePosition[] = ['all', '2oct', 1, 2, 3, 4, 5];

export type ViewMode = 'chord' | 'scale' | 'note' | 'all';

export type AppState = {
  mode: ViewMode;
  chord: ChordSelection;
  scale: ScaleSelection;
  singleNote: PitchClass;
  scalePosition: ScalePosition;
  /**
   * Spell the current key with flats (e.g. "Bb major" → Bb C D Eb F G A) rather
   * than the sharps-only internal default. Set when the user picks a flat-named
   * root; only affects accidental roots — natural-root keys are spelled by tonal
   * regardless (D major is always F#/C#).
   */
  preferFlats: boolean;
};

export type PianoKey = {
  note: Note;
  isBlack: boolean;
  index: number;
};

export type GuitarPosition = {
  string: number;
  fret: number;
  note: Note;
};

export type PushPad = {
  row: number;
  col: number;
  note: Note;
};

export type ResolvedSelection = {
  piano: Note[];
  guitar: Note[];
  push: Note[];
  /** Notes for the 4-string bass view. Always matched by pitch class
   *  (bass plays single notes — no chord voicings tracked), so the array
   *  is the same set the guitar uses in PC-flood mode. */
  bass: Note[];
  rootPitchClass: PitchClass | null;
  label: string;
};

// ----- Game mode (find-the-note ear/visual training) -----

export type Instrument = 'piano' | 'guitar' | 'push';

export const INSTRUMENTS: Instrument[] = ['piano', 'guitar', 'push'];

export type GuessPosition =
  | { kind: 'piano'; midi: number }
  | { kind: 'guitar'; string: number; fret: number }
  | { kind: 'push'; row: number; col: number };

export type GuessResult = {
  position: GuessPosition;
  /** Pitch class actually at this position (what the player effectively chose). */
  actualPC: PitchClass;
  /** Pitch class that was asked when this guess was submitted. */
  expectedPC: PitchClass;
  correct: boolean;
};

export type GameModeState = {
  enabled: boolean;
  currentQuestion: PitchClass | null;
  /** Display spelling for the current question — same PC, but might read as a flat ("Db" vs "C#"). */
  currentQuestionDisplay: string | null;
  pendingGuesses: GuessPosition[];
  /** Per-guess expected PC, parallel to pendingGuesses (the question rotates after each click). */
  pendingExpected: PitchClass[];
  checkedResults: GuessResult[] | null;
  currentStreak: number;
  bestStreak: number;
  lastQuestion: PitchClass | null;
};
