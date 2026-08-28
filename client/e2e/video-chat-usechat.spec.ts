import { test, expect, type Page } from '@playwright/test';
import { askInChat } from './chat-helpers';

// End-to-end smoke for VideoChat after the useChat migration.
//
// VideoChat is the hardest of the four surfaces: it has skills, slash
// commands, a model picker, timecode seeking, and an evidence accordion that
// is fetched AFTER the answer completes and is deliberately held outside the
// message (in a Map keyed by message id) so transcript excerpts never ride
// the wire on later turns.
//
// The component no longer owns its transcript and /api/chat now speaks AG-UI.
// Nothing in the unit suite renders this component, so a mismatch between the
// two halves would look like a chat that posts and then shows nothing — with
// no failing test anywhere. Hence a real browser, a real model, real asserts.
//
// Assumes the stack is already running (repo-root `yarn dev`/`yarn start`
// → Strapi :1350 + client :3015), like the other specs here.

const VIDEO_ID = 'TRg-75VKOFU';

function errorGuard(page: Page): () => void {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => hits.push(`pageerror: ${err.message}`));
  return () => expect(hits, `unexpected page errors:\n${hits.join('\n')}`).toEqual([]);
}

test.describe('VideoChat on useChat', () => {
  test('renders the chat surface without errors', async ({ page }) => {
    test.setTimeout(120_000);
    const assertClean = errorGuard(page);
    await page.goto(`/learn/${VIDEO_ID}`);

    await expect(page.getByRole('heading', { name: /ask about this video/i })).toBeVisible();
    assertClean();
  });

  test('sends a question and streams the answer into the transcript', async ({ page }) => {
    test.setTimeout(300_000);
    const assertClean = errorGuard(page);
    await page.goto(`/learn/${VIDEO_ID}`);

    const input = page.getByPlaceholder(/ask about this video/i);
    const send = page.getByRole('button', { name: /^send$/i });
    await askInChat(page, input, send, 'In one sentence, what is this video about?');

    // The user turn is appended optimistically by useChat.
    await expect(page.getByText('In one sentence, what is this video about?')).toBeVisible();

    // Then the assistant's prose, rendered from UIMessage text parts.
    const bubble = page.locator('.chat-md').first();
    await expect(bubble).toBeVisible({ timeout: 280_000 });
    await expect(bubble).not.toBeEmpty();

    // The composer must return when the run settles.
    await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible({ timeout: 30_000 });
    assertClean();
  });
});
