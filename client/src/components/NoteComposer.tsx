// AI-assisted note composer.
//
// Two modes:
//   • create — empty editor; Generate produces a fresh note from a
//     prompt + video context, then subsequent Refine calls revise the
//     draft in place. Save persists via `createNote`.
//   • edit — existing note loaded; Refine revises the current body.
//     Save becomes Update (via `updateNote`). Delete removes the note.
//
// The active skill (from the in-code skill registry, filtered to
// `notes-composer` context) drives the model's output shape. "Note" is
// the default — standard study-note format. "Social Post" produces
// drafts. "Tutor" produces a first-person learning note. Skill switch
// is allowed at any time; the next Generate/Refine uses the new skill.
//
// Streaming: uses AG-UI-style SSE deltas from /api/notes/compose. The
// accumulating markdown is pushed into the MarkdownEditor live — the
// user watches the note assemble the same way chat streams.

import { useMemo, useRef, useState } from 'react';
import { ModelPicker } from '#/components/ModelPicker';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { MarkdownEditor } from './MarkdownEditor';
import { listSkills, type Skill } from '#/lib/skills';
import { createNote, updateNote, deleteNote } from '#/data/server-functions/notes';
import { friendlyStreamError } from '#/lib/services/chat-stream';
import type { StrapiNote } from '#/lib/services/notes';

type Props = {
  videoDocumentId: string;
  videoYoutubeId: string;
  existingNote?: StrapiNote;
  onClose: () => void;
  onSaved: () => void;
};

// Issue the compose request and yield text deltas. Wire framing +
// AG-UI parsing (including non-OK body extraction and RUN_ERROR
// translation) live in `chat-stream.ts`; this wrapper owns only the
// request shape for the note-composer endpoint.
async function compose(
  input: {
    videoId: string;
    prompt: string;
    currentContent?: string;
    skillSlug?: string;
    /** Choice TOKEN, not a model id — validated server-side. */
    modelChoice: string;
  },
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/notes/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  // The route returns JSON, not SSE: the composer never rendered deltas, so
  // there was nothing for a stream to deliver early. `error` carries a message
  // the server already translated with the tier that answered.
  const data = (await res.json().catch(() => null)) as
    | { markdown?: string; error?: string }
    | null;
  if (!res.ok || !data || typeof data.markdown !== 'string') {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data.markdown;
}

// Extract a markdown H1 title from the body, if present. Used on Save
// to populate the note's title field automatically. Leading whitespace
// + fences (```) are skipped.
function extractH1Title(markdown: string): string | null {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('```')) break; // bail if we hit a fence before a heading
    const m = /^#\s+(.+)$/.exec(trimmed);
    if (m) return m[1].trim().slice(0, 200);
    break; // first non-empty non-heading line — no title to extract
  }
  return null;
}

