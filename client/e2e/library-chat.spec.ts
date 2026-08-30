import { test, expect, type Page } from '@playwright/test';
import { askInChat, chatErrorGuard } from './chat-helpers';

// End-to-end smoke for the library drawer after it moved onto <Chat>.
//
// This is the surface where the migration could most easily break something
// quietly. Citations here arrive AHEAD of the answer they ground, as a raw
// CITATIONS frame, and are re-bound to their message by a transport-level
// interceptor (capture-frames.ts). If that binding fails, nothing throws: the
// answer renders, the sources disclosure simply never appears. So this asserts
// the citations, not just the prose.
//
// Assumes the stack is already running (repo-root `yarn dev`/`yarn start`).

async function openDrawer(page: Page) {
  await page.goto('/feed');
  await page.getByRole('button', { name: /ask your library/i }).first().click();
  await expect(page.getByRole('complementary', { name: /library chat/i })).toBeVisible();
}

test.describe('LibraryChat on <Chat>', () => {
  test('opens the drawer and renders the composer', async ({ page }) => {
    test.setTimeout(120_000);
    const assertClean = chatErrorGuard(page);
    await openDrawer(page);

    await expect(page.getByPlaceholder(/ask anything about your library/i)).toBeVisible();
    assertClean();
  });

  test('closes on Escape', async ({ page }) => {
    test.setTimeout(120_000);
    await openDrawer(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: /library chat/i })).toBeHidden();
  });

  test('answers a question and binds its citations to the message', async ({ page }) => {
    test.setTimeout(300_000);
    const assertClean = chatErrorGuard(page);
    await openDrawer(page);

    const input = page.getByPlaceholder(/ask anything about your library/i);
    const send = page.getByRole('button', { name: /^ask$|^send$/i });
    await askInChat(input, send, 'What instruments are discussed? One sentence.');

    const bubble = page.locator('.chat-md').first();
    await expect(bubble).toBeVisible({ timeout: 280_000 });
    await expect(bubble).not.toBeEmpty();

    // The citations arrived before the message and had to be re-bound to it.
    // If the interceptor silently failed, the prose above still renders.
    await expect(page.locator('details').first()).toBeVisible({ timeout: 30_000 });
    assertClean();
  });
});

/**
 * Delete the stored library conversation.
 *
 * Necessary now that the transcript lives in Strapi rather than in each
 * browser profile: every spec in this file shares ONE row, so without a reset
 * a conversation left behind by the previous test satisfies the next test's
 * assertions and the suite goes green having proved nothing. A fresh browser
 * context is no longer isolation — that is precisely the change being made.
 */
async function clearStoredConversation() {
  const base = 'http://localhost:1350/api/chat-conversations';
  const query = new URLSearchParams({ 'filters[threadId][$eq]': 'library-ask:v1' });
  const found = await fetch(`${base}?${query}`);
  if (!found.ok) return;
  const body = (await found.json()) as { data?: Array<{ documentId: string }> };
  for (const row of body.data ?? []) {
    await fetch(`${base}/${row.documentId}`, { method: 'DELETE' });
  }
}

test.describe('LibraryChat persistence', () => {
  test.beforeEach(clearStoredConversation);

  test('citations survive a reload, not just the messages', async ({ page }) => {
    // useChat restores the transcript on its own, but citations live BESIDE a
    // message (keyed by id, so excerpts are never replayed to the model). If
    // they are not persisted too, a reload brings back every answer with its
    // sources silently missing — the prose renders, the disclosure does not,
    // and nothing errors.
    test.setTimeout(300_000);
    await openDrawer(page);

    const input = page.getByPlaceholder(/ask anything about your library/i);
    const send = page.getByRole('button', { name: /^ask$|^send$/i });
    await askInChat(input, send, 'What instruments are discussed? One sentence.');

    await expect(page.locator('.chat-md').first()).not.toBeEmpty({ timeout: 280_000 });
    await expect(page.locator('details').first()).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await openDrawer(page);

    // Both halves must come back.
    await expect(page.locator('.chat-md').first()).not.toBeEmpty({ timeout: 30_000 });
    await expect(page.locator('details').first()).toBeVisible({ timeout: 30_000 });
  });

  test('the conversation follows the user to a second device', async ({ page, browser }) => {
    // THE point of moving persistence off localStorage, and the one thing the
    // reload test above cannot prove: a reload reuses the same browser
    // profile, so it passed against localStorage too. A second context has its
    // own empty storage, so anything that shows up there came from Strapi.
    test.setTimeout(300_000);
    await openDrawer(page);

    const input = page.getByPlaceholder(/ask anything about your library/i);
    const send = page.getByRole('button', { name: /^ask$|^send$/i });
    await askInChat(input, send, 'What instruments are discussed? One sentence.');
    await expect(page.locator('.chat-md').first()).not.toBeEmpty({ timeout: 280_000 });

    // The write is debounced; give it its quiet period before switching.
    await page.waitForTimeout(2_000);

    const secondDevice = await browser.newContext();
    try {
      const otherPage = await secondDevice.newPage();
      await otherPage.goto('/feed');
      await otherPage
        .getByRole('button', { name: /ask your library/i })
        .first()
        .click();

      await expect(otherPage.locator('.chat-md').first()).not.toBeEmpty({ timeout: 30_000 });
      // And the citations came with it — they live in the same Strapi row.
      await expect(otherPage.locator('details').first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await secondDevice.close();
    }
  });
});
