process.env.MONGO_URI ||= 'mongodb://localhost:27017/x';
process.env.JWT_ACCESS_SECRET ||= 'aaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET ||= 'bbbbbbbbbbbbbbbbbbbb';
process.env.XAI_API_KEY = 'xai-test';
process.env.XAI_SEARCH_MODE = process.argv[2] || 'auto';
process.env.LOG_LEVEL = 'error';

const calls = [];
const reply = (obj, status = 200) => ({ ok: status < 300, status, headers: new Map(), text: async () => JSON.stringify(obj) });
let script = [];
globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return script.shift()(); };

const grok = (await import('./src/modules/ai/providers/grok.provider.js')).default;
const mode = process.argv[2];

if (mode === 'on') {
  script = [() => reply({ error: 'search credits exhausted' }, 403)];
  try {
    await grok.research({ system: 's', prompt: 'p' });
    console.log('mode=on   : NO THROW  <-- wrong');
  } catch (e) {
    console.log('mode=on   : threw ProviderError as required |', e.status, '|', e.message.slice(0, 52));
  }
}

if (mode === 'off') {
  script = [() => reply({ choices: [{ message: { content: 'text' } }], usage: {} })];
  const r = await grok.research({ system: 's', prompt: 'p' });
  console.log('mode=off  : sent search_parameters?', 'search_parameters' in calls[0], '| grounded=' + r.grounded);
  console.log('            describe().grounding =', grok.describe().grounding);
}

if (mode === 'auto') {
  /* titled search_results preferred over bare citation urls */
  script = [() => reply({
    choices: [{ message: { content: 'brief', search_results: [{ url: 'https://x.com/a', title: 'Colleges near HSR' }] } }],
    citations: ['https://ignored.com'], usage: {},
  })];
  const r = await grok.research({ system: 's', prompt: 'p' });
  console.log('titles    :', JSON.stringify(r.citations));

  /* synthesize: strict schema, then json_object fallback */
  calls.length = 0;
  const schema = { type: 'object', properties: { verdict: { type: 'string' } }, propertyOrdering: ['verdict'] };
  script = [() => reply({ choices: [{ message: { content: '```json\n{"verdict":"viable"}\n```' } }], usage: { prompt_tokens: 9 } })];
  let s = await grok.synthesize({ system: 's', prompt: 'p', schema, schemaName: 'rep' });
  const fmt = calls[0].response_format;
  console.log('synth ok  :', JSON.stringify(s.json), '| format=' + fmt.type, 'strict=' + fmt.json_schema.strict,
    '| addlProps=' + fmt.json_schema.schema.additionalProperties, '| geminiKeyStripped=' + !('propertyOrdering' in fmt.json_schema.schema));

  calls.length = 0;
  script = [
    () => reply({ error: 'response_format json_schema is not supported' }, 400),
    () => reply({ choices: [{ message: { content: '{"verdict":"weak"}' } }], usage: {} }),
  ];
  s = await grok.synthesize({ system: 's', prompt: 'p', schema });
  console.log('synth fbk :', calls.length, 'calls | 2nd format=' + calls[1].response_format.type, '|', JSON.stringify(s.json));
}
