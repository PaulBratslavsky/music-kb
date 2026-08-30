import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Type into a chat composer and wait until Send is actually enabled.
 *
 * WHY NOT JUST `fill()`. These pages are server-rendered and hydrate after
 * paint. `fill()` sets the DOM value and dispatches an input event, but if
 * React has not attached its handler yet the event lands on nothing: the
 * controlled `input` state stays empty, Send stays `disabled={!input.trim()}`,
 * and the test then waits out its whole timeout clicking a dead button. It is
 * a race, so it passes alone and fails in a full run — which is exactly how it
 * behaved here.
 *
 * Retrying the fill is the fix: once hydration lands, the next one sticks.
 */
export async function askInChat(
  input: Locator,
  send: Locator,
  question: string,
): Promise<void> {
  await expect(input).toBeEditable();

  await expect(async () => {
    await input.fill(question);
    await expect(send).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  await send.click();
}

/**
 * Fail a test if the page logs an error it did not cause.
 *
 * Browser-environment noise is filtered, not the app's own errors. The embedded
 * YouTube player trips a `compute-pressure` permissions-policy warning that has
 * nothing to do with us, and a guard that fails on it would either be deleted
 * or routinely ignored — both worse than a guard that is narrow and trusted.
 */
export function chatErrorGuard(page: Page): () => void {
  const IGNORE = [
    /permissions policy violation/i,
    /compute-pressure/i,
    // Favicon and other resource 404s from third-party embeds.
    /failed to load resource.*favicon/i,
  ];
  const hits: string[] = [];
  const record = (text: string) => {
    if (!IGNORE.some((re) => re.test(text))) hits.push(text);
  };
  page.on('console', (msg) => {
    if (msg.type() === 'error') record(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => record(`pageerror: ${err.message}`));
  return () => expect(hits, `unexpected page errors:\n${hits.join('\n')}`).toEqual([]);
}
