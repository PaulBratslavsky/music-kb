// VideoNotesEditor — per-video freeform scratchpad ("Your notes") on the
// Summary tab. Tasks #41/#42 of docs/notes-section-plan.md.
//
// Two deliberate deviations from the plan doc (its "current state" predates
// the notes schema that actually shipped):
//
//   1. Persistence. The plan assumed a `notes: richtext` field on Video.
//      The schema that shipped models notes as rows on api::note.note
//      (many-to-many with Video), so the scratchpad persists as ONE
//      dedicated Note row per video — source 'manual', author 'scratchpad'
//      — driven entirely through the existing note CRUD server functions.
//      No new endpoints, and the scratchpad shows up in the Notes tab
//      alongside chat/MCP notes for free.
//
//   2. Current-time access. The plan specced an `onCurrentVideoTime` prop;
//      the player Module's documented idiom (components/player/index.tsx)
//      is that consumers read `usePlayerControl()` directly instead of
//      receiving player callbacks via props. We follow the Module.
//
// Autosave: 800ms debounce after the last editor update; saves are
// serialized so a debounce firing mid-save can't double-create the row.
// Emptying the editor deletes the row (the plan's "persist empty as null"
// rule mapped onto row-based storage — Strapi's `body` is required, and
// it keeps the Notes tab free of blank cards). Unmount and beforeunload
// flush pending edits best-effort.
//
// The Tiptap setup (StarterKit + Link + tiptap-markdown) intentionally
// mirrors MarkdownEditor.tsx so markdown round-trips identically. We don't
// reuse that component because the insert-timecode button needs the editor
// instance for cursor-position insertion, which MarkdownEditor doesn't
// expose — and v1 here wants a slim toolbar (timecode + save state), not
// the full formatting bar. StarterKit's input rules still give `#`, `-`,
// `**bold**` etc. while typing.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { usePlayerControl } from '#/components/player';
import {
  createNote,
  deleteNote,
  listNotesForVideo,
  updateNote,
} from '#/data/server-functions/notes';

type Props = {
  videoDocumentId: string;
};

// Marks the one Note row this editor owns. `author` is documented in the
// note schema as a free-form label, so 'scratchpad' distinguishes this row
// from other manual notes the user drafts via NoteComposer.
const SCRATCHPAD_AUTHOR = 'scratchpad';
const SCRATCHPAD_TITLE = 'Your notes';
const SAVE_DEBOUNCE_MS = 800;

