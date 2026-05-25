// /builder — standalone Chord/Scale fretboard page.
//
// Lets the user pick a root + quality (chord mode) or root + scale-type +
// position (scale mode) and exports the resulting fretboard as a PNG suitable
// for dropping into a YouTube thumbnail or talking-head clip. Re-uses the
// instrument-visualizer's SelectionBar + GuitarView + useAppState wholesale —
// no route-specific state. syncUrl=false so the visualizer doesn't try to
// write `?mode=&root=...` into the URL (which TanStack Router's strict zod
// schema would strip anyway, same conflict we solved on /learn/$videoId).

import { useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useAppState } from '#/lib/music/state/useAppState';
import { resolveSelection } from '#/lib/music/state/resolve';
import { SelectionBar } from '#/lib/music/components/SelectionBar';
import { GuitarView } from '#/lib/music/instruments/guitar/GuitarView';
import { synth } from '#/lib/music/audio/synth';
import { Button } from '#/components/ui/button';
import { exportFretboardPng } from '#/lib/music/png-export';
import { availablePositions, realizeCagedShape } from '#/lib/music/theory/positions';
import { getScalePitchClasses } from '#/lib/music/theory/scales';
import { guitarVoicing, guitarVoicingCount } from '#/lib/music/theory/voicings/guitar';
import type { ScalePosition } from '#/lib/music/types';
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
      cropToShape,
    });
  };

  // Voicing nav (chord mode only). The total count comes from
  // guitarVoicingCount; the active shape name is what guitarVoicing actually
  // selected — same code path the GuitarView uses, so the label always
  // matches the displayed shape (no off-by-one when an open shape is missing
  // for a particular root and the picker silently skips it).
  const voicingTotal =
    appState.state.mode === 'chord' ? guitarVoicingCount(appState.state.chord) : 0;
  const currentShapeName =
    appState.state.mode === 'chord' ? guitarVoicing(appState.state.chord).shapeName : null;
  const stepVoicing = (delta: 1 | -1) => {
    if (appState.state.mode !== 'chord' || voicingTotal === 0) return;
    appState.setChord((c) => ({
      ...c,
      voicingIndex: ((c.voicingIndex + delta) % voicingTotal + voicingTotal) % voicingTotal,
    }));
  };
  const activeVoicingIndex =
    voicingTotal === 0
      ? 0
      : ((appState.state.chord.voicingIndex % voicingTotal) + voicingTotal) % voicingTotal;

  // Crop-to-shape toggle. When on, the exported SVG's viewBox tightens to the
  // chord/scale-shape bbox + a fret of padding instead of dumping the full
  // 15-fret neck. Default on — chord diagrams and CAGED boxes both look
  // better tight for video graphics; uncheck for a full-neck reference.
  const [cropToShape, setCropToShape] = useState(true);
  // Multi-shape outlines: in scale mode with Guitar shape = "All", overlay
  // a tight polygon outline around each available CAGED shape so the
  // viewer can see how the boxes tile across the full neck. Single-shape
  // views don't need this — the filtered notes ARE the shape. Chord mode
  // doesn't either — chord diagrams traditionally show just the dots.
  const [showShapeOutline, setShowShapeOutline] = useState(true);
  const outlineApplies =
    appState.state.mode === 'scale' && appState.state.scalePosition === 'all';
  const shapeOutlines = useMemo(() => {
    if (!showShapeOutline || !outlineApplies) return [];
    const sel = appState.state.scale;
    const scalePcs = getScalePitchClasses(sel);
    return availablePositions(sel.type)
      .map((pos) => realizeCagedShape(pos, sel.root, scalePcs, sel.type))
      .filter((cells) => cells.length > 0)
      .map((cells) => new Set(cells.map((p) => `${p.string}-${p.fret}`)));
  }, [showShapeOutline, outlineApplies, appState.state.scale]);

  // Bulk export: iterate every available CAGED-style position for the current
  // scale and export each one as its own PNG. Only meaningful in scale mode
  // for scales that ship boxes (major + the modes WINDOW_BOXES covers).
  const [bulkExporting, setBulkExporting] = useState(false);
  const positions: ScalePosition[] =
    appState.state.mode === 'scale'
      ? availablePositions(appState.state.scale.type)
      : [];

  const handleBulkExport = async () => {
    if (appState.state.mode !== 'scale' || positions.length === 0) return;
    setBulkExporting(true);
    const originalPosition = appState.state.scalePosition;
    try {
      for (const pos of positions) {
        appState.setScalePosition(pos);
        // Wait two animation frames so React commits the state change and
        // GuitarView re-renders with the new shapePositions before we
        // serialize the SVG.
        await new Promise<void>((r) => {
          requestAnimationFrame(() => requestAnimationFrame(() => r()));
        });
        const root = fretboardRef.current;
        if (!root) continue;
        const svg = root.querySelector('svg.instrument-svg') as SVGSVGElement | null;
        if (!svg) continue;
        await exportFretboardPng({
          svg,
          themeRoot: root,
          filename: `${slug(appState.state.scale.root)}-${slug(
            appState.state.scale.type,
          )}-shape${pos}.png`,
          cropToShape,
        });
      }
    } finally {
      appState.setScalePosition(originalPosition);
      setBulkExporting(false);
    }
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

      {appState.state.mode === 'chord' && voicingTotal > 1 && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3">
          <button
            type="button"
            onClick={() => stepVoicing(-1)}
            className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)]"
            aria-label="Previous voicing"
          >
            ‹ Prev
          </button>
          <div className="flex-1 text-center">
            <div className="text-sm font-semibold text-[var(--ink)]">
              {currentShapeName ?? 'No named shape'}
            </div>
            <div className="text-xs text-[var(--ink-muted)]">
              Voicing {activeVoicingIndex + 1} of {voicingTotal}
            </div>
          </div>
          <button
            type="button"
            onClick={() => stepVoicing(1)}
            className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)]"
            aria-label="Next voicing"
          >
            Next ›
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm text-[var(--ink-soft)]">{resolved.label}</span>
        <div className="flex flex-wrap items-center gap-3">
          {outlineApplies && (
            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
              <input
                type="checkbox"
                checked={showShapeOutline}
                onChange={(e) => setShowShapeOutline(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
              />
              Outline shape
            </label>
          )}
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
            <input
              type="checkbox"
              checked={cropToShape}
              onChange={(e) => setCropToShape(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
            />
            Crop to shape
          </label>
          {positions.length > 0 && (
            <Button
              type="button"
              onClick={() => void handleBulkExport()}
              size="pill"
              variant="outline"
              disabled={bulkExporting}
              title={`Download a PNG for each of the ${positions.length} CAGED-style positions`}
            >
              {bulkExporting
                ? 'Exporting all…'
                : `⬇ Export all ${positions.length} shapes`}
            </Button>
          )}
          <Button type="button" onClick={handleExport} size="pill" disabled={bulkExporting}>
            ⬇ Export PNG
          </Button>
        </div>
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
          shapeOutlines={shapeOutlines}
          showNaturals={appState.showNaturals}
          emphasizedPitchClasses={resolved.previewedChordPCs}
          gameMode={appState.gameMode.guitar}
          onGameGuess={(pos) => appState.submitGuess('guitar', pos)}
        />
      </div>
    </main>
  );
}

// Filename-safe slug — strips characters that confuse most file systems and
// browser-download flows, keeps the musical-notation marks (#, +, °).
function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9#+°-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Builds the suggested download filename from current state. Examples:
//   chord mode:        F-min7.png
//   scale mode 'all':  A-minor.png
//   scale mode shape:  A-minor-shape3.png  /  A-minor-2oct.png
function buildFilename(state: ReturnType<typeof useAppState>['state']): string {
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
