// Standalone progressions — the ones built on the Builder home page, which
// belong to no video.
//
// `SavedProgression.videoId` is nullable so both kinds live on one
// `tv:progressions` key. That's only safe if the two readers stay disjoint
// and a video deletion can't take a standalone progression with it, which
// is what these tests pin. Everything here runs against a stubbed
// localStorage because vitest's default environment is node, not jsdom.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addProgression,
  addVideo,
  deleteVideo,
  progressionsForVideo,
  standaloneProgressions,
} from './storage';

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as { window?: unknown }).window = { localStorage };
}

beforeEach(installFakeLocalStorage);
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('standalone progressions', () => {
  it('round-trips a progression saved with no video', () => {
    const saved = addProgression({
      videoId: null,
      name: 'ii-V-I',
      chords: [
        { root: 'D', quality: 'min7' },
        { root: 'G', quality: 'dom7' },
        { root: 'C', quality: 'maj7' },
      ],
    });

    const all = standaloneProgressions();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(saved.id);
    expect(all[0].name).toBe('ii-V-I');
    expect(all[0].chords.map((c) => c.root)).toEqual(['D', 'G', 'C']);
  });

  it('lists newest first', () => {
    addProgression({ videoId: null, name: 'older', chords: [] });
    addProgression({ videoId: null, name: 'newer', chords: [] });
    expect(standaloneProgressions().map((p) => p.name)).toEqual(['newer', 'older']);
  });

  it('is disjoint from video-scoped progressions in both directions', () => {
    addProgression({ videoId: null, name: 'standalone', chords: [] });
    addProgression({ videoId: 'vid-1', name: 'from a song', chords: [] });

    expect(standaloneProgressions().map((p) => p.name)).toEqual(['standalone']);
    expect(progressionsForVideo('vid-1').map((p) => p.name)).toEqual(['from a song']);
  });
});

describe('deleting a video', () => {
  it('cascades to that video progressions but spares standalone ones', () => {
    const video = addVideo({
      url: 'https://youtu.be/abc12345678',
      youtubeVideoId: 'abc12345678',
      title: 'A tutorial',
      author: 'Someone',
      thumbnailUrl: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg',
    });
    addProgression({ videoId: video.id, name: 'song chords', chords: [] });
    addProgression({ videoId: null, name: 'my own thing', chords: [] });

    expect(deleteVideo(video.id)).toBe(true);

    expect(progressionsForVideo(video.id)).toEqual([]);
    expect(standaloneProgressions().map((p) => p.name)).toEqual(['my own thing']);
  });
});
