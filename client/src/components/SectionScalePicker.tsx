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

import { useMemo, useState } from 'react';
import { MiniNeck, type NeckDot } from '#/components/lesson/MiniNeck';
import { usePlayerControl } from '#/components/player';
import { activeIndex } from '#/components/SectionChordStrip';
import { chordToneMap, outsideScaleTones } from '#/lib/music/theory/chord-overlay';
import { voicingPositionKeys } from '#/lib/music/theory/voicing-positions';
import { QUALITY_LABELS } from '#/lib/music/theory/quality-labels';
import { inferKeyFromChords, parseExtractedKey } from '#/lib/music/theory/key-inference';
import { threeNotesPerString } from '#/lib/music/theory/neck-patterns';
import { getScalePitchClasses, SCALE_TYPE_LABELS } from '#/lib/music/theory/scales';
import { PITCH_CLASSES, type PitchClass, type ScaleType } from '#/lib/music/types';
import type { ProgressionChord } from '#/lib/services/progressions';
import { STANDARD_TUNING_MIDI } from '#/lib/music/instruments/guitar/layout';
import { STANDARD_BASS_TUNING_MIDI } from '#/lib/music/instruments/bass/layout';

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
};

export function SectionScalePicker({ chords, extractedKey, timing }: Readonly<Props>) {
  // Where the default came from, so the UI can say so rather than looking
  // like it guessed arbitrarily.
  const suggestion = useMemo(() => {
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
  }, [chords, extractedKey]);

  // null = follow the suggestion; set = the user has taken manual control.
  const [override, setOverride] = useState<{ root: PitchClass; type: ScaleType } | null>(null);
  const [position, setPosition] = useState<number | 'all'>('all');
  const [showDegrees, setShowDegrees] = useState(false);
  const [instrument, setInstrument] = useState<'guitar' | 'bass'>('guitar');
  const [overlayOn, setOverlayOn] = useState(false);

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

  const scalePcs = useMemo(
    () => getScalePitchClasses({ root, type }),
    [root, type],
  );

  // The spotlighted box. 3NPS needs 7 degrees, so pentatonic/blues scales
  // get no position picker — there is nothing meaningful to generate.
  const supportsPositions = scalePcs.length === 7 && instrument === 'guitar';

  const positionSet = useMemo(() => {
    if (!supportsPositions || position === 'all') return null;
    const notes = threeNotesPerString(scalePcs, position, {
      tuning: STANDARD_TUNING_MIDI,
      minFret: 1,
    });
    return new Set(notes.map((n) => `${n.string}:${n.fret}`));
  }, [supportsPositions, position, scalePcs]);

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
        ? voicingPositionKeys(activeChord)
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
        const inScale = scalePcs.includes(pc);
        const isChordTone = overlay?.tones.has(pc) ?? false;
        // Without an overlay: the scale. With one: the scale PLUS any chord
        // tone from outside it.
        if (!inScale && !isChordTone) continue;

        const outOfPosition = positionSet ? !positionSet.has(`${string}:${fret}`) : false;

        out.push({
          string,
          fret,
          // With the overlay on, ONLY chord tones are labelled. Labelling
          // the rest would put two different systems side by side (chord
          // function "3 5 7" next to note names "F# A D") and neither
          // would be scannable. The unlabelled rings still show the
          // scale's shape.
          label: overlay
            ? overlay.labelFor.get(pc)
            : showDegrees
              ? degreeLabel(pc, root)
              : pc,
          // With the overlay on, the CHORD's root is the anchor worth
          // accenting — that's the note that sounds like home right now.
          root: overlay ? pc === overlay.root : pc === root,
          // Non-chord scale tones recede to rings; they stay legal, just not
          // load-bearing.
          hollow: overlay ? !isChordTone : false,
          ringed: voicedKeys?.has(`${string}:${fret}`) ?? false,
          dim: outOfPosition,
        });
      }
    });
    return out;
  }, [scalePcs, instrument, showDegrees, root, positionSet, overlay, voicedKeys]);

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
            {suggestion.source === 'chords'
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
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          {(['guitar', 'bass'] as const).map((inst) => (
            <button
              key={inst}
              type="button"
              aria-pressed={instrument === inst}
              onClick={() => { setInstrument(inst); setPosition('all'); }}
              className={`rounded-lg px-2 py-1 text-xs font-medium capitalize ${instrument === inst ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}
            >
              {inst}
            </button>
          ))}
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
          {scalePcs.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={position === i}
              onClick={() => setPosition(i)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${position === i ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]'}`}
            >
              Pos {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <MiniNeck
          instrument={instrument}
          dots={dots}
          fromFret={NECK_FROM}
          toFret={NECK_TO}
          size="roomy"
          ariaLabel={`${scaleName} across the ${instrument} neck${
            position === 'all' ? '' : `, position ${Number(position) + 1} highlighted`
          }`}
        />
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
            {' — solid dots are chord tones, rings are the rest of the scale. The circled notes are the shape shown above.'}
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
