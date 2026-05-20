import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildMarkdownComponents } from './TimecodeMarkdown';
import { NoteComposer } from './NoteComposer';
import { Button } from '#/components/ui/button';
import {
  deleteNote,
  listNotesForVideo,
  type ListNotesResult,
} from '#/data/server-functions/notes';
import type { StrapiNote } from '#/lib/services/notes';

type Props = {
  videoDocumentId: string;
  /** YouTube video id — needed by the AI note composer, which POSTs to
   * /api/notes/compose (the endpoint resolves videos by YouTube id
   * like the chat routes). */
  videoYoutubeId: string;
  /** Bumped by the parent (e.g. after VideoChat saves a note) to force
   * a refetch so the new note appears without a page reload. */
  refreshKey?: number;
};

// Composer state: either hidden, composing a fresh note, or editing one.
type ComposerState =
  | { kind: 'hidden' }
  | { kind: 'new' }
  | { kind: 'edit'; note: StrapiNote };

const SOURCE_LABEL: Record<StrapiNote['source'], string> = {
  chat: 'Chat',
  'digest-chat': 'Digest chat',
  mcp: 'MCP',
  manual: 'Manual',
};

const SOURCE_BADGE: Record<StrapiNote['source'], string> = {
  chat: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  'digest-chat':
    'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400',
  mcp: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  manual: 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotesPane({
  videoDocumentId,
  videoYoutubeId,
  refreshKey = 0,
}: Readonly<Props>) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; notes: StrapiNote[] }
    | { kind: 'error'; error: string }
  >({ kind: 'loading' });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState>({ kind: 'hidden' });

  const load = useCallback(async () => {
    const res: ListNotesResult = await listNotesForVideo({
      data: { videoDocumentId },
    });
    if (res.status === 'error') {
      setState({ kind: 'error', error: res.error });
      return;
    }
    setState({ kind: 'ready', notes: res.notes });
  }, [videoDocumentId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleDelete = async (documentId: string) => {
    if (!window.confirm('Delete this note?')) return;
    setDeletingId(documentId);
    const res = await deleteNote({ data: { documentId } });
    setDeletingId(null);
    if (res.status === 'ok') await load();
  };

  // Composer-open path is the same in loading/empty/ready states —
  // render the composer above whatever list (or empty state) we have.
  const composerNode =
    composer.kind === 'new' ? (
      <NoteComposer
        key="new"
        videoDocumentId={videoDocumentId}
        videoYoutubeId={videoYoutubeId}
        onClose={() => setComposer({ kind: 'hidden' })}
        onSaved={() => void load()}
      />
    ) : composer.kind === 'edit' ? (
      <NoteComposer
        key={`edit-${composer.note.documentId}`}
        videoDocumentId={videoDocumentId}
        videoYoutubeId={videoYoutubeId}
        existingNote={composer.note}
        onClose={() => setComposer({ kind: 'hidden' })}
        onSaved={() => void load()}
      />
    ) : null;

  const newNoteButton =
    composer.kind === 'hidden' ? (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => setComposer({ kind: 'new' })}
        >
          New note
        </Button>
      </div>
    ) : null;

  if (state.kind === 'loading') {
    return (
      <div className="grid gap-4">
        {newNoteButton}
        {composerNode}
        <div className="py-10 text-center text-sm text-[var(--ink-muted)]">
          Loading notes…
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="grid gap-4">
        {newNoteButton}
        {composerNode}
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn&apos;t load notes: {state.error}
        </div>
      </div>
    );
  }

  if (state.notes.length === 0) {
    return (
      <div className="grid gap-4">
        {newNoteButton}
        {composerNode}
        {composer.kind === 'hidden' && (
          <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-center">
            <p className="text-sm text-[var(--ink)]">No notes yet.</p>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              Click <span className="font-medium">New note</span> to draft one
              with AI assistance, or use{' '}
              <span className="font-medium">Summarize to note</span> in the
              chat. Notes written from Claude Desktop via MCP also show up
              here.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {newNoteButton}
      {composerNode}
      {state.notes.map((note) => (
        <NoteCard
          key={note.documentId}
          note={note}
          onDelete={() => void handleDelete(note.documentId)}
          onEdit={() => setComposer({ kind: 'edit', note })}
          deleting={deletingId === note.documentId}
          isEditing={composer.kind === 'edit' && composer.note.documentId === note.documentId}
        />
      ))}
    </div>
  );
}

function NoteCard({
  note,
  onDelete,
  onEdit,
  deleting,
  isEditing,
}: Readonly<{
  note: StrapiNote;
  onDelete: () => void;
  onEdit: () => void;
  deleting: boolean;
  isEditing: boolean;
}>) {
  const markdownComponents = buildMarkdownComponents();
  // Dim the card when it's being edited in the composer above — the
  // composer is the live draft; this card is the snapshot pre-edit.
  return (
    <article
      className={`min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 ${isEditing ? 'opacity-50' : ''}`}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {note.title && (
            <h3 className="text-base font-semibold text-[var(--ink)]">
              {note.title}
            </h3>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.65rem] text-[var(--ink-muted)]">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${SOURCE_BADGE[note.source]}`}
            >
              {SOURCE_LABEL[note.source]}
            </span>
            <span>{formatDate(note.createdAt)}</span>
            {note.author && <span>· {note.author}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            disabled={deleting || isEditing}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={deleting || isEditing}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </header>
      {/* Use the shared chat-md styles (see styles.css) for consistency
          with the chat bubble rendering — subtle code blocks with
          overflow-x: auto, sensible heading sizes, no dark-prose
          surprises. `min-w-0` on the article above lets `<pre>`'s
          internal scroll engage instead of pushing the column. */}
      <div className="chat-md min-w-0 text-sm text-[var(--ink)]">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {note.body}
        </ReactMarkdown>
      </div>
    </article>
  );
}
