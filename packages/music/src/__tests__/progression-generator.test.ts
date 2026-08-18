import { describe, expect, it } from 'vitest';
import {
  generateProgression,
  STYLE_OPTIONS,
  type ProgressionStyle,
} from '../theory/progression-generator';

/** Deterministic PRNG so "random" output is reproducible in tests. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLES = STYLE_OPTIONS.map((s) => s.id);
const MODES = ['major', 'minor'] as const;

/** Every (style, mode, length, seed) combination — the full search space. */
function everyProgression(lengths = [4, 8]) {
  const out = [];
  for (const style of STYLES) {
    for (const mode of MODES) {
      for (const length of lengths) {
        for (let seed = 0; seed < 60; seed++) {
          out.push({
            style,
            mode,
            length,
            result: generateProgression({
              mode,
              style,
              length,
              rng: mulberry32(seed),
            }),
          });
        }
      }
    }
  }
  return out;
}

describe('generateProgression', () => {
  it('is deterministic for a given seed', () => {
    const a = generateProgression({ mode: 'major', style: 'pop', rng: mulberry32(7) });
    const b = generateProgression({ mode: 'major', style: 'pop', rng: mulberry32(7) });
    expect(a.degrees).toEqual(b.degrees);
  });

  it('produces different progressions for different seeds', () => {
    const seen = new Set(
      Array.from({ length: 30 }, (_, i) =>
        generateProgression({
          mode: 'major',
          style: 'pop',
          length: 4,
          rng: mulberry32(i),
        }).degrees.join('-'),
      ),
    );
    expect(seen.size).toBeGreaterThan(3);
  });

  it('always opens on the tonic', () => {
    for (const { result } of everyProgression()) {
      expect(result.degrees[0]).toBe(1);
    }
  });

  it('never repeats a chord back to back', () => {
    for (const { result, style, mode } of everyProgression()) {
      for (let i = 1; i < result.degrees.length; i++) {
        expect(
          result.degrees[i],
          `${style}/${mode}: ${result.degrees.join('-')}`,
        ).not.toBe(result.degrees[i - 1]);
      }
    }
  });

  it('only uses degrees the style allows', () => {
    const ALLOWED: Record<ProgressionStyle, number[]> = {
      pop: [1, 2, 4, 5, 6],
      jazz: [1, 2, 3, 4, 5, 6, 7],
      blues: [1, 4, 5],
      folk: [1, 2, 4, 5, 6],
      cinematic: [1, 3, 4, 6, 7],
    };
    for (const { result, style } of everyProgression()) {
      for (const d of result.degrees) {
        expect(ALLOWED[style], `${style}: ${result.degrees.join('-')}`).toContain(d);
      }
    }
  });

  it('lands on a real cadence rather than stopping at random', () => {
    for (const { result } of everyProgression()) {
      const last = result.degrees[result.degrees.length - 1];
      const prev = result.degrees[result.degrees.length - 2];
      switch (result.cadence) {
        case 'authentic':
          expect(last).toBe(1);
          expect(prev).toBe(5);
          break;
        case 'plagal':
          expect(last).toBe(1);
          expect(prev).toBe(4);
          break;
        case 'deceptive':
          expect(last).toBe(6);
          expect(prev).toBe(5);
          break;
        case 'half':
          expect(last).toBe(5);
          break;
      }
    }
  });

  it('honours the requested length', () => {
    for (const { result, length } of everyProgression([4, 6, 8])) {
      expect(result.degrees).toHaveLength(length);
    }
  });

  it('never lets a dominant fall back to a predominant, except the rock V–IV', () => {
    // A D → S move (V → ii, vii° → IV, …) is the retrogression that makes
    // random output wander. V → IV is the one sanctioned exception.
    for (const { result, style, mode } of everyProgression()) {
      for (let i = 1; i < result.degrees.length; i++) {
        const from = result.degrees[i - 1];
        const to = result.degrees[i];
        const isDominant = from === 5 || (mode === 'major' && from === 7);
        const isPredominant = to === 2 || to === 4;
        if (isDominant && isPredominant) {
          expect(
            `${from}->${to}`,
            `${style}/${mode}: ${result.degrees.join('-')}`,
          ).toBe('5->4');
        }
      }
    }
  });

  it('gives blues only I, IV and V', () => {
    for (const { result } of everyProgression().filter((p) => p.style === 'blues')) {
      expect(new Set(result.degrees).size).toBeLessThanOrEqual(3);
    }
  });

  it('raises the minor V only for styles that want a leading tone', () => {
    for (const { result, mode, style } of everyProgression()) {
      if (mode === 'major') {
        expect(result.raisedSeventh).toBe(false);
        continue;
      }
      // Modal styles keep the natural minor v — that unresolved quality is
      // the point of the sound.
      if (style === 'cinematic' || style === 'pop' || style === 'folk') {
        expect(result.raisedSeventh).toBe(false);
      }
      if (result.raisedSeventh) expect(result.degrees).toContain(5);
    }
  });

  it('always reaches the dominant when the ending depends on one', () => {
    // Plagal and modal endings resolve without a V and may never touch one.
    // Every other cadence is defined by its dominant, so it must be there.
    for (const { result, style, mode } of everyProgression()) {
      if (result.cadence === 'plagal' || result.cadence === 'modal') continue;
      expect(
        result.degrees,
        `${style}/${mode}: ${result.degrees.join('-')}`,
      ).toContain(5);
    }
  });

  it('describes what it built', () => {
    for (const { result } of everyProgression([4])) {
      expect(result.rationale).toMatch(/cadence|dominant/);
      expect(result.rationale.length).toBeGreaterThan(20);
    }
  });
});
