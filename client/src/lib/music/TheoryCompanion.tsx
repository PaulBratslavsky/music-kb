// Theory companion — ported from the standalone instrument-visualizer app.
// Renders as a tab content area inside `/learn/$videoId`'s ViewTabs (not as
// a full page), so the standalone App.tsx's <header>/<footer> chrome is
// stripped. Everything else (selection bar, play row, diatonic chips,
// three-instrument grid, sheet music + tab strips) is preserved.

import { useEffect, useMemo } from 'react';
import { PianoView } from './instruments/piano/PianoView';
import { GuitarView } from './instruments/guitar/GuitarView';
import { PushView } from './instruments/push/PushView';
import { SelectionBar } from './components/SelectionBar';
import { GameModePanel } from './components/GameModePanel';
import { QuickStartRow } from './components/QuickStartRow';
import { useAppState } from './state/useAppState';
import type { AppState, PitchClass, ScaleSelection } from './types';
import { resolveSelection } from './state/resolve';
import { getDiatonicChords } from './theory/diatonic';
import { guitarScaleOrgUrl } from './theory/scales';
import { findScalesContaining } from './theory/chord-scales';
import { synth } from './audio/synth';
import { midiFromNote, notesAscending } from './theory/notes';
import type { DiatonicChord } from './theory/diatonic';
import { SheetMusicView } from './instruments/notation/SheetMusicView';
import { TabView } from './instruments/notation/TabView';
import './theory-companion.css';

// Display a diatonic chord chip as either a triad ("C", "Dm", "B°") or its
// full seventh form ("Cmaj7", "Dm7", "Bm7b5") based on user preference.
// The chord's `quality` field (root + simple quality) is always saved to the
// LoopBuilder progression on click — only the chip rendering changes.
function chipDisplay(
  c: DiatonicChord,
  depth: 'triad' | 'seventh',
): { name: string; roman: string } {
  if (depth === 'seventh') {
    return { name: c.chordName, roman: c.roman };
  }
  // Map the visualizer's 7th-chord suffix to a triad-quality suffix.
  const suffixMap: Record<string, string> = {
    maj7: '',
    m7: 'm',
    '7': '',
    m7b5: '°',
    mMaj7: 'm',
    dim7: '°',
    maj: '',
    m: 'm',
    dim: '°',
    aug: '+',
  };
  const triadSuffix = suffixMap[c.qualitySuffix] ?? c.qualitySuffix;
  const romanPrefix = c.roman.replace(/(?:maj7|m7b5|m7|dim7|7|ø)$/i, '');
  return {
    name: c.rootDisplay + triadSuffix,
    roman: romanPrefix + (triadSuffix === '°' || triadSuffix === '+' ? triadSuffix : ''),
  };
}

export interface TheoryCompanionProps {
  /** Initial visualizer state, typically parsed from the host route's deep-link
   *  param. When omitted, the visualizer starts at its default (C major chord).
   *  When the host re-renders with a different value, the visualizer keeps its
   *  current state — initialState is only read once on mount. */
  initialState?: AppState;
  /** Fires whenever the user clicks a piano key (toggles focusedPitchClass).
   *  The host uses this to drive the LoopBuilder's "Use as <PC> major / minor"
   *  affordance — when null, no piano focus; when set, a key has been picked
   *  by ear and is awaiting a major/minor choice. */
  onFocusedPitchClassChange?: (pc: PitchClass | null) => void;
  /** Fires when a diatonic chord chip is clicked. The host wires this into
   *  LoopBuilder.appendChord when recordMode is on. The visualizer's own
   *  behavior (preview + play the chord) is unchanged — this is sidecar. */
  onDiatonicChordClick?: (chord: { root: PitchClass; quality: string }) => void;
  /** Fires when the visualizer is in scale mode and the scale changes
   *  (root or type). Lets the host treat any SelectionBar scale change
   *  as picking a key — equivalent to clicking "Use as X major" but
   *  without the explicit two-button step. Null when mode is not scale. */
  onScaleChange?: (scale: ScaleSelection | null) => void;
}

