// The play-along scale, sitting directly under the section's chord strip.
//
// The chords tell you WHAT is being played; this tells you what you can
// play OVER it. It opens on the scale the section is already in — inferred
// from the saved progression's own chords, falling back to the video's
// extracted key — so the common case needs no interaction at all.
//
// Whole neck by default (every scale tone, 0–15) with a position picker
// that spotlights one 3-notes-per-string box; out-of-position notes stay
// faintly visible so you can see where the box sits in the larger shape.
//
// Read-only, like SectionChordStrip: the video is the transport, and this
// panel never plays audio of its own.
//
// Ported from music-kb. The one behavioural difference: "Save to section"
// writes the chosen scale to the loop in localStorage rather than to
// Strapi — same field name (`key`), same precedence over inference.

import { useMemo, useState } from 'react';
import { MiniNeck, type NeckDot } from '../lessons/components/MiniNeck';
import { MiniKeyboard, type KeyMark } from '../lessons/components/MiniKeyboard';
import type { PlayAlongInstrument } from './usePlayAlongInstrument';
import { usePlayerControl } from './Player';
import { activeIndex } from './SectionChordStrip';
import { chordToneMap, outsideScaleTones } from '../theory/chord-overlay';
import { pianoVoicing } from '../theory/voicings/piano';
import { midiFromPitchOctave } from '../theory/notes';
import { voicingPositionKeys } from '../theory/voicing-positions';
import { QUALITY_LABELS } from '../theory/quality-labels';
import { inferKeyFromChords, parseExtractedKey } from '../theory/key-inference';
import {
  availablePositions,
  realizeCagedShape,
  shapeName,
  supportsCaged,
} from '../theory/positions';
import { getScalePitchClasses, SCALE_TYPE_LABELS } from '../theory/scales';
import {
  PITCH_CLASSES,
  type PitchClass,
  type ScalePosition,
  type ScaleType,
} from '../types';

type PositionId = ScalePosition;
import type { ProgressionChord } from './types';

import { updateLoop } from './storage';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { STANDARD_BASS_TUNING_MIDI } from '../instruments/bass/layout';

// Modes are offered but never inferred — picking dorian over minor is an
// interpretive choice, not something 4 chords can settle.
const OFFERED_TYPES: ScaleType[] = [
  'major', 'minor', 'majorPentatonic', 'minorPentatonic', 'blues',
  'dorian', 'mixolydian', 'lydian', 'phrygian', 'harmonicMinor',
];

const NECK_FROM = 0;
const NECK_TO = 15;

/** Degree labels relative to the scale root, for the degrees view. */
const DEGREE_LABELS = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

function degreeLabel(pc: PitchClass, root: PitchClass): string {
  const semis =
    (PITCH_CLASSES.indexOf(pc) - PITCH_CLASSES.indexOf(root) + 12) % 12;
  return DEGREE_LABELS[semis];
}

type Props = {
  /** The section's chords — the primary source for the default scale. */
  chords: readonly ProgressionChord[];
  /** `Video.musicExtraction.key`, e.g. "E minor". Fallback when there are
   *  no chords yet, or when the chords are too ambiguous to trust. */
  extractedKey?: string | null;
  /** Section bounds + bar count, so the chord overlay can follow the
   *  playhead exactly the way the chord strip above it does. */
  timing?: { startSec: number; endSec: number; bars: number | null } | null;
  /** Shared with the chord strip — see usePlayAlongInstrument. */
  instrument: PlayAlongInstrument;
  /** The section to persist a chosen scale onto (Loop.key). */
  loopDocumentId?: string | null;
  /** Scale already saved on the section, if any. Outranks inference. */
  savedKey?: { root: string; type: string } | null;
  /** Fired after a successful save so the parent can refetch the loop. */
  onScaleSaved?: () => void;
};

