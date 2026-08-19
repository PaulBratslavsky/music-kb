// Interactive Circle of Fifths.
//
// SVG wheel: outer ring = major keys, inner ring = relative minors. Click
// any major key to set it as the tonic — the wheel highlights I/IV/V on
// the outer ring, ii/iii/vi on the inner ring, and marks vii° on the
// outer at the leading-tone position. Roman numerals appear next to each
// labeled position. Key signature (# / ♭ count) shown below.
//
// Layout: 12 wedges per ring, 30° each. Top (12 o'clock) is C. Clockwise
// is up-a-fifth, the standard layout on every printed circle of fifths.

import { useState } from 'react';
import {
  CIRCLE_MAJORS,
  diatonicPositions,
  keySignatureLabel,
  majorDisplay,
  majorKeyAt,
  minorDisplay,
  type CircleDirection,
  type Enharmonic,
  type KeyMode,
} from '@music-kb/music/theory/circle-of-fifths';
import { PITCH_CLASSES, type PitchClass } from '@music-kb/music/types';
import { midiFromPitchOctave } from '@music-kb/music/theory/notes';
import { getChordPitchClasses, stackAscending } from '@music-kb/music/theory/chords';
import { synth } from '#/lib/music/audio/synth';

// Component supports two modes:
//   - Uncontrolled: omit `tonicIdx` + `onTonicChange`, internal state.
//   - Controlled: provide both, parent owns state (used by /theory to
//     share the tonic with the Chord Substitutions panel below).

const VIEW = 440;
const CENTER = VIEW / 2;
const OUTER_R = 200;
const MID_R = 145; // separates outer (major) ring from inner (minor) ring
const INNER_R = 80; // inner edge of the minor ring (the hollow center starts here)

// Stroke + fill colors derived from the theme tokens at runtime.
const COLOR_TONIC_FILL = 'var(--accent)';
const COLOR_TONIC_TEXT = '#ffffff';
const COLOR_DIATONIC_FILL = 'var(--accent-soft)';
const COLOR_NEUTRAL_FILL = 'var(--bg-subtle)';
const COLOR_TEXT = 'var(--ink)';
const COLOR_TEXT_MUTED = 'var(--ink-muted)';

type Ring = 'outer' | 'inner';

// Convert (segment index, ring) → SVG wedge path.
//   - segIdx 0 is centered at the top (12 o'clock); each segment is 30° wide.
//   - For the outer ring, the wedge spans MID_R..OUTER_R.
//   - For the inner ring, it spans INNER_R..MID_R.
function wedgePath(segIdx: number, ring: Ring): string {
  const rInner = ring === 'outer' ? MID_R : INNER_R;
  const rOuter = ring === 'outer' ? OUTER_R : MID_R;
  // -90° rotates so segment 0 is at the top; then ±15° on each side of
  // the segment center.
  const startDeg = segIdx * 30 - 90 - 15;
  const endDeg = startDeg + 30;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p = (r: number, deg: number) => ({
    x: CENTER + r * Math.cos(toRad(deg)),
    y: CENTER + r * Math.sin(toRad(deg)),
  });
  const p1 = p(rOuter, startDeg);
  const p2 = p(rOuter, endDeg);
  const p3 = p(rInner, endDeg);
  const p4 = p(rInner, startDeg);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 0 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}

// Center point of a segment for placing the label text.
function segCenter(segIdx: number, ring: Ring): { x: number; y: number } {
  const r = ring === 'outer' ? (MID_R + OUTER_R) / 2 : (INNER_R + MID_R) / 2;
  const deg = segIdx * 30 - 90;
  const rad = (deg * Math.PI) / 180;
  return {
    x: CENTER + r * Math.cos(rad),
    y: CENTER + r * Math.sin(rad),
  };
}

