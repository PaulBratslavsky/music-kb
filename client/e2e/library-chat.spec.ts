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
  // Also needed here, not just in the persistence suite: these assertions are
  // exactly the ones a leftover transcript would satisfy.
  test.beforeEach(clearStoredConversation);
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
type StoredRow = {
  messages: Array<{ id: string; role: string }>;
  citations: Array<[string, Array<Record<string, unknown>>]>;
};

const STRAPI = 'http://localhost:1350/api/chat-conversations';
const THREAD_ID = 'library-ask:v1';

/** Read the stored conversation, or null when there is none. */
async function readStoredConversation(): Promise<StoredRow | null> {
  const query = new URLSearchParams({ 'filters[threadId][$eq]': THREAD_ID });
  const res = await fetch(`${STRAPI}?${query}`);
  if (!res.ok) throw new Error(`could not read chat-conversations (${res.status})`);
  const body = (await res.json()) as { data?: StoredRow[] };
  return body.data?.[0] ?? null;
}

/**
 * Write a known conversation straight into Strapi, bypassing the model.
 *
 * The assistant turn carries a `[1]` marker on purpose: the citation
 * disclosure renders only sources the answer actually cited, so a seeded
 * transcript without one would correctly show nothing and the test would be
 * asserting the wrong thing.
 */
async function seedConversation(): Promise<{ videoTitle: string }> {
  const assistantId = 'msg-seeded-assistant';
  const videoTitle = 'Lecture 4. Rhythm: Jazz, Pop and Classical';
  const res = await fetch(STRAPI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        threadId: THREAD_ID,
        surface: 'library-ask',
        messages: [
          { id: 'msg-seeded-user', role: 'user', parts: [{ type: 'text', content: 'Seeded question' }] },
          {
            id: assistantId,
            role: 'assistant',
            parts: [{ type: 'text', content: 'Rhythm is discussed at length [1].' }],
          },
        ],
        citations: [
          [
            assistantId,
            [
              {
                index: 1,
                videoDocumentId: 'seed-doc',
                youtubeVideoId: 'h4ROqE4SMyA',
                videoTitle,
                videoAuthor: 'YaleCourses',
                videoThumbnailUrl: null,
                startSec: 10,
                endSec: 40,
                text: 'a seeded passage',
              },
            ],
          ],
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`could not seed a conversation (${res.status})`);
  return { videoTitle };
}

/**
 * Delete the stored conversation, and FAIL the test if that does not happen.
 *
 * Chat state now lives in one Strapi row, so a browser context is no longer an
 * isolation boundary between these specs. A cleanup that returns quietly on a
 * failed lookup — or ignores a failed DELETE — leaves the previous test's
 * transcript in place, and the next test's assertions ("the answer is
 * non-empty", "a sources disclosure is visible") are satisfied by that
 * leftover. It passes, having proved nothing about the code under test.
 */
async function clearStoredConversation() {
  const base = 'http://localhost:1350/api/chat-conversations';
  const query = new URLSearchParams({ 'filters[threadId][$eq]': 'library-ask:v1' });

  const found = await fetch(`${base}?${query}`);
  if (!found.ok) {
    throw new Error(
      `e2e cleanup could not read chat-conversations (${found.status}). ` +
        'Refusing to run: a leftover row would make these tests pass vacuously.',
    );
  }

  const body = (await found.json()) as { data?: Array<{ documentId: string }> };
  for (const row of body.data ?? []) {
    const deleted = await fetch(`${base}/${row.documentId}`, { method: 'DELETE' });
    if (!deleted.ok) {
      throw new Error(
        `e2e cleanup could not delete ${row.documentId} (${deleted.status}).`,
      );
    }
  }
}

test.describe('LibraryChat persistence', () => {
  test.beforeEach(clearStoredConversation);

  test('restores a stored transcript AND its citations', async ({ page }) => {
    // SEEDED, not generated. The earlier version of this test asked a real
    // model and then asserted a sources disclosure appeared after a reload —
    // but the disclosure only renders citations the answer actually CITED, and
    // whether the model emits `[1]` markers is its choice. The test passed by
    // luck and failed the moment a model answered without citing, which is
    // correct behaviour it was reading as a bug.
    //
    // Writing the row directly removes the model from the loop, so this tests
    // exactly one thing: a stored conversation comes back whole — prose and
    // sources — which is what the persistence layer is for.
    const seeded = await seedConversation();

    await openDrawer(page);

    await expect(page.getByText('Seeded question')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.chat-md').first()).toContainText('Rhythm is discussed');

    // The sources half. If citations were not persisted alongside the
    // transcript, the prose above still renders and only this fails — which is
    // exactly how the localStorage version shipped broken.
    const disclosure = page.locator('details').first();
    await expect(disclosure).toBeVisible({ timeout: 30_000 });
    await disclosure.click();
    await expect(disclosure).toContainText(seeded.videoTitle);
  });

  test('a live answer writes its citations into the stored row', async ({ page }) => {
    // The other half of the round trip, asserted where it is deterministic:
    // the ROW, not the rendering. What the model chooses to cite is its own
    // business; that the retrieval citations reach storage is ours.
    test.setTimeout(300_000);
    await openDrawer(page);

    const input = page.getByPlaceholder(/ask anything about your library/i);
    const send = page.getByRole('button', { name: /^ask$|^send$/i });
    await askInChat(input, send, 'What instruments are discussed? One sentence.');
    await expect(page.locator('.chat-md').first()).not.toBeEmpty({ timeout: 280_000 });

    await expect(async () => {
      const row = await readStoredConversation();
      expect(row, 'no conversation row was written').not.toBeNull();
      expect(row!.messages.length).toBeGreaterThanOrEqual(2);
      expect(row!.citations.length, 'citations were not stored').toBeGreaterThan(0);
      // Keyed to a message that is actually in the transcript.
      const ids = row!.messages.map((m) => m.id);
      expect(ids).toContain(row!.citations[0][0]);
    }).toPass({ timeout: 30_000 });
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