export default function TheoryCompanion({
  initialState,
  onFocusedPitchClassChange,
  onDiatonicChordClick,
  onScaleChange,
}: TheoryCompanionProps = {}) {
  // syncUrl=false so the visualizer doesn't fight TanStack Router for the URL.
  // The host route owns the URL via its zod-validated search schema; deep-links
  // arrive through `initialState` (parsed from the `theory=` param).
  const appState = useAppState({ syncUrl: false, initialState });

  // Forward focused-pitch-class changes to the host. Effect (not inline) so
  // we observe the React-managed state transitions rather than racing inside
  // the click handler.
  useEffect(() => {
    onFocusedPitchClassChange?.(appState.focusedPitchClass);
  }, [appState.focusedPitchClass, onFocusedPitchClassChange]);

  // Forward scale-mode changes — root and type tracked as primitives so a
  // re-render with the same scale doesn't refire. Null when mode is not
  // scale (chord/note/all) — host decides whether to clear its candidateKey.
  const scaleRoot = appState.state.mode === 'scale' ? appState.state.scale.root : null;
  const scaleType = appState.state.mode === 'scale' ? appState.state.scale.type : null;
  useEffect(() => {
    if (scaleRoot && scaleType) {
      onScaleChange?.({ root: scaleRoot, type: scaleType });
    } else {
      onScaleChange?.(null);
    }
  }, [scaleRoot, scaleType, onScaleChange]);
  const resolved = useMemo(
    () => resolveSelection(appState.state, appState.previewedChordDegree),
    [appState.state, appState.previewedChordDegree],
  );

  const pcLabels =
    appState.labelMode === 'degree' ? resolved.pcDegrees : resolved.pcDisplay;

  const focusedNoteName = appState.focusedPitchClass
    ? resolved.pcDisplay[appState.focusedPitchClass] ?? appState.focusedPitchClass
    : null;

  const diatonicChords = useMemo(
    () =>
      appState.state.mode === 'scale'
        ? getDiatonicChords(appState.state.scale, appState.state.preferFlats)
        : [],
    [appState.state.mode, appState.state.scale, appState.state.preferFlats],
  );

  const containingScales = useMemo(
    () =>
      appState.state.mode === 'chord'
        ? findScalesContaining(appState.state.chord)
        : [],
    [appState.state.mode, appState.state.chord],
  );

  const playDiatonicChord = (c: DiatonicChord) => {
    const midis = notesAscending(c.pitchClasses, 4).map(midiFromNote);
    if (midis.length > 0) synth.playChord(midis);
  };

  const playCurrent = () => {
    if (resolved.previewedChordPCs && appState.state.mode === 'scale') {
      const midis = resolved.piano
        .filter((n) => resolved.previewedChordPCs!.has(n.pitchClass))
        .map(midiFromNote);
      if (midis.length > 0) synth.playChord(midis);
      return;
    }
    if (appState.state.mode === 'chord') {
      synth.playChord(resolved.piano.map(midiFromNote));
    } else {
      const seen = new Set<string>();
      const midis = resolved.piano
        .filter((n) => {
          if (seen.has(n.pitchClass)) return false;
          seen.add(n.pitchClass);
          return true;
        })
        .map(midiFromNote)
        .sort((a, b) => a - b);
      synth.playSequence(midis);
    }
  };

  return (
    <div className="app theory-companion">
      <QuickStartRow {...appState} />
      <SelectionBar {...appState} />

      <div className="panel label-row">
        <button
          type="button"
          className="chip play-chip"
          onClick={playCurrent}
          title="Play the current chord/scale/note"
        >
          ▶
        </button>
        <span className="label">{resolved.label}</span>
        {focusedNoteName && (
          <span className="label focus-label">
            Focused: {focusedNoteName}
            <button
              className="clear-focus"
              onClick={appState.clearFocusedPitchClass}
              aria-label="Clear focused note"
              title="Clear focused note"
            >
              ×
            </button>
          </span>
        )}
        <button
          type="button"
          className="chip"
          onClick={appState.toggleAudio}
          title={appState.audioMuted ? 'Unmute audio' : 'Mute audio'}
          style={{ marginLeft: 'auto' }}
        >
          {appState.audioMuted ? '🔇 muted' : '🔊 sound'}
        </button>
      </div>
      <div className="panel hint-row">
        <span className="hint">
          tip: click a key, fret, or pad to focus a note across all three views.
        </span>
      </div>

      {diatonicChords.length > 0 && (
        <div className="panel diatonic-panel">
          <h2 className="panel-title">
            Chords in this scale
            {appState.previewedChordDegree != null && (
              <button
                type="button"
                className="clear-focus"
                style={{ marginLeft: 12 }}
                onClick={appState.clearPreviewedChordDegree}
                title="Clear chord preview"
              >
                ×
              </button>
            )}
          </h2>
          <div className="diatonic-row">
            {diatonicChords.map((c) => {
              const active = appState.previewedChordDegree === c.degree;
              const display = chipDisplay(c, appState.state.chordDepth);
              return (
                <button
                  key={c.degree}
                  type="button"
                  className={`diatonic-chip${active ? ' diatonic-chip-active' : ''}`}
                  onClick={() => {
                    appState.togglePreviewedChordDegree(c.degree);
                    playDiatonicChord(c);
                    // Sidecar: notify the host so LoopBuilder can append the
                    // chord to its in-progress progression when recordMode is
                    // on. The visualizer's own behaviour (preview + play) is
                    // unchanged regardless of whether anyone listens.
                    if (c.quality) {
                      onDiatonicChordClick?.({ root: c.root, quality: c.quality });
                    }
                  }}
                  title={`Play ${c.chordName} and highlight it within the scale`}
                >
                  <span className="diatonic-roman">{display.roman}</span>
                  <span className="diatonic-name">{display.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {containingScales.length > 0 && (
        <div className="panel diatonic-panel">
          <h2 className="panel-title">Scales containing this chord</h2>
          <div className="diatonic-row">
            {containingScales.slice(0, 12).map((s) => (
              <button
                key={`${s.selection.root}-${s.selection.type}`}
                type="button"
                className="diatonic-chip"
                onClick={() => appState.selectScale(s.selection.root, s.selection.type)}
                title={`Open ${s.label} in scale view`}
              >
                <span className="diatonic-roman">scale</span>
                <span className="diatonic-name">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="instruments">
        <div className="panel">
          <h2 className="panel-title">Piano</h2>
          <GameModePanel
            instrument="piano"
            game={appState.gameMode.piano}
            onToggle={() => appState.toggleGameMode('piano')}
            onCheck={() => appState.checkGame('piano')}
            onReset={() => appState.resetGameRound('piano')}
          />
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
        </div>
        <div className="panel">
          <h2 className="panel-title">
            Guitar (standard tuning)
            {appState.state.mode === 'scale' && (
              <a
                className="ref-link"
                href={guitarScaleOrgUrl(
                  appState.state.scale.root,
                  appState.state.scale.type,
                  appState.state.preferFlats,
                )}
                target="_blank"
                rel="noopener noreferrer"
                title="Open this scale on guitarscale.org"
              >
                ↗ guitarscale.org
              </a>
            )}
          </h2>
          <GameModePanel
            instrument="guitar"
            game={appState.gameMode.guitar}
            onToggle={() => appState.toggleGameMode('guitar')}
            onCheck={() => appState.checkGame('guitar')}
            onReset={() => appState.resetGameRound('guitar')}
          />
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
            showNaturals={appState.showNaturals}
            emphasizedPitchClasses={resolved.previewedChordPCs}
            gameMode={appState.gameMode.guitar}
            onGameGuess={(pos) => appState.submitGuess('guitar', pos)}
          />
        </div>
        <div className="panel">
          <h2 className="panel-title">Ableton Push (chromatic)</h2>
          <GameModePanel
            instrument="push"
            game={appState.gameMode.push}
            onToggle={() => appState.toggleGameMode('push')}
            onCheck={() => appState.checkGame('push')}
            onReset={() => appState.resetGameRound('push')}
          />
          <PushView
            highlighted={resolved.push}
            rootPitchClass={resolved.rootPitchClass}
            focusedPitchClass={appState.focusedPitchClass}
            onPickPitchClass={appState.toggleFocusedPitchClass}
            onPlayNote={(midi) => synth.playNote(midi)}
            pcLabels={pcLabels}
            emphasizedPitchClasses={resolved.previewedChordPCs}
            gameMode={appState.gameMode.push}
            onGameGuess={(pos) => appState.submitGuess('push', pos)}
          />
        </div>
      </div>

      <div className="notation-row">
        <div className="panel notation-panel">
          <h2 className="panel-title">Sheet music</h2>
          <div className="notation-strip">
            <SheetMusicView
              notes={resolved.piano}
              pcDisplay={resolved.pcDisplay}
              mode={
                appState.state.mode === 'chord'
                  ? 'stack'
                  : appState.state.mode === 'note'
                  ? 'single'
                  : 'sequence'
              }
            />
          </div>
        </div>
        <div className="panel notation-panel">
          <h2 className="panel-title">Guitar tab</h2>
          <div className="notation-strip">
            <TabView
              notes={appState.state.mode === 'chord' ? resolved.guitar : resolved.piano}
              pcDisplay={resolved.pcDisplay}
              mode={
                appState.state.mode === 'chord'
                  ? 'stack'
                  : appState.state.mode === 'note'
                  ? 'single'
                  : 'sequence'
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
