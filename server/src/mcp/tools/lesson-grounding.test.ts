// MCP lesson writes never keep a timecode the model produced (issue #10).
//
// CLAUDE.md: "Do not add a code path that trusts a timecode the model
// produced." The app's generator never does — it tells the model not to emit
// timecodes and derives each one by BM25 against the video's transcript. The
// MCP write tools used to store `source.timeSec` exactly as sent. These tests
// pin the app's policy on the MCP path:
//
//   - a confident transcript match decides the timecode, whatever was sent;
//   - no confident match, no stored index, or no text to match means NO
//     timecode — "a wrong timecode is worse than no timecode" (the app's own
//     words, in resolveBlockSource);
//   - a citation to a video that isn't in the library is reported, so the
//     tool can reject it rather than ship a dead link.
//
// The index is built with the client's builder, as bm25-search.parity.test.ts
// does: server PRODUCTION code only ever reads a stored index (ADR 0010).
import { describe, expect, it } from 'vitest';
import { buildBM25Index } from '../../../../client/src/lib/services/transcript';
import { citedVideoIds, groundLessonTimecodes, type CitedVideo } from './lesson-grounding';

// A small transcript whose chunks are easy to tell apart.
const INDEX = buildBM25Index([
  { id: 0, startWord: 0, timeSec: 0, text: 'welcome to the channel today we talk about practice routines and warmups' },
  { id: 1, startWord: 12, timeSec: 95, text: 'a major triad stacks a major third and a minor third on top of the root note' },
  { id: 2, startWord: 30, timeSec: 210, text: 'the minor pentatonic box one sits under your hand at the fifth fret for a minor' },
  { id: 3, startWord: 48, timeSec: 340, text: 'resolve the turnaround by walking the bass line down to the tonic chord' },
]);

const VIDEO = 'dQw4w9WgXcQ';
const known = (video: CitedVideo) => new Map<string, CitedVideo>([[VIDEO, video]]);
const withIndex = known({ exists: true, index: INDEX as never });

describe('a confident match decides the timecode', () => {
  it('replaces a wrong model-supplied timecode with the real one', () => {
    const body: any[] = [
      {
        __component: 'lesson.prose',
        body: 'A major triad stacks a major third and a minor third on the root.',
        source: { videoId: VIDEO, timeSec: 12 }, // the model guessed
      },
    ];
    const report = groundLessonTimecodes(body, withIndex);
    expect(body[0].source.timeSec).toBe(95);
    expect(report.grounded).toEqual([{ block: 0, videoId: VIDEO, from: 12, to: 95 }]);
  });

  it('adds a timecode the model left out, as the app would', () => {
    const body: any[] = [
      {
        __component: 'lesson.callout',
        body: 'Resolve the turnaround by walking the bass line down to the tonic.',
        source: { videoId: VIDEO },
      },
    ];
    groundLessonTimecodes(body, withIndex);
    expect(body[0].source.timeSec).toBe(340);
  });

  it('grounds a step on its title, lede and body together', () => {
    const body: any[] = [
      {
        __component: 'lesson.step',
        title: 'Box one',
        lede: 'Where the minor pentatonic box sits',
        body: 'At the fifth fret for A minor.',
        source: { videoId: VIDEO, timeSec: 0 },
      },
    ];
    groundLessonTimecodes(body, withIndex);
    expect(body[0].source.timeSec).toBe(210);
  });

  it('grounds a video-ref on its own label', () => {
    const body: any[] = [
      { __component: 'lesson.video-ref', videoId: VIDEO, timeSec: 5, label: 'walking the bass line down to the tonic' },
    ];
    groundLessonTimecodes(body, withIndex);
    expect(body[0].timeSec).toBe(340);
  });

  it('a correct model timecode is kept and not reported as a change', () => {
    const body: any[] = [
      {
        __component: 'lesson.prose',
        body: 'A major triad stacks a major third and a minor third on the root.',
        source: { videoId: VIDEO, timeSec: 95 },
      },
    ];
    const report = groundLessonTimecodes(body, withIndex);
    expect(body[0].source.timeSec).toBe(95);
    expect(report.grounded).toEqual([]);
  });
});

describe('without a confident match there is no timecode — never the model\'s', () => {
  it('no match: removed, and the video citation stays', () => {
    const body: any[] = [
      {
        __component: 'lesson.prose',
        body: 'Quantum chromodynamics and gluon confinement.',
        source: { videoId: VIDEO, timeSec: 42 },
      },
    ];
    const report = groundLessonTimecodes(body, withIndex);
    expect(body[0].source).toEqual({ videoId: VIDEO });
    expect(report.removed).toEqual([{ block: 0, videoId: VIDEO, from: 42, reason: 'no-match' }]);
  });

  it('no stored index for the video: removed', () => {
    const body: any[] = [
      { __component: 'lesson.prose', body: 'A major triad.', source: { videoId: VIDEO, timeSec: 42 } },
    ];
    const report = groundLessonTimecodes(body, known({ exists: true, index: null }));
    expect(body[0].source).toEqual({ videoId: VIDEO });
    expect(report.removed[0].reason).toBe('no-index');
  });

  it('nothing to match against: removed', () => {
    const body: any[] = [
      { __component: 'lesson.video-ref', videoId: VIDEO, timeSec: 42 }, // no label
    ];
    const report = groundLessonTimecodes(body, withIndex);
    expect(body[0]).not.toHaveProperty('timeSec');
    expect(report.removed[0].reason).toBe('no-text');
  });

  it('a timecode with no video to belong to is removed', () => {
    const body: any[] = [{ __component: 'lesson.prose', body: 'x', source: { timeSec: 42 } }];
    groundLessonTimecodes(body, withIndex);
    expect(body[0].source).not.toHaveProperty('timeSec');
  });
});

describe('a citation to a video outside the library is reported', () => {
  it('lists the unknown id and leaves the block for the caller to reject', () => {
    const body: any[] = [
      { __component: 'lesson.prose', body: 'A major triad.', source: { videoId: 'hallucinate', timeSec: 3 } },
      { __component: 'lesson.video-ref', videoId: 'alsoFake123' },
    ];
    const report = groundLessonTimecodes(body, new Map([
      ['hallucinate', { exists: false }],
      ['alsoFake123', { exists: false }],
    ]));
    expect(report.unknownVideos.sort()).toEqual(['alsoFake123', 'hallucinate']);
  });
});

describe('citedVideoIds', () => {
  it('collects every cited video once, from sources and video-refs', () => {
    const body: any[] = [
      { __component: 'lesson.prose', body: 'a', source: { videoId: 'A' } },
      { __component: 'lesson.prose', body: 'b', source: { videoId: 'A' } },
      { __component: 'lesson.video-ref', videoId: 'B' },
      { __component: 'lesson.heading', text: 'no source' },
    ];
    expect(citedVideoIds(body).sort()).toEqual(['A', 'B']);
  });
});
