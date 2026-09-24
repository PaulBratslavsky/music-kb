// The PNG exporter's CSS-variable allowlist has to cover every variable the
// exportable SVGs actually reference.
//
// exportFretboardPng serializes an SVG out of the document and rasterizes it
// standalone, which severs it from the stylesheet that defines the theme. Its
// fix is to inline the variables — but only the ones named in VAR_NAMES. A
// variable the SVG uses and the list omits does not fall back to something
// sensible: an unresolved var() makes the presentation attribute invalid, so
// the property takes its INITIAL value. `stroke` becomes `none` (lines vanish
// outright) and `fill` becomes black (dots and markers go solid black, and a
// label drawn in a light token turns black-on-black).
//
// That failure is invisible in the app — on screen the vars resolve against
// .theory-companion — and only shows up in a downloaded file. It shipped once
// in web/ for exactly that reason; this is the same guard on this side, and it
// caught the three --game-* colours missing here.
//
// Adding a component that renders into an `svg.instrument-svg`? Add it to
// EXPORTABLE_SOURCES below.
import { describe, expect, it } from 'vitest';
import { VAR_NAMES } from './png-export';

// Rooted at the project root (a leading slash) rather than written relative to
// this file: Vite normalises a relative glob's same-directory matches to
// "./Name.tsx" while nesting others as "../dir/Name.tsx", and a root-rooted
// pattern gives every entry the same "/src/dir/Name.tsx" shape instead.
const SOURCE_TEXT = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const EXPORTABLE_SOURCES = [
  // The boards ChordBuilder exports (the /builder page and the video Chords
  // tab). Game-mode feedback colours live in these.
  'lib/music/instruments/piano/PianoView.tsx',
  'lib/music/instruments/guitar/GuitarView.tsx',
  'lib/music/instruments/bass/BassView.tsx',
  'lib/music/instruments/push/PushView.tsx',
  // The notation strips.
  'lib/music/instruments/notation/SheetMusicView.tsx',
  'lib/music/instruments/notation/TabView.tsx',
  // Chord diagrams: the progression sheet and per-chord card, plus everything
  // they nest.
  'components/ProgressionSheet.tsx',
  'components/ChordCard.tsx',
  'components/ChordMini.tsx',
  'components/ChordDiagram.tsx',
  'components/lesson/MiniPush.tsx',
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

  it('covers the game-mode colours, which is the gap this guard found', () => {
    // A board exported while a drill is running paints its correct / wrong /
    // pending markers with these. They were absent from the list, so those
    // markers would have rasterized black.
    for (const v of ['--game-correct', '--game-wrong', '--game-pending']) {
      expect(VAR_NAMES).toContain(v);
    }
  });
});
