import { describe, expect, it } from 'vitest';
import { inferKeyFromChords, parseExtractedKey, type ChordLike } from './key-inference';
import type { ChordQuality, PitchClass } from '../types';

const c = (root: PitchClass, quality: ChordQuality): ChordLike => ({ root, quality });

describe('inferKeyFromChords', () => {
  it('returns null for no chords', () => {
    expect(inferKeyFromChords([])).toBeNull();
  });

  it('reads a I-V-vi-IV in C as C major', () => {
    const g = inferKeyFromChords([c('C', 'maj'), c('G', 'maj'), c('A', 'min'), c('F', 'maj')]);
    expect(g).toMatchObject({ root: 'C', type: 'major', confidence: 1 });
  });

  it('reads the screenshot progression (Cmaj7 / Em) as E minor', () => {
    // Cmaj7-Em-Cmaj7-Em: both chords are diatonic to C major AND E minor,
    // so the tie is broken by which chord it starts and ends on.
    const g = inferKeyFromChords([
      c('C', 'maj7'), c('E', 'min'), c('C', 'maj7'), c('E', 'min'),
    ]);
    expect(g).toMatchObject({ root: 'E', type: 'minor' });
    expect(g?.confidence).toBe(1);
  });

  it('uses a dominant 7th to separate relative major from minor', () => {
    // Am and E7: E7 is V7 of A minor. Without the dom7 bonus this could
    // read as A minor's relative, C major.
    const g = inferKeyFromChords([c('A', 'min'), c('D', 'min'), c('E', 'dom7'), c('A', 'min')]);
    expect(g).toMatchObject({ root: 'A', type: 'minor' });
  });

  it('reports low confidence when the chords are not all diatonic', () => {
    const g = inferKeyFromChords([c('C', 'maj'), c('F#', 'maj'), c('A#', 'min')]);
    expect(g).not.toBeNull();
    expect(g!.confidence).toBeLessThan(1);
  });

  it('treats power and sus chords as non-contradicting', () => {
    // A '5' chord has no third, so it must not veto an otherwise clean key.
    const g = inferKeyFromChords([c('E', 'min'), c('G', 'maj'), c('D', '5'), c('A', 'sus4')]);
    expect(g?.confidence).toBe(1);
  });

  it('counts a single chord as its own tonic', () => {
    const g = inferKeyFromChords([c('E', 'min')]);
    expect(g).toMatchObject({ root: 'E', type: 'minor', matched: 1, total: 1 });
  });
});

describe('parseExtractedKey', () => {
  it('parses the stored "<root> <type>" shape', () => {
    expect(parseExtractedKey('E minor')).toEqual({ root: 'E', type: 'minor' });
    expect(parseExtractedKey('F# major')).toEqual({ root: 'F#', type: 'major' });
  });

  it('normalizes flats to the sharp spelling PitchClass uses', () => {
    expect(parseExtractedKey('Bb major')).toEqual({ root: 'A#', type: 'major' });
    expect(parseExtractedKey('Eb minor')).toEqual({ root: 'D#', type: 'minor' });
  });

  it('is case- and whitespace-tolerant', () => {
    expect(parseExtractedKey('  a MINOR ')).toEqual({ root: 'A', type: 'minor' });
  });

  it('returns null for absent, modal or unparseable keys', () => {
    expect(parseExtractedKey(null)).toBeNull();
    expect(parseExtractedKey(undefined)).toBeNull();
    expect(parseExtractedKey('')).toBeNull();
    expect(parseExtractedKey('D dorian')).toBeNull();
    expect(parseExtractedKey('modal / ambiguous')).toBeNull();
    expect(parseExtractedKey('H minor')).toBeNull();
  });
});
