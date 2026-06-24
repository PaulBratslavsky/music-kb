// Chord/scale builder — the visualizer + progression tool. Extracted from
// the /builder route so it can also be embedded in the music-video page's
// "Chords" tab (scoped to that video via `videoDocumentId`).
//
// Pick a root + quality (chord mode) or root + scale-type + position (scale
// mode), view it on guitar/piano, export the diagram as a PNG, and build a
// chord progression. Re-uses the instrument-visualizer's SelectionBar +
// GuitarView/PianoView + useAppState. syncUrl=false so it never writes
// `?mode=&root=...` into the URL.
import { useMemo, useRef, useState } from 'react';
import { useAppState } from '#/lib/music/state/useAppState';
import { resolveSelection } from '#/lib/music/state/resolve';
import { SelectionBar } from '#/lib/music/components/SelectionBar';
import { CircleOfFifths } from '#/components/CircleOfFifths';
import type { KeyMode } from '#/lib/music/circle-of-fifths';
import { GuitarView } from '#/lib/music/instruments/guitar/GuitarView';
import { PianoView } from '#/lib/music/instruments/piano/PianoView';
import { ProgressionPanel } from '#/components/ProgressionPanel';
import { synth } from '#/lib/music/audio/synth';
import { Button } from '#/components/ui/button';
import { exportFretboardPng } from '#/lib/music/png-export';
import { availablePositions, realizeCagedShape } from '#/lib/music/theory/positions';
import { getScalePitchClasses } from '#/lib/music/theory/scales';
import { guitarVoicing, guitarVoicingCount } from '#/lib/music/theory/voicings/guitar';
import { parseTheoryParam } from '#/lib/music/deep-link';
import type { PitchClass, ChordQuality, ScalePosition } from '#/lib/music/types';
import '#/lib/music/theory-companion.css';

type ChordBuilderProps = {
  /** `chord:C:maj` / `scale:C:major` / `note:C` shorthand to seed the view. */
  initialTheory?: string;
  /** When set, saved progressions are tied to this music video. */
  videoDocumentId?: string;
  /** Show the "Chord & scale builder" page header (the /builder route). */
  showHeader?: boolean;
};

