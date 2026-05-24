// /builder — standalone Chord/Scale fretboard page.
//
// Lets the user pick a root + quality (chord mode) or root + scale-type +
// position (scale mode) and exports the resulting fretboard as a PNG suitable
// for dropping into a YouTube thumbnail or talking-head clip. Re-uses the
// instrument-visualizer's SelectionBar + GuitarView + useAppState wholesale —
// no route-specific state. syncUrl=false so the visualizer doesn't try to
// write `?mode=&root=...` into the URL (which TanStack Router's strict zod
// schema would strip anyway, same conflict we solved on /learn/$videoId).

import { useMemo, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useAppState } from '#/lib/music/state/useAppState';
import { resolveSelection } from '#/lib/music/state/resolve';
import { SelectionBar } from '#/lib/music/components/SelectionBar';
import { GuitarView } from '#/lib/music/instruments/guitar/GuitarView';
import { synth } from '#/lib/music/audio/synth';
import { Button } from '#/components/ui/button';
import { exportFretboardPng } from '#/lib/music/png-export';
import '#/lib/music/theory-companion.css';

export const Route = createFileRoute('/builder')({
  component: BuilderPage,
  head: () => ({ meta: [{ title: 'Chord & scale builder · Music KB' }] }),
});

function BuilderPage() {
  const appState = useAppState({ syncUrl: false });
  const resolved = useMemo(
    () => resolveSelection(appState.state, appState.previewedChordDegree),
    [appState.state, appState.previewedChordDegree],
  );

  const pcLabels =
    appState.labelMode === 'degree' ? resolved.pcDegrees : resolved.pcDisplay;

  // Ref on the wrapping panel so the export logic can find the .theory-
  // companion ancestor (for CSS-var resolution) and the SVG it contains.
  const fretboardRef = useRef<HTMLDivElement | null>(null);

  const handleExport = () => {
    const root = fretboardRef.current;
    if (!root) return;
    const svg = root.querySelector('svg.instrument-svg') as SVGSVGElement | null;
    if (!svg) return;
    exportFretboardPng({
      svg,
      themeRoot: root,
      filename: buildFilename(appState.state),
    });
  };

  return (
    <main className="theory-companion page-wrap mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-6">
        <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
          Chord &amp; scale builder
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Pick a chord or scale, then export the fretboard as a PNG you can drop
          into a video or share. In scale mode, the Guitar shape picker filters
          to a single CAGED-style position.
        </p>
      </header>

      <div className="panel">
        <SelectionBar {...appState} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="font-mono text-sm text-[var(--ink-soft)]">{resolved.label}</span>
        <Button type="button" onClick={handleExport} size="pill">
          ⬇ Export PNG
        </Button>
      </div>

      <div ref={fretboardRef} className="panel mt-4">
        <h2 className="panel-title">Guitar (standard tuning)</h2>
        <GuitarView
          highlighted={resolved.guitar}
          rootPitchClass={resolved.rootPitchClass}
          matchByPitchClass={resolved.guitarMatchByPitchClass}
          focusedPitchClass={appState.focusedPitchClass}
          onPickPitchClass={appState.toggleFocusedPitchClass}
          onPlayNote={(midi) => synth.playNote(midi)}
          pcLabels={pcLabels}
          shapePositions={resolved.guitarShapePositions}
          showNaturals={appState.showNaturals}
          emphasizedPitchClasses={resolved.previewedChordPCs}
          gameMode={appState.gameMode.guitar}
          onGameGuess={(pos) => appState.submitGuess('guitar', pos)}
        />
      </div>
    </main>
  );
}

// Builds the suggested download filename from current state. Examples:
//   chord mode:        F-min7.png
//   scale mode 'all':  A-minor.png
//   scale mode shape:  A-minor-shape3.png  /  A-minor-2oct.png
function buildFilename(state: ReturnType<typeof useAppState>['state']): string {
  const slug = (s: string) =>
    s.replace(/[^A-Za-z0-9#+°-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (state.mode === 'chord') {
    return `${slug(state.chord.root)}-${slug(state.chord.quality)}.png`;
  }
  if (state.mode === 'scale') {
    const base = `${slug(state.scale.root)}-${slug(state.scale.type)}`;
    if (state.scalePosition === 'all') return `${base}.png`;
    if (state.scalePosition === '2oct') return `${base}-2oct.png`;
    return `${base}-shape${state.scalePosition}.png`;
  }
  if (state.mode === 'note') {
    return `note-${slug(state.singleNote)}.png`;
  }
  return 'fretboard.png';
}
