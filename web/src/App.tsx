import { useState, useMemo } from 'react';
import { PianoView } from './instruments/piano/PianoView';
import { GuitarView } from './instruments/guitar/GuitarView';
import { BassView } from './instruments/bass/BassView';
import { PushView } from './instruments/push/PushView';
import { SelectionBar } from './components/SelectionBar';
import { GameModePanel } from './components/GameModePanel';
import { ThemeToggle } from './components/ThemeToggle';
import { useAppState } from './state/useAppState';
import {
  availablePositions,
  realizeCagedShape,
  shapeName,
  supportsCaged,
} from '@music-kb/music/theory/positions';
import { getScalePitchClasses } from '@music-kb/music/theory/scales';
import { resolveSelection } from './state/resolve';
import { getDiatonicChords } from '@music-kb/music/theory/diatonic';
import { guitarScaleOrgUrl } from '@music-kb/music/theory/scales';
import { findScalesContaining } from '@music-kb/music/theory/chord-scales';
import { synth } from './audio/synth';
import { midiFromNote, notesAscending } from '@music-kb/music/theory/notes';
import type { DiatonicChord } from '@music-kb/music/theory/diatonic';
import { SheetMusicView } from './instruments/notation/SheetMusicView';
import { TabView } from './instruments/notation/TabView';
import { useRoute, navigate } from './music/useHashRoute';
import { LibraryPage } from './music/LibraryPage';
import { PlayerPage } from './music/PlayerPage';
import LessonsIndexPage from './lessons';
import { LessonPage } from './lessons/LessonPage';
import { TheoryPage } from './theory-page/TheoryPage';

export default function App() {
  const route = useRoute();
  if (route.kind === 'lessons') {
    return (
      <div className="app-wide">
        <Header active="lessons" />
        <LessonsIndexPage />
      </div>
    );
  }
  if (route.kind === 'lesson') {
    return (
      <div className="app-wide">
        <Header active="lessons" />
        <LessonPage slug={route.slug} />
      </div>
    );
  }
  if (route.kind === 'theory') {
    return (
      <div className="app-wide">
        <Header active="theory" />
        <TheoryPage />
      </div>
    );
  }
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

// Mirrors music-kb's music-side navigation: Builder · Theory · Lessons ·
// Music. ("Builder" is music-kb's name for what this app called the
// Visualizer.)
const NAV = [
  { key: 'visualizer' as const, label: 'Builder', route: { kind: 'home' } as const },
  { key: 'theory' as const, label: 'Theory', route: { kind: 'theory' } as const },
  { key: 'lessons' as const, label: 'Lessons', route: { kind: 'lessons' } as const },
  { key: 'music' as const, label: 'Music', route: { kind: 'library' } as const },
];

function Header({
  active,
}: {
  active: 'visualizer' | 'music' | 'theory' | 'lessons';
}) {
  return (
    <header className="app-header">
      <h1>Paul's Music Helper</h1>
      <span className="tagline" style={{ flex: 1, minWidth: 0 }} />
      <nav style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`chip${active === item.key ? ' active' : ''}`}
            onClick={() => navigate(item.route)}
          >
            {item.label}
          </button>
        ))}
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

  // Box highlight. Pick a CAGED box and its notes tint on the board.
  //
  // This used to carry a chord lookup too — triads and power chords inside
  // the box, picked by degree. It came out: cramming string sets,
  // inversions and grips into one strip of chips was confusing, and the
  // same material now has room to breathe in /lessons/triads and
  // /lessons/power-chords, with the drill version in Theory > Practice.
  const BOX_COLOR = '#4f8cff';
  const [boxIdx, setBoxIdx] = useState<number | null>(null);

  const boxOptions = useMemo(
    () =>
      appState.state.mode === 'scale' && supportsCaged(appState.state.scale.type)
        ? availablePositions(appState.state.scale.type)
        : [],
    [appState.state.mode, appState.state.scale.type],
  );

  // Two controls can pick a box: the app's scalePosition (which crops the
  // board) and the BOX chips below it. Whichever is active wins,
  // scalePosition first since it's the more prominent control.
  const effectiveBox =
    appState.state.mode !== 'scale'
      ? null
      : typeof appState.state.scalePosition === 'number'
        ? appState.state.scalePosition
        : boxIdx != null
          ? (boxOptions[boxIdx] ?? null)
          : null;

  const boxCells = useMemo(() => {
    if (effectiveBox == null) return null;
    const sel = appState.state.scale;
    const cells = realizeCagedShape(
      effectiveBox,
      sel.root,
      getScalePitchClasses(sel),
      sel.type,
    );
    return cells.length > 0 ? cells : null;
  }, [effectiveBox, appState.state.scale]);

  const cellColors = useMemo(() => {
    if (!boxCells) return null;
    const map = new Map<string, string>();
    for (const c of boxCells) map.set(`${c.string}-${c.fret}`, BOX_COLOR);
    return map;
  }, [boxCells]);

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
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`chip${item.key === 'visualizer' ? ' active' : ''}`}
              onClick={() => navigate(item.route)}
            >
              {item.label}
            </button>
          ))}
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
            cellColors={cellColors}
          />
          {boxOptions.length > 0 && (
            <div className="box-chords">
              <span className="box-chords-label">BOX</span>
              {boxOptions.map((b, i) => (
                <button
                  key={b}
                  type="button"
                  className={`chip${boxIdx === i ? ' active' : ''}`}
                  onClick={() => setBoxIdx((cur) => (cur === i ? null : i))}
                >
                  {shapeName(b, appState.state.scale.type)}
                </button>
              ))}
            </div>
          )}
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
