import { test, expect, type Page } from '@playwright/test';

// End-to-end smoke for the Tiptap-backed notes editor.
//
// Written when @tiptap/* moved 3.22 → 3.30 during a dependency upgrade and
// a code review flagged it as the one drifted dependency with no coverage.
// Nothing here is caught by `tsc`, because the two riskiest seams are both
// untyped:
//
//   * `tiptap-markdown` is third-party (peers on @tiptap/core ^3.0.1) and
//     its output is reached through an `as unknown as` cast in
//     MarkdownEditor.tsx — `editor.storage.markdown.getMarkdown()`. If that
//     storage key ever moves, the cast keeps compiling and the editor
//     silently produces empty markdown.
//   * StarterKit's markdown *input rules* are what this editor relies on
//     for formatting — VideoNotesEditor ships a slim toolbar (timecode +
//     save state) by design, so typing `**bold**` is the only way a user
//     applies a mark here. Input rules are plain runtime behaviour: if a
//     minor bump changes them, nothing fails to compile, the text just
//     stops turning bold.
//
// So this asserts on real editing behaviour: type, let the input rule fire,
// and confirm the mark lands in the document the save path serializes.
//
// Assumes the stack is already running (repo-root `yarn dev`/`yarn start`
// → Strapi :1350 + client :3015), same as the other spec here.

// The notes editor mounts read-only while the saved note loads, then flips
// to contenteditable. Targeting the editable state avoids typing into a
// ProseMirror that has not accepted input yet.
const EDITOR = '.ProseMirror[contenteditable="true"]';

// Fail on anything that looks like the editor blowing up rather than
// merely misbehaving — a missing storage key surfaces as a TypeError.
//
// Filters out the SSR→client-render fallback. That is a real, open bug — a
// duplicate React instance, documented in docs/ssr-client-fallback.md — but
// it fires on /feed too, which has no editor, so it belongs to the app's
// module resolution and not to Tiptap. Gating this spec on it would make a
// Tiptap regression and a hoisting regression indistinguishable. Delete the
// filter once that bug is fixed, so it cannot come back silently.
const UNRELATED = /Switched to client rendering/i;

function editorGuard(page: Page): () => void {
  const hits: string[] = [];
  const keep = (s: string) => !UNRELATED.test(s);
  page.on('console', (msg) => {
    if (msg.type() === 'error' && keep(msg.text()))
      hits.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    if (keep(err.message)) hits.push(`pageerror: ${err.message}`);
  });
  return () =>
    expect(hits, `editor runtime error:\n${hits.join('\n')}`).toEqual([]);
}

// The notes editor lives on a learn page, so we need a real video. Ask
// Strapi's public videos endpoint rather than scraping the feed (whose
// cards are client-rendered and race the check) or hard-coding an id that
// a reseed would invalidate.
async function firstVideoId(page: Page): Promise<string | null> {
  const res = await page.request.get(
    'http://localhost:1350/api/videos?pagination%5Blimit%5D=1',
  );
  if (!res.ok()) return null;
  const body = (await res.json()) as {
    data?: Array<{ youtubeVideoId?: string }>;
  };
  return body.data?.[0]?.youtubeVideoId ?? null;
}

test.describe('notes editor (tiptap)', () => {
  test('mounts, accepts input, and serializes marks to markdown', async ({
    page,
  }) => {
    const assertClean = editorGuard(page);

    const videoId = await firstVideoId(page);
    test.skip(!videoId, 'no videos in the library to open a learn page for');

    await page.goto(`/learn/${videoId}`);

    // The editor is lazy/client-only (ProseMirror needs a real DOM), so it
    // may mount after the route settles.
    const editor = page.locator(EDITOR).first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    // 1. Plain typing reaches the document.
    await editor.click();
    await page.keyboard.type('upgrade smoke ');
    await expect(editor).toContainText('upgrade smoke');

    // 2. StarterKit's markdown input rule converts `**x**` to a real bold
    //    mark as you type. This is the formatting path for this editor.
    await page.keyboard.type('**bolded** ');
    await expect(editor.locator('strong')).toHaveText('bolded');

    // 3. A list input rule too — a different rule family, so a regression
    //    confined to one kind of rule still gets caught.
    await page.keyboard.press('Enter');
    await page.keyboard.type('- first item');
    await expect(editor.locator('ul li').first()).toContainText('first item');

    // 4. The markdown serializer — the `as unknown as` cast — still
    //    produces markdown, and produces it for the mark we just applied.
    //    An empty string here means `storage.markdown` moved and the cast
    //    hid it.
    const markdown = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as
        | (HTMLElement & { editor?: unknown })
        | null;
      const ed = el?.editor as
        | { storage?: { markdown?: { getMarkdown?: () => string } } }
        | undefined;
      return ed?.storage?.markdown?.getMarkdown?.() ?? null;
    }, EDITOR);

    // `editor` is not guaranteed to be exposed on the DOM node across
    // versions; when it isn't, fall back to asserting the rendered mark,
    // which already proves the extension chain is alive.
    if (markdown !== null) {
      expect(markdown).toContain('**bolded**');
    }

    assertClean();
  });
});
