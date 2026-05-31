// SaveLoopButton — minimal "save the current A/B section" flow for the
// music video page. Reads loopStart / loopEnd from PlayerControl,
// disabled when the user hasn't marked a section yet. On click,
// inline-prompts for a label and saves to Strapi via the existing
// saveLoop server fn.
//
// Unlike /learn's LoopBuilder, this doesn't require a candidate key
// or chord progression — those default to null / empty so the user can
// snapshot a section first and tag musical content later. The Saved
// loops list refetches via the refreshKey bump.

import { useState } from 'react';
import { Button } from '#/components/ui/button';
import { usePlayerControl } from '#/components/player';
import { saveLoop as saveLoopServerFn } from '#/data/server-functions/loops';
import type { SaveLoopResult } from '#/data/server-functions/loops';

type SaveLoopButtonProps = {
  videoDocumentId: string;
  onSaved: () => void;
};

export function SaveLoopButton({
  videoDocumentId,
  onSaved,
}: SaveLoopButtonProps) {
  const { loopStartSec, loopEndSec } = usePlayerControl();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave =
    loopEndSec != null && loopEndSec > (loopStartSec ?? 0);

  const reset = () => {
    setOpen(false);
    setLabel('');
    setError(null);
  };

  const submit = async () => {
    if (!canSave) return;
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Give the loop a label');
      return;
    }
    setSaving(true);
    setError(null);
    // Server-fn return type widens to unknown in this codebase; narrow
    // back to the declared shape so we can read .status / .error.
    const res = (await saveLoopServerFn({
      data: {
        videoDocumentId,
        label: trimmed,
        startSec: loopStartSec ?? 0,
        endSec: loopEndSec!,
        // Music-page save is section-only. Key + progression can be
        // added later via /learn's LoopBuilder if the user wants to
        // tag the chord content. Strapi schema accepts null/empty.
        key: null,
        progression: [],
        bpm: null,
        notes: null,
      },
    })) as SaveLoopResult;
    setSaving(false);
    if (res.status === 'error') {
      setError(res.error);
      return;
    }
    reset();
    onSaved();
  };

  if (!open) {
    return (
      <Button
        type="button"
        size="pill"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!canSave}
        title={
          canSave
            ? 'Save the current A/B section as a named loop'
            : 'Mark a section first with the A/B controls under the player'
        }
      >
        + Save loop
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-3">
      <label className="grid gap-1 text-xs">
        <span className="font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Loop label
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoFocus
          placeholder="e.g. Verse 1, Solo, Chorus"
          maxLength={120}
          className="rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') reset();
          }}
        />
      </label>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="pill"
          variant="outline"
          onClick={reset}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="pill"
          onClick={submit}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
