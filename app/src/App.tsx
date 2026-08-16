import { useMemo } from 'react';
import { PianoView } from './instruments/piano/PianoView';
import { GuitarView } from './instruments/guitar/GuitarView';
import { BassView } from './instruments/bass/BassView';
import { PushView } from './instruments/push/PushView';
import { SelectionBar } from './components/SelectionBar';
import { GameModePanel } from './components/GameModePanel';
import { ThemeToggle } from './components/ThemeToggle';
import { useAppState } from './state/useAppState';
import { resolveSelection } from './state/resolve';
import { getDiatonicChords } from './theory/diatonic';
import { guitarScaleOrgUrl } from './theory/scales';
import { findScalesContaining } from './theory/chord-scales';
import { synth } from './audio/synth';
import { midiFromNote, notesAscending } from './theory/notes';
import type { DiatonicChord } from './theory/diatonic';
import { SheetMusicView } from './instruments/notation/SheetMusicView';
import { TabView } from './instruments/notation/TabView';
import { useRoute, navigate } from './music/useHashRoute';
import { LibraryPage } from './music/LibraryPage';
import { PlayerPage } from './music/PlayerPage';

export default function App() {
  const route = useRoute();
  if (route.kind === 'library') {
    return (
      <div className="app-wide">
        <Header active="music" />
        <LibraryPage />
      </div>
    );
  }
  if (route.kind === 'player') {
    return (
      <div className="app-wide">
        <Header active="music" />
        <PlayerPage videoId={route.id} />
      </div>
    );
  }
  return <VisualizerHome />;
}

function Header({ active }: { active: 'visualizer' | 'music' }) {
  return (
    <header className="app-header">
      <h1>Paul's Music Helper</h1>
      <span className="tagline" style={{ flex: 1, minWidth: 0 }} />
      <nav style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
        <button
          type="button"
          className={`chip${active === 'visualizer' ? ' active' : ''}`}
          onClick={() => navigate({ kind: 'home' })}
        >
          Visualizer
        </button>
        <button
          type="button"
          className={`chip${active === 'music' ? ' active' : ''}`}
          onClick={() => navigate({ kind: 'library' })}
        >
          Music
        </button>
      </nav>
      <ThemeToggle />
    </header>
  );
}

function VisualizerHome() {
  const appState = useAppState();
  const resolved = useMemo(
    () => resolveSelection(appState.state, appState.previewedChordDegree),
    [appState.state, appState.previewedChordDegree],
  );

  const pcLabels =
    appState.labelMode === 'degree'
      ? resolved.pcDegrees
      : resolved.pcDisplay;

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

  // Clicking a diatonic-chord chip both previews it in the scale and plays it,
  // so the user hears the chord they're looking at. Plays the full 7th chord
  // (matching the chip's label, e.g. "Cmaj7"), voiced ascending from the root.
  const playDiatonicChord = (c: DiatonicChord) => {
    const midis = notesAscending(c.pitchClasses, 4).map(midiFromNote);
    if (midis.length > 0) synth.playChord(midis);
  };

  const playCurrent = () => {
    if (resolved.previewedChordPCs && appState.state.mode === 'scale') {
      // Play the previewed triad as a chord.
      const midis = resolved.piano
        .filter((n) => resolved.previewedChordPCs!.has(n.pitchClass))
        .map(midiFromNote);
      if (midis.length > 0) synth.playChord(midis);
      return;
    }
    if (appState.state.mode === 'chord') {
      synth.playChord(resolved.piano.map(midiFromNote));
    } else {
      // Scale or note mode → play sequence of unique-PC notes ascending.
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
    <div className="app">
      <header className="app-header">
        <h1>Paul's Music Helper</h1>
        <span className="tagline" style={{ flex: 1, minWidth: 0 }}>
          See any chord on piano, guitar, bass, and Push — loop YouTube
          tracks and find their key with the Circle of Fifths.
        </span>
        <nav style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
          <button type="button" className="chip active">Visualizer</button>
          <button
            type="button"
            className="chip"
            onClick={() => navigate({ kind: 'library' })}
          >
            Music
          </button>
        </nav>
        <ThemeToggle />
        <button
          type="button"
          className="chip"
          onClick={appState.toggleAudio}
          title={appState.audioMuted ? 'Unmute audio' : 'Mute audio'}
        >
          {appState.audioMuted ? '🔇 muted' : '🔊 sound'}
        </button>
      </header>

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
              return (
                <button
                  key={c.degree}
                  type="button"
                  className={`diatonic-chip${active ? ' diatonic-chip-active' : ''}`}
                  onClick={() => {
                    appState.togglePreviewedChordDegree(c.degree);
                    playDiatonicChord(c);
                  }}
                  title={`Play ${c.chordName} and highlight it within the scale`}
                >
                  <span className="diatonic-roman">{c.roman}</span>
                  <span className="diatonic-name">{c.chordName}</span>
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
          <h2 className="panel-title">Bass (4-string, standard tuning)</h2>
          <BassView
            highlighted={resolved.bass}
            rootPitchClass={resolved.rootPitchClass}
            focusedPitchClass={appState.focusedPitchClass}
            onPickPitchClass={appState.toggleFocusedPitchClass}
            onPlayNote={(midi) => synth.playNote(midi)}
            pcLabels={pcLabels}
            showNaturals={appState.showNaturals}
            emphasizedPitchClasses={resolved.previewedChordPCs}
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

      <footer className="app-footer">
        Guitar CAGED scale shapes adapted from{' '}
        <a href="https://www.guitarscale.org/" target="_blank" rel="noopener noreferrer">
          guitarscale.org
        </a>
        .
      </footer>
    </div>
  );
}
