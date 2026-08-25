import { chromium } from 'playwright';
const tag = process.argv[2] ?? 'before';
const outDir = '/Users/paul/projects/music-kb/.superpowers/sdd/lesson-ux/screenshots';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://localhost:3015/lessons', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outDir}/${tag}-index-desktop.png` });
await browser.close();
console.log('done index', tag);
