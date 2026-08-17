// The chord progression attached to ONE saved loop (a song section).
//
// Read-only by design. Chords are built and named in the Chord Progression
// panel below the player; a section does not own its own chord list, it
// LINKS to a saved progression. That way the same progression can back
// several sections (verse 1 / verse 2) and editing it in one place updates
// them all — and there is exactly one surface for building chords.
//
// This is only the PICKER — which saved progression this section uses. The
// shapes themselves render under the player in SectionChordStrip, where
// there is room for them and where you are actually looking while playing
// along; duplicating them in this narrow column just made the list long.

import { useCallback, useEffect, useState } from 'react';
import { updateLoop } from '#/data/server-functions/loops';
import { listProgressionsForVideo } from '#/data/server-functions/progressions';
import type { ChordStep } from '#/components/practice/useProgressionPlayback';
import { PITCH_CLASSES, type ChordQuality, type PitchClass } from '#/lib/music/types';
import { QUALITY_LABELS } from '#/lib/music/theory/quality-labels';
import type { StrapiLoopProgression } from '#/lib/services/loops';
import type { ProgressionChord } from '#/lib/services/progressions';

type SavedProgression = {
  documentId: string;
  name: string;
  chords: ProgressionChord[] | null;
};

const isPitchClass = (v: unknown): v is PitchClass =>
  typeof v === 'string' && (PITCH_CLASSES as readonly string[]).includes(v);

/** Stored chord list → playable / displayable steps. */
function toSteps(chords: SavedProgression['chords']): ChordStep[] {
  if (!Array.isArray(chords)) return [];
  return chords.flatMap((c) => {
    if (!isPitchClass(c.root)) return [];
    const quality = (c.quality || 'maj') as ChordQuality;
    return [
      {
        root: c.root,
        quality,
        chordName: `${c.root}${
          quality === 'maj' ? '' : (QUALITY_LABELS[quality] ?? quality)
        }`,
      },
    ];
  });
}

export function LoopProgressionView({
  loopDocumentId,
  videoDocumentId,
  linked,
  onLinkChange,
}: {
  loopDocumentId: string;
  videoDocumentId: string;
  /** Currently linked progression, as populated on the loop. */
  linked: StrapiLoopProgression | null;
  onLinkChange?: (next: StrapiLoopProgression | null) => void;
}) {
  const [options, setOptions] = useState<SavedProgression[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Only this video's saved progressions — a section of one song should not
  // offer progressions saved against a different track.
  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await listProgressionsForVideo({ data: { videoDocumentId } });
      const res = raw as {
        status: 'ok' | 'error';
        progressions?: SavedProgression[];
      };
      const next = res.status === 'ok' ? (res.progressions ?? []) : [];
      setOptions(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [videoDocumentId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  /**
   * Re-read the list as the dropdown opens. Renames, saves and deletes all
   * happen in the Chord Progression panel, which has no channel back to
   * here — without this the options keep whatever names they had when the
   * section was first expanded.
   */
  const refreshOnOpen = () => {
    void loadOptions().then((next) => {
      if (!linked) return;
      const fresh = next.find((o) => o.documentId === linked.documentId);
      // Renamed or deleted elsewhere — reflect it rather than showing a
      // name that no longer exists.
      if (!fresh) onLinkChange?.(null);
      else if (fresh.name !== linked.name) {
        onLinkChange?.({ ...linked, name: fresh.name, chords: fresh.chords });
      }
    });
  };

  const steps = toSteps(linked?.chords ?? null);

  const link = (documentId: string | null) => {
    setSaving(true);
    void updateLoop({ data: { documentId: loopDocumentId, savedProgression: documentId } })
      .then((raw) => {
        const res = raw as {
          status: 'ok' | 'error';
          loop?: { savedProgression?: StrapiLoopProgression | null };
        };
        if (res.status !== 'ok') return;
        const next = options.find((o) => o.documentId === documentId) ?? null;
        onLinkChange?.(
          next
            ? { id: 0, documentId: next.documentId, name: next.name, chords: next.chords }
            : null,
        );
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-1.5 rounded-md border border-[var(--accent)] bg-[var(--card)] p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Progression
        </span>
        <select
          value={linked?.documentId ?? ''}
          disabled={saving}
          onFocus={refreshOnOpen}
          onMouseDown={refreshOnOpen}
          onChange={(e) => link(e.target.value || null)}
          aria-label="Progression for this section"
          className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-0.5 text-xs text-[var(--ink)]"
        >
          <option value="">
            {loading ? 'loading…' : '— none —'}
          </option>
          {options.map((o) => (
            <option key={o.documentId} value={o.documentId}>
              {o.name}
            </option>
          ))}
        </select>
        {saving && (
          <span className="text-[0.65rem] text-[var(--ink-muted)]">saving…</span>
        )}
      </div>

      <p className="mt-1.5 text-[0.7rem] text-[var(--ink-soft)]">
        {steps.length === 0
          ? options.length === 0
            ? 'No saved progressions for this song yet — build one in the Chord Progression panel below the player, name it, and save.'
            : 'Pick a saved progression to attach it to this section.'
          : steps.map((s) => s.chordName).join(' · ')}
      </p>
    </div>
  );
}
