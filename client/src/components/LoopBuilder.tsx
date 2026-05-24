// LoopBuilder — the "Find chords" panel that sits above TheoryCompanion
// inside the Theory tab.
//
// Three rendering states:
//
//   1. No key picked yet, no focused note
//      → Prompt to click a piano key in the visualizer below.
//
//   2. No key picked, but the user focused a piano note (`lastFocusedPC`)
//      → Two buttons: "Use as <PC> major" / "Use as <relativeMinor> minor".
//        Picking one calls onUseAsKey(key) — the host (LearnPage) flips
//        the visualizer into scale mode and sets candidateKey in the
//        LoopBuilder context.
//
//   3. Key picked
//      → Show key chip, the in-progress progression as removable chips,
//        a "Record" toggle, and a "Save loop" button (wired in Phase E).
//        While Record is on, diatonic-chord-chip clicks inside the
//        visualizer append to the progression.

import { useState } from 'react';
import { useLoopBuilder } from './LoopBuilderProvider';
import type { KeySig } from '#/lib/services/loops';

export type SaveLoopPayload = {
  label: string;
  bpm: number | null;
  notes: string | null;
};

// 12-tone chromatic; flat names mirror the visualizer's notes.ts so a
// chord chip "Db" round-trips visibly. Index 0 = C.
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
type PitchClass = (typeof PITCH_CLASSES)[number];

const FLAT_DISPLAY: Partial<Record<PitchClass, string>> = {
  'C#': 'Db',
  'D#': 'Eb',
  'F#': 'Gb',
  'G#': 'Ab',
  'A#': 'Bb',
};

function displayPC(pc: string): string {
  return FLAT_DISPLAY[pc as PitchClass] ?? pc;
}

/** Relative minor of a major root is 3 semitones (a minor third) down,
 *  modulo 12. C major → A minor; G major → E minor; etc. */
function relativeMinor(majorRoot: string): string {
  const idx = PITCH_CLASSES.indexOf(majorRoot as PitchClass);
  if (idx < 0) return majorRoot;
  return PITCH_CLASSES[(idx + 9) % 12];
}

