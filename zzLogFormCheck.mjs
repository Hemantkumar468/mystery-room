// A daily site report is a log: filed and read, never shortlisted or rejected.
import puppeteer from 'puppeteer-core';
const S = 'C:/Users/DTABLE~1/AppData/Local/Temp/claude/d--D-table-Mystery-Rooms/9e17e073-dffd-483f-bd8d-c265094163d7/scratchpad';
const BASE = 'http://localhost:5173';
const URL = '/projects/6a868da015dfa2a0f1c39d62/execution';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1400, height: 950 } });
const page = await browser.newPage();
page.setDefaultNavigationTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
const out = [];
const check = (n, ok, d = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${String(d).slice(0, 130)})` : ''}`);
const path = () => page.evaluate(() => location.pathname + location.search);
const body = () => page.evaluate(() => document.body.innerText);

try {
  // MD is the role that would see decision buttons — test as the strongest role.
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 60000 });
  for (let i = 0; i < 4 && (await path()).startsWith('/login'); i += 1) {
    await page.type('input[type="email"]', 'md@gmail.com');
    await page.type('input[type="password"]', '12345678');
    await page.keyboard.press('Enter');
    for (let j = 0; j < 20 && (await path()).startsWith('/login'); j += 1) await wait(500);
  }
  check('signed in as the MD', !(await path()).startsWith('/login'), await path());

  await page.goto(`${BASE}${URL}`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await page.evaluate(() => [...document.querySelectorAll('button, a')].find((x) => /daily reports/i.test(x.textContent || ''))?.click());
  await wait(2500);
  await page.evaluate(() => document.querySelector('table tbody tr')?.click());
  await wait(2500);

  const modal = await page.evaluate(() => {
    const m = document.querySelector('.modal, [role="dialog"]');
    if (!m) return null;
    return { text: m.innerText, buttons: [...m.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean) };
  });
  check('the report opens', Boolean(modal));
  if (modal) {
    check('NO Shortlist button', !modal.buttons.some((b) => /shortlist/i.test(b)), modal.buttons.join(' | '));
    check('NO Reject button', !modal.buttons.some((b) => /reject/i.test(b)), modal.buttons.join(' | '));
    check('status reads "Filed", not "Under Review"', /Filed/.test(modal.text) && !/Under Review/.test(modal.text), (modal.text.split('\n').find((l) => /Filed|Under Review/.test(l)) || ''));
    check('Edit is still offered', modal.buttons.some((b) => /edit/i.test(b)), modal.buttons.join(' | '));
  }
  await page.screenshot({ path: `${S}/logform.png`, fullPage: true });

  // And the approvals page must not list it.
  await page.goto(`${BASE}/approvals`, { waitUntil: 'domcontentloaded' });
} catch (err) {
  out.push(`CRASH  ${err.message.split('\n')[0]}`);
}
try {
  await wait(3500);
  const t = await body();
  check('Approvals page does not list a Daily Site Report', !/Daily Site Report/i.test(t));
} catch { /* page gone */ }
console.log(out.join('\n'));
console.log('runtime errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
process.exit(out.some((r) => !r.startsWith('PASS')) ? 1 : 0);
