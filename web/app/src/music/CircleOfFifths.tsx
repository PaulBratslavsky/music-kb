// Interactive Circle of Fifths — slim version for the music player
// page. Same SVG geometry as the music-kb component, but rewritten to
// use inline styles + the standalone's existing color tokens (no
// Tailwind, no music-kb-only `--ink-muted` / `--accent-soft` tokens).
//
// Clicking a wedge plays its root triad through the existing synth
// singleton (outer ring = major triad, inner ring = minor triad).
// Used on the Player page so the user can find the song's key by
// matching wedges to what they hear.

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
} from '../theory/circle-of-fifths';
import { PITCH_CLASSES } from '../types';
import { midiFromPitchOctave } from '../theory/notes';
import { getChordPitchClasses, stackAscending } from '../theory/chords';
import { synth } from '../audio/synth';

const VIEW = 440;
const CENTER = VIEW / 2;
const OUTER_R = 200;
const MID_R = 145;
const INNER_R = 80;

const COLOR_TONIC_FILL = 'var(--accent)';
const COLOR_TONIC_TEXT = '#ffffff';
const COLOR_DIATONIC_FILL = 'rgba(79, 140, 255, 0.18)';
const COLOR_NEUTRAL_FILL = 'var(--panel-2)';
const COLOR_TEXT = 'var(--text)';
const COLOR_TEXT_MUTED = 'var(--text-dim)';

type Ring = 'outer' | 'inner';

function wedgePath(segIdx: number, ring: Ring): string {
  const rInner = ring === 'outer' ? MID_R : INNER_R;
  const rOuter = ring === 'outer' ? OUTER_R : MID_R;
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

function segCenter(segIdx: number, ring: Ring): { x: number; y: number } {
  const r = ring === 'outer' ? (MID_R + OUTER_R) / 2 : (INNER_R + MID_R) / 2;
  const deg = segIdx * 30 - 90;
  const rad = (deg * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

type Props = {
  /** Title + key-signature line above the wheel. Default off — the
   *  surrounding page usually provides its own header. */
  showTitle?: boolean;
  /** Major / Minor toggle. Default on — useful even on compact
   *  surfaces since clicking a wedge auto-sets the mode anyway. */
  showKeyModeToggle?: boolean;
  /** Fifths / Fourths layout direction toggle. Default off in compact
   *  contexts since "fifths" is the textbook layout most users want. */
  showDirectionToggle?: boolean;
  /** Enharmonic spelling toggle (Standard / ♯ / ♭). Default off in
   *  compact contexts — irrelevant for chord identification. */
  showEnharmonicToggle?: boolean;
  /** 🔊 sound toggle. Default on so wedge clicks are audible — the
   *  primary affordance for "find the key by ear". */
  showSoundToggle?: boolean;
};

export function CircleOfFifths({
  showTitle = false,
  showKeyModeToggle = true,
  showDirectionToggle = true,
  showEnharmonicToggle = true,
  showSoundToggle = true,
}: Props) {
  const [tonicIdx, setTonicIdx] = useState(0);
  const [enharmonic, setEnharmonic] = useState<Enharmonic>('standard');
  const [keyMode, setKeyMode] = useState<KeyMode>('major');
  const [direction, setDirection] = useState<CircleDirection>('fifths');
  const [audioMuted, setAudioMuted] = useState(false);

  const positions = diatonicPositions(tonicIdx, keyMode, direction);
  const numeralMap = new Map<string, string>();
  for (const p of Object.values(positions)) {
    numeralMap.set(`${p.ring}-${p.idx}`, p.numeral);
  }
  const tonicRing: Ring = keyMode === 'minor' ? 'inner' : 'outer';
  const tonicKey = (ring: Ring, idx: number) =>
    ring === tonicRing && idx === tonicIdx;
  const relativeMinorKey = (ring: Ring, idx: number) =>
    ring !== tonicRing && idx === tonicIdx;
  const isDiatonic = (ring: Ring, idx: number) =>
    numeralMap.has(`${ring}-${idx}`);

  const playWedge = (ring: Ring, idx: number) => {
    if (audioMuted) return;
    const majorPC = majorKeyAt(idx, direction);
    const majorPcIdx = PITCH_CLASSES.indexOf(majorPC);
    const pcIdx = ring === 'outer' ? majorPcIdx : (majorPcIdx + 9) % 12;
    const rootPc = PITCH_CLASSES[pcIdx];
    const triadPcs = getChordPitchClasses(rootPc, ring === 'outer' ? 'maj' : 'min');
    const notes = stackAscending(triadPcs, 4);
    synth.playChord(notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {showTitle && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>
            {keyMode === 'minor'
              ? `${minorDisplay(tonicIdx, enharmonic, direction)} minor / ${majorDisplay(tonicIdx, enharmonic, direction)} major`
              : `${majorDisplay(tonicIdx, enharmonic, direction)} major / ${minorDisplay(tonicIdx, enharmonic, direction)} minor`}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
            {keySignatureLabel(tonicIdx)}
          </div>
        </div>
      )}

      {(showKeyModeToggle || showDirectionToggle || showSoundToggle || showEnharmonicToggle) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {showKeyModeToggle && (
            <Toggle
              options={[
                { value: 'major', label: 'Major' },
                { value: 'minor', label: 'Minor' },
              ]}
              value={keyMode}
              onChange={(v) => setKeyMode(v as KeyMode)}
            />
          )}
          {showDirectionToggle && (
            <Toggle
              options={[
                { value: 'fifths', label: 'Fifths' },
                { value: 'fourths', label: 'Fourths' },
              ]}
              value={direction}
              onChange={(v) => setDirection(v as CircleDirection)}
            />
          )}
          {showSoundToggle && (
            <button
              type="button"
              onClick={() => {
                const next = !audioMuted;
                setAudioMuted(next);
                synth.setMuted(next);
              }}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: audioMuted ? 'var(--panel-2)' : 'var(--accent)',
                color: audioMuted ? 'var(--text-dim)' : '#fff',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {audioMuted ? '🔇 muted' : '🔊 sound'}
            </button>
          )}
          {showEnharmonicToggle && (
            <Toggle
              options={[
                { value: 'standard', label: 'Std' },
                { value: 'sharps', label: '♯' },
                { value: 'flats', label: '♭' },
              ]}
              value={enharmonic}
              onChange={(v) => setEnharmonic(v as Enharmonic)}
            />
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={VIEW}
        height={VIEW}
        style={{ maxWidth: '100%', height: 'auto' }}
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
                setTonicIdx(i);
                if (keyMode !== 'major') setKeyMode('major');
                playWedge('outer', i);
              }}
              style={{ cursor: 'pointer' }}
            >
              <path d={wedgePath(i, 'outer')} fill={fill} stroke="var(--border)" strokeWidth={1.5} />
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
                setTonicIdx(i);
                if (keyMode !== 'minor') setKeyMode('minor');
                playWedge('inner', i);
              }}
              style={{ cursor: 'pointer' }}
            >
              <path d={wedgePath(i, 'inner')} fill={fill} stroke="var(--border)" strokeWidth={1.5} />
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

        <circle
          cx={CENTER}
          cy={CENTER}
          r={INNER_R}
          fill="var(--panel)"
          stroke="var(--border)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: 'inline-flex',
        padding: 2,
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--panel-2)',
        fontSize: 11,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '3px 10px',
              borderRadius: 999,
              border: 'none',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-dim)',
              cursor: 'pointer',
              fontWeight: 500,
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
