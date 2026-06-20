import { useEffect, useState } from 'react';
import { Button } from '#/components/ui/button';
import { QUALITY_LABELS } from '#/lib/music/theory/quality-labels';
import {
  listProgressions,
  saveProgression,
  deleteProgression,
} from '#/data/server-functions/progressions';
import type {
  StrapiProgression,
  ProgressionChord,
} from '#/lib/services/progressions';
import type { ChordQuality } from '#/lib/music/types';
import { ChordMini } from '#/components/ChordMini';

// "Cmaj" / "Am" / "Fmaj7" — root glued to the short quality label.
function chordLabel(c: ProgressionChord): string {
  return `${c.root}${QUALITY_LABELS[c.quality as ChordQuality] ?? c.quality}`;
}

// Suggested name when the user saves without typing one.
function defaultName(chords: ProgressionChord[]): string {
  const joined = chords.map(chordLabel).join(' ');
  return joined.length <= 60 ? joined : `${joined.slice(0, 57)}…`;
}

type Props = {
  /** Current builder chord, or null when the builder isn't in chord mode. */
  currentChord: ProgressionChord | null;
  /** Re-select a saved chord (with its voicing) back into the builder. */
  onLoadChord: (chord: ProgressionChord) => void;
  /** Builder's active instrument — drives which diagram the chips show. */
  instrument: 'guitar' | 'piano';
};

// Builder-local chord progression: append the current chord, reorder/remove,
// and save the ordered list to the Strapi `progression` collection so it can
// be reloaded later. Distinct from the Theory → Compose tool (that's a
// scale-degree melody/bass sketchpad); this is just an ordered chord list.
export function ProgressionPanel({ currentChord, onLoadChord, instrument }: Props) {
  const [chords, setChords] = useState<ProgressionChord[]>([]);
  const [name, setName] = useState('');
  // documentId of the saved row currently loaded — Save updates it in place;
  // null means the working list is unsaved (Save creates a new row).
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<StrapiProgression[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    const res = await listProgressions();
    if (res.status === 'ok') setSaved(res.progressions);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const addCurrent = () => {
    if (!currentChord) return;
    setChords((cs) => [...cs, currentChord]);
    setMsg(null);
  };
  const removeAt = (i: number) =>
    setChords((cs) => cs.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) =>
    setChords((cs) => {
      const j = i + dir;
      if (j < 0 || j >= cs.length) return cs;
      const next = cs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const clearAll = () => {
    setChords([]);
    setName('');
    setLoadedId(null);
    setMsg(null);
  };

  const handleSave = async (asNew: boolean) => {
    if (chords.length === 0) {
      setMsg('Add at least one chord first.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveProgression({
        data: {
          documentId: asNew ? null : loadedId,
          name: name.trim() || defaultName(chords),
          chords,
        },
      });
      if (res.status === 'error') {
        setMsg(res.error);
        return;
      }
      setLoadedId(res.progression.documentId);
      setName(res.progression.name);
      setMsg('Saved.');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = (p: StrapiProgression) => {
    setChords(p.chords);
    setName(p.name);
    setLoadedId(p.documentId);
    setMsg(null);
  };

  const handleDelete = async (p: StrapiProgression) => {
    setBusy(true);
    try {
      await deleteProgression({ data: { documentId: p.documentId } });
      if (loadedId === p.documentId) clearAll();
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel mt-4">
      <h2 className="panel-title">Chord progression</h2>

      {/* Working list — one diagram card per chord */}
      <div className="mt-3 flex flex-wrap gap-3">
        {chords.length === 0 && (
          <span className="text-sm text-[var(--ink-muted)]">
            No chords yet — pick a chord above, then “Add chord”.
          </span>
        )}
        {chords.map((c, i) => (
          <div
            key={`${c.root}-${c.quality}-${c.voicingIndex ?? 0}-${i}`}
            className="flex flex-col items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-2"
          >
            <button
              type="button"
              onClick={() => onLoadChord(c)}
              className="rounded-lg transition hover:opacity-80"
              title="Load this chord (and its voicing) back into the builder"
            >
              <ChordMini chord={c} instrument={instrument} />
            </button>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded px-1 text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-30"
                aria-label={`Move ${chordLabel(c)} left`}
                title="Move left"
              >
                ‹
              </button>
              <span className="px-1 text-sm font-medium text-[var(--ink)]">
                {chordLabel(c)}
              </span>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === chords.length - 1}
                className="rounded px-1 text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-30"
                aria-label={`Move ${chordLabel(c)} right`}
                title="Move right"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="ml-0.5 rounded-full px-1 text-[var(--ink-muted)] hover:bg-[var(--card)] hover:text-[var(--ink)]"
                aria-label={`Remove ${chordLabel(c)}`}
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="pill"
          onClick={addCurrent}
          disabled={!currentChord}
          title={
            currentChord
              ? 'Append the current chord to the progression'
              : 'Switch the builder to Chord mode to add a chord'
          }
        >
          + Add chord
        </Button>
        {chords.length > 0 && (
          <Button type="button" size="pill" variant="outline" onClick={clearAll}>
            Clear
          </Button>
        )}
        <div className="flex-1" />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            chords.length > 0 ? defaultName(chords) : 'Progression name'
          }
          maxLength={100}
          className="min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--ink)] sm:flex-none sm:basis-56"
        />
        <Button
          type="button"
          size="pill"
          onClick={() => void handleSave(false)}
          disabled={busy || chords.length === 0}
        >
          {loadedId ? 'Save' : 'Save progression'}
        </Button>
        {loadedId && (
          <Button
            type="button"
            size="pill"
            variant="outline"
            onClick={() => void handleSave(true)}
            disabled={busy || chords.length === 0}
            title="Save as a new progression instead of overwriting"
          >
            Save as new
          </Button>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-[var(--ink-muted)]">{msg}</p>}

      {/* Saved list */}
      {saved.length > 0 && (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Saved progressions
          </h3>
          <ul className="flex flex-col gap-1">
            {saved.map((p) => (
              <li
                key={p.documentId}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  p.documentId === loadedId
                    ? 'bg-[var(--bg-subtle)]'
                    : 'hover:bg-[var(--bg-subtle)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleLoad(p)}
                  className="min-w-0 flex-1 text-left"
                  title="Load this progression"
                >
                  <span className="font-medium text-[var(--ink)]">{p.name}</span>
                  <span className="ml-2 text-xs text-[var(--ink-muted)]">
                    {Array.isArray(p.chords)
                      ? p.chords.map(chordLabel).join(' ')
                      : ''}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(p)}
                  disabled={busy}
                  className="rounded px-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--danger,#c0392b)]"
                  title="Delete this saved progression"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
