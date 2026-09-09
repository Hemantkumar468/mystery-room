// The one thing that must work: press Mark as Complete, the task completes.
import puppeteer from 'puppeteer-core';

const APP = 'http://localhost:5173';
const API = 'http://localhost:5000/api/v1';
const OUT = 'C:/Users/DTABLE~1/AppData/Local/Temp/claude/d--D-table-Mystery-Rooms/9e17e073-dffd-483f-bd8d-c265094163d7/scratchpad';
const out = [];
const check = (n, ok, d = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${String(d).replace(/\s+/g, ' ').slice(0, 175)})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Find a real open task to finish ──
const lr = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'prateek@mysteryrooms.in', password: '12345678' }),
});
const lj = await lr.json();
const dig = (o, k) => { if (o && typeof o === 'object') { for (const [kk, v] of Object.entries(o)) { if (kk === k && typeof v === 'string') return v; const q = dig(v, k); if (q) return q; } } return null; };
const tok = dig(lj, 'accessToken') || dig(lj, 'token');
const api = async (p, init = {}) => {
  const r = await fetch(`${API}${p}`, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const PID = '6a8f3053532a9db275f781b4'; // MR-NOI-003
const all = (await api(`/pms/tasks?project=${PID}&limit=200`)).body?.data || [];
const target = all.find((t) => t.status === 'pending' && !(t.checklist || []).length)
  || all.find((t) => t.status === 'pending');
check('found an open task to finish', Boolean(target), `${target?.code} "${target?.title}" status=${target?.status}`);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

await page.goto(`${APP}/login`, { waitUntil: 'networkidle2' });
const set = async (sel, v) => { await page.waitForSelector(sel); await page.$eval(sel, (el, x) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); }, v); };
await set('input[type="email"]', 'prateek@mysteryrooms.in');
await set('input[type="password"]', '12345678');
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /sign in/i.test(x.textContent))?.click());
await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 30000 });

await page.goto(`${APP}/projects/${PID}/tasks/${target.code}`, { waitUntil: 'networkidle2' });
await wait(3000);

const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /mark as complete/i.test(x.textContent || ''));
  if (b) b.click();
  return b ? b.textContent.trim() : null;
});
check('the Mark as Complete button is there', Boolean(clicked), clicked);
await wait(2000);

// An unticked checklist asks first — confirm it.
const confirmed = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.overlay button, [role=dialog] button')]
    .find((x) => /complete anyway|yes|confirm|mark it complete/i.test(x.textContent || ''));
  if (b) b.click();
  return b ? b.textContent.trim() : null;
});
if (confirmed) await wait(2500);

const screen = await page.evaluate(() => document.body.innerText);
check('no validation error is shown', !/Invalid enum value|Validation failed|received 'done'/i.test(screen),
  screen.split('\n').find((l) => /invalid|validation/i.test(l)) || 'clean');
check('nothing blew up in the console', !errors.some((e) => /enum|validation/i.test(e)), errors.slice(0, 2).join(' | ') || 'clean');
await page.screenshot({ path: `${OUT}/complete-after.png` });

// ── The server is the judge ──
const after = (await api(`/pms/tasks/${target._id}`)).body?.data;
check('the task is COMPLETE on the server', after?.status === 'complete', `status=${after?.status} approvalState=${after?.approvalState}`);
check('and it recorded when', Boolean(after?.actualEnd || after?.completedAt), after?.actualEnd || after?.completedAt);

// ── And it now reads as complete in the app ──
await page.reload({ waitUntil: 'networkidle2' });
await wait(2500);
const reread = await page.evaluate(() => document.body.innerText);
check('the task page shows it as complete, not pending', /complete/i.test(reread) && !/^Pending$/im.test(reread.split('\n').slice(0, 6).join('\n')),
  reread.split('\n').slice(0, 3).join(' · '));

await page.goto(`${APP}/my-tasks`, { waitUntil: 'networkidle2' });
await wait(3000);
const mine = await page.evaluate(() => document.body.innerText);
check('My Tasks no longer counts it as outstanding', !new RegExp(`${target.code}[\\s\\S]{0,200}overdue`, 'i').test(mine), 'not in the overdue pile');

console.log(out.join('\n'));
console.log(`\ntask used: ${target.code} — ${target.title}`);
await browser.close();
process.exit(out.some((r) => !r.startsWith('PASS')) ? 1 : 0);
