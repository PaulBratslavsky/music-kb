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
  page: Page,
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
