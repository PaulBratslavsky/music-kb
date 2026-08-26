import { test, expect, type Page } from '@playwright/test';

// End-to-end guard for the lesson two-column view.
//
// Everything here is geometry and iframe behaviour — the two things unit
// tests structurally cannot see. `LessonVideoPanel.test.tsx` asserts the
// panel hands the player the right videoId and startSec; only a real
// browser can confirm that the columns actually sit side by side, that
// they actually collapse on a phone, that the panel actually stays put
// through a 2,000-word scroll, and that the YouTube embed actually
// mounts. This repo's recurring failure is a surface that validates and
// is invisible; this is the test that looks.
//
// Assumes the stack is already running (repo-root `yarn dev`/`yarn start`
// → Strapi :1350 + client :3015), same as the other specs here.

const PANEL = 'aside[aria-label="Lesson sources and player"]';
// The citation buttons LessonBody renders: a "Source" kicker followed by
// the button that loads the panel.
const CITATIONS = 'p:has(> span:text-is("Source")) > button';

// Fail on anything that looks like the page blowing up. Nothing is
// filtered except the YouTube embed's own network noise, which this
// sandbox cannot reach and which says nothing about our code.
function pageGuard(page: Page): () => void {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('ERR_CONNECTION_REFUSED') || text.includes('ERR_NAME_NOT_RESOLVED')) return;
    hits.push(`console: ${text}`);
  });
  page.on('pageerror', (err) => hits.push(`pageerror: ${err.message}`));
  return () => expect(hits, `lesson runtime error:\n${hits.join('\n')}`).toEqual([]);
}

// Finds a lesson that actually has a video panel, rather than hard-coding
// a slug a reseed could invalidate.
//
// Discovered through the app's own `/lessons` index rather than by asking
// Strapi on :1350 — the panel's existence is a property of the rendered
// page (`lessonHasVideoPanel` over the body and the resolved relation),
// not something the REST payload states directly, so the page is the
// honest place to ask. Cached across the specs in this file: it is a few
// navigations and none of them mutate anything.
let cachedSlug: string | null | undefined;

async function citedLessonSlug(page: Page): Promise<string | null> {
  if (cachedSlug !== undefined) return cachedSlug;
  await page.goto('/lessons');
  const slugs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/lessons/"]'))
      .map((a) => (a.getAttribute('href') ?? '').replace('/lessons/', ''))
      .filter((s) => s.length > 0 && !s.includes('/')),
  );
  for (const slug of slugs.slice(0, 8)) {
    await page.goto(`/lessons/${slug}`);
    if ((await page.locator(PANEL).count()) > 0) {
      cachedSlug = slug;
      return slug;
    }
  }
  cachedSlug = null;
  return null;
}

test.describe('lesson two-column view', () => {
  test('puts the panel beside the lesson on a wide viewport and keeps it there while scrolling', async ({
    page,
  }) => {
    const assertNoErrors = pageGuard(page);
    const slug = await citedLessonSlug(page);
    test.skip(!slug, 'no cited lesson in this Strapi instance');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/lessons/${slug}`);
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();

    const columns = await page.evaluate((panelSel) => {
      const aside = document.querySelector(panelSel) as HTMLElement;
      const content = aside.previousElementSibling as HTMLElement;
      const a = aside.getBoundingClientRect();
      const c = content.getBoundingClientRect();
      return { asideLeft: a.left, contentRight: c.right, contentWidth: c.width };
    }, PANEL);
    // Side by side, not stacked.
    expect(columns.asideLeft).toBeGreaterThanOrEqual(columns.contentRight - 1);
    // The reading column is still a reading column, not a full-bleed one.
    expect(columns.contentWidth).toBeLessThan(900);

    // No sideways scroll — the whole page fits its viewport.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // Sticky: still pinned near the top after a long scroll. These
    // lessons run 55-91 blocks, and the panel being lost off the top of
    // that scroll is the specific failure this asserts against.
    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(300);
    const top = await panel.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(200);

    assertNoErrors();
  });

  test('collapses to a single column on a narrow viewport', async ({ page }) => {
    const assertNoErrors = pageGuard(page);
    const slug = await citedLessonSlug(page);
    test.skip(!slug, 'no cited lesson in this Strapi instance');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/lessons/${slug}`);
    await expect(page.locator(PANEL)).toBeVisible();

    const stacked = await page.evaluate((panelSel) => {
      const aside = document.querySelector(panelSel) as HTMLElement;
      const content = aside.previousElementSibling as HTMLElement;
      const a = aside.getBoundingClientRect();
      const c = content.getBoundingClientRect();
      return {
        sideBySide: a.left >= c.right,
        sameWidth: Math.abs(a.width - c.width) < 2,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    }, PANEL);
    expect(stacked.sideBySide).toBe(false);
    expect(stacked.sameWidth).toBe(true);
    // A phone must never scroll sideways. It did before this work: the
    // "Built from" cards were grid items with the default
    // `min-width: auto` and grew past the column.
    expect(stacked.scrollWidth).toBeLessThanOrEqual(stacked.clientWidth);

    assertNoErrors();
  });

  test('a citation loads its video in the panel at the grounded second, without navigating', async ({
    page,
  }) => {
    const assertNoErrors = pageGuard(page);
    const slug = await citedLessonSlug(page);
    test.skip(!slug, 'no cited lesson in this Strapi instance');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/lessons/${slug}`);
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();

    // Nothing playing yet: the panel's default state is the source list.
    await expect(panel.getByRole('heading', { name: 'Sources' })).toBeVisible();
    await expect(panel.locator('iframe')).toHaveCount(0);

    // Find a citation that carries a grounded timestamp — the label ends
    // in `m:ss` when one exists.
    const citations = page.locator(CITATIONS);
    const count = await citations.count();
    expect(count).toBeGreaterThan(0);
    let chosen: number | null = null;
    let stamp = '';
    for (let i = 0; i < count; i++) {
      const text = (await citations.nth(i).textContent()) ?? '';
      const match = /(\d+:\d{2}(?::\d{2})?)$/.exec(text.trim());
      if (match) {
        chosen = i;
        stamp = match[1];
        break;
      }
    }
    test.skip(chosen === null, 'no citation on this lesson carries a grounded timestamp');

    const url = page.url();
    await citations.nth(chosen as number).click();

    // The video is in the panel, at the citation's second — and the page
    // never navigated.
    await expect(panel.getByText(`Playing from ${stamp}`)).toBeVisible();
    await expect(panel.locator('iframe')).toHaveCount(1);
    await expect(citations.nth(chosen as number)).toHaveAttribute('aria-current', 'true');
    expect(page.url()).toBe(url);

    // The explicit way out survives.
    await expect(panel.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute(
      'href',
      /youtube\.com\/watch\?v=[^&]+&t=\d+s$/,
    );

    assertNoErrors();
  });
});
