/**
 * CRM smoke test — against a RUNNING server, over real HTTP.
 *
 * WHY THIS EXISTS. Four background jobs were dead for hours while 77 unit
 * tests stayed green, because every one of them called the sweep function
 * directly and none asked whether the thing that invokes it could. Every check
 * below therefore goes through the actual boundary: an HTTP request to a live
 * process, and a job pushed through a live queue.
 *
 * It is not a replacement for the regression suites. It answers a different
 * question, in about thirty seconds, after every restart and every deploy:
 * is this system actually alive, or did it merely compile?
 *
 *   npm run smoke:crm
 *   npm run smoke:crm -- --url=https://api.example.com/api/v1
 *
 * SAFE TO RUN AGAINST REAL DATA. It creates one deal, moves it, creates one
 * task, completes it, and deletes both on the way out. Nothing it writes
 * survives a successful run.
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const BASE = arg('url', `http://localhost:${process.env.PORT || 5000}${process.env.API_PREFIX || '/api/v1'}`);
const EMAIL = arg('email', 'admin@mysteryrooms.in');
const PASSWORD = arg('password', '12345678');

/* eslint-disable no-console */
const results = [];
const pass = (name, detail = '') => { results.push(true); console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { results.push(false); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); };
const check = (name, condition, detail) => (condition ? pass(name, detail) : fail(name, detail));

let token = null;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a non-JSON body is itself the finding */ }
  return { status: res.status, body: json, raw: text };
}

