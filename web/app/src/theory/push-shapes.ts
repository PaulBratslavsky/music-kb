// Where a chord's notes actually sit on the Push grid.
//
// The scale view lights pads BY PITCH CLASS — every C is a C, and seeing
// the pattern repeat is the point. A chord card is the opposite problem: it
// should show the shape your hand makes, once. Lighting every pitch-class
// match there turns a 3-note voicing into a dozen scattered pads and the
// shape disappears.
//
// Push chromatic layout: midi = base + row*5 + col. A given note therefore
// has several valid pads (one per row where the column lands in range),
// which is exactly why the grid is playable — and why picking ONE is a real
// choice rather than a lookup.

import { PUSH_BASE_MIDI, PUSH_COLS, PUSH_ROWS } from '../instruments/push/layout';

export type PushPadPos = { row: number; col: number };

/** Every pad that sounds `midi` inside a rows x cols window. */
function padsFor(midi: number, rows: number, cols: number): PushPadPos[] {
  const out: PushPadPos[] = [];
  for (let row = 0; row < rows; row += 1) {
    const col = midi - PUSH_BASE_MIDI - row * 5;
    if (col >= 0 && col < cols) out.push({ row, col });
  }
  return out;
}

/**
 * Lay a chord out as one compact shape.
 *
 * The root is placed first, on its lowest available pad, and every other
 * note then takes whichever of its pads sits nearest that root — so the
 * result is a grip you could actually play with one hand rather than a
 * scatter across the board.
 *
 * `midis` should be an ascending voicing (root first). Notes with no pad in
 * range are dropped rather than forced somewhere wrong.
 */
export function pushChordShape(
  midis: number[],
  rows: number = PUSH_ROWS,
  cols: number = PUSH_COLS,
): PushPadPos[] {
  if (midis.length === 0) return [];

  // Transpose the whole voicing into the window if it sits above it — the
  // shape is what matters on a chord card, not the octave it was voiced in.
  let notes = [...midis].sort((a, b) => a - b);
  const highest = PUSH_BASE_MIDI + (rows - 1) * 5 + (cols - 1);
  while (notes[0] < PUSH_BASE_MIDI) notes = notes.map((n) => n + 12);
  while (notes[notes.length - 1] > highest && notes[0] - 12 >= PUSH_BASE_MIDI) {
    notes = notes.map((n) => n - 12);
  }

  const rootPads = padsFor(notes[0], rows, cols);
  if (rootPads.length === 0) return [];
  const root = rootPads[0]; // lowest row = closest to the player

  const out: PushPadPos[] = [root];
  for (const midi of notes.slice(1)) {
    const options = padsFor(midi, rows, cols);
    if (options.length === 0) continue;
    options.sort(
      (a, b) =>
        Math.hypot(a.row - root.row, a.col - root.col) -
        Math.hypot(b.row - root.row, b.col - root.col),
    );
    out.push(options[0]);
  }
  return out;
}
