# Notes section — plan

Per-video freeform notes on the learn page. Rich-text editing via Tiptap, persisted as markdown in Strapi, autosaved on change.

Status: **shipped** (2026-06-12). Tasks #41 and #42 are implemented — `client/src/components/VideoNotesEditor.tsx`, mounted in `routes/learn.$videoId.tsx` on the Summary tab between the Action Steps section and the generation-mode footer.

Implementation notes — where the shipped code deviates from the plan below (the plan's "current state" predated the notes schema that actually landed):

- **Persistence is a Note row, not a Video field.** `video.notes` shipped as a many-to-many relation to `api::note.note` (there is no `notes: richtext` field on Video, and `updateVideoNotesService` was never built). The scratchpad persists as one dedicated Note row per video — `source: 'manual'`, `author: 'scratchpad'`, title "Your notes" — through the existing note CRUD server functions (`listNotesForVideo` / `createNote` / `updateNote` / `deleteNote`). No new endpoints or schema changes. Bonus: the scratchpad shows up in the Notes tab alongside chat/MCP notes, rendered with timecode chips via `TimecodeMarkdown`.
- **"Persist empty as null" became "delete the row"** — `body` is required on the note schema, and an empty scratchpad shouldn't leave a blank card in the Notes tab.
- **No new dependencies.** `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, and `tiptap-markdown` were already in `client/package.json` (used by `MarkdownEditor.tsx`). `@tiptap/extension-placeholder` was not added — the placeholder is a CSS overlay inside the component instead.
- **Current-time access uses `usePlayerControl()`** (the player Module's documented consumer idiom) instead of the `onCurrentVideoTime` prop specced below; the only prop is `videoDocumentId`.
- Autosave (800ms debounce, serialized saves, idle/saving/saved/error indicator), the insert-timecode toolbar button, and the unmount/`beforeunload` flush shipped as specced.
- One caveat vs. the test plan: tiptap-markdown's serializer escapes square brackets, so the stored markdown may contain `\[01:23\]` rather than the literal `[01:23]`; react-markdown unescapes on render, so timecode chips still work.

---

## Goal

Let the user jot their own thoughts against a video — quotes they want to remember, links to related content, personal commentary — without leaving the learn page. Notes are free-form markdown, not structured like sections/takeaways. They survive regeneration (unlike AI summary fields).

## Why markdown, not JSON/HTML

- Markdown survives a Tiptap swap (switch editors without a migration).
- Trivial to render with the existing `TimecodeMarkdown` component (same `[mm:ss]` chip treatment as the AI summary — so "jump to" still works on user-written notes).
- Portable: export the whole Strapi DB → usable notes in any markdown viewer.
- Tiptap's `tiptap-markdown` extension round-trips markdown ↔ ProseMirror cleanly.

## Current state

**Done:**
- `notes: richtext` field on `api::video.video` schema (`server/src/api/video/content-types/video/schema.json`).
- `updateVideoNotesService({ documentId, notes })` in `client/src/lib/services/videos.ts`.
- `updateVideoNotes` server function in `client/src/data/server-functions/videos.ts`.
- `notes: string | null` on `StrapiVideo` type; populated by default detail query.

**Pending:**
- Task #41 — `VideoNotesEditor` component (Tiptap + tiptap-markdown).
- Task #42 — integration into `routes/learn.$videoId.tsx` below the summary block.

## Proposed implementation

### 1. Dependencies

```bash
yarn --cwd client add @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder tiptap-markdown
```

No custom Tiptap extensions yet — StarterKit + Placeholder + Markdown is enough for v1.

### 2. `VideoNotesEditor` component

Location: `client/src/components/VideoNotesEditor.tsx`.

Props:
```ts
type Props = {
  documentId: string;
  initialMarkdown: string | null;
  onCurrentVideoTime?: () => number | null;  // pulled from YouTube IFrame, same pattern as SectionTimecodeEditor
};
```

Responsibilities:
- Instantiate Tiptap editor with `StarterKit`, `Placeholder` ("Jot your thoughts…"), `Markdown`.
- Read `initialMarkdown` into the editor on mount via `editor.commands.setContent(md)`.
- On every `editor.on('update')`, debounce 800ms → call `updateVideoNotes({ documentId, notes: editor.storage.markdown.getMarkdown() })`.
- Show a small saved/saving indicator in the corner (state machine: `idle | saving | saved | error`).
- **Insert-timecode toolbar button**: when `onCurrentVideoTime` returns a number, insert `[mm:ss]` at the cursor position as plain text. Renders as a chip when the note is displayed (via `TimecodeMarkdown`, if we later add read-only view mode — for v1 the editor itself doesn't need to render chips).

Edge cases:
- Empty string vs null: persist empty string as `null` to keep the DB clean.
- Rapid regeneration triggers: the notes field is never overwritten by `generateVideoSummary`, so no conflict.
- Tab switch mid-save: `beforeunload` should flush pending saves (wrap the debounced fn with `flush()` and call it on unload).

### 3. Learn-page integration

In `routes/learn.$videoId.tsx`, inside `SummaryView`:

- Render `<VideoNotesEditor>` in a new section below the summary footer (Action Steps section) and above the chat block.
- Title: "Your notes".
- Pass `documentId={video.documentId}`, `initialMarkdown={video.notes}`, `onCurrentVideoTime={getCurrentVideoTime}` where `getCurrentVideoTime` reuses the IFrame-postMessage pattern from `SectionTimecodeEditor`.

### 4. Styling

Match the existing card style (`border border-[var(--line)] bg-[var(--card)] rounded-2xl p-4`). Tiptap content area uses `prose prose-sm` via Tailwind Typography — verify Typography is already enabled in `tailwind.config` (it should be; summary bodies use it).

## Open questions

1. **Do notes render with timecode chips?** In v1 the editor is always-edit; no separate view mode. Skip chip rendering for now. Revisit if users ask for a read-only print view.
2. **Full-screen / focus mode?** Out of scope for v1.
3. **Per-note tags?** Out of scope — global per-video tags already exist.
4. **Note history / versioning?** Out of scope; Strapi's built-in revisions are sufficient.

## Test plan

- Paste markdown with a link, bold, and a bullet list → reload → content round-trips intact.
- Type → stop typing → wait 1s → verify `notes` field in Strapi admin is updated.
- Insert `[mm:ss]` via the toolbar → the raw markdown contains the literal `[01:23]` string.
- Regenerate summary → notes field is untouched after regeneration completes.
- Close tab mid-edit → reload → last-flushed state is present (beforeunload flush works).

## Non-goals

- Collaborative editing (single-user app).
- Image uploads in notes (not worth the Strapi asset-handling for v1).
- Exporting notes to markdown file (use Strapi admin export).
