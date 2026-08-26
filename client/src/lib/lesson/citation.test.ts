import { describe, it, expect } from 'vitest';
import {
  citationStartSec,
  formatCitationTime,
  sameCitation,
  youtubeWatchUrl,
} from './citation';

// citationStartSec is the single choke point that keeps a missing
// BM25-grounded timestamp from turning into `t=undefined` / `t=NaN` in a
// URL or a `currentTime = undefined` on the player. Every case that could
// reach it from a Strapi `json` column is pinned here.
describe('citationStartSec', () => {
  it('uses the grounded second when there is one', () => {
    expect(citationStartSec({ timeSec: 42 })).toBe(42);
  });

  it('floors a fractional second — the player wants whole seconds', () => {
    expect(citationStartSec({ timeSec: 42.7 })).toBe(42);
  });

  it('starts at the beginning when grounding declined to guess', () => {
    expect(citationStartSec({})).toBe(0);
    expect(citationStartSec({ timeSec: undefined })).toBe(0);
    expect(citationStartSec({ timeSec: null })).toBe(0);
  });

  it('starts at the beginning for values that are not a real time', () => {
    expect(citationStartSec({ timeSec: Number.NaN })).toBe(0);
    expect(citationStartSec({ timeSec: Number.POSITIVE_INFINITY })).toBe(0);
    expect(citationStartSec({ timeSec: -30 })).toBe(0);
  });
});

describe('sameCitation', () => {
  it('matches the same video at the same grounded moment', () => {
    expect(
      sameCitation({ videoId: 'a', timeSec: 12 }, { videoId: 'a', timeSec: 12 }),
    ).toBe(true);
  });

  it('treats "no timestamp" and "second zero" as the same moment', () => {
    // They load the player identically, so marking one active and not the
    // other would be a distinction the reader cannot see.
    expect(sameCitation({ videoId: 'a' }, { videoId: 'a', timeSec: 0 })).toBe(true);
  });

  it('does not match a different video or a different moment', () => {
    expect(
      sameCitation({ videoId: 'a', timeSec: 12 }, { videoId: 'b', timeSec: 12 }),
    ).toBe(false);
    expect(
      sameCitation({ videoId: 'a', timeSec: 12 }, { videoId: 'a', timeSec: 99 }),
    ).toBe(false);
  });

  it('never matches when nothing is loaded', () => {
    expect(sameCitation({ videoId: 'a', timeSec: 12 }, null)).toBe(false);
    expect(sameCitation(null, { videoId: 'a', timeSec: 12 })).toBe(false);
  });
});

describe('formatCitationTime', () => {
  it('formats as m:ss below an hour', () => {
    expect(formatCitationTime(0)).toBe('0:00');
    expect(formatCitationTime(42)).toBe('0:42');
    expect(formatCitationTime(90)).toBe('1:30');
    expect(formatCitationTime(3599)).toBe('59:59');
  });

  it('formats as h:mm:ss from an hour up', () => {
    expect(formatCitationTime(3600)).toBe('1:00:00');
    expect(formatCitationTime(3725)).toBe('1:02:05');
  });
});

describe('youtubeWatchUrl', () => {
  it('deep-links to the grounded second', () => {
    expect(youtubeWatchUrl({ videoId: 'abc123', timeSec: 42 })).toBe(
      'https://www.youtube.com/watch?v=abc123&t=42s',
    );
  });

  it('omits the time entirely rather than emitting t=undefined', () => {
    const url = youtubeWatchUrl({ videoId: 'abc123' });
    expect(url).toBe('https://www.youtube.com/watch?v=abc123');
    expect(url).not.toContain('undefined');
    expect(url).not.toContain('t=');
  });
});
