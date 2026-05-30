// Shading of the selected chord's tones across its tick span, drawn into
// the melody piano-roll so the user can see which notes are chord tones.

export type ChordToneHighlight = {
  degrees: Set<number>;
  start: number;
  length: number;
  color: string;
};
