// Chord-mode control sub-panel of the SelectionBar.
//
// Owns the three controls that only matter when the visualizer is in
// chord mode:
//   • Quality picker — every ChordQuality as a chip. Chips for qualities
//     without a named guitar shape are dimmed (see qualityHasAnyShape)
//     with a tooltip explaining the pitch-class-flood fallback.
//   • Inversion stepper.
//   • Voicing stepper — augmented with a Shape-name badge that surfaces
//     the active voicing's identity (Open C / E-shape barre /
//     A-string power chord) so the user can tell at a glance.
//
// Extracted from SelectionBar to keep that component focused on top-level
// concerns (mode, root, label toggles). The Stepper sub-component is
// inlined here since it has no other call sites once Inversion + Voicing
// move in.

import {
  CHORD_QUALITIES,
  type ChordQuality,
  type ChordSelection,
} from '../types';
import { chordInversionCount, chordVoicingCount } from '../state/resolve';
import {
  currentGuitarShapeName,
  qualityHasAnyShape,
} from '../theory/voicings/guitar';
import { QUALITY_LABELS } from '../theory/quality-labels';

type Props = Readonly<{
  chord: ChordSelection;
  setChord: (updater: (c: ChordSelection) => ChordSelection) => void;
}>;

export function ChordControlPanel({ chord, setChord }: Props) {
  return (
    <>
      <div className="selection-group">
        <span className="group-label">Quality</span>
        <div className="btn-row">
          {CHORD_QUALITIES.map((q) => {
            // Dim chips for qualities with no named guitar shape — they
            // still work (piano + Push light the correct pitch classes),
            // but the guitar fretboard falls back to "every matching
            // position" instead of a clean fingering. Tooltip explains
            // the fallback so the user isn't surprised.
            const hasShape = qualityHasAnyShape(q);
            const isActive = chord.quality === q;
            return (
              <button
                key={q}
                className={`chip${isActive ? ' active' : ''}`}
                style={!hasShape && !isActive ? { opacity: 0.55 } : undefined}
                title={
                  hasShape
                    ? undefined
                    : 'No named guitar shape — fretboard shows every matching position (piano + Push still work as expected)'
                }
                onClick={() =>
                  setChord((c) => ({
                    ...c,
                    quality: q as ChordQuality,
                    inversion: 0,
                    // Reset voicingIndex on quality change too — the new
                    // quality has its own voicing list (might be shorter,
                    // might lack an open shape), so starting from 0 lands
                    // on the canonical fingering instead of a stale barre.
                    voicingIndex: 0,
                  }))
                }
              >
                {QUALITY_LABELS[q]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="selection-group">
        <span className="group-label">Inversion</span>
        <Stepper
          value={chord.inversion}
          max={Math.max(0, chordInversionCount(chord) - 1)}
          onChange={(n) => setChord((c) => ({ ...c, inversion: n }))}
        />
      </div>

      <div className="selection-group">
        <span className="group-label">Voicing</span>
        <Stepper
          value={chord.voicingIndex}
          max={Math.max(0, chordVoicingCount(chord) - 1)}
          onChange={(n) => setChord((c) => ({ ...c, voicingIndex: n }))}
        />
        <ShapeBadge chord={chord} />
      </div>
    </>
  );
}

/** Surfaces the active voicing's shape name ("Open C", "E-shape barre",
 *  "A-string power chord") next to the Voicing stepper. Color-coded —
 *  accent for barre/power shapes (so they pop), muted for open shapes. */
function ShapeBadge({ chord }: { chord: ChordSelection }) {
  const name = currentGuitarShapeName(chord);
  if (!name) return null;
  const isBarre = name.toLowerCase().includes('barre');
  const isPower = name.toLowerCase().includes('power');
  const badgeColor = isBarre || isPower ? 'var(--accent)' : 'var(--ink-muted)';
  return (
    <span
      style={{
        marginLeft: 8,
        padding: '2px 8px',
        borderRadius: 12,
        border: `1px solid ${badgeColor}`,
        color: badgeColor,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {name}
    </span>
  );
}

function Stepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const wrap = (n: number) => {
    if (max <= 0) return 0;
    const span = max + 1;
    return ((n % span) + span) % span;
  };
  return (
    <div className="stepper">
      <button onClick={() => onChange(wrap(value - 1))} aria-label="previous">
        ‹
      </button>
      <span className="stepper-value">{value}</span>
      <button onClick={() => onChange(wrap(value + 1))} aria-label="next">
        ›
      </button>
    </div>
  );
}
