import { chromium } from 'playwright';
const outDir = '/Users/paul/projects/music-kb/.superpowers/sdd/lesson-ux/screenshots';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto('http://localhost:3015/lessons/how-chords-come-from-scales', { waitUntil: 'networkidle' });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.42));
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/after-how-chords-desktop-diagrams.png` });
await browser.close();
