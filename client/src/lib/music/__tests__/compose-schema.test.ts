import { describe, expect, it } from 'vitest';
import { parseStoredComposition } from '../compose/schema';
import { emptyComposition, SCHEMA_VERSION } from '../compose/types';

describe('parseStoredComposition', () => {
  it('round-trips a current composition (preserving seventh)', () => {
    const c = emptyComposition('c1', 'Test', 'C', 'major');
    c.chords = [{ id: 'a', degree: 1, seventh: true, start: 0, length: 16 }];
    const parsed = parseStoredComposition(JSON.parse(JSON.stringify(c)));
    expect(parsed).not.toBeNull();
    expect(parsed!.chords).toHaveLength(1);
    expect(parsed!.chords[0].seventh).toBe(true);
    expect(parsed!.version).toBe(SCHEMA_VERSION);
  });

  it('migrates a v1 row by defaulting chord.seventh to false', () => {
    // A row saved before sevenths existed: version 1, chords without the field.
    const v1 = {
      id: 'old',
      version: 1,
      name: 'Pre-seventh',
      key: { root: 'C', mode: 'major' },
      bpm: 100,
      chords: [{ id: 'a', degree: 1, start: 0, length: 16 }],
      melody: [],
      bass: [],
    };
    const parsed = parseStoredComposition(v1);
    expect(parsed).not.toBeNull();
    expect(parsed!.chords[0].seventh).toBe(false);
    expect(parsed!.version).toBe(SCHEMA_VERSION);
  });

  it('defaults version on a pre-versioning row', () => {
    const c = emptyComposition('c2', 'Old', 'G', 'minor') as Record<string, unknown>;
    delete c.version; // simulate a row saved before versioning existed
    const parsed = parseStoredComposition(c);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(SCHEMA_VERSION);
  });

  it('rejects a malformed blob (out-of-range degree)', () => {
    const c = emptyComposition('c3') as Record<string, unknown>;
    c.chords = [{ id: 'x', degree: 9, start: 0, length: 4 }]; // degree > 7
    expect(parseStoredComposition(c)).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(parseStoredComposition(null)).toBeNull();
    expect(parseStoredComposition('nope')).toBeNull();
  });
});