export function SectionScalePicker({
  chords,
  extractedKey,
  timing,
  instrument,
  loopDocumentId,
  savedKey,
  onScaleSaved,
}: Readonly<Props>) {
  // Where the default came from, so the UI can say so rather than looking
  // like it guessed arbitrarily.
  const suggestion = useMemo(() => {
    // An explicitly saved scale is a human decision about this exact
    // section, so it outranks anything we can infer.
    if (savedKey?.root && savedKey?.type) {
      return {
        root: savedKey.root as PitchClass,
        type: savedKey.type as ScaleType,
        confidence: 1,
        source: 'saved' as const,
      };
    }
    const inferred = inferKeyFromChords(chords);
    // A progression whose chords don't agree on a key is worse evidence
    // than an explicit extraction, so prefer the extraction below 0.75.
    if (inferred && inferred.confidence >= 0.75) {
      return { ...inferred, source: 'chords' as const };
    }
    const fromVideo = parseExtractedKey(extractedKey);
    if (fromVideo) return { ...fromVideo, confidence: 1, source: 'video' as const };
    if (inferred) return { ...inferred, source: 'chords' as const };
    return null;
  }, [chords, extractedKey, savedKey]);

  // null = follow the suggestion; set = the user has taken manual control.
  const [override, setOverride] = useState<{ root: PitchClass; type: ScaleType } | null>(null);
  const [position, setPosition] = useState<PositionId>('all');
  const [showDegrees, setShowDegrees] = useState(false);
  const [overlayOn, setOverlayOn] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // The chord currently sounding, from the same clock the chord strip uses —
  // so the overlay and the highlighted chord box can never disagree.
  const { currentSeconds } = usePlayerControl();
  const liveIndex =
    overlayOn && timing
      ? activeIndex(currentSeconds, timing.startSec, timing.endSec, chords.length, timing.bars)
      : null;
  // Before playback starts (or outside the loop window) fall back to the
  // first chord, so turning the overlay on always shows something.
  const activeChord = overlayOn
    ? chords[liveIndex ?? 0] ?? null
    : null;

  const root = override?.root ?? suggestion?.root ?? 'C';
  const type = override?.type ?? suggestion?.type ?? 'major';

  const scaleMatchesSaved =
    savedKey?.root === root && savedKey?.type === type;

  const scalePcs = useMemo(
    () => getScalePitchClasses({ root, type }),
    [root, type],
  );

  // The spotlighted box comes from positions.ts — the CAGED fingerings and
  // fret-window boxes transcribed dot-for-dot from guitarscale.org, which
  // is the reference this app has always used. An earlier version of this
  // panel generated 3-notes-per-string patterns instead; those are a real
  // system but a DIFFERENT one, so "Pos 4" here disagreed with "box 4"
  // everywhere else in the app.
  const supportsPositions = supportsCaged(type) && instrument === 'guitar';

  const positionOptions = useMemo(
    () => (supportsPositions ? availablePositions(type) : []),
    [supportsPositions, type],
  );

  const positionSet = useMemo(() => {
    if (!supportsPositions || position === 'all') return null;
    const notes = realizeCagedShape(position, root, scalePcs, type);
    if (notes.length === 0) return null;
    return new Set(notes.map((n) => `${n.string}:${n.fret}`));
  }, [supportsPositions, position, root, scalePcs, type]);

  const overlay = useMemo(
    () => (activeChord ? chordToneMap(activeChord.root, activeChord.quality) : null),
    [activeChord],
  );

  // Chord tones the key doesn't contain (a secondary dominant's raised 7th,
  // a borrowed chord's ♭6). These are the notes players most often fluff, so
  // the overlay draws them rather than omitting them.
  const outside = useMemo(
    () => (overlay ? outsideScaleTones(overlay, scalePcs) : []),
    [overlay, scalePcs],
  );

  // The exact positions fretted in the shape shown above — haloed so the
  // neck says "your hand is here", not merely "this note is in the chord".
  // Guitar only: the shapes are guitar voicings.
  const voicedKeys = useMemo(
    () =>
      activeChord && instrument === 'guitar'
        ? voicingPositionKeys({
            ...activeChord,
            inversion: activeChord.inversion ?? 0,
            voicingIndex: activeChord.voicingIndex ?? 0,
          })
        : null,
    [activeChord, instrument],
  );

  const dots = useMemo<NeckDot[]>(() => {
    if (scalePcs.length === 0) return [];
    const tuning =
      instrument === 'bass' ? STANDARD_BASS_TUNING_MIDI : STANDARD_TUNING_MIDI;

    const out: NeckDot[] = [];
    tuning.forEach((openMidi, string) => {
      for (let fret = NECK_FROM; fret <= NECK_TO; fret += 1) {
        const pc = PITCH_CLASSES[(openMidi + fret) % 12];
        if (!scalePcs.includes(pc)) continue;

        // Under the overlay the neck is a quiet white field of scale notes
        // with ONE thing solid on it: the shape actually being fretted
        // above. Filling every instance of the chord's pitch classes was
        // the wrong answer — it lit half the board and buried the shape.
        const inShape = voicedKeys?.has(`${string}:${fret}`) ?? false;

        out.push({
          string,
          fret,
          label: showDegrees ? degreeLabel(pc, root) : pc,
          // Overlay: only the chord's own root, and only where it is
          // actually played, takes the accent. Plain view: every root.
          root: overlay ? inShape && pc === overlay.root : pc === root,
          // Overlay: everything except the shape is a white circle.
          light: overlay ? !inShape : false,
          dim: positionSet ? !positionSet.has(`${string}:${fret}`) : false,
        });
      }
    });
    return out;
  }, [scalePcs, instrument, showDegrees, root, positionSet, overlay, voicedKeys]);

  // Piano board: the scale's notes, with the current chord's tones accented
  // when the overlay is on. The keyboard has no position system and no
  // fretted "shape", so it shows chord TONES rather than a voicing — the
  // honest piano equivalent.
  const keyMarks = useMemo<KeyMark[]>(() => {
    // With the overlay on, mark ONLY the current chord's notes. Marking the
    // whole scale lit almost every key and said nothing — the question the
    // overlay answers is "which notes are this chord", so everything else
    // has to stay unmarked.
    if (overlay && activeChord) {
      // Draw the ACTUAL piano voicing, not a set of pitch classes. That
      // means inversions read correctly — a Cmaj7/E puts E in the bass and
      // the rest above it — and it's why the board spans two octaves: a
      // voicing that crosses the octave has somewhere to go. The lowest
      // sounding note is pinned to the lower drawn octave.
      // voicingIndex is a GUITAR index (which barre shape); piano voicings
      // are a different list entirely, so reusing the number turns a
      // 5th-fret barre into a wide two-octave spread and the board stops
      // matching the card above. Pin the closed voicing and let `inversion`
      // — which IS instrument-neutral — do the work.
      const notes = pianoVoicing({
        ...activeChord,
        inversion: activeChord.inversion ?? 0,
        voicingIndex: 0,
      });
      if (notes.length > 0) {
        const midis = notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave));
        const lowest = Math.min(...midis);
        return notes.map((n, i) => ({
          pc: n.pitchClass,
          // 0 or 1 — which drawn octave this note lands in, relative to the
          // bass note. Clamped so a wide spread can't fall off the board.
          octave: Math.min(1, Math.floor((midis[i] - lowest) / 12)),
          label: showDegrees ? degreeLabel(n.pitchClass, root) : n.pitchClass,
          root: midis[i] === lowest,
        }));
      }
    }
    return scalePcs.map((pc) => ({
      pc,
      label: showDegrees ? degreeLabel(pc, root) : pc,
      root: pc === root,
    }));
  }, [scalePcs, showDegrees, root, overlay, activeChord]);

  const scaleName = `${root} ${SCALE_TYPE_LABELS[type]}`;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Scale
        </span>

        <select
          aria-label="Scale root"
          value={root}
          onChange={(e) => setOverride({ root: e.target.value as PitchClass, type })}
          className="rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1 text-sm font-medium text-[var(--ink)]"
        >
          {PITCH_CLASSES.map((pc) => (
            <option key={pc} value={pc}>{pc}</option>
          ))}
        </select>

        <select
          aria-label="Scale type"
          value={type}
          onChange={(e) => setOverride({ root, type: e.target.value as ScaleType })}
          className="rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1 text-sm font-medium text-[var(--ink)]"
        >
          {OFFERED_TYPES.map((t) => (
            <option key={t} value={t}>{SCALE_TYPE_LABELS[t]}</option>
          ))}
        </select>

        {/* Provenance — without this the default looks arbitrary. */}
        {!override && suggestion && (
          <span className="text-xs text-[var(--ink-muted)]">
            {suggestion.source === 'saved'
              ? 'saved on this section'
              : suggestion.source === 'chords'
                ? 'from these chords'
                : "from the video's detected key"}
          </span>
        )}
        {override && suggestion && (
          <button
            type="button"
            onClick={() => setOverride(null)}
            className="text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            reset to {suggestion.root} {SCALE_TYPE_LABELS[suggestion.type]}
          </button>
        )}

        {/* Explicit save rather than persisting on every dropdown change —
            a stray click shouldn't silently rewrite the section. Matches how
            the loop's own times are saved. */}
        {loopDocumentId && !scaleMatchesSaved && (
          <button
            type="button"
            disabled={saveState === 'saving'}
            onClick={() => {
              setSaveState('saving');
              const res = updateLoop(loopDocumentId, { key: { root, type } });
              if (res) {
                setSaveState('saved');
                onScaleSaved?.();
              } else {
                setSaveState('error');
              }
            }}
            className="rounded-lg border border-[var(--accent)] px-2 py-0.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white disabled:opacity-50"
          >
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'error'
                ? 'Retry save'
                : 'Save to section'}
          </button>
        )}
        {saveState === 'saved' && scaleMatchesSaved && (
          <span className="text-xs text-[var(--ink-muted)]">Saved</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-pressed={!showDegrees}
            onClick={() => setShowDegrees(false)}
            className={`rounded-lg px-2 py-1 text-xs font-medium ${!showDegrees ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}
          >
            Notes
          </button>
          <button
            type="button"
            aria-pressed={showDegrees}
            onClick={() => setShowDegrees(true)}
            className={`rounded-lg px-2 py-1 text-xs font-medium ${showDegrees ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}
          >
            Degrees
          </button>
          {chords.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-[var(--line)]" />
              <button
                type="button"
                aria-pressed={overlayOn}
                onClick={() => setOverlayOn((v) => !v)}
                className={`rounded-lg px-2 py-1 text-xs font-medium ${overlayOn ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}
              >
                Chord tones
              </button>
            </>
          )}
        </div>
      </div>

      {supportsPositions && (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-pressed={position === 'all'}
            onClick={() => setPosition('all')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${position === 'all' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]'}`}
          >
            All
          </button>
          {positionOptions.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={position === p}
              onClick={() => setPosition(p)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${position === p ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]'}`}
            >
              {shapeName(p, type)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        {instrument === 'piano' ? (
          // A scale is a pattern that repeats, so two octaves earn their
          // space. A chord is ONE grip — showing it twice reads as playing
          // the root twice. So the overlay drops to a single octave, capped
          // in width because a lone octave stretched across a full-width
          // panel gives absurdly large keys.
          <div>
            <MiniKeyboard
              octaves={2}
              marks={keyMarks}
              size="roomy"
              // MiniKeyboard's own warning: an unlit "F" sitting in a row of
              // numbers reads as part of the numbering. So note names on
              // unmarked keys only when the marks are note names too.
              showUnmarkedLabels={!overlay && !showDegrees}
              ariaLabel={`${scaleName} on the keyboard`}
            />
          </div>
        ) : (
          <MiniNeck
            instrument={instrument === 'bass' ? 'bass' : 'guitar'}
            dots={dots}
            fromFret={NECK_FROM}
            toFret={NECK_TO}
            size="roomy"
            ariaLabel={`${scaleName} across the ${instrument} neck${
              position === 'all' ? '' : `, ${shapeName(position, type)} highlighted`
            }`}
          />
        )}
      </div>

      <p className="mt-2 text-xs text-[var(--ink-muted)]">
        <span className="font-semibold text-[var(--ink-soft)]">{scaleName}</span>
        {overlay && activeChord ? (
          <>
            {' · over '}
            <span className="font-semibold text-[var(--accent)]">
              {activeChord.detectedLabel ??
                `${activeChord.root}${QUALITY_LABELS[activeChord.quality] ?? activeChord.quality}`}
            </span>
            {instrument === 'piano'
              ? ' — the lit keys are that chord. Everything unlit is still in the scale.'
              : ' — the solid notes are that shape on the neck; the white ones are the rest of the scale you can move through.'}
            {outside.length > 0 && (
              <> This chord adds <strong>{outside.join(', ')}</strong> from outside the key.</>
            )}
          </>
        ) : (
          ' — filled dots are the root. Loop the section above and play these over it.'
        )}
      </p>
    </div>
  );
}
