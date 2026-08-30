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

test.describe('LibraryChat persistence', () => {
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
});
