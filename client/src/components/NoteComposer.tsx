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

import { useMemo, useState } from 'react';
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
import type { StrapiNote } from '#/lib/services/notes';

type Props = {
  videoDocumentId: string;
  videoYoutubeId: string;
  existingNote?: StrapiNote;
  onClose: () => void;
  onSaved: () => void;
};

async function* streamCompose(input: {
  videoId: string;
  prompt: string;
  currentContent?: string;
  skillSlug?: string;
}): AsyncGenerator<string, void, void> {
  const res = await fetch('/api/notes/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`compose failed (${res.status}): ${text || 'request failed'}`);
  }
  if (!res.body) throw new Error('compose: empty body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE: events are separated by blank lines. `data: <json>\n\n`.
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');
      if (!frame.startsWith('data:')) continue;
      const payload = frame.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const ev = JSON.parse(payload) as { type?: string; delta?: string };
        if (ev.type === 'TEXT_MESSAGE_CONTENT' && ev.delta) {
          yield ev.delta;
        }
      } catch {
        // Non-JSON frame (run-start/end/etc.) — ignore.
      }
    }
  }
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
  const [prompt, setPrompt] = useState('');
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
      // Consume the full stream before touching the editor. Partial
      // markdown renders poorly in Tiptap (half-formed headings, open
      // code fences, mid-word italics) and every `setContent` during
      // streaming churns the editor state. For note generation the user
      // waits a few seconds then sees the complete draft — cleaner than
      // watching tokens assemble imperfectly.
      let acc = '';
      for await (const delta of streamCompose({
        videoId: videoYoutubeId,
        prompt: trimmed,
        currentContent: hadContent ? body : undefined,
        skillSlug,
      })) {
        acc += delta;
      }
      setBody(acc);
      // Auto-set title from H1 if the user hasn't typed one.
      if (!title.trim()) {
        const h1 = extractH1Title(acc);
        if (h1) setTitle(h1);
      }
      // Keep the prompt so the user can edit + run again; they can
      // clear it manually if they want a fresh direction.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compose failed');
    } finally {
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
            onClick={onClose}
            disabled={streaming || saving || deleting}
          >
            Cancel
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
