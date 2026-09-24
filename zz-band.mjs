import puppeteer from 'puppeteer';
const APP = 'http://localhost:5173';
const errs = [];
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1366, height: 800 });
p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
await p.goto(`${APP}/login`, { waitUntil: 'networkidle2' });
await p.type('input[type="email"]', 'admin@mysteryrooms.in');
await p.type('input[type="password"]', '12345678');
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Sign in/i.test(x.textContent))?.click());
await new Promise((r) => setTimeout(r, 4200));
await p.goto(`${APP}/property/assessment`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 3800));

const look = () => p.evaluate(() => {
  const wrap = document.querySelector('.prop-table-wrap');
  const vis = [...document.querySelectorAll('.prop-group-label')].map((el) => {
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    return { name: el.textContent.trim(), x: Math.round(r.left - w.left), onScreen: r.right > w.left && r.left < w.right };
  });
  return { scrollLeft: Math.round(wrap.scrollLeft), labels: vis.filter((v) => v.onScreen).map((v) => `${v.name}@${v.x}`) };
});

console.log('at start        ', JSON.stringify(await look()));
for (const x of [1600, 2400, 3200, 4000, 4800, 5600, 6400]) {
  await p.evaluate((sx) => { document.querySelector('.prop-table-wrap').scrollLeft = sx; }, x);
  await new Promise((r) => setTimeout(r, 500));
  console.log(`scrolled ${String(x).padEnd(5)}   `, JSON.stringify(await look()));
}
await p.screenshot({ path: 'zz-band.png' });
console.log('ERRORS:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