type SaveState =
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function getMarkdown(ed: Editor): string {
  return (
    ed.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
}

export function VideoNotesEditor({ videoDocumentId }: Readonly<Props>) {
  // Reactive ~4Hz while playing — the whole learn layout already re-renders
  // on this signal, so subscribing here adds no new cost; it lets the
  // insert button show the live timecode like SectionTimecodeEditor does.
  const { currentSeconds, isReady } = usePlayerControl();

  const [save, setSave] = useState<SaveState>({ kind: 'loading' });
  const [isEmpty, setIsEmpty] = useState(true);

  // Autosave machinery lives in refs so the 4Hz re-renders and the async
  // save loop never tear it.
  const noteIdRef = useRef<string | null>(null); // documentId of our row, if any
  const lastSavedRef = useRef(''); // trimmed markdown last persisted ('' = no row)
  const latestRef = useRef(''); // markdown currently in the editor
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const dirtyAgainRef = useRef(false);

  // Serialized save: one runner at a time; edits landing mid-save mark
  // dirtyAgain and the loop re-checks before releasing the lock. This is
  // what prevents a double-create of the scratchpad row.
  const performSave = useCallback(async () => {
    if (savingRef.current) {
      dirtyAgainRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      do {
        dirtyAgainRef.current = false;
        const md = latestRef.current.trim();
        if (md === lastSavedRef.current) continue;
        setSave({ kind: 'saving' });
        try {
          if (md === '') {
            // Emptied — delete the row to keep the DB (and Notes tab) clean.
            if (noteIdRef.current) {
              const res = await deleteNote({
                data: { documentId: noteIdRef.current },
              });
              if (res.status === 'error') {
                setSave({ kind: 'error', message: res.error });
                break;
              }
              noteIdRef.current = null;
            }
            lastSavedRef.current = '';
            setSave({ kind: 'saved' });
          } else if (noteIdRef.current) {
            const res = await updateNote({
              data: { documentId: noteIdRef.current, body: md },
            });
            if (res.status === 'error') {
              setSave({ kind: 'error', message: res.error });
              break;
            }
            lastSavedRef.current = md;
            setSave({ kind: 'saved' });
          } else {
            const res = await createNote({
              data: {
                title: SCRATCHPAD_TITLE,
                body: md,
                source: 'manual',
                author: SCRATCHPAD_AUTHOR,
                videoDocumentIds: [videoDocumentId],
              },
            });
            if (res.status === 'error') {
              setSave({ kind: 'error', message: res.error });
              break;
            }
            noteIdRef.current = res.note.documentId;
            lastSavedRef.current = md;
            setSave({ kind: 'saved' });
          }
        } catch (err) {
          setSave({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Save failed',
          });
          break;
        }
      } while (dirtyAgainRef.current);
    } finally {
      savingRef.current = false;
    }
  }, [videoDocumentId]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void performSave();
    }, SAVE_DEBOUNCE_MS);
  }, [performSave]);

  // Fire any pending debounced save immediately. Best-effort on
  // beforeunload — the request is dispatched but the browser may not wait.
  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void performSave();
    }
  }, [performSave]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        tightListClass: 'tight',
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: '',
    // Stays read-only until the existing scratchpad row (if any) has
    // loaded — typing before that could fork a duplicate row.
    editable: false,
    editorProps: {
      attributes: {
        class: 'chat-md min-w-0 focus:outline-none',
        style: 'min-height: 140px; padding: 0.75rem 0.9rem;',
      },
    },
    onUpdate: ({ editor: ed }) => {
      latestRef.current = getMarkdown(ed);
      setIsEmpty(ed.isEmpty);
      scheduleSave();
    },
  });

  // Load the scratchpad row on mount (NotesPane-style self-fetch — the
  // route loader doesn't populate the video's notes relation). Re-runs
  // when the editor instance becomes available; the fetch is idempotent.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    void listNotesForVideo({ data: { videoDocumentId } }).then((res) => {
      if (cancelled) return;
      if (res.status === 'error') {
        setSave({ kind: 'error', message: res.error });
        return;
      }
      // List is sorted createdAt:desc — first match wins if duplicates
      // ever exist.
      const scratch =
        res.notes.find(
          (n) => n.source === 'manual' && n.author === SCRATCHPAD_AUTHOR,
        ) ?? null;
      if (scratch) {
        noteIdRef.current = scratch.documentId;
        lastSavedRef.current = scratch.body.trim();
        latestRef.current = scratch.body;
        editor.commands.setContent(scratch.body, { emitUpdate: false });
      }
      setIsEmpty(editor.isEmpty);
      editor.setEditable(true);
      setSave({ kind: 'idle' });
    });
    return () => {
      cancelled = true;
    };
  }, [editor, videoDocumentId]);

  // Flush pending edits when the tab closes or the component unmounts
  // (tab switch within the learn page unmounts this view).
  useEffect(() => {
    const onBeforeUnload = () => flush();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [flush]);

  const handleInsertTimecode = () => {
    if (!editor || !isReady) return;
    const tc = formatTimecode(currentSeconds);
    // Plain text — renders as a seekable chip wherever the note body is
    // displayed through TimecodeMarkdown (e.g. the Notes tab).
    editor.chain().focus().insertContent(`[${tc}] `).run();
  };

  const statusNode = (() => {
    switch (save.kind) {
      case 'loading':
        return <span className="text-[var(--ink-muted)]">Loading…</span>;
      case 'saving':
        return <span className="text-[var(--ink-muted)]">Saving…</span>;
      case 'saved':
        return <span className="text-[var(--ink-muted)]">Saved</span>;
      case 'error':
        return (
          <span className="text-destructive" title={save.message}>
            Couldn&apos;t save — retrying on next edit
          </span>
        );
      default:
        return null;
    }
  })();

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
        Your notes
      </h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        Freeform scratchpad for this video. Saves automatically and survives
        summary regeneration.
      </p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1.5">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep editor focus/selection
            onClick={handleInsertTimecode}
            disabled={!isReady || !editor || save.kind === 'loading'}
            title="Insert the current video time at the cursor"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 text-xs font-medium text-[var(--ink-soft)] transition hover:bg-[var(--ink)] hover:text-[var(--cream)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--card)] disabled:hover:text-[var(--ink-soft)]"
          >
            <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
              <path fill="currentColor" d="M4 2v12l9-6z" />
            </svg>
            {isReady
              ? `Insert [${formatTimecode(currentSeconds)}]`
              : 'Insert timecode'}
          </button>
          <span className="text-[0.7rem]" aria-live="polite">
            {statusNode}
          </span>
        </div>
        <div className="relative text-sm text-[var(--ink)]">
          {/* No CSS hook exists for Tiptap's data-placeholder attribute, so
              the empty-state hint is a pointer-transparent overlay aligned
              with the editor's padding. */}
          {isEmpty && save.kind !== 'loading' && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-[0.9rem] top-[0.75rem] text-sm text-[var(--ink-muted)]"
            >
              Jot your thoughts…
            </span>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
    </section>
  );
}
