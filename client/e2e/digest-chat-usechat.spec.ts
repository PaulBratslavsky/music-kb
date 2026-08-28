import { test, expect, type Page } from '@playwright/test';
import { askInChat } from './chat-helpers';

// End-to-end smoke for DigestChat after the useChat migration.
//
// The component no longer owns its message state: useChat does, as an ordered
// `UIMessage.parts` array, and the route now speaks AG-UI RunAgentInput. Both
// halves changed at once, and nothing in the unit suite renders this component
// or exercises that wire — a mismatch would show as a chat that posts and then
// silently displays nothing, with no failing test anywhere.
//
// So this drives the real thing: type a question, watch a real model answer,
// assert the user turn and the assistant's prose both reach the DOM.
//
// Assumes the stack is already running (repo-root `yarn dev`/`yarn start`
// → Strapi :1350 + client :3015), like the other specs here.

const VIDEOS = 'ScMK-5dwOYM,TRg-75VKOFU';

function errorGuard(page: Page): () => void {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => hits.push(`pageerror: ${err.message}`));
  return () => expect(hits, `unexpected page errors:\n${hits.join('\n')}`).toEqual([]);
}

test.describe('DigestChat on useChat', () => {
  test('renders the chat surface without errors', async ({ page }) => {
    // The /digest loader retrieves across every selected video before the page
    // paints, which is well past Playwright's 30s default on a cold cache.
    test.setTimeout(240_000);
    const assertClean = errorGuard(page);
    await page.goto(`/digest?videos=${VIDEOS}`);

    await expect(page.getByRole('heading', { name: /ask across these videos/i })).toBeVisible();
    await expect(page.getByPlaceholder(/ask about these videos/i)).toBeVisible();
    assertClean();
  });

  test('sends a question and streams an answer back into the transcript', async ({ page }) => {
    // A real local model answers, so this needs a generous budget.
    test.setTimeout(240_000);
    const assertClean = errorGuard(page);
    await page.goto(`/digest?videos=${VIDEOS}`);

    const input = page.getByPlaceholder(/ask about these videos/i);
    const send = page.getByRole('button', { name: /^send$/i });
    await askInChat(input, send, 'Name one topic both videos cover. One sentence.');

    // The user's turn must appear immediately — useChat appends it optimistically.
    await expect(page.getByText('Name one topic both videos cover. One sentence.')).toBeVisible();

    // Then the assistant's prose, rendered from UIMessage text parts.
    const bubbles = page.locator('.chat-md');
    await expect(bubbles.first()).toBeVisible({ timeout: 220_000 });
    await expect(bubbles.first()).not.toBeEmpty();

    // And the composer must come back to life when the run settles.
    await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible({ timeout: 30_000 });
    assertClean();
  });
});