export function NoteComposer({
  videoDocumentId,
  videoYoutubeId,
  existingNote,
  onClose,
  onSaved,
}: Readonly<Props>) {
  const isEdit = !!existingNote;
  // Lets Cancel actually stop a run. Before this the button was disabled for
  // the whole generation, so a slow or wrong draft had to be waited out.
  const abortRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState('');
  // Per-compose model choice. 'default' preserves prior behaviour.
  const [modelChoice, setModelChoice] = useState<string>('default');
  const [body, setBody] = useState<string>(existingNote?.body ?? '');
  const [title, setTitle] = useState<string>(existingNote?.title ?? '');
  const [skillSlug, setSkillSlug] = useState<string>('note');
  const [streaming, setStreaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skills = useMemo<Skill[]>(() => listSkills('notes-composer'), []);
  const activeSkill = skills.find((s) => s.slug === skillSlug) ?? null;

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || streaming) return;
    setStreaming(true);
    setError(null);
    const hadContent = body.trim().length > 0;
    try {
      // The whole draft arrives at once. Partial markdown renders poorly in
      // Tiptap (half-formed headings, open code fences, mid-word italics) and
      // every setContent during streaming churned the editor state, so this
      // component always waited for the complete text before touching the
      // editor — which is why the endpoint no longer streams at all.
      const controller = new AbortController();
      abortRef.current = controller;
      const acc = await compose(
        {
          videoId: videoYoutubeId,
          prompt: trimmed,
          currentContent: hadContent ? body : undefined,
          skillSlug,
          modelChoice,
        },
        controller.signal,
      );
      setBody(acc);
      // Auto-set title from H1 if the user hasn't typed one.
      if (!title.trim()) {
        const h1 = extractH1Title(acc);
        if (h1) setTitle(h1);
      }
      // Keep the prompt so the user can edit + run again; they can
      // clear it manually if they want a fresh direction.
    } catch (err) {
      // A user-initiated abort is not a failure — say nothing and leave the
      // existing draft alone.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // Request failed (Ollama died, model missing, …) — surface the error
        // and leave the existing draft untouched: `acc` only reaches the
        // editor on success. Run failures arrive pre-translated by the model
        // that answered (stream-errors.ts); transport failures translate here.
        setError(friendlyStreamError(err, 'Compose failed'));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  const handleSave = async () => {
    if (saving || streaming) return;
    const bodyTrimmed = body.trim();
    if (!bodyTrimmed) {
      setError('Nothing to save yet — generate a draft first.');
      return;
    }
    setSaving(true);
    setError(null);
    const finalTitle = title.trim() || extractH1Title(bodyTrimmed) || '';
    try {
      if (isEdit && existingNote) {
        const res = await updateNote({
          data: {
            documentId: existingNote.documentId,
            title: finalTitle || undefined,
            body: bodyTrimmed,
          },
        });
        if (res.status !== 'ok') {
          setError(res.error);
          return;
        }
      } else {
        const res = await createNote({
          data: {
            title: finalTitle || undefined,
            body: bodyTrimmed,
            source: 'manual',
            author: 'you',
            videoDocumentIds: [videoDocumentId],
          },
        });
        if (res.status !== 'ok') {
          setError(res.error);
          return;
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingNote || deleting) return;
    if (!window.confirm('Delete this note?')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteNote({
        data: { documentId: existingNote.documentId },
      });
      if (res.status !== 'ok') {
        setError(res.error);
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const hasContent = body.trim().length > 0;
  const generateLabel = streaming
    ? hasContent
      ? 'Refining…'
      : 'Generating…'
    : hasContent
      ? 'Refine'
      : 'Generate';

  return (
    <div className="min-w-0 space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-wider text-[var(--ink-muted)]">
          <span>{isEdit ? 'Edit note' : 'New note'}</span>
        </div>
        <div className="flex items-center gap-2">
          <ModelPicker
            surface="note-compose"
            value={modelChoice}
            onChange={setModelChoice}
            disabled={streaming || saving || deleting}
          />
          {skills.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={streaming || saving || deleting}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] focus:outline-none focus:border-[var(--line-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                title={activeSkill?.description ?? 'Pick a note style'}
              >
                <span>{activeSkill?.name ?? 'Default'}</span>
                <svg
                  viewBox="0 0 20 20"
                  className="h-3 w-3 text-[var(--ink-muted)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[240px]">
                <DropdownMenuRadioGroup
                  value={skillSlug}
                  onValueChange={(next) => setSkillSlug(next)}
                >
                  {skills.map((skill) => (
                    <DropdownMenuRadioItem
                      key={skill.slug}
                      value={skill.slug}
                      className="flex flex-col items-start gap-0.5 px-2 py-1.5"
                    >
                      <span className="text-xs font-medium text-[var(--ink)]">
                        {skill.name}
                      </span>
                      {skill.description && (
                        <span className="text-[0.65rem] leading-snug text-[var(--ink-muted)]">
                          {skill.description}
                        </span>
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              // While generating, Cancel stops the run rather than being
              // disabled; otherwise it closes the composer as before.
              if (streaming) abortRef.current?.abort();
              else onClose();
            }}
            disabled={saving || deleting}
          >
            {streaming ? 'Stop' : 'Cancel'}
          </Button>
        </div>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (auto-filled from H1 when you generate)"
        disabled={streaming}
        className="w-full rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
      />

      <MarkdownEditor
        value={body}
        onChange={setBody}
        disabled={streaming}
        minHeight="260px"
        placeholder={
          hasContent
            ? 'Edit freely, or type a prompt below to refine with AI.'
            : 'Type a prompt below, then Generate — the draft streams in here.'
        }
      />

      <div className="flex items-stretch gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            hasContent
              ? 'What should change? e.g. "shorter", "add the chord diagrams", "make it a practice plan"'
              : 'What do you want in this note? e.g. "chord shapes and scales covered", "a 20-minute practice routine from this lesson", "ear-training exercises from the video"'
          }
          disabled={streaming || saving}
          rows={2}
          className="min-h-[3rem] flex-1 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
        />
        <Button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={streaming || saving || !prompt.trim()}
          className="self-stretch"
        >
          {generateLabel}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={streaming || saving || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={streaming || saving || !body.trim()}
          >
            {saving
              ? isEdit
                ? 'Updating…'
                : 'Saving…'
              : isEdit
                ? 'Update'
                : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
