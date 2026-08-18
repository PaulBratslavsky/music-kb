import type { ChordQuality } from '../types';

/**
 * Display label for each ChordQuality — used in BOTH the SelectionBar
 * Quality picker chips AND the label string produced by resolveSelection
 * (e.g. "C major — root position, E-shape barre").
 *
 * Single source of truth. When adding a new quality to `types.ts`, the
 * Record type forces a compile error here until you add a label for it.
 *
 * Naming guideline: short enough to fit a chip (≤8 chars), uses the
 * conventional chord-symbol glyphs (♭ for flat, ♯ for sharp, ° for
 * diminished). Empty-string and 'maj' are both legal for major triads in
 * sheet music; we use 'maj' here so the picker chip is unambiguous.
 */
export const QUALITY_LABELS: Record<ChordQuality, string> = {
  '5': '5',
  maj: 'maj',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  '6': '6',
  m6: 'm6',
  maj7: 'maj7',
  min7: 'm7',
  dom7: '7',
  m7b5: 'm7♭5',
  dim7: 'dim7',
  mMaj7: 'mMaj7',
  '7sus4': '7sus4',
  add9: 'add9',
  madd9: 'm(add9)',
  '9': '9',
  maj9: 'maj9',
  m9: 'm9',
  '11': '11',
  m11: 'm11',
  '13': '13',
  m13: 'm13',
  '7b5': '7♭5',
  '7#5': '7♯5',
  '7b9': '7♭9',
  '7#9': '7♯9',
  alt: 'alt',
};
