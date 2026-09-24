// The PNG exporter's CSS-variable allowlist has to cover every variable the
// exportable SVGs actually reference.
//
// exportFretboardPng serializes an SVG out of the document and rasterizes it
// standalone, which severs it from the stylesheet that defines the theme.
// Its fix is to inline the variables — but only the ones named in VAR_NAMES.
// A variable the SVG uses and the list omits does not fall back to something
// sensible: an unresolved var() makes the presentation attribute invalid, so
// the property takes its INITIAL value. `stroke` becomes `none` (the fret and
// string lines vanish outright) and `fill` becomes black (dots and the nut go
// solid black, and any label drawn in a light token turns black-on-black).
//
// That failure is invisible in the app — on screen the vars resolve fine — and
// only shows up in a downloaded file, which is the worst place to find it. So
// this guard compares the list against the source text of every component that
// can end up inside an exported SVG.
//
// Adding a component that renders into an `svg.instrument-svg`? Add it to
// EXPORTABLE_SOURCES below.
// Sources are read through Vite's `?raw` glob rather than node's fs: this
// file is compiled by tsconfig.app.json, which gives src/ only `vite/client`
// types on purpose, so that browser code can't reach for node APIs.
import { describe, expect, it } from 'vitest';
import { VAR_NAMES } from './png-export';

// Rooted at the project root (a leading slash) rather than written relative
// to this file: Vite normalises a relative glob's same-directory matches to
// "./Name.tsx" while nesting others as "../dir/Name.tsx", and a root-rooted
// pattern gives every entry the same "/src/dir/Name.tsx" shape instead.
const SOURCE_TEXT = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const EXPORTABLE_SOURCES = [
  // The four boards the Builder page exports directly.
  'instruments/piano/PianoView.tsx',
  'instruments/guitar/GuitarView.tsx',
  'instruments/bass/BassView.tsx',
  'instruments/push/PushView.tsx',
  // The notation strips.
  'instruments/notation/SheetMusicView.tsx',
  'instruments/notation/TabView.tsx',
  // Chord diagrams: the progression sheet and per-chord card, plus everything
  // they nest.
  'music/ProgressionSheet.tsx',
  'music/ChordCard.tsx',
  'music/ChordMini.tsx',
  'music/ChordDiagram.tsx',
  'lessons/components/MiniPush.tsx',
];

/** Every `var(--x)` referenced in a file, as bare names. */
function varsUsedIn(relPath: string): string[] {
  const text = SOURCE_TEXT[`/src/${relPath}`];
  // A renamed or moved component must fail here rather than silently pass
  // with an empty var list, which would leave the real gap uncovered.
  if (text === undefined) {
    throw new Error(
      `EXPORTABLE_SOURCES lists "${relPath}", which no longer exists. ` +
        'Update the list to match the file that replaced it.',
    );
  }
  return [...text.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
}

describe('VAR_NAMES covers every exportable SVG source', () => {
  it.each(EXPORTABLE_SOURCES)('%s', (relPath) => {
    const missing = [...new Set(varsUsedIn(relPath))]
      .filter((v) => !VAR_NAMES.includes(v))
      .sort();
    expect(missing).toEqual([]);
  });
});

describe('the allowlist itself', () => {
  it('has no duplicates', () => {
    expect(VAR_NAMES).toEqual([...new Set(VAR_NAMES)]);
  });

  it('covers the chord-diagram tokens, which is the gap that broke exports', () => {
    // Pinned by name as well as by the scan above: these four are aliases
    // defined in styles.css (--ink: var(--text) and friends) that only the
    // chord diagrams use, so they were easy to miss when this exporter was
    // adapted from the client's copy.
    for (const v of ['--ink', '--ink-muted', '--line', '--card']) {
      expect(VAR_NAMES).toContain(v);
    }
  });
});