async function run() {
  console.log(`CRM smoke test → ${BASE}\n`);

  /* ── Is anything there at all? ───────────────────────────── */
  console.log('── The server answers ──');
  try {
    const root = await api('/');
    check('the API responds', root.status === 200, `HTTP ${root.status}`);
    check('and lists the CRM module', root.body?.data?.modules?.includes('crm') || root.body?.modules?.includes('crm'),
      JSON.stringify(root.body?.modules || root.body?.data?.modules));
  } catch (err) {
    fail('the API responds', err.message);
    console.log('\nNothing else can be checked while the server is unreachable.');
    process.exit(1);
  }

  const login = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (login.status === 429) {
    console.log('\n  Rate limited on login. Wait for the window to clear and re-run.');
    process.exit(1);
  }
  token = login.body?.data?.accessToken || login.body?.accessToken;
  check('login works', Boolean(token), token ? '' : `HTTP ${login.status}`);
  if (!token) { console.log('\nEverything below needs a session.'); process.exit(1); }

  /* ── The three screens an agent opens ────────────────────── */
  console.log('\n── The screens return real data, not empty shells ──');
  const today = await api('/crm/today');
  check('/crm/today responds', today.status === 200, `HTTP ${today.status}`);
  check('with its five sections',
    ['overdue', 'dueToday', 'upcoming', 'newLeads', 'stalled'].every((k) => k in (today.body?.data || {})),
    Object.keys(today.body?.data || {}).join(', '));

  const dash = await api('/crm/dashboard');
  check('/crm/dashboard responds', dash.status === 200, `HTTP ${dash.status}`);
  check('and its counts add up',
    dash.body?.data?.sources?.reduce((n, s) => n + s.leads, 0) === dash.body?.data?.capture?.total,
    `sources sum ${dash.body?.data?.sources?.reduce((n, s) => n + s.leads, 0)} vs total ${dash.body?.data?.capture?.total}`);

  const board = await api('/crm/board');
  check('/crm/board responds', board.status === 200, `HTTP ${board.status}`);
  const stages = board.body?.data?.stages || [];
  check('with a pipeline behind it', stages.length > 0, `${stages.length} stages`);
  check('and column counts that match the total',
    stages.reduce((n, s) => n + s.count, 0) === board.body?.data?.totals?.count,
    `columns ${stages.reduce((n, s) => n + s.count, 0)} vs total ${board.body?.data?.totals?.count}`);

  const dropbox = await api('/crm/email/dropbox/status');
  check('/crm/email/dropbox/status responds', dropbox.status === 200, `HTTP ${dropbox.status}`);
  check('and says whether inbound email is on',
    typeof dropbox.body?.data?.configured === 'boolean',
    dropbox.body?.data?.configured ? `polling ${dropbox.body.data.address}` : 'not configured yet');

  const unfiled = await api('/crm/email/dropbox/unfiled');
  check('/crm/email/dropbox/unfiled responds', unfiled.status === 200, `HTTP ${unfiled.status}`);

  /* The tracking pixel is fetched by the recipient's mail client, so it must
     answer WITHOUT a session. A token nobody issued still has to return an
     image rather than an error — otherwise every unknown open renders as a
     broken-image box inside a customer's email. */
  const pixel = await fetch(`${BASE}/crm/public/e/o/smoke-not-a-real-token`, {
    signal: AbortSignal.timeout(10_000),
  });
  check('the tracking pixel answers without a session', pixel.status === 200, `HTTP ${pixel.status}`);
  check('and returns an image', (pixel.headers.get('content-type') || '').includes('image'),
    pixel.headers.get('content-type') || 'none');

  /* And a link nobody sent must NOT redirect. A redirect endpoint that
     degrades to "somewhere sensible" is an open redirect wearing our domain. */
  const click = await fetch(`${BASE}/crm/public/e/c/smoke-not-a-real-token/0`, {
    redirect: 'manual', signal: AbortSignal.timeout(10_000),
  });
  check('a link we never sent is refused, not redirected',
    click.status === 404, `HTTP ${click.status}`);

  /* ── A deal really moves ─────────────────────────────────── */
  console.log('\n── A stage change writes history ──');
  const openStages = stages.filter((s) => !s.isWon && !s.isLost);
  let dealId = null;

  if (openStages.length < 2) {
    fail('the pipeline has two open stages to move between', `${openStages.length}`);
  } else {
    const made = await api('/crm/deals', {
      method: 'POST',
      body: { title: `SMOKE ${new Date().toISOString()}`, value: 100000, stage: openStages[0]._id },
    });
    dealId = made.body?.data?._id;
    check('a deal can be created', Boolean(dealId), `HTTP ${made.status}`);

    if (dealId) {
      const before = await api(`/crm/deals/${dealId}`);
      const historyBefore = before.body?.data?.deal?.stageHistory?.length || 0;

      const moved = await api(`/crm/deals/${dealId}/move`, {
        method: 'PATCH', body: { stage: openStages[1]._id },
      });
      check('it can be moved to another stage', moved.status === 200, `HTTP ${moved.status}`);

      const after = await api(`/crm/deals/${dealId}`);
      const historyAfter = after.body?.data?.deal?.stageHistory?.length || 0;
      check('and stageHistory grew', historyAfter === historyBefore + 1,
        `${historyBefore} → ${historyAfter}`);
      check('with the previous entry closed off',
        after.body?.data?.deal?.stageHistory?.[0]?.exitedAt != null,
        String(after.body?.data?.deal?.stageHistory?.[0]?.durationHours));
    }
  }

  /* ── A task really completes ─────────────────────────────── */
  console.log('\n── Completing a task records the activity ──');
  const task = await api('/crm/tasks', {
    method: 'POST',
    body: {
      title: `SMOKE task ${Date.now()}`,
      type: 'call',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      ...(dealId ? { entityType: 'deal', entityId: dealId, entityLabel: 'smoke deal' } : {}),
    },
  });
  const taskId = task.body?.data?._id;
  check('a task can be created', Boolean(taskId), `HTTP ${task.status}`);

  if (taskId) {
    const done = await api(`/crm/tasks/${taskId}/complete`, { method: 'PATCH' });
    check('it can be completed', done.status === 200, `HTTP ${done.status}`);
    check('and the completion says how it was confirmed',
      Boolean(done.body?.data?.completionSource), done.body?.data?.completionSource);

    if (dealId) {
      const after = await api(`/crm/deals/${dealId}`);
      check('an activity landed on the record',
        (after.body?.data?.timeline || []).some((a) => /Task done/.test(a.subject || '')),
        `${(after.body?.data?.timeline || []).length} timeline entries`);
    }
  }

  /* ── The queue is alive ──────────────────────────────────── */
  console.log('\n── A background job actually runs ──');
  /* THE CHECK THAT WOULD HAVE CAUGHT THE OUTAGE. Everything above proves the
     request path; this proves the queue, which failed independently and
     silently for hours. It connects to the same database the server uses and
     pushes a job through a real Agenda instance. */
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20_000 });
  const { startJobs, stopJobs, getAgenda } = await import('../src/core/jobs/agenda.js');
  await startJobs();
  const agenda = getAgenda();

  const names = Object.keys(agenda.definitions || {});
  check('jobs are registered', names.length > 0, names.join(', '));
  check('and every one has a callable processor',
    names.every((n) => typeof agenda.definitions[n]?.fn === 'function'),
    names.filter((n) => typeof agenda.definitions[n]?.fn !== 'function').join(', ') || 'all callable');

  /**
   * PROVE THE JOB BODY RAN, by its side effect.
   *
   * Two weaker checks were tried first and both were wrong:
   *
   *   - listening for `success:` in this process — the running server has its
   *     own Agenda on the same queue and usually does the work, so the event
   *     never fires here even though the job ran perfectly;
   *   - polling the job row for `lastFinishedAt` — Agenda removes a completed
   *     one-off job, so the row vanishes and "gone" is indistinguishable from
   *     "never picked up".
   *
   * So: plant a task whose reminder is already due, push the sweep, and see
   * whether the task comes back stamped. That is the same thing the outage
   * broke, observed the same way a user would notice it.
   */
  const { CrmTask: TaskModel } = await import('../src/modules/crm/tasks/task.model.js');
  const { User } = await import('../src/modules/auth/auth.model.js');

  const { withTenant, withoutTenant } = await import('../src/core/tenancy/tenantContext.js');
  const me = await withoutTenant('smoke test resolves its own user', () => User
    .findOne({ email: EMAIL }).select('_id tenant').lean());

  /* Created INSIDE the user's company, because this is meant to behave like
     the product rather than like a script. A canary written with no company
     would be invisible to every scoped query, and the sweep's notification
     would be orphaned with it — which is the exact bug this smoke run exists
     to notice. */
  const canary = await withTenant(me.tenant, () => TaskModel.create({
    title: `SMOKE reminder canary ${Date.now()}`,
    owner: me._id,
    dueAt: new Date(Date.now() + 10 * 60_000),
    // 60 minutes before a due date 10 minutes away → due 50 minutes ago.
    reminderOffsetMinutes: 60,
  }));
  check('the canary belongs to a company', Boolean(canary.tenant),
    canary.tenant ? String(canary.tenant) : 'NONE — it would be invisible');

  await agenda.now('crm.tasks.sweepReminders');

  let stamped = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const row = await TaskModel.findById(canary._id).select('reminderSentAt').lean();
    if (row?.reminderSentAt) { stamped = row.reminderSentAt; break; }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 700));
  }

  check(
    'the reminder sweep ran through the queue and did its work',
    Boolean(stamped),
    stamped ? `canary reminded at ${new Date(stamped).toISOString()}` : 'the canary was never reminded',
  );

  await TaskModel.deleteOne({ _id: canary._id });

  /* ── Tidy up ─────────────────────────────────────────────── */
  const { Deal } = await import('../src/modules/crm/deals/deal.model.js');
  const { CrmTask } = await import('../src/modules/crm/tasks/task.model.js');
  const { CrmActivity } = await import('../src/modules/crm/activities/crmActivity.model.js');
  if (dealId) {
    await Promise.all([
      Deal.deleteOne({ _id: dealId }),
      CrmActivity.deleteMany({ entityId: dealId }),
      CrmTask.deleteMany({ entityId: dealId }),
    ]);
  }
  if (taskId) await CrmTask.deleteOne({ _id: taskId });
  await stopJobs();
  await mongoose.disconnect();

  const failed = results.filter((r) => !r).length;
  console.log(`\n${'='.repeat(56)}`);
  console.log(`CRM SMOKE   ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(async (err) => {
  console.error('\nSmoke test crashed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
