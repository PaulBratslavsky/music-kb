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
  CIRCLE_MAJOR_DISPLAY,
  CIRCLE_MINOR_DISPLAY,
  diatonicPositions,
  keySignatureLabel,
} from '#/lib/music/circle-of-fifths';

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
}: {
  initialTonicIdx?: number;
  tonicIdx?: number;
  onTonicChange?: (next: number) => void;
} = {}) {
  const [internalTonicIdx, setInternalTonicIdx] = useState(initialTonicIdx);
  const tonicIdx = tonicIdxProp ?? internalTonicIdx;
  const setTonicIdx = (next: number) => {
    if (onTonicChange) onTonicChange(next);
    else setInternalTonicIdx(next);
  };
  const positions = diatonicPositions(tonicIdx);

  // Build a quick lookup: (ring, idx) → numeral label, or null.
  const numeralMap = new Map<string, string>();
  for (const p of Object.values(positions)) {
    numeralMap.set(`${p.ring}-${p.idx}`, p.numeral);
  }
  // Distinguish the tonic itself from the other diatonic positions.
  const tonicKey = (ring: Ring, idx: number) =>
    ring === 'outer' && idx === tonicIdx;
  const relativeMinorKey = (ring: Ring, idx: number) =>
    ring === 'inner' && idx === tonicIdx;
  // Any diatonic position (the cluster + vii°).
  const isDiatonic = (ring: Ring, idx: number) =>
    numeralMap.has(`${ring}-${idx}`);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center">
        <div className="text-2xl font-semibold text-[var(--ink)]">
          {CIRCLE_MAJOR_DISPLAY[tonicIdx]} major /{' '}
          {CIRCLE_MINOR_DISPLAY[tonicIdx]} minor
        </div>
        <div className="mt-1 text-sm text-[var(--ink-muted)]">
          {keySignatureLabel(tonicIdx)}
        </div>
      </div>

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
              onClick={() => setTonicIdx(i)}
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
                {CIRCLE_MAJOR_DISPLAY[i]}
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
          // Inner-ring click: jump to the parallel-major tonic so the
          // wheel re-pivots around the major key whose relative minor
          // this is. (Click Am → tonic becomes C major.)
          return (
            <g
              key={`inner-${i}`}
              onClick={() => setTonicIdx(i)}
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
                {CIRCLE_MINOR_DISPLAY[i]}
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

      <div className="max-w-md text-center text-xs text-[var(--ink-muted)]">
        Click any key to make it the tonic. The cluster of highlighted
        wedges shows the diatonic chord family: I, IV, V on the outer
        (major) ring; ii, iii, vi on the inner (minor) ring. vii° sits
        opposite as the leading-tone diminished.
      </div>
    </div>
  );
}
