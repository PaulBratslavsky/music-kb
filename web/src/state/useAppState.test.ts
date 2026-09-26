// Arpeggio view mode — URL round-trip + fallback behavior.
//
// `useAppState`'s URL sync is the persistence layer for this app's state
// (see the "State machine" section of web/CLAUDE.md): `stateFromUrl` and
// `urlFromState` must stay inverses of each other for every ViewMode, and
// an unrecognized `?mode=` must fall back to the default rather than
// throwing — that's the whole point of `isViewMode` gating the parse.
import { describe, expect, it } from 'vitest';
import { stateFromUrl, urlFromState, urlSyncTarget } from './useAppState';

describe('arpeggio mode round-trips through the URL', () => {
  it('serializes root + quality like chord mode (no inv/v — no single voicing)', () => {
    const state = stateFromUrl('?mode=arpeggio&root=D&quality=min7');
    expect(state.mode).toBe('arpeggio');
    expect(state.chord.root).toBe('D');
    expect(state.chord.quality).toBe('min7');

    const url = urlFromState(state);
    expect(url).toContain('mode=arpeggio');
    expect(url).toContain('root=D');
    expect(url).toContain('quality=min7');
    expect(url).not.toContain('inv=');
    expect(url).not.toContain('v=');
  });

  it('round-trips: stateFromUrl(urlFromState(s)) reproduces the arpeggio selection', () => {
    const original = stateFromUrl('?mode=arpeggio&root=F&quality=dom7');
    const roundTripped = stateFromUrl(urlFromState(original));
    expect(roundTripped.mode).toBe('arpeggio');
    expect(roundTripped.chord.root).toBe('F');
    expect(roundTripped.chord.quality).toBe('dom7');
  });
});

describe('an unknown ?mode= value falls back to the default instead of throwing', () => {
  it('garbage mode → falls back, does not throw', () => {
    expect(() => stateFromUrl('?mode=whatever-this-is-not-a-real-mode')).not.toThrow();
    const state = stateFromUrl('?mode=whatever-this-is-not-a-real-mode');
    expect(state.mode).toBe('chord'); // DEFAULT_STATE.mode
  });

  it('missing ?mode= entirely → falls back, does not throw', () => {
    expect(() => stateFromUrl('')).not.toThrow();
    expect(stateFromUrl('').mode).toBe('chord');
  });

  it('urlFromState never throws for any real ViewMode', () => {
    for (const mode of ['chord', 'arpeggio', 'scale', 'note', 'all'] as const) {
      const state = stateFromUrl(`?mode=${mode}`);
      expect(() => urlFromState(state)).not.toThrow();
    }
  });
});

// The URL write must never drop the hash route.
//
// web is hash-routed: the player lives at `#/video/<id>`. The selection is
// synced as a query string, and `history.replaceState(null, '', '?mode=…')`
// resolves a bare query against the current URL — which replaces the query
// AND discards the fragment. So an instance of this hook mounted on the
// player page used to rewrite `/#/video/abc` to `/?mode=chord…`, and a
// reload landed on the Builder instead of the video.
describe('urlSyncTarget keeps the hash route', () => {
  const chord = stateFromUrl('?mode=chord&root=C&quality=maj&inv=0&v=0');

  it('carries the current hash onto the URL it writes', () => {
    const target = urlSyncTarget(chord, { search: '', hash: '#/video/abc' });
    expect(target).toBe('?mode=chord&root=C&quality=maj&inv=0&v=0#/video/abc');
  });

  it('writes nothing when the query already matches', () => {
    const search = urlFromState(chord);
    expect(urlSyncTarget(chord, { search, hash: '#/video/abc' })).toBeNull();
  });

  it('writes a plain query when there is no hash', () => {
    expect(urlSyncTarget(chord, { search: '', hash: '' })).toBe(urlFromState(chord));
  });

  it('resolves to a URL that still routes to the video', () => {
    // The exact failure: resolve what we write against a player-page URL.
    const target = urlSyncTarget(chord, { search: '', hash: '#/video/abc' })!;
    const resolved = new URL(target, 'https://app.example/#/video/abc');
    expect(resolved.hash).toBe('#/video/abc');
  });
});
