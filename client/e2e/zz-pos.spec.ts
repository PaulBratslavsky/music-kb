import { test } from '@playwright/test';
const OUT = '/private/tmp/claude-501/-Users-paul-programing-music-kb/a432aaf2-be60-4a86-990a-f3282a74bff2/scratchpad';
test('positions match the curated boxes', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setViewportSize({ width: 1500, height: 1200 });
  await page.goto('http://localhost:3015/video/bh8tpbcp51gg8sauspgjwup6?loopId=j6ap2h7jlwlrf8ti953zbdox');
  await page.waitForTimeout(3000);
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b=>b.textContent?.trim())
      .filter(t=>t && (t==='All' || /Box|shape/i.test(t))));
  console.log('BUTTONS ' + JSON.stringify(btns));
  const target = btns.find(b => b !== 'All');
  if (target) {
    await page.getByRole('button', { name: target!, exact: true }).last().click();
    await page.waitForTimeout(700);
    const span = await page.evaluate(() => {
      const svg=[...document.querySelectorAll('svg')].find(x=>(x.getAttribute('aria-label')||'').includes('neck'))!;
      const gs=[...svg.querySelectorAll('g[opacity]')];
      return { lit: gs.filter(g=>g.getAttribute('opacity')==='1').length, dim: gs.filter(g=>g.getAttribute('opacity')!=='1').length };
    });
    console.log('SELECTED ' + target + ' ' + JSON.stringify(span));
  }
  console.log('ERRS ' + errs.length);
  await page.locator('.overflow-x-auto').last().screenshot({ path: `${OUT}/boxes.png` });
});
