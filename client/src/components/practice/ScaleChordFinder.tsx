// Find the chords hiding inside a scale shape.
//
// Deliberately a *practice* surface, not a lookup table: the answer starts
// hidden. You pick a key, a box and a degree, then go find the shape on
// your own instrument and reveal to check. Handing over the dots
// immediately would make it a reference — useful, but it wouldn't build the
// thing worth building, which is the habit of looking for chords inside a
// scale you already know.
//
// Lives here rather than on the video page because it is not a play-along
// activity: nothing about it is time-bound, and you cannot browse shapes
// and follow a loop at the same time.

import { useMemo, useState } from 'react';
import { MiniNeck, type NeckDot } from '#/components/lesson/MiniNeck';
import {
  findChordsInScale,
  type FinderMode,
} from '#/lib/music/theory/scale-chord-finder';
import { availablePositions, shapeName, supportsCaged } from '#/lib/music/theory/positions';
import { getScalePitchClasses, SCALE_TYPE_LABELS } from '#/lib/music/theory/scales';
import {
  PITCH_CLASSES,
  type PitchClass,
  type ScalePosition,
  type ScaleType,
} from '#/lib/music/types';

// Only scales with transcribed box data — the point of the exercise is a
// shape you can actually put your hand in.
const SCALES: ScaleType[] = ['major', 'minor', 'majorPentatonic', 'minorPentatonic', 'blues'];

const TUNING = [64, 59, 55, 50, 45, 40];
const NECK_TO = 15;

export function ScaleChordFinder() {
  const [root, setRoot] = useState<PitchClass>('E');
  const [type, setType] = useState<ScaleType>('minor');
  const [position, setPosition] = useState<ScalePosition>(3);
  const [mode, setMode] = useState<FinderMode>('triads');
  const [degree, setDegree] = useState(1);
  const [revealed, setRevealed] = useState(false);

  const boxes = useMemo(
    () => (supportsCaged(type) ? availablePositions(type) : []),
    [type],
  );

  const chords = useMemo(
    () => findChordsInScale(root, type, position, mode),
    [root, type, position, mode],
  );

  const target = chords.find((c) => c.degree === degree) ?? chords[0];
  const scalePcs = useMemo(() => getScalePitchClasses({ root, type }), [root, type]);

  // The box's own notes, with the target chord's notes solid once revealed.
  const dots = useMemo<NeckDot[]>(() => {
    if (!target) return [];
    const inChord = new Set(target.positions.map((p) => `${p.string}:${p.fret}`));
    const boxKeys =
      position === 'all'
        ? null
        : new Set(
            findChordsInScale(root, type, position, 'triads')
              .flatMap((c) => c.positions)
              .map((p) => `${p.string}:${p.fret}`),
          );

    const out: NeckDot[] = [];
    for (let s = 0; s < TUNING.length; s += 1) {
      for (let f = 0; f <= NECK_TO; f += 1) {
        const pc = PITCH_CLASSES[(TUNING[s] + f) % 12];
        if (!scalePcs.includes(pc)) continue;
        const key = `${s}:${f}`;
        // Outside the chosen box entirely — skip, the exercise is about one
        // hand position.
        if (boxKeys && !boxKeys.has(key) && !inChord.has(key)) continue;

        const isTarget = inChord.has(key);
        out.push({
          string: s,
          fret: f,
          // Hidden until revealed: unlabelled rings give you the box to
          // search without giving away the answer.
          label: revealed && isTarget ? pc : undefined,
          root: revealed && isTarget && pc === target.targetPcs[0],
          light: !(revealed && isTarget),
          hollow: !(revealed && isTarget),
        });
      }
    }
    return out;
  }, [target, revealed, scalePcs, root, type, position]);

  const chip = (active: boolean) =>
    `rounded-lg px-2.5 py-1 text-xs font-semibold ${
      active
        ? 'bg-[var(--accent)] text-white'
        : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]'
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Key"
          value={root}
          onChange={(e) => { setRoot(e.target.value as PitchClass); setRevealed(false); }}
          className="rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1 text-sm font-medium text-[var(--ink)]"
        >
          {PITCH_CLASSES.map((pc) => <option key={pc} value={pc}>{pc}</option>)}
        </select>
        <select
          aria-label="Scale"
          value={type}
          onChange={(e) => {
            const next = e.target.value as ScaleType;
            setType(next);
            setPosition(availablePositions(next)[0] ?? 'all');
            setRevealed(false);
          }}
          className="rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1 text-sm font-medium text-[var(--ink)]"
        >
          {SCALES.map((t) => <option key={t} value={t}>{SCALE_TYPE_LABELS[t]}</option>)}
        </select>

        <span className="mx-1 h-4 w-px bg-[var(--line)]" />
        {(['triads', 'power'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => { setMode(m); setRevealed(false); }}
            className={chip(mode === m)}
          >
            {m === 'triads' ? 'Triads' : 'Power chords'}
          </button>
        ))}
      </div>

      {boxes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Box
          </span>
          {boxes.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={position === b}
              onClick={() => { setPosition(b); setRevealed(false); }}
              className={chip(position === b)}
            >
              {shapeName(b, type)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Chord
        </span>
        {chords.map((c) => (
          <button
            key={c.degree}
            type="button"
            aria-pressed={degree === c.degree}
            onClick={() => { setDegree(c.degree); setRevealed(false); }}
            className={chip(degree === c.degree)}
          >
            {c.roman}
          </button>
        ))}
      </div>

      {target && (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
          <p className="text-sm text-[var(--ink)]">
            Find{' '}
            <strong className="text-[var(--accent)]">{target.chordName}</strong>{' '}
            ({target.roman}) inside{' '}
            {position === 'all' ? 'the whole neck' : shapeName(position, type)} of{' '}
            {root} {SCALE_TYPE_LABELS[type]}.
          </p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {mode === 'triads'
              ? 'Three notes — root, third, fifth. Play them together without shifting position.'
              : 'Two notes — root and fifth, no third.'}
          </p>

          {target.flatFifthWarning && (
            <p className="mt-2 rounded-lg border border-[var(--band-red-line,var(--line))] bg-[var(--card)] p-2 text-xs text-[var(--ink-soft)]">
              <strong className="text-[var(--ink)]">Careful:</strong> {target.roman} is
              diminished, so its fifth is flat. The usual power-chord grip
              (root + 7 frets) sounds a note outside the key — the fifth you
              want here is <strong>{target.targetPcs[1]}</strong>.
            </p>
          )}

          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="mt-3 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white"
          >
            {revealed ? 'Hide answer' : 'Reveal'}
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <MiniNeck
          dots={dots}
          fromFret={0}
          toFret={NECK_TO}
          size="roomy"
          ariaLabel={
            revealed
              ? `${target?.chordName} inside the scale box`
              : 'Scale box with the answer hidden'
          }
        />
      </div>
    </div>
  );
}
