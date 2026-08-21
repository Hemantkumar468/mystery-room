// Task → "Open the phase" → the page's own back arrow → must be back on the task.
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5173';
const TASK = '/projects/6a82eb4394c4936e44178f33/tasks/MR-NEW-001-T003';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', defaultViewport: { width: 1366, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const path = () => page.evaluate(() => location.pathname + location.search);
const out = [];
const check = (name, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.type('input[type="email"]', 'ea@gmail.com');
await page.type('input[type="password"]', '12345678');
await Promise.all([
  page.evaluate(() => document.querySelector('form button')?.click() || document.querySelector('form')?.requestSubmit()),
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
]);

// Arrive at the task the way a user does: from My Tasks (so history is real).
await page.goto(`${BASE}/my-tasks`, { waitUntil: 'networkidle2' });
await wait(800);
await page.goto(`${BASE}${TASK}`, { waitUntil: 'networkidle2' });
await wait(1500);
check('on the task page', (await path()).startsWith(TASK), await path());

// Click "Open the phase" (an in-app link).
const opened = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a')].find((x) => /open the phase/i.test(x.textContent));
  if (!a) return null; a.click(); return a.getAttribute('href');
});
await wait(1500);
const phasePath = await path();
check('Open the phase navigated', Boolean(opened) && phasePath.includes('/site-evaluation'), phasePath);

// Click the page's OWN back arrow (the one in the title bar).
const clickedBack = await page.evaluate(() => {
  const btn = document.querySelector('.topbar button[aria-label^="Back"], .topbar button.back-btn, .topbar .btn-icon');
  if (!btn) return false; btn.click(); return true;
});
await wait(1200);
const afterBack = await path();
check('clicked the title-bar back arrow', clickedBack);
check('back arrow → returns to the TASK, not elsewhere', afterBack.startsWith(TASK), afterBack);

// And the browser's own Back from the phase page should do the same.
await page.goto(`${BASE}${TASK}`, { waitUntil: 'networkidle2' });
await wait(1200);
await page.evaluate(() => [...document.querySelectorAll('a')].find((x) => /open the phase/i.test(x.textContent))?.click());
await wait(1200);
await page.goBack({ waitUntil: 'networkidle2' }).catch(() => {});
await wait(1000);
check('browser Back from the phase → the task', (await path()).startsWith(TASK), await path());

console.log(out.join('\n'));
console.log('runtime errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
process.exit(out.some((r) => r.startsWith('FAIL')) ? 1 : 0);
