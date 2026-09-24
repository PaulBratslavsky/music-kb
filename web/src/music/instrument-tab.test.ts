// Which instrument tab the Builder page opens on.
//
// This is a per-viewer convenience, so it lives in localStorage rather than
// the URL: the URL describes the chord you are looking at and is meant to be
// shareable, and a link should not drag the sender's tab choice along with it.
//
// localStorage is also the least reliable thing the app touches — it can be
// absent, throw outright in a private window, or hold a value written by an
// older build. Every path has to end at a real tab, which is what these pin.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTRUMENT_TAB,
  INSTRUMENT_TABS,
  readInstrumentTab,
  writeInstrumentTab,
} from './instrument-tab';

function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      ...impl,
    },
  };
  return store;
}

beforeEach(() => void installStorage());
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('reading the stored tab', () => {
  it('defaults to guitar when nothing has been stored', () => {
    expect(readInstrumentTab()).toBe('guitar');
    expect(DEFAULT_INSTRUMENT_TAB).toBe('guitar');
  });

  it('round-trips every tab the strip offers', () => {
    for (const tab of INSTRUMENT_TABS) {
      writeInstrumentTab(tab.key);
      expect(readInstrumentTab()).toBe(tab.key);
    }
  });

  it('falls back to the default for a value that is not a tab', () => {
    // An older build, a hand-edited key, or a renamed board. Selecting a tab
    // that does not exist would render an empty panel with no way back.
    const store = installStorage();
    store.set('tv:instrument-tab', 'harpsichord');
    expect(readInstrumentTab()).toBe('guitar');
  });

  it('falls back when localStorage throws, rather than breaking the page', () => {
    installStorage({
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(() => readInstrumentTab()).not.toThrow();
    expect(readInstrumentTab()).toBe('guitar');
  });

  it('returns the default during SSR, where there is no window at all', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readInstrumentTab()).toBe('guitar');
  });
});

describe('writing the stored tab', () => {
  it('silently no-ops when localStorage throws', () => {
    installStorage({
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    });
    expect(() => writeInstrumentTab('push')).not.toThrow();
  });
});

describe('the tab set itself', () => {
  it('has keys matching the data-board attributes the exporter queries', () => {
    // ChordBuilderPanel finds a board to export with
    // `[data-board="<key>"] svg.instrument-svg`, so these keys are not just
    // labels — they are the export selector.
    expect(INSTRUMENT_TABS.map((t) => t.key)).toEqual([
      'piano',
      'guitar',
      'bass',
      'push',
    ]);
  });

  it('gives every tab a label', () => {
    for (const tab of INSTRUMENT_TABS) expect(tab.label.length).toBeGreaterThan(0);
  });
});