export function ChordBuilder({
  initialTheory,
  videoDocumentId,
  showHeader = false,
}: ChordBuilderProps) {
  const initialState = parseTheoryParam(initialTheory) ?? undefined;
  const appState = useAppState({ syncUrl: false, initialState });
  const resolved = useMemo(
    () => resolveSelection(appState.state, appState.previewedChordDegree),
    [appState.state, appState.previewedChordDegree],
  );

  const pcLabels =
    appState.labelMode === 'degree' ? resolved.pcDegrees : resolved.pcDisplay;

  // Load a chord (root + quality) into the builder as a fresh root-position
  // triad, switching to chord mode so the instrument shows it even if the
  // user was in scale/note mode. Shared by the circle-of-fifths picker and
  // the progression panel's chip-reselect.
  const loadChord = (root: PitchClass, quality: ChordQuality) => {
    appState.setMode('chord');
    appState.setChord((c) => ({
      ...c,
      root,
      quality,
      inversion: 0,
      voicingIndex: 0,
    }));
  };

  // Circle-of-fifths picker → set the base chord. Outer wedge = (root,
  // major); inner wedge = (relativeMinorRoot, minor).
  const pickChordFromWheel = (root: PitchClass, keyMode: KeyMode) =>
    loadChord(root, keyMode === 'minor' ? 'min' : 'maj');

  // The current chord (full selection incl. voicing), for the progression
  // panel. Null unless in chord mode.
  const currentChord =
    appState.state.mode === 'chord' ? appState.state.chord : null;

  // Reselect a saved progression chord, restoring its exact voicing.
  const loadFullChord = (chord: typeof appState.state.chord) => {
    appState.setMode('chord');
    appState.setChord(() => ({ ...chord }));
  };

  // Which instrument the panel renders + exports. Both PianoView and
  // GuitarView emit `svg.instrument-svg`, so the PNG exporter is
  // instrument-agnostic — only the guitar-specific controls (voicing nav,
  // CAGED shape highlight, crop-to-shape, bulk-shape export) are gated off
  // in piano mode below.
  const [instrument, setInstrument] = useState<'guitar' | 'piano'>('guitar');

  const fretboardRef = useRef<HTMLDivElement | null>(null);

  const handleExport = () => {
    const root = fretboardRef.current;
    if (!root) return;
    const svg = root.querySelector('svg.instrument-svg') as SVGSVGElement | null;
    if (!svg) return;
    exportFretboardPng({
      svg,
      themeRoot: root,
      filename: buildFilename(appState.state, instrument),
      cropToShape: cropToShape && instrument === 'guitar',
    });
  };

  // Voicing nav (chord mode only).
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

  const [cropToShape, setCropToShape] = useState(true);
  const highlightApplies =
    appState.state.mode === 'scale' && appState.state.scalePosition === 'all';
  const availableShapePositions = highlightApplies
    ? availablePositions(appState.state.scale.type)
    : [];
  const [highlightedShapeIdx, setHighlightedShapeIdx] = useState<number | null>(0);
  const safeHighlightIdx =
    highlightedShapeIdx == null
      ? null
      : Math.min(highlightedShapeIdx, availableShapePositions.length - 1);
  const highlightedShape =
    safeHighlightIdx != null && safeHighlightIdx >= 0
      ? availableShapePositions[safeHighlightIdx]
      : null;
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
    <div className="theory-companion">
      {showHeader && (
        <header className="mb-6">
          <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
            Chord &amp; scale builder
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Pick a chord or scale, then export the fretboard as a PNG you can
            drop into a video or share. In scale mode, the Guitar shape picker
            filters to a single CAGED-style position.
          </p>
        </header>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,340px)] lg:items-stretch">
        <div className="panel">
          <SelectionBar {...appState} />
        </div>
        {/* Circle of fifths as an alternate base-chord picker. */}
        <div className="panel flex items-center justify-center">
          <CircleOfFifths
            compact
            hideControls
            enharmonic="sharps"
            onChordSelect={pickChordFromWheel}
          />
        </div>
      </div>

      {instrument === 'guitar' && appState.state.mode === 'chord' && voicingTotal > 1 && (
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
          {instrument === 'guitar' && highlightApplies && availableShapePositions.length > 0 && (
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
          {instrument === 'guitar' && (
            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
              <input
                type="checkbox"
                checked={cropToShape}
                onChange={(e) => setCropToShape(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
              />
              Crop to shape
            </label>
          )}
          {instrument === 'guitar' && positions.length > 0 && (
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
        {/* Instrument tab — pick the view to render + export. */}
        <div
          className="mb-4 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-sm"
          role="radiogroup"
          aria-label="Instrument"
        >
          {(
            [
              { id: 'guitar' as const, label: 'Guitar' },
              { id: 'piano' as const, label: 'Piano' },
            ]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={instrument === opt.id}
              onClick={() => setInstrument(opt.id)}
              className={`rounded-full px-4 py-1 font-medium transition ${
                instrument === opt.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {instrument === 'guitar' ? (
          <>
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
              barre={resolved.guitarBarre}
              cellColors={cellColors}
              showNaturals={appState.showNaturals}
              emphasizedPitchClasses={resolved.previewedChordPCs}
              gameMode={appState.gameMode.guitar}
              onGameGuess={(pos) => appState.submitGuess('guitar', pos)}
            />
          </>
        ) : (
          <>
            <h2 className="panel-title">Piano</h2>
            <PianoView
              highlighted={resolved.piano}
              rootPitchClass={resolved.rootPitchClass}
              matchByPitchClass={resolved.pianoMatchByPitchClass}
              focusedPitchClass={appState.focusedPitchClass}
              onPickPitchClass={appState.toggleFocusedPitchClass}
              onPlayNote={(midi) => synth.playNote(midi)}
              pcLabels={pcLabels}
              emphasizedPitchClasses={resolved.previewedChordPCs}
              gameMode={appState.gameMode.piano}
              onGameGuess={(pos) => appState.submitGuess('piano', pos)}
            />
          </>
        )}
      </div>

      <ProgressionPanel
        currentChord={currentChord}
        onLoadChord={loadFullChord}
        instrument={instrument}
        videoDocumentId={videoDocumentId}
      />
    </div>
  );
}

// Filename-safe slug — keeps musical-notation marks (#, +, °).
function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9#+°-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Suggested download filename from current state + instrument.
function buildFilename(
  state: ReturnType<typeof useAppState>['state'],
  instrument: 'guitar' | 'piano',
): string {
  const suffix = instrument === 'piano' ? '-piano' : '';
  if (state.mode === 'chord') {
    return `${slug(state.chord.root)}-${slug(state.chord.quality)}${suffix}.png`;
  }
  if (state.mode === 'scale') {
    const base = `${slug(state.scale.root)}-${slug(state.scale.type)}`;
    if (instrument === 'piano') return `${base}${suffix}.png`;
    if (state.scalePosition === 'all') return `${base}.png`;
    if (state.scalePosition === '2oct') return `${base}-2oct.png`;
    return `${base}-shape${state.scalePosition}.png`;
  }
  if (state.mode === 'note') {
    return `note-${slug(state.singleNote)}${suffix}.png`;
  }
  return `${instrument}.png`;
}
