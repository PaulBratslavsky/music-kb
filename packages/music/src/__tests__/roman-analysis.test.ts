import { describe, expect, it } from 'vitest';
import { parseChordSymbol } from '../theory/parse-chord';
import { analyzeChordInKey } from '../theory/roman-analysis';
import type { PitchClass } from '../types';

// Helper: parse + analyze in one step.
const inKey = (symbol: string, key: PitchClass, mode: 'major' | 'minor') => {
  const p = parseChordSymbol(symbol);
  expect(p, `${symbol} failed to parse`).not.toBeNull();
  return analyzeChordInKey(p!, key, mode);
};

describe('Roman analysis — diatonic in C major', () => {
  it('Cmaj7 → Imaj7 (tonic)', () => {
    const r = inKey('Cmaj7', 'C', 'major');
    expect(r.roman).toBe('Imaj7');
    expect(r.func).toBe('T');
  });

  it('C triad → I (no maj7 suffix when user typed a plain triad)', () => {
    const r = inKey('C', 'C', 'major');
    expect(r.roman).toBe('I');
    expect(r.func).toBe('T');
  });

  it('Dm7 → ii7 (case carries the minor)', () => {
    const r = inKey('Dm7', 'C', 'major');
    expect(r.roman).toBe('ii7');
    expect(r.func).toBe('PD');
  });

  it('G7 → V7 (dominant)', () => {
    const r = inKey('G7', 'C', 'major');
    expect(r.roman).toBe('V7');
    expect(r.func).toBe('D');
  });

  it('Am7 → vi7', () => {
    const r = inKey('Am7', 'C', 'major');
    expect(r.roman).toBe('vi7');
    expect(r.func).toBe('T');
  });

  it('Bm7b5 → viiø (ornament carries m7b5; no extra suffix)', () => {
    const r = inKey('Bm7b5', 'C', 'major');
    expect(r.roman).toBe('viiø');
    expect(r.func).toBe('D');
  });
});

describe('Roman analysis — secondary dominants', () => {
  it('A7 in C major → V7/ii (dominant of Dm)', () => {
    const r = inKey('A7', 'C', 'major');
    expect(r.roman).toBe('V7/ii');
    expect(r.func).toBe('D');
  });

  it('D7 in C major → V7/V (dominant of G)', () => {
    const r = inKey('D7', 'C', 'major');
    expect(r.roman).toBe('V7/V');
    expect(r.func).toBe('D');
  });

  it('E7 in C major → V7/vi (dominant of Am)', () => {
    const r = inKey('E7', 'C', 'major');
    expect(r.roman).toBe('V7/vi');
    expect(r.func).toBe('D');
  });
});

describe('Roman analysis — modal interchange (major key)', () => {
  it('Fm in C major → iv (borrowed from C minor)', () => {
    const r = inKey('Fm', 'C', 'major');
    expect(r.roman).toBe('iv');
    expect(r.func).toBe('chromatic');
  });

  it('Ab in C major → ♭VI', () => {
    const r = inKey('Ab', 'C', 'major');
    expect(r.roman).toBe('♭VI');
    expect(r.func).toBe('chromatic');
  });

  it('Bb in C major → ♭VII', () => {
    const r = inKey('Bb', 'C', 'major');
    expect(r.roman).toBe('♭VII');
    expect(r.func).toBe('chromatic');
  });
});

describe('Roman analysis — unknown', () => {
  it('F# major in C major → ?', () => {
    const r = inKey('F#', 'C', 'major');
    expect(r.roman).toBe('?');
    expect(r.func).toBe('unknown');
  });
});

describe('Roman analysis — minor key diatonic', () => {
  it('Am triad in A minor → i', () => {
    const r = inKey('Am', 'A', 'minor');
    expect(r.roman).toBe('i');
    expect(r.func).toBe('T');
  });

  it('Am7 in A minor → i7', () => {
    const r = inKey('Am7', 'A', 'minor');
    expect(r.roman).toBe('i7');
    expect(r.func).toBe('T');
  });

  it('Dm in A minor → iv', () => {
    const r = inKey('Dm', 'A', 'minor');
    expect(r.roman).toBe('iv');
    expect(r.func).toBe('PD');
  });

  it('F major triad in A minor → VI (F is diatonic in natural minor)', () => {
    const r = inKey('F', 'A', 'minor');
    expect(r.roman).toBe('VI');
    expect(r.func).toBe('T');
  });
});