export function LoopBuilder({
  lastFocusedPC,
  onUseAsKey,
  onSave,
  saveBlockedReason,
}: {
  lastFocusedPC: string | null;
  onUseAsKey: (key: KeySig) => void;
  /** Persist the current draft + supplied form fields. The host bundles
   *  the player's loop region and the video relation; this prop just
   *  receives the user-typed label/bpm/notes. */
  onSave: (payload: SaveLoopPayload) => Promise<{ ok: boolean; error?: string }>;
  /** When non-null, the Save button is disabled and the reason is shown
   *  as a tooltip (e.g. "Set an A/B loop on the player first"). */
  saveBlockedReason: string | null;
}) {
  const {
    candidateKey,
    progression,
    recordMode,
    removeChordAt,
    clearDraft,
    toggleRecordMode,
  } = useLoopBuilder();

  // Inline save form. Hidden until the user clicks "Save loop"; controlled
  // form state lives here (not in LoopBuilderProvider) because it's purely
  // UI ephemera — once saved, the values live on the persisted Loop row.
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [bpm, setBpm] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resetForm = () => {
    setShowForm(false);
    setLabel('');
    setBpm('');
    setNotes('');
    setSaveError(null);
  };

  const handleSubmit = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setSaveError('Label is required');
      return;
    }
    const bpmNum = bpm.trim() ? Number(bpm.trim()) : null;
    if (bpmNum != null && (!Number.isFinite(bpmNum) || bpmNum < 20 || bpmNum > 400)) {
      setSaveError('BPM must be between 20 and 400');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await onSave({
      label: trimmedLabel,
      bpm: bpmNum,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.ok) {
      resetForm();
      clearDraft();
    } else {
      setSaveError(res.error ?? 'Save failed');
    }
  };

  // ---- State 3: key picked → progression builder --------------------------
  if (candidateKey) {
    return (
      <div className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Find chords in
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-sm font-medium text-[var(--ink)]">
            {displayPC(candidateKey.root)} {candidateKey.type}
          </span>

          <button
            type="button"
            onClick={toggleRecordMode}
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition ${
              recordMode
                ? 'border border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                : 'border border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink)] hover:border-[var(--line-strong)]'
            }`}
            title={
              recordMode
                ? 'Stop appending chord chip clicks to the progression'
                : 'Append chord chip clicks to the progression'
            }
          >
            {recordMode ? '◉ Recording' : '◯ Record'}
          </button>

          <button
            type="button"
            onClick={clearDraft}
            className="text-xs text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            clear
          </button>
        </div>

        <div className="mt-4">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Progression
          </span>
          {progression.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {recordMode
                ? 'Press a chord chip on the visualizer to append it.'
                : 'Turn on Record, then press the diatonic chord chips below to capture what you hear.'}
            </p>
          ) : (
            <ol className="mt-2 flex flex-wrap items-center gap-1.5">
              {progression.map((c, i) => (
                <li
                  key={`${i}-${c.root}-${c.quality}`}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-xs text-[var(--ink)]"
                >
                  <span>{i + 1}.</span>
                  <span className="font-semibold">
                    {displayPC(c.root)}
                    {c.quality === 'maj' ? '' : c.quality}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeChordAt(i)}
                    aria-label={`Remove chord ${i + 1}`}
                    className="text-[var(--ink-muted)] hover:text-destructive"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        {!showForm ? (
          <div className="mt-4 flex items-center justify-end">
            <button
              type="button"
              disabled={saveBlockedReason != null}
              onClick={() => setShowForm(true)}
              title={saveBlockedReason ?? 'Save this loop with the current key + progression'}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save loop
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-4 sm:grid-cols-[2fr_1fr]"
          >
            <label className="block text-xs sm:col-span-2">
              <span className="text-[var(--ink-muted)]">Label *</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder='e.g. "intro hook", "chorus", "verse vamp"'
                disabled={saving}
                maxLength={120}
                autoFocus
                className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <label className="block text-xs">
              <span className="text-[var(--ink-muted)]">BPM (optional)</span>
              <input
                type="number"
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                placeholder="e.g. 96"
                min={20}
                max={400}
                disabled={saving}
                className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <label className="block text-xs sm:col-span-2">
              <span className="text-[var(--ink-muted)]">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="what section is this, what are you trying to nail…"
                rows={2}
                maxLength={2000}
                disabled={saving}
                className="mt-1 w-full resize-none rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            {saveError && (
              <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive sm:col-span-2">
                {saveError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                className="text-xs text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline disabled:opacity-50"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={saving || !label.trim()}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // ---- State 2: focused PC, no key picked → two-button choice -------------
  if (lastFocusedPC) {
    const major = lastFocusedPC;
    const minor = relativeMinor(major);
    return (
      <div className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <p className="text-sm text-[var(--ink-soft)]">
          You focused <span className="font-semibold text-[var(--ink)]">{displayPC(major)}</span>{' '}
          on the piano. Is the loop in…
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onUseAsKey({ root: major, type: 'major' })}
            className="rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)]"
          >
            Use as {displayPC(major)} major
          </button>
          <button
            type="button"
            onClick={() => onUseAsKey({ root: minor, type: 'minor' })}
            className="rounded-full border border-[var(--accent)] bg-[var(--card)] px-4 py-1.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
          >
            Use as {displayPC(minor)} minor
          </button>
        </div>
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Tip: same notes, different tonal center. If the loop sounds bright, pick major;
          if it sounds darker or resolves to {displayPC(minor)}, pick minor.
        </p>
      </div>
    );
  }

  // ---- State 1: nothing yet → instructions --------------------------------
  return (
    <div className="mb-6 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-5">
      <p className="text-sm text-[var(--ink-soft)]">
        <span className="font-semibold text-[var(--ink)]">Find the key.</span> Mark an A/B
        loop on the player, then click piano keys below to find the note that matches
        what you hear. Once you settle on a root, pick a key to start finding chords.
      </p>
    </div>
  );
}
