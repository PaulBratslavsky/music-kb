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
import { z } from 'zod';
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
import { parseTheoryParam } from '#/lib/music/deep-link';
import type { ScalePosition } from '#/lib/music/types';
import '#/lib/music/theory-companion.css';

// `?theory=` deep-link param so /theory and other surfaces can jump
// here with a specific chord or scale pre-selected. Uses the same
// shorthand parser as /learn/$videoId's Theory tab — chord:C:maj,
// scale:C:major, note:C. Length-capped + max 64 chars matches the
// /learn schema for consistency.
const BuilderSearchSchema = z.object({
  theory: z.string().max(64).optional(),
});

export const Route = createFileRoute('/builder')({
  validateSearch: BuilderSearchSchema,
  component: BuilderPage,
  head: () => ({ meta: [{ title: 'Chord & scale builder · Music KB' }] }),
});

function BuilderPage() {
  const search = Route.useSearch();
  // Seed visualizer from ?theory= when present (deep-link from /theory's
  // Circle of Fifths or Substitutions table). Parsed once on mount;
  // subsequent picker clicks update state from there.
  const initialState = parseTheoryParam(search.theory) ?? undefined;
  const appState = useAppState({ syncUrl: false, initialState });
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
  // Shape-coloring on the All-positions view: in scale mode with Guitar
  // shape = "All", color each note by which CAGED shape it belongs to
  // (Shape 1 = blue, Shape 2 = green, etc.). Notes shared between
  // overlapping shapes take the color of the LOWEST-numbered shape — a
  // deterministic tie-break that keeps adjacent shapes visually distinct
  // along the neck. The orange root color always wins regardless of
  // shape; the user's mental model of "the root pattern across the neck"
  // is more important than which shape claims a particular root note.
  //
  // This replaces the earlier outline approach. Outlines (polygon or
  // bbox) either disconnect at gaps in 3NPS shapes or pile into visual
  // noise when 5 of them overlap on one neck; coloring sidesteps both.
  const highlightApplies =
    appState.state.mode === 'scale' && appState.state.scalePosition === 'all';
  const availableShapePositions = highlightApplies
    ? availablePositions(appState.state.scale.type)
    : [];
  // Index into availableShapePositions of the currently highlighted shape.
  // null = no shape highlighted; show plain scale view. Default to 0 so
  // the user lands on Shape 1 highlighted by default.
  const [highlightedShapeIdx, setHighlightedShapeIdx] = useState<number | null>(0);
  const safeHighlightIdx =
    highlightedShapeIdx == null
      ? null
      : Math.min(highlightedShapeIdx, availableShapePositions.length - 1);
  const highlightedShape =
    safeHighlightIdx != null && safeHighlightIdx >= 0
      ? availableShapePositions[safeHighlightIdx]
      : null;
  // Single distinct color for the highlighted shape — bright accent that
  // contrasts with the default green and orange root.
  const HIGHLIGHT_COLOR = '#4f8cff';
  const cellColors = useMemo(() => {
    if (!highlightApplies || highlightedShape == null) return null;
    const sel = appState.state.scale;
    const scalePcs = getScalePitchClasses(sel);
    const cells = realizeCagedShape(highlightedShape, sel.root, scalePcs, sel.type);
    if (cells.length === 0) return null;
    const map = new Map<string, string>();
    for (const c of cells) {
      map.set(`${c.string}-${c.fret}`, HIGHLIGHT_COLOR);
    }
    return map;
  }, [highlightApplies, highlightedShape, appState.state.scale]);
  const stepHighlight = (delta: 1 | -1) => {
    if (availableShapePositions.length === 0) return;
    const cur = safeHighlightIdx ?? 0;
    const next =
      ((cur + delta) % availableShapePositions.length +
        availableShapePositions.length) %
      availableShapePositions.length;
    setHighlightedShapeIdx(next);
  };

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
          {highlightApplies && availableShapePositions.length > 0 && (
            <div className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-xs">
              <button
                type="button"
                onClick={() => stepHighlight(-1)}
                className="rounded px-1.5 text-[var(--ink)] hover:bg-[var(--bg-subtle)]"
                aria-label="Previous shape highlight"
                title="Highlight the previous CAGED shape"
              >
                ‹
              </button>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: HIGHLIGHT_COLOR }}
                aria-hidden="true"
              />
              <span className="font-medium text-[var(--ink)]">
                {highlightedShape == null
                  ? 'Highlight: none'
                  : `Highlight: Shape ${highlightedShape}`}
              </span>
              <button
                type="button"
                onClick={() => stepHighlight(1)}
                className="rounded px-1.5 text-[var(--ink)] hover:bg-[var(--bg-subtle)]"
                aria-label="Next shape highlight"
                title="Highlight the next CAGED shape"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() =>
                  setHighlightedShapeIdx(safeHighlightIdx == null ? 0 : null)
                }
                className="ml-1 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                title={safeHighlightIdx == null ? 'Show highlight' : 'Hide highlight'}
              >
                {safeHighlightIdx == null ? '◯' : '×'}
              </button>
            </div>
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
          cellColors={cellColors}
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
