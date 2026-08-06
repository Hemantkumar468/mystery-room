process.env.MONGO_URI ||= 'mongodb://localhost:27017/x';
process.env.JWT_ACCESS_SECRET ||= 'aaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET ||= 'bbbbbbbbbbbbbbbbbbbb';
const { estimateCostUsd } = await import('./src/modules/ai/ai.constants.js');
for (const m of ['grok-4-fast-reasoning', 'grok-4-0709', 'grok-3-mini', 'gemini-2.5-pro', 'gpt-5', 'made-up-model'])
  console.log('  ', m.padEnd(24), '$' + estimateCostUsd(m, 200000, 20000));
// full app import — catches config/route wiring breakage
process.env.AI_PROVIDER = 'grok,gemini';
await import('./src/app.js');
console.log('\n  app.js imported OK with AI_PROVIDER=grok,gemini');
