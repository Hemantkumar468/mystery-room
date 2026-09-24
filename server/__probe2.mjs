process.env.MONGO_URI ||= 'mongodb://localhost:27017/x';
process.env.JWT_ACCESS_SECRET ||= 'aaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET ||= 'bbbbbbbbbbbbbbbbbbbb';
process.env.XAI_API_KEY = 'xai-test';
process.env.AI_PROVIDER = 'grok';
process.env.LOG_LEVEL = 'error';

const calls = [];
const reply = (obj, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Map(),
  text: async () => JSON.stringify(obj),
});
let script = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  const next = script.shift();
  return next(body);
};

const grok = (await import('./src/modules/ai/providers/grok.provider.js')).default;
const ok = (extra = {}) => reply({
  choices: [{ message: { content: 'RESEARCH BRIEF TEXT' } }],
  citations: ['https://a.com/x', 'https://a.com/x', 'https://b.com/y'],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, num_sources_used: 7 },
  ...extra,
});

/* 1. happy path */
calls.length = 0; script = [() => ok()];
let r = await grok.research({ system: 's', prompt: 'p' });
console.log('1 happy   :', r.provider, r.model, '| grounded=' + r.grounded, '| searchCount=' + r.searchCount,
  '| citations=' + r.citations.length, '| tokens=' + r.usage.totalTokens);
console.log('  sent search_parameters:', JSON.stringify(calls[0].search_parameters?.mode), 'sources=' + calls[0].search_parameters?.sources?.length, 'temp=' + calls[0].temperature);

/* 2. temperature rejected -> retried without it */
calls.length = 0;
script = [
  () => reply({ error: 'temperature is not supported for this model' }, 400),
  () => ok(),
];
r = await grok.research({ system: 's', prompt: 'p' });
console.log('2 no-temp :', calls.length, 'calls | 2nd has temperature?', 'temperature' in calls[1], '| grounded=' + r.grounded);

/* 3. search entitlement missing -> ungrounded fallback */
calls.length = 0;
script = [
  () => reply({ code: 403, error: 'Your team does not have credits for search' }, 403),
  () => ok({ citations: [] }),
];
r = await grok.research({ system: 's', prompt: 'p' });
console.log('3 nosearch:', calls.length, 'calls | 2nd sent search_parameters?', 'search_parameters' in calls[1],
  '| grounded=' + r.grounded, '| citations=' + r.citations.length);

/* 3b. same failure with mode=on -> must throw */
process.env.XAI_SEARCH_MODE = 'on';
