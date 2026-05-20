import { test, expect, type Page } from '@playwright/test';

// End-to-end smoke for the seroval server→client boundary.
//
// These three surfaces each ship video rows across the TanStack Start
// loader / server-fn stream, which serializes with seroval. A BM25 token
// table containing a reserved-name token (e.g. "constructor") crashes
// that stream. The unit contract test (seroval-safety.test.ts) locks the
// fix at the data level; this smoke proves the wired-up app actually
// renders these pages without the stream crashing.
//
// Assumes the stack is already running (repo-root `yarn dev`/`yarn start`
// → Strapi :1350 + client :3015). No stack auto-start here by design.

// Collect anything that smells like the seroval boundary crash:
// console errors, uncaught page errors. Returns an assert fn to call
// after the page has settled.
function serovalGuard(page: Page): () => void {
  const hits: string[] = [];
  const isSerovalCrash = (s: string) =>
    /seroval error/i.test(s) ||
    /an error occurred in the <AwaitInner>/i.test(s);

  page.on('console', (msg) => {
    if (msg.type() === 'error' && isSerovalCrash(msg.text())) {
      hits.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    if (isSerovalCrash(err.message)) hits.push(`pageerror: ${err.message}`);
  });

  return () =>
    expect(hits, `seroval boundary crash detected:\n${hits.join('\n')}`).toEqual([]);
}

// TanStack Router's default when a loader stream fails / route can't
// resolve. If we see this where real content is expected, the boundary
// likely crashed.
async function expectNotTanStackNotFound(page: Page) {
  const body = (await page.locator('body').innerText()).trim();
  expect(body, 'page fell back to the default Not Found component').not.toBe(
    'Not Found',
  );
}

test.describe('seroval boundary — search surfaces render without crashing', () => {
  test('/feed (default listing) ships full video rows and renders', async ({
    page,
  }) => {
    const assertNoCrash = serovalGuard(page);
    const res = await page.goto('/feed', { waitUntil: 'domcontentloaded' });
    expect(res?.status(), '/feed HTTP status').toBeLessThan(400);

    await expect(page.getByText('Knowledge feed', { exact: true })).toBeVisible();
    // Either real cards rendered, or the explicit empty state — both mean
    // the loader stream survived. A seroval crash yields neither.
    const grid = page.locator('a[href^="/learn/"]').first();
    const emptyState = page.getByText(/Nothing here yet|No matches/);
    await expect(grid.or(emptyState).first()).toBeVisible();

    await expectNotTanStackNotFound(page);
    assertNoCrash();
  });

  test('/feed?mode=semantic ships videos via semanticSearchVideos', async ({
    page,
  }) => {
    const assertNoCrash = serovalGuard(page);
    const res = await page.goto('/feed?mode=semantic&q=react', {
      waitUntil: 'domcontentloaded',
    });
    expect(res?.status(), 'semantic feed HTTP status').toBeLessThan(400);

    // Ollama may be down in dev — semantic mode then degrades to the
    // keyword listing. Either way the feed header + a result-or-empty
    // container must render (the boundary still shipped video rows).
    await expect(page.getByText('Knowledge feed', { exact: true })).toBeVisible();
    const grid = page.locator('a[href^="/learn/"]').first();
    const emptyState = page.getByText(/Nothing here yet|No matches/);
    await expect(grid.or(emptyState).first()).toBeVisible();

    await expectNotTanStackNotFound(page);
    assertNoCrash();
  });

  test('/learn/$videoId loader + Related Videos panel render', async ({
    page,
  }) => {
    // Derive a real video id from the feed rather than hardcoding seed
    // data. If the library is empty, there's nothing to exercise here.
    await page.goto('/feed', { waitUntil: 'domcontentloaded' });
    const firstLearnLink = page.locator('a[href^="/learn/"]').first();
    if ((await firstLearnLink.count()) === 0) {
      test.skip(true, 'empty library — no video to open /learn for');
    }
    const href = await firstLearnLink.getAttribute('href');
    expect(href).toBeTruthy();

    const assertNoCrash = serovalGuard(page);
    // RelatedVideos fires the `relatedVideos` server fn from a useEffect
    // after mount. Capture that response so we actually wait for the
    // panel's boundary crossing instead of racing it. The TanStack Start
    // server-fn endpoint carries the fn name in the URL.
    const relatedResp = page
      .waitForResponse(
        (r) => /relatedVideos/i.test(r.url()),
        { timeout: 15_000 },
      )
      .catch(() => null); // library may be empty / no embedding — fine

    const res = await page.goto(href!, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), '/learn HTTP status').toBeLessThan(400);

    // Every learn state (ready / pending / failed / unshared / backend-
    // error) renders a <main>; the default Not Found does not.
    await expect(page.locator('main').first()).toBeVisible();
    await relatedResp;
    await expectNotTanStackNotFound(page);
    assertNoCrash();
  });

  test('/search loader renders without crashing', async ({ page }) => {
    const assertNoCrash = serovalGuard(page);
    const res = await page.goto('/search?q=react', {
      waitUntil: 'domcontentloaded',
    });
    expect(res?.status(), '/search HTTP status').toBeLessThan(400);

    await expect(page.getByText('Moment search', { exact: true })).toBeVisible();
    // ok (results or 0-moments line), error (Ollama down), all fine —
    // each means the page rendered. A boundary crash renders none.
    const anyState = page.getByText(
      /moments? for|Couldn.t run the search|Enter a query above/,
    );
    await expect(anyState.first()).toBeVisible();

    await expectNotTanStackNotFound(page);
    assertNoCrash();
  });
});
