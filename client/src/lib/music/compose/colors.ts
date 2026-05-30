// Progression Composer — per-degree colors for chord blocks and palette
// chips, so a given scale degree reads as the same hue everywhere (à la
// Hookpad). Muted tones that hold up on both light and dark themes with
// white text.

export const DEGREE_COLORS: Record<number, string> = {
  1: '#c2553f', // tonic — terracotta red
  2: '#b07b39', // amber
  3: '#8a5aa6', // violet
  4: '#4f9d69', // green
  5: '#4a83c2', // blue
  6: '#b0529c', // magenta
  7: '#6b7280', // slate (diminished)
};

export function degreeColor(degree: number): string {
  return DEGREE_COLORS[degree] ?? '#6b7280';
}
