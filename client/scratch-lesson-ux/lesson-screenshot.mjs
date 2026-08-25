// One-off Playwright screenshot capture for the lesson-ux brief.
// Run from client/ so `playwright` resolves: `node scratch-lesson-ux/lesson-screenshot.mjs <tag>`
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const tag = process.argv[2] ?? 'before';
const outDir = '/Users/paul/projects/music-kb/.superpowers/sdd/lesson-ux/screenshots';
mkdirSync(outDir, { recursive: true });

const targets = [{ slug: 'how-chords-come-from-scales', name: 'how-chords' }];
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'narrow', width: 390, height: 900 },
];

const browser = await chromium.launch();
for (const t of targets) {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const url = `http://localhost:3015/lessons/${t.slug}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/${tag}-${t.name}-${vp.name}-top.png` });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${outDir}/${tag}-${t.name}-${vp.name}-mid.png` });
    await page.close();
  }
}
await browser.close();
console.log(`done: ${tag}`);
