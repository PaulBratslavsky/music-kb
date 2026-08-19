import { useEffect, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { QUALITY_LABELS } from '@music-kb/music/theory/quality-labels';
import {
  listProgressions,
  listProgressionsForVideo,
  saveProgression,
  deleteProgression,
} from '#/data/server-functions/progressions';
import type {
  StrapiProgression,
  ProgressionChord,
} from '#/lib/services/progressions';
import type { ChordQuality } from '@music-kb/music/types';
import { ChordMini } from '#/components/ChordMini';
import { ProgressionSheet } from '#/components/ProgressionSheet';
import { guitarVoicingCount } from '@music-kb/music/theory/voicings/guitar';
import { exportFretboardPng } from '#/lib/music/png-export';

// "Cmaj" / "Am" / "Fmaj7" — root glued to the short quality label. A
// detect-captured chord shows its tonal-detected name (e.g. "Em7/C") since
// root+quality is only a fallback for shapes that don't map to a quality.
function chordLabel(c: ProgressionChord): string {
  if (c.detectedLabel) return c.detectedLabel;
  return `${c.root}${QUALITY_LABELS[c.quality as ChordQuality] ?? c.quality}`;
}

// Suggested name when the user saves without typing one.
function defaultName(chords: ProgressionChord[]): string {
  const joined = chords.map(chordLabel).join(' ');
  return joined.length <= 60 ? joined : `${joined.slice(0, 57)}…`;
}

// Identity of a chord incl. its voicing — so the live edit-sync only writes
// when the builder actually changed the selected slot.
function chordKey(c: ProgressionChord): string {
  return `${c.root}|${c.quality}|${c.inversion ?? 0}|${c.voicingIndex ?? 0}|${(c.positions ?? []).join(',')}`;
}

// A detect-captured chord pins an exact shape (`positions`); its voicing
// can't be cycled and it isn't editable in the normal builder.
function isCustomShape(c: ProgressionChord): boolean {
  return Array.isArray(c.positions) && c.positions.length > 0;
}

type Props = {
  /** Current builder chord, or null when the builder isn't in chord mode. */
  currentChord: ProgressionChord | null;
  /** Re-select a saved chord (with its voicing) back into the builder. */
  onLoadChord: (chord: ProgressionChord) => void;
  /** Builder's active instrument — drives which diagram the chips show. */
  instrument: 'guitar' | 'piano';
  /** When set, saved progressions are scoped to (and created against) this
   *  music video; the saved list shows only that video's. Omit on /builder
   *  for standalone progressions. */
  videoDocumentId?: string;
};

// Builder-local chord progression: append the current chord, reorder/remove,
// and save the ordered list to the Strapi `progression` collection so it can
// be reloaded later. Distinct from the Theory → Compose tool (that's a
// scale-degree melody/bass sketchpad); this is just an ordered chord list.
export function ProgressionPanel({
  currentChord,
  onLoadChord,
  instrument,
  videoDocumentId,
}: Props) {
  const [chords, setChords] = useState<ProgressionChord[]>([]);
  const [name, setName] = useState('');
  // Inline rename of a saved row: the row being renamed + its draft name.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // documentId of the saved row currently loaded — Save updates it in place;
  // null means the working list is unsaved (Save creates a new row).
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<StrapiProgression[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Slot currently being edited in the builder, or null. While set, builder
  // chord changes (voicing/root/quality) write back to this slot live.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // Set on select so the FIRST sync after selecting (which fires with the
  // stale builder chord, before onLoadChord propagates) doesn't overwrite
  // the slot with the wrong chord.
  const skipNextSync = useRef(false);
  // Off-screen sheet (composed SVG of all chords) for PNG export.
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    const res = videoDocumentId
      ? await listProgressionsForVideo({ data: { videoDocumentId } })
      : await listProgressions();
    if (res.status === 'ok') setSaved(res.progressions);
  };
  useEffect(() => {
    void refresh();
    // Re-fetch when the scope (video) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDocumentId]);

  // Live edit-in-place: mirror the builder chord into the selected slot
  // whenever it changes.
  useEffect(() => {
    if (editingIndex === null) return;
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    if (!currentChord) return;
    setChords((cs) => {
      const target = cs[editingIndex];
      if (!target) return cs;
      // Don't clobber a custom (positions) shape with a non-detect chord —
      // e.g. if the builder leaves detect mode mid-edit (switches to piano).
      if (isCustomShape(target) && !isCustomShape(currentChord)) return cs;
      if (chordKey(target) === chordKey(currentChord)) return cs;
      const next = cs.slice();
      next[editingIndex] = currentChord;
      return next;
    });
  }, [currentChord, editingIndex]);

  // Click a chord card → edit it in place (load into builder, highlight).
  // Click the same card again to stop editing.
  const selectForEdit = (i: number) => {
    if (editingIndex === i) {
      setEditingIndex(null);
      return;
    }
    // onLoadChord routes by chord type: a custom detected shape reloads onto
    // the detect fretboard (re-tap to edit), a normal chord into chord mode.
    // Either way, edits mirror back into this slot via the live-sync effect.
    skipNextSync.current = true;
    setEditingIndex(i);
    onLoadChord(chords[i]);
  };

  const addCurrent = () => {
    if (!currentChord) return;
    setEditingIndex(null);
    setChords((cs) => [...cs, currentChord]);
    setMsg(null);
  };
  const removeAt = (i: number) => {
    setChords((cs) => cs.filter((_, j) => j !== i));
    setEditingIndex((cur) =>
      cur === null ? null : cur === i ? null : cur > i ? cur - 1 : cur,
    );
  };
  // Cycle a chord's voicing (its position/shape on the neck) in place. If the
  // chord is currently being edited in the builder, push the new voicing there
  // too so the big view stays in sync (skip the live-sync echo).
  const cycleVoicing = (i: number, dir: -1 | 1) => {
    const c = chords[i];
    if (isCustomShape(c)) return; // shape is fixed by its tapped positions
    const count = guitarVoicingCount(c);
    if (count <= 1) return;
    const v = (((c.voicingIndex ?? 0) + dir) % count + count) % count;
    const updated: ProgressionChord = { ...c, voicingIndex: v };
    setChords((cs) => cs.map((x, j) => (j === i ? updated : x)));
    if (i === editingIndex) {
      skipNextSync.current = true;
      onLoadChord(updated);
    }
  };
  const clearAll = () => {
    setChords([]);
    setName('');
    setLoadedId(null);
    setEditingIndex(null);
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
          videoDocumentId: videoDocumentId ?? null,
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
    setEditingIndex(null);
    setMsg(null);
  };

  const handleExport = async () => {
    const host = sheetRef.current;
    if (!host) return;
    const svg = host.querySelector('svg.instrument-svg') as SVGSVGElement | null;
    if (!svg) return;
    // Resolve theme CSS vars against the page's .theory-companion root.
    const themeRoot =
      (svg.closest('.theory-companion') as HTMLElement | null) ?? document.body;
    const base = (name.trim() || defaultName(chords)).replace(
      /[^A-Za-z0-9#°+ -]/g,
      '',
    );
    await exportFretboardPng({
      svg,
      themeRoot,
      filename: `${base || 'progression'}-${instrument}.png`,
      cropToShape: false,
    });
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

  const startRename = (p: StrapiProgression) => {
    setRenamingId(p.documentId);
    setRenameValue(p.name);
  };
  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };
  // Rename a saved progression in place — re-saves the same chords under the
  // new name (saveProgression with a documentId updates the row).
  const commitRename = async (p: StrapiProgression) => {
    const newName = renameValue.trim();
    if (!newName || newName === p.name) {
      cancelRename();
      return;
    }
    setBusy(true);
    try {
      const res = await saveProgression({
        data: {
          documentId: p.documentId,
          name: newName,
          chords: p.chords,
          videoDocumentId: videoDocumentId ?? null,
        },
      });
      if (res.status === 'error') {
        setMsg(res.error);
        return;
      }
      if (loadedId === p.documentId) setName(newName);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      setBusy(false);
      cancelRename();
    }
  };

  return (
    <section className="panel mt-4">
      <h2 className="panel-title">Chord progression</h2>

      {/* Working list — one diagram card per chord, 4 per row */}
      {chords.length === 0 && (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          No chords yet — pick a chord above, then “Add chord”.
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">

        {chords.map((c, i) => (
          <div
            key={`${c.root}-${c.quality}-${c.voicingIndex ?? 0}-${i}`}
            className={`relative flex flex-col items-center gap-1 rounded-xl border bg-[var(--bg-subtle)] p-2 ${
              editingIndex === i
                ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                : 'border-[var(--line)]'
            }`}
          >
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--card)] hover:text-[var(--ink)]"
              aria-label={`Remove ${chordLabel(c)}`}
              title="Remove chord"
            >
              ×
            </button>
            <button
              type="button"
              onClick={() => selectForEdit(i)}
              className="rounded-lg transition hover:opacity-80"
              title={
                editingIndex === i
                  ? isCustomShape(c)
                    ? 'Editing — re-tap the fretboard to change this shape; click to stop'
                    : 'Editing — change voicing or chord in the builder; click to stop'
                  : isCustomShape(c)
                    ? 'Edit this detected shape: loads onto the detect fretboard to re-tap'
                    : 'Edit this chord: load it into the builder, then tweak its voicing or change the chord'
              }
            >
              <ChordMini chord={c} instrument={instrument} orientation="horizontal" />
            </button>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => cycleVoicing(i, -1)}
                disabled={isCustomShape(c) || guitarVoicingCount(c) <= 1}
                className="rounded px-1 text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-30"
                aria-label={`Lower fret position for ${chordLabel(c)}`}
                title="Lower position / previous voicing"
              >
                ‹
              </button>
              <span className="px-1 text-sm font-medium text-[var(--ink)]">
                {chordLabel(c)}
              </span>
              <button
                type="button"
                onClick={() => cycleVoicing(i, 1)}
                disabled={isCustomShape(c) || guitarVoicingCount(c) <= 1}
                className="rounded px-1 text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-30"
                aria-label={`Higher fret position for ${chordLabel(c)}`}
                title="Higher position / next voicing"
              >
                ›
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Editing hint */}
      {editingIndex !== null && (
        <p className="mt-3 text-xs text-[var(--accent)]">
          Editing chord {editingIndex + 1} — change its voicing or pick a
          different chord above; it updates in place.{' '}
          <button
            type="button"
            onClick={() => setEditingIndex(null)}
            className="underline underline-offset-2 hover:no-underline"
          >
            Done
          </button>
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="pill"
          onClick={addCurrent}
          disabled={!currentChord}
          title={
            editingIndex !== null
              ? 'Append the current chord as a NEW chord (stops editing)'
              : currentChord
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
        {chords.length > 0 && (
          <Button
            type="button"
            size="pill"
            variant="outline"
            onClick={() => void handleExport()}
            title="Export all chord diagrams as a single PNG"
          >
            ⬇ Export chords
          </Button>
        )}
        <div className="flex-1" />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this progression…"
          title={
            chords.length > 0
              ? `Leave blank to auto-name it "${defaultName(chords)}"`
              : 'Give this progression a name'
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
                {renamingId === p.documentId ? (
                  <>
                    <input
                      type="text"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(p);
                        if (e.key === 'Escape') cancelRename();
                      }}
                      maxLength={100}
                      className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--ink)]"
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename(p)}
                      disabled={busy}
                      className="rounded px-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      className="rounded px-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
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
                      onClick={() => startRename(p)}
                      disabled={busy}
                      className="rounded px-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      title="Rename this saved progression"
                    >
                      Rename
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
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Off-screen composed sheet — the export source. Positioned out of
          view but still laid out so getBoundingClientRect / CSS vars resolve. */}
      <div
        ref={sheetRef}
        aria-hidden
        className="pointer-events-none absolute -left-[99999px] top-0 opacity-0"
      >
        <ProgressionSheet chords={chords} instrument={instrument} />
      </div>
    </section>
  );
}