export function CircleOfFifths({
  initialTonicIdx = 0,
  tonicIdx: tonicIdxProp,
  onTonicChange,
  enharmonic: enharmonicProp,
  onEnharmonicChange,
  keyMode: keyModeProp,
  onKeyModeChange,
  direction: directionProp,
  onDirectionChange,
  audioMuted: audioMutedProp,
  onAudioMutedChange,
  onChordSelect,
  compact = false,
  hideControls = false,
}: {
  initialTonicIdx?: number;
  tonicIdx?: number;
  onTonicChange?: (next: number) => void;
  /** 'standard' uses sharps on the sharp half, flats on the flat half (the
   *  default on every printed circle). 'sharps' shows all 5 accidentals as
   *  sharps; 'flats' shows them all as flats. */
  enharmonic?: Enharmonic;
  onEnharmonicChange?: (next: Enharmonic) => void;
  /** 'major' (default) puts the tonic on the outer ring; 'minor' puts it
   *  on the inner ring so the user can treat any minor key (e.g. C♯m) as
   *  the I-equivalent (i). The same six wedges light up either way — only
   *  which wedge is the tonic + the Roman numerals change. */
  keyMode?: KeyMode;
  onKeyModeChange?: (next: KeyMode) => void;
  /** 'fifths' (default) is the standard CW = up-a-fifth layout.
   *  'fourths' flips to CW = up-a-fourth — the more guitar-friendly
   *  direction since the strings are tuned in fourths. V and IV swap
   *  positions on the wheel. */
  direction?: CircleDirection;
  onDirectionChange?: (next: CircleDirection) => void;
  /** When false (default), clicking a wedge plays the wedge's root note
   *  via the global synth singleton. Controlled/uncontrolled — the host
   *  can lift the state to keep multiple Circles on the same page in
   *  sync, or omit both props and let the Circle own its own toggle. */
  audioMuted?: boolean;
  onAudioMutedChange?: (next: boolean) => void;
  /** Fires on every wedge click with the (root, mode) that was selected.
   *  Outer ring fires (majorRoot, 'major'); inner ring fires (minorRoot,
   *  'minor'). Used by the Visualizer host to drive its selectChord — so
   *  clicking a wheel wedge updates the piano/guitar/Push views to the
   *  corresponding triad. Independent of the local tonicIdx state. */
  onChordSelect?: (root: PitchClass, mode: KeyMode) => void;
  /** When true, hides the top title block ("C major / Am minor" + key
   *  signature line) and the bottom hint paragraph so the component
   *  renders just the controls + wheel itself. Used when embedded in
   *  a tight surface (e.g., the music-video page's right column)
   *  where the surrounding chrome already provides context. */
  compact?: boolean;
  /** When true, hides ALL the control toggles (Major/Minor, Fifths/Fourths,
   *  sound, enharmonic) so only the wheel itself renders. For surfaces that
   *  use the wheel purely as a picker and drive mode/spelling externally
   *  (e.g. /builder's base-chord picker). */
  hideControls?: boolean;
} = {}) {
  const [internalTonicIdx, setInternalTonicIdx] = useState(initialTonicIdx);
  const tonicIdx = tonicIdxProp ?? internalTonicIdx;
  const setTonicIdx = (next: number) => {
    if (onTonicChange) onTonicChange(next);
    else setInternalTonicIdx(next);
  };
  const [internalEnharmonic, setInternalEnharmonic] = useState<Enharmonic>('standard');
  const enharmonic = enharmonicProp ?? internalEnharmonic;
  const setEnharmonic = (next: Enharmonic) => {
    if (onEnharmonicChange) onEnharmonicChange(next);
    else setInternalEnharmonic(next);
  };
  const [internalKeyMode, setInternalKeyMode] = useState<KeyMode>('major');
  const keyMode = keyModeProp ?? internalKeyMode;
  const setKeyMode = (next: KeyMode) => {
    if (onKeyModeChange) onKeyModeChange(next);
    else setInternalKeyMode(next);
  };
  const [internalDirection, setInternalDirection] = useState<CircleDirection>('fifths');
  const direction = directionProp ?? internalDirection;
  const setDirection = (next: CircleDirection) => {
    if (onDirectionChange) onDirectionChange(next);
    else setInternalDirection(next);
  };
  const [internalAudioMuted, setInternalAudioMuted] = useState(false);
  const audioMuted = audioMutedProp ?? internalAudioMuted;
  const setAudioMuted = (next: boolean) => {
    // Keep the global synth muted state in sync so any other component
    // hitting `synth.play*` (e.g. IntervalCalculator's "Hear it" button)
    // respects the same preference.
    synth.setMuted(next);
    if (onAudioMutedChange) onAudioMutedChange(next);
    else setInternalAudioMuted(next);
  };
  const positions = diatonicPositions(tonicIdx, keyMode, direction);

  // Compute the wedge's pitch class. Outer ring = major root (the wedge's
  // displayed pitch class); inner ring = relative-minor root, 3 semitones
  // below the major (e.g., A is the relative minor of C — C - 3 ≡ C + 9
  // mod 12 = A).
  const wedgePitchClass = (ring: Ring, idx: number): PitchClass => {
    const majorPC = majorKeyAt(idx, direction);
    const majorPcIdx = PITCH_CLASSES.indexOf(majorPC);
    const pcIdx = ring === 'outer' ? majorPcIdx : (majorPcIdx + 9) % 12;
    return PITCH_CLASSES[pcIdx];
  };

  // Play the wedge's chord triad. Outer = major triad; inner = minor
  // triad. Octave 4 + stackAscending gives a closed mid-range voicing.
  const playWedge = (ring: Ring, idx: number) => {
    if (audioMuted) return;
    const rootPc = wedgePitchClass(ring, idx);
    const triadPcs = getChordPitchClasses(rootPc, ring === 'outer' ? 'maj' : 'min');
    const notes = stackAscending(triadPcs, 4);
    synth.playChord(notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave)));
  };

  // Fire the host's chord-selection callback for a wedge click. Used by
  // the Visualizer tab to update piano/guitar/Push views to the wedge's
  // triad. No-op when no callback is wired (Tools-tab callsite).
  const emitChordSelect = (ring: Ring, idx: number) => {
    if (!onChordSelect) return;
    onChordSelect(wedgePitchClass(ring, idx), ring === 'outer' ? 'major' : 'minor');
  };

  // Build a quick lookup: (ring, idx) → numeral label, or null.
  const numeralMap = new Map<string, string>();
  for (const p of Object.values(positions)) {
    numeralMap.set(`${p.ring}-${p.idx}`, p.numeral);
  }
  // Tonic ring depends on mode: major → outer, minor → inner. The other
  // ring at the same idx is the parallel relative key (shown a notch less
  // bright but still highlighted).
  const tonicRing: Ring = keyMode === 'minor' ? 'inner' : 'outer';
  const tonicKey = (ring: Ring, idx: number) =>
    ring === tonicRing && idx === tonicIdx;
  const relativeMinorKey = (ring: Ring, idx: number) =>
    ring !== tonicRing && idx === tonicIdx;
  // Any diatonic position (the cluster + vii°).
  const isDiatonic = (ring: Ring, idx: number) =>
    numeralMap.has(`${ring}-${idx}`);

  return (
    <div className="flex flex-col items-center gap-4">
      {!compact && (
      <div className="text-center">
        <div className="text-2xl font-semibold text-[var(--ink)]">
          {keyMode === 'minor' ? (
            <>
              {minorDisplay(tonicIdx, enharmonic, direction)} minor /{' '}
              {majorDisplay(tonicIdx, enharmonic, direction)} major
            </>
          ) : (
            <>
              {majorDisplay(tonicIdx, enharmonic, direction)} major /{' '}
              {minorDisplay(tonicIdx, enharmonic, direction)} minor
            </>
          )}
        </div>
        <div className="mt-1 text-sm text-[var(--ink-muted)]">
          {keySignatureLabel(tonicIdx)}
        </div>
      </div>
      )}

      {!hideControls && (
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div
          className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
          role="radiogroup"
          aria-label="Key mode"
        >
          {(
            [
              { mode: 'major' as const, label: 'Major', title: 'Tonic sits on the outer ring (Iiv-V family).' },
              { mode: 'minor' as const, label: 'Minor', title: 'Tonic sits on the inner ring — click any minor key to set it as i.' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.mode}
              type="button"
              role="radio"
              aria-checked={keyMode === opt.mode}
              onClick={() => setKeyMode(opt.mode)}
              title={opt.title}
              className={`rounded-full px-3 py-1 font-medium transition ${
                keyMode === opt.mode
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div
          className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
          role="radiogroup"
          aria-label="Direction"
        >
          {(
            [
              { mode: 'fifths' as const, label: 'Fifths', title: 'Clockwise = up a 5th (C→G→D…). Standard printed-circle layout.' },
              { mode: 'fourths' as const, label: 'Fourths', title: 'Clockwise = up a 4th (C→F→B♭…). Mirror image — more guitar-friendly since the strings are tuned in fourths.' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.mode}
              type="button"
              role="radio"
              aria-checked={direction === opt.mode}
              onClick={() => setDirection(opt.mode)}
              title={opt.title}
              className={`rounded-full px-3 py-1 font-medium transition ${
                direction === opt.mode
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      <button
        type="button"
        onClick={() => setAudioMuted(!audioMuted)}
        aria-pressed={!audioMuted}
        title={
          audioMuted
            ? 'Sound is muted — click to enable wedge-click playback'
            : 'Sound is on — click a wedge to hear its root note'
        }
        className={`inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium transition ${
          audioMuted
            ? 'bg-[var(--card)] text-[var(--ink-muted)]'
            : 'bg-[var(--accent-soft)] text-[var(--accent)]'
        }`}
      >
        {audioMuted ? '🔇 muted' : '🔊 sound'}
      </button>
      <div
        className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
        role="radiogroup"
        aria-label="Enharmonic spelling"
      >
        {(
          [
            { mode: 'standard' as const, label: 'Standard', title: 'Sharp half uses sharps, flat half uses flats — the printed-circle convention.' },
            { mode: 'sharps' as const, label: '♯ Sharps', title: 'All 5 accidentals shown as sharps (C♯, D♯, F♯, G♯, A♯).' },
            { mode: 'flats' as const, label: '♭ Flats', title: 'All 5 accidentals shown as flats (D♭, E♭, G♭, A♭, B♭).' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={enharmonic === opt.mode}
            onClick={() => setEnharmonic(opt.mode)}
            title={opt.title}
            className={`rounded-full px-3 py-1 font-medium transition ${
              enharmonic === opt.mode
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      </div>
      )}

      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={VIEW}
        height={VIEW}
        className="max-w-full"
        role="img"
        aria-label="Circle of fifths"
      >
        {CIRCLE_MAJORS.map((_, i) => {
          const isTonic = tonicKey('outer', i);
          const diatonic = isDiatonic('outer', i);
          const fill = isTonic
            ? COLOR_TONIC_FILL
            : diatonic
            ? COLOR_DIATONIC_FILL
            : COLOR_NEUTRAL_FILL;
          const text = isTonic ? COLOR_TONIC_TEXT : COLOR_TEXT;
          const numeral = numeralMap.get(`outer-${i}`);
          const center = segCenter(i, 'outer');
          return (
            <g
              key={`outer-${i}`}
              onClick={() => {
                // Clicking the outer (majors) ring sets the major key. If
                // the user was in minor mode, switch to major so the
                // clicked wedge becomes the I they expected — not "this
                // major's relative minor", which is musically right but
                // not what users mean when they click "C# major".
                setTonicIdx(i);
                if (keyMode !== 'major') setKeyMode('major');
                playWedge('outer', i);
                emitChordSelect('outer', i);
              }}
              style={{ cursor: 'pointer' }}
            >
              <path
                d={wedgePath(i, 'outer')}
                fill={fill}
                stroke="var(--line)"
                strokeWidth={1.5}
              />
              <text
                x={center.x}
                y={center.y - 4}
                fontSize={20}
                fontWeight={600}
                fill={text}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {majorDisplay(i, enharmonic, direction)}
              </text>
              {numeral && (
                <text
                  x={center.x}
                  y={center.y + 14}
                  fontSize={11}
                  fontWeight={500}
                  fill={isTonic ? COLOR_TONIC_TEXT : COLOR_TEXT_MUTED}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                >
                  {numeral}
                </text>
              )}
            </g>
          );
        })}

        {CIRCLE_MAJORS.map((_, i) => {
          const isRelMin = relativeMinorKey('inner', i);
          const diatonic = isDiatonic('inner', i);
          const fill = isRelMin
            ? COLOR_TONIC_FILL
            : diatonic
            ? COLOR_DIATONIC_FILL
            : COLOR_NEUTRAL_FILL;
          const text = isRelMin ? COLOR_TONIC_TEXT : COLOR_TEXT;
          const numeral = numeralMap.get(`inner-${i}`);
          const center = segCenter(i, 'inner');
          return (
            <g
              key={`inner-${i}`}
              onClick={() => {
                // Clicking the inner (minors) ring sets the minor key
                // directly — clicking C#m makes C#m the i, not "the
                // major key whose relative minor is C#m." Auto-switches
                // out of major mode if needed.
                setTonicIdx(i);
                if (keyMode !== 'minor') setKeyMode('minor');
                playWedge('inner', i);
                emitChordSelect('inner', i);
              }}
              style={{ cursor: 'pointer' }}
            >
              <path
                d={wedgePath(i, 'inner')}
                fill={fill}
                stroke="var(--line)"
                strokeWidth={1.5}
              />
              <text
                x={center.x}
                y={center.y - 4}
                fontSize={14}
                fontWeight={600}
                fill={text}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {minorDisplay(i, enharmonic, direction)}
              </text>
              {numeral && (
                <text
                  x={center.x}
                  y={center.y + 10}
                  fontSize={10}
                  fontWeight={500}
                  fill={isRelMin ? COLOR_TONIC_TEXT : COLOR_TEXT_MUTED}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                >
                  {numeral}
                </text>
              )}
            </g>
          );
        })}

        {/* Hollow center — visual breathing room + label for the tonic. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={INNER_R}
          fill="var(--card)"
          stroke="var(--line)"
          strokeWidth={1}
        />
      </svg>

      {!compact && (
        <div className="max-w-md text-center text-xs text-[var(--ink-muted)]">
          Click any key to make it the tonic. The cluster of highlighted
          wedges shows the diatonic chord family: I, IV, V on the outer
          (major) ring; ii, iii, vi on the inner (minor) ring. vii° sits
          opposite as the leading-tone diminished.
        </div>
      )}
    </div>
  );
}
