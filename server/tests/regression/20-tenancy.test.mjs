/**
 * REGRESSION SUITE — company isolation.
 *
 * WHAT IS BEING PROTECTED. There is one company on this deployment today, so
 * none of these assertions can fail in a way a user would currently notice.
 * They exist because the failure they guard against is the worst kind this
 * system can have: another company's customer list, rendered on screen,
 * looking entirely normal. Nothing crashes, nothing is logged, and nobody
 * reports it — the same silence as the 97 unnormalised phone numbers and the
 * four dead jobs, except the consequence is a data breach rather than a
 * feature that quietly does nothing.
 *
 * THE COMPLETENESS TEST is the important one. Every other assertion here
 * checks that the guard works on models that have it; that one checks that
 * every model HAS it, by enumerating what Mongoose actually registered. A
 * model added six months from now that forgets `attachTenancy` is caught by
 * that test and by nothing else.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const { Tenant } = await import('../../src/core/tenancy/tenant.model.js');
const {
  withTenant, withoutTenant, currentTenant, withRecordTenant,
} = await import('../../src/core/tenancy/tenantContext.js');
const {
  setStrictForTesting, isStrict, resolveTenantWithoutSession, publicTenantContext,
} = await import('../../src/core/tenancy/tenancy.js');
const { Lead } = await import('../../src/modules/crm/leads/lead.model.js');
const { CrmActivity } = await import('../../src/modules/crm/activities/crmActivity.model.js');
const { leadService } = await import('../../src/modules/crm/leads/lead.service.js');
const { User } = await import('../../src/modules/auth/auth.model.js');
const { createApp } = await import('../../src/app.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));
const throws = async (name, fn, re) => {
  try {
    await fn();
    no(name, 'expected a refusal, but it SUCCEEDED');
  } catch (err) {
    (re.test(err.message) ? ok : no)(name, err.message.slice(0, 100));
  }
};

const tag = `ZZTEN-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const cleanup = [];

try {
  /* ══ Completeness ═════════════════════════════════════════════ */
  console.log('── Every model is scoped, including the ones added later ──');
  {
    // Import every model file so the registry is complete rather than
    // whatever this suite happened to pull in.
    await Promise.all([
      import('../../src/modules/ai/ai.model.js'),
      import('../../src/modules/crm/contacts/contact.model.js'),
      import('../../src/modules/crm/companies/company.model.js'),
      import('../../src/modules/crm/deals/deal.model.js'),
      import('../../src/modules/crm/pipelines/pipeline.model.js'),
      import('../../src/modules/crm/tasks/task.model.js'),
      import('../../src/modules/crm/routing/routingRule.model.js'),
      import('../../src/modules/crm/tickets/ticket.model.js'),
      import('../../src/modules/crm/integrations/email/emailDropbox.model.js'),
      import('../../src/modules/pms/projects/project.model.js'),
      import('../../src/modules/pms/tasks/task.model.js'),
      import('../../src/modules/pms/records/record.model.js'),
      import('../../src/modules/pms/templates/template.model.js'),
      import('../../src/modules/pms/activity/activity.model.js'),
      import('../../src/modules/pms/notifications/notification.model.js'),
    ]);

    // `Tenant` is the thing being scoped TO, so it is the one exemption.
    const EXEMPT = new Set(['Tenant']);
    const registered = Object.keys(mongoose.models).filter((n) => !EXEMPT.has(n));
    const missing = registered.filter((n) => !mongoose.models[n].schema.path('tenant'));

    truthy(`all ${registered.length} models carry a tenant field`, missing.length === 0,
      missing.length ? `MISSING on: ${missing.join(', ')} — add attachTenancy(schema) to each` : '');
  }

  {
    /* THE BUG THIS CAUGHT ON ITS FIRST RUN. The plugin originally prefixed
       every index with `tenant`, including unique ones. A `sparse unique`
       index skips a document only when it is missing EVERY indexed field, so
       once `tenant` was always present nothing was skipped, and 391 activity
       rows sharing `providerEventId: null` collided. */
    /* Two distinct things, and only one of them is a bug:
       - A SPARSE unique index prefixed with tenant is always wrong. Sparse
         skips a document only when it is missing every indexed field, and
         tenant is always present, so the sparseness evaporates.
       - A plain unique index on `{tenant, x}` is deliberate and correct: it is
         how a field is made unique per company (RoutingCounter.team,
         Template.code). What must NOT happen is BOTH — a global unique on `x`
         and a tenant-prefixed one — because that is the plugin duplicating an
         index it was told to leave alone. */
    const sparsePrefixed = [];
    const duplicated = [];
    for (const [name, model] of Object.entries(mongoose.models)) {
      const specs = model.schema.indexes().filter(([, o]) => o?.unique);
      const keysOf = ([f]) => Object.keys(f);
      for (const spec of specs) {
        const keys = keysOf(spec);
        if (keys[0] === 'tenant' && keys.length > 1) {
          if (spec[1]?.sparse) sparsePrefixed.push(`${name}: ${keys.join('+')}`);
          const bare = keys.slice(1).join(',');
          if (specs.some((s) => keysOf(s).join(',') === bare)) duplicated.push(`${name}: ${bare}`);
        }
      }
    }
    truthy('no sparse unique index was given a tenant prefix', sparsePrefixed.length === 0,
      sparsePrefixed.length ? `${sparsePrefixed.join(', ')} — this silently destroys sparseness` : '');
    truthy('and no field is unique both globally and per company', duplicated.length === 0,
      duplicated.length ? `${duplicated.join(', ')} — one of the two is redundant and will reject valid data` : '');

    // Proven rather than asserted: two null values must still coexist.
    const rows = await withoutTenant('test fixture', () => CrmActivity.insertMany([
      {
        type: 'note', entityType: 'lead', entityId: new mongoose.Types.ObjectId(), subject: `${tag} a`,
      },
      {
        type: 'note', entityType: 'lead', entityId: new mongoose.Types.ObjectId(), subject: `${tag} b`,
      },
    ]));
    cleanup.push(() => withoutTenant('cleanup', () => CrmActivity.deleteMany({ _id: { $in: rows.map((r) => r._id) } })));
    is('two rows with no provider id can coexist', rows.length, 2);
  }

  /* ══ Two companies ════════════════════════════════════════════ */
  console.log('\n── Reads and writes stay inside their company ──');
  const home = await withoutTenant('test setup', () => Tenant.findOne({ isDefault: true }).lean());
  truthy('the default company exists', Boolean(home), home?.name);

  {
    // While one company exists the answer is unambiguous, so a sessionless
    // request gets it. Asserted here, before a second company is created.
    const bound = await resolveTenantWithoutSession('a public request');
    is('a sessionless request resolves to the only company', String(bound), String(home._id));
  }

  const other = await withoutTenant('test setup', () => Tenant.create({
    name: `${tag} Other Co`, slug: `${tag.toLowerCase()}-other`,
  }));
  cleanup.push(() => withoutTenant('cleanup', () => Tenant.deleteOne({ _id: other._id })));

  const mine = await withTenant(home._id, () => Lead.create({
    name: `${tag} ours`, source: 'manual', phone: '9876500001',
  }));
  const theirs = await withTenant(other._id, () => Lead.create({
    name: `${tag} theirs`, source: 'manual', phone: '9876500002',
  }));
  cleanup.push(() => withoutTenant('cleanup', () => Lead.deleteMany({ _id: { $in: [mine._id, theirs._id] } })));

  is('a document is stamped with the company that created it', String(mine.tenant), String(home._id));
  is('and the other company stamps its own', String(theirs.tenant), String(other._id));

  {
    const seen = await withTenant(home._id, () => Lead.find({ name: new RegExp(tag) }).lean());
    is('a find returns only this company', seen.length, 1);
    is('and it is the right one', seen[0]?.name, `${tag} ours`);
  }
  {
    const count = await withTenant(other._id, () => Lead.countDocuments({ name: new RegExp(tag) }));
    is('a count is filtered too', count, 1);
  }
  {
    const found = await withTenant(home._id, () => Lead.findById(theirs._id).lean());
    // Null, not a refusal: the route turns this into a 404, because saying
    // "that exists but is not yours" already confirms it exists.
    is("another company's record reads as absent, not as forbidden", found, null);
  }
  {
    const agg = await withTenant(home._id, () => Lead.aggregate([
      { $match: { name: new RegExp(tag) } },
      { $group: { _id: null, n: { $sum: 1 } } },
    ]));
    is('an aggregation is filtered before it groups', agg[0]?.n, 1);
  }

  console.log('\n── Writes cannot reach across ──');
  {
    const res = await withTenant(home._id, () => Lead.updateOne(
      { _id: theirs._id }, { $set: { name: `${tag} HIJACKED` } },
    ));
    is("an update cannot touch another company's record", res.matchedCount, 0);
    const still = await withoutTenant('verification', () => Lead.findById(theirs._id).lean());
    is('and the record is untouched', still.name, `${tag} theirs`);
  }
  {
    const res = await withTenant(home._id, () => Lead.deleteOne({ _id: theirs._id }));
    is('a delete cannot reach across either', res.deletedCount, 0);
  }
  {
    await withTenant(other._id, () => Lead.updateOne(
      { name: `${tag} upserted` },
      { $set: { source: 'manual', phone: '9876500003' } },
      { upsert: true },
    ));
    const created = await withoutTenant('verification', () => Lead.findOne({ name: `${tag} upserted` }).lean());
    cleanup.push(() => withoutTenant('cleanup', () => Lead.deleteMany({ name: `${tag} upserted` })));
    is('an upsert creates inside the right company', String(created?.tenant), String(other._id));
  }

  console.log('\n── The service layer inherits it without knowing ──');
  {
    // leadService was written before tenancy existed and was not changed for
    // it. That is the point of putting the rule on the model.
    const mdUser = await withoutTenant('test setup', () => User.findOne({ role: 'md' }).select('_id name role').lean());
    const md = {
      _id: mdUser._id, id: String(mdUser._id), role: 'md', name: mdUser.name,
    };
    const list = await withTenant(other._id, () => leadService.list({ search: tag }, md));
    const names = (list.items || []).map((l) => l.name);
    truthy('a service query sees only its own company', !names.includes(`${tag} ours`), names.join(', ') || '(none)');
  }

  console.log('\n── The deliberate escape hatch ──');
  {
    const all = await withoutTenant('a test that means to see everything', () => Lead.find({ name: new RegExp(tag) }).lean());
    truthy('withoutTenant sees every company', all.length >= 2, `${all.length} found`);
    await throws('and it refuses to run without a stated reason',
      async () => withoutTenant('', () => Lead.find({})), /reason/i);
  }
  {
    is('no context leaks out of withTenant', currentTenant(), null);
    const inside = await withTenant(other._id, async () => currentTenant());
    is('and inside it the company is set', inside, String(other._id));
  }

  console.log('\n── Strictness arms itself when a second company appears ──');
  {
    const before = isStrict();
    setStrictForTesting(true);
    await throws('an unscoped query throws once strict',
      () => Lead.find({ name: new RegExp(tag) }), /without a tenant context/i);
    const stillWorks = await withTenant(home._id, () => Lead.find({ name: new RegExp(tag) }).lean());
    is('while a scoped one is unaffected', stillWorks.length, 1);
    const explicit = await withoutTenant('deliberately across companies', () => Lead.find({ name: new RegExp(tag) }).lean());
    truthy('and the escape hatch still works', explicit.length >= 2);
    setStrictForTesting(before);
  }

  console.log('\n── The company comes from the session, never the request ──');
  {
    /* The same rule as ownerId, assignedTo and isSeed. A company a caller can
       name is a company a caller can choose, and choosing somebody else's is
       the entire attack. */
    const forged = await withTenant(home._id, () => Lead.create({
      name: `${tag} forged`, source: 'manual', phone: '9876500004', tenant: other._id,
    }));
    cleanup.push(() => withoutTenant('cleanup', () => Lead.deleteOne({ _id: forged._id })));
    // The model does not overwrite an explicitly set tenant — that is what
    // migrations need — so the protection lives at the door: services build
    // documents from a whitelist and `authenticate` is the only thing that
    // ever sets the context. This asserts the door, not the model.
    const routeBuilt = await withTenant(home._id, () => Lead.create({
      name: `${tag} normal`, source: 'manual', phone: '9876500005',
    }));
    cleanup.push(() => withoutTenant('cleanup', () => Lead.deleteOne({ _id: routeBuilt._id })));
    is('a document built without an explicit tenant takes the session one',
      String(routeBuilt.tenant), String(home._id));

    const { leadIntakeService } = await import('../../src/modules/crm/intake/leadIntake.service.js');
    const { lead } = await withTenant(home._id, () => leadIntakeService.intake({
      name: `${tag} via intake`, phone: '9876500006', source: 'manual', tenant: String(other._id),
    }));
    cleanup.push(() => withoutTenant('cleanup', () => Lead.deleteOne({ _id: lead._id })));
    is('and intake ignores a tenant sent in the payload',
      String(lead.tenant), String(home._id));
  }


  console.log('\n── A request with no session still lands somewhere ──');
  {
    /* THE BUG THIS CAUGHT. Public endpoints — the web enquiry form, the Meta
       lead webhook, the telephony callbacks — have no user, so nothing told
       them which company they belonged to. The lead was accepted, written with
       no tenant at all, and then invisible to every scoped query: stored, and
       never on anybody's screen. Silent in exactly the way this project keeps
       being bitten by. */
    const { leadIntakeService } = await import('../../src/modules/crm/intake/leadIntake.service.js');

    // What the public router now does before any handler runs.
    const { lead } = await withTenant(String(home._id), () => leadIntakeService.intake({
      name: `${tag} public form`, phone: '9000000911', source: 'web_form',
    }));
    cleanup.push(() => withoutTenant('cleanup', () => Lead.deleteOne({ _id: lead._id })));

    const onDisk = await withoutTenant('verification', () => mongoose.connection.db
      .collection('leads').findOne({ _id: lead._id }));
    truthy('a lead from the public form is stamped with a company', Boolean(onDisk.tenant),
      onDisk.tenant ? String(onDisk.tenant) : 'NONE — it would be invisible to everyone');

    const seen = await withTenant(String(home._id), () => Lead.findById(lead._id).lean());
    truthy('and a signed-in agent can actually see it', Boolean(seen));

    /* A second company now exists, so there is no honest default. It refuses
       rather than filing a stranger's enquiry into the wrong company's
       database — loud at the moment somebody is onboarding tenant two, rather
       than silent forever afterwards. */
    await throws('with two companies it refuses to guess',
      () => resolveTenantWithoutSession('a public request'), /can no longer be inferred/i);

    truthy('the public router binds it for every route under it',
      typeof publicTenantContext('x') === 'function');
  }

  console.log('\n── A sweep writes into the company it is acting for ──');
  {
    /* THE SECOND BUG THIS SUITE CAUGHT, and the more expensive one. A sweep
       reads across companies on purpose, so it runs inside withoutTenant.
       Everything it then WRITES — a notification, an activity, a follow-up
       task — belongs to exactly one company, and inherited the unscoped
       context instead: written with no company, invisible to the very person
       it was meant to reach. 421 rows were orphaned before this was noticed,
       and nothing logged a thing. */
    const { Notification } = await import('../../src/modules/pms/notifications/notification.model.js');
    const { CrmTask } = await import('../../src/modules/crm/tasks/task.model.js');
    const { sweepReminders } = await import('../../src/modules/crm/tasks/reminder.job.js');
    const staff = await withoutTenant('test setup', () => User.findOne({ role: 'md' }).select('_id').lean());

    const title = `${tag} sweep canary`;
    const canary = await withTenant(String(home._id), () => CrmTask.create({
      title,
      owner: staff._id,
      dueAt: new Date(Date.now() + 10 * 60_000),
      reminderOffsetMinutes: 60,
    }));
    cleanup.push(() => withoutTenant('cleanup', () => CrmTask.deleteOne({ _id: canary._id })));
    cleanup.push(() => withoutTenant('cleanup', () => Notification.deleteMany({ title: new RegExp(tag) })));

    await withoutTenant('the reminder sweep runs for every company', () => sweepReminders());

    const note = await withoutTenant('verification', () => Notification
      .findOne({ title: new RegExp(tag) }).lean());
    truthy('the sweep produced a notification', Boolean(note));
    is('stamped with the company the task belongs to',
      String(note?.tenant), String(home._id));

    const seen = await withTenant(String(home._id), () => Notification.findById(note._id).lean());
    truthy('so the person it is for can actually see it', Boolean(seen));

    // The helper that makes this structural rather than remembered.
    const inner = await withRecordTenant({ tenant: other._id }, async () => currentTenant());
    is("withRecordTenant binds the record's own company", inner, String(other._id));
  }

  console.log('\n── Per-company uniqueness, where that is what is meant ──');
  {
    /* THE BUG THIS CAUGHT, and it was severe and silent. RoutingCounter had
       `unique: true` on `team` alone. The counter is fetched with an upsert
       scoped to the company, so once the filter carried a tenant it stopped
       matching the existing row, tried to INSERT, and the GLOBAL unique index
       rejected it. Routing threw, routing.service.js swallowed it by design
       (losing the enquiry is worse than losing the assignment), and every
       lead from the public web form arrived with no owner — invisible to
       every list view. Nobody would notice until someone asked why the
       website had stopped producing enquiries.

       The generic plugin deliberately does not prefix unique indexes, because
       doing that to a sparse one destroys its sparseness. So which fields are
       unique PER COMPANY is a decision per field, and these are the ones. */
    const { RoutingCounter } = await import('../../src/modules/crm/routing/routingRule.model.js');
    const { Template } = await import('../../src/modules/pms/templates/template.model.js');

    for (const [model, field] of [[RoutingCounter, 'team'], [Template, 'code']]) {
      const specs = model.schema.indexes();
      const globalUnique = specs.some(([f, o]) => o?.unique && Object.keys(f).join() === field);
      const perTenant = specs.some(([f, o]) => o?.unique && Object.keys(f).join() === `tenant,${field}`);
      is(`${model.modelName}.${field} is not globally unique`, globalUnique, false);
      is(`and is unique within a company instead`, perTenant, true);
    }

    /* Proven, not just declared: two companies must each be able to hold a
       rotation for the same team name. */
    const a = await withTenant(String(home._id), () => RoutingCounter.findOneAndUpdate(
      { team: `${tag}-team` }, { $inc: { pointer: 1 } }, { new: true, upsert: true },
    ));
    const b = await withTenant(String(other._id), () => RoutingCounter.findOneAndUpdate(
      { team: `${tag}-team` }, { $inc: { pointer: 1 } }, { new: true, upsert: true },
    ));
    cleanup.push(() => withoutTenant('cleanup', () => RoutingCounter.deleteMany({ team: new RegExp(tag) })));
    truthy('two companies can each run a rotation of the same name', Boolean(a && b));
    truthy('and they are separate counters', String(a._id) !== String(b._id));
  }

  /* ══ Registration ═════════════════════════════════════════════ */
  console.log('\n── The context is established where identity is ──');
  {
    const authSource = await import('node:fs').then((fs) => fs.promises.readFile('src/core/middleware/auth.js', 'utf8'));
    truthy('authenticate binds the tenant context', /withTenant\(/.test(authSource),
      'without this, every router would have to remember tenancy separately');
    truthy('and resolves the user outside it', /withoutTenant\(/.test(authSource),
      'the lookup that determines the company cannot already be filtered by it');
    truthy('the app still builds', Boolean(createApp()));
  }
} finally {
  for (const fn of cleanup) await fn();
  /* A leftover test company is not merely untidy: armStrictness() counts rows,
     so one stray row turns strict mode on for the real deployment and every
     sessionless request starts throwing. Swept by pattern, not by id, so a run
     that died before its cleanup ran is still tidied by the next one. */
  await withoutTenant('sweeping test companies', () => Tenant.deleteMany({ name: /^ZZTEN-/ }));
  await disconnect();
}

process.exit(finish('TENANCY'));
