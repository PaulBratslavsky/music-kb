import { describe, expect, it } from 'vitest';
import { pitchClassAt } from './neck';

// string 0 = high e … 5 = low E (guitar), string 0 = high G … 3 = low E (bass)

describe('pitchClassAt — guitar', () => {
  it('gets the open strings right', () => {
    expect(pitchClassAt(0, 0, 'guitar')).toBe('E'); // high e
    expect(pitchClassAt(1, 0, 'guitar')).toBe('B');
    expect(pitchClassAt(2, 0, 'guitar')).toBe('G');
    expect(pitchClassAt(3, 0, 'guitar')).toBe('D');
    expect(pitchClassAt(4, 0, 'guitar')).toBe('A');
    expect(pitchClassAt(5, 0, 'guitar')).toBe('E'); // low E
  });

  // The exact five positions the live-data audit found mislabelled —
  // this is the bug this helper exists to stop from recurring.
  it('matches the positions the audit found the model naming wrong', () => {
    expect(pitchClassAt(3, 5, 'guitar')).toBe('G'); // was labelled C
    expect(pitchClassAt(3, 10, 'guitar')).toBe('C'); // was labelled D
    expect(pitchClassAt(3, 12, 'guitar')).toBe('D'); // was labelled E
    expect(pitchClassAt(1, 13, 'guitar')).toBe('C'); // was labelled D
    expect(pitchClassAt(4, 15, 'guitar')).toBe('C'); // was labelled D
  });

  it('defaults to guitar when no instrument is given', () => {
    expect(pitchClassAt(0, 0)).toBe('E');
  });

  it('returns null for a string the instrument does not have', () => {
    expect(pitchClassAt(6, 0, 'guitar')).toBeNull();
    expect(pitchClassAt(-1, 0, 'guitar')).toBeNull();
  });

  it('returns null for a negative or non-integer fret', () => {
    expect(pitchClassAt(0, -1, 'guitar')).toBeNull();
    expect(pitchClassAt(0, 1.5, 'guitar')).toBeNull();
  });

  it('wraps octaves past the 12th fret', () => {
    expect(pitchClassAt(0, 12, 'guitar')).toBe('E'); // e string, octave up
  });
});

describe('pitchClassAt — bass', () => {
  it('gets the open strings right', () => {
    expect(pitchClassAt(0, 0, 'bass')).toBe('G'); // high G
    expect(pitchClassAt(1, 0, 'bass')).toBe('D');
    expect(pitchClassAt(2, 0, 'bass')).toBe('A');
    expect(pitchClassAt(3, 0, 'bass')).toBe('E'); // low E
  });

  it('computes a fretted note', () => {
    expect(pitchClassAt(1, 2, 'bass')).toBe('E'); // D + 2 frets
  });

  it('returns null for a string a 4-string bass does not have', () => {
    expect(pitchClassAt(4, 0, 'bass')).toBeNull();
    expect(pitchClassAt(5, 0, 'bass')).toBeNull(); // the guitar-range string a model defaults to
  });
});
