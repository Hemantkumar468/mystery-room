/**
 * no-undef sweep — the check the Vite build does NOT do.
 *
 * esbuild compiles an undefined identifier happily; it only fails in the
 * browser, as a white screen. This catches that class before it ships.
 *
 * IT TREATS A PARSE ERROR AS A FAILURE, and that is the whole reason this file
 * exists as a committed script rather than a throwaway. The first version
 * filtered messages down to `ruleId === 'no-undef'`. A file ESLint cannot parse
 * produces exactly one message with `ruleId: null` — so an unparseable file
 * matched nothing, and the sweep printed CLEAN over a page that crashed on
 * load. It said "no undefined identifiers" about a file it had never read.
 *
 *   node scripts/undef-sweep.mjs 'src/features/**\/*.jsx'
 *   node scripts/undef-sweep.mjs src/features/projects/ProjectDetailPage.jsx
 */
import { ESLint } from 'eslint';
import globals from 'globals';
import { readFileSync } from 'fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/undef-sweep.mjs <files…>');
  process.exit(2);
}

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module', ecmaVersion: 'latest' },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    /* no-unused-vars is deliberately NOT enabled: without react/jsx-uses-vars
       it calls every component "unused" because a JSX reference does not count
       as a use, and 40 false positives is how a sweep gets ignored. */
    rules: { 'no-undef': 'error' },
  },
});

const short = (p) => p.split(/[\\/]/).slice(-1)[0];
let problems = 0;
let parsed = 0;

for (const r of await eslint.lintFiles(files)) {
  /* `fatal`, not `ruleId === null`. An unused eslint-disable comment also
     reports with a null ruleId and is harmless — treating it as a parse error
     produced eight false alarms and buried the one real finding. */
  const parseErr = r.messages.find((m) => m.fatal);
  if (parseErr) {
    problems += 1;
    console.log(`  PARSE   ${short(r.filePath)}:${parseErr.line}  ${parseErr.message}`);
    console.log('          → nothing was checked in this file; fix the syntax first');
    continue;
  }
  parsed += 1;
  for (const m of r.messages) {
    if (m.ruleId !== 'no-undef') continue;
    problems += 1;
    console.log(`  UNDEF   ${short(r.filePath)}:${m.line}  ${m.message}`);
  }
}

/* espree does not treat a JSX tag as a variable reference, so <Foo /> with no
   import sails past no-undef too. Same white screen, different shape. */
const declared = (src) => {
  const set = new Set();
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s*['"]/gs)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) set.add(name);
    }
  }
  for (const m of src.matchAll(/(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) set.add(m[1]);
  // `list.map((S, i) => <S />)` — an arrow parameter can be a component too.
  for (const m of src.matchAll(/\(\s*([A-Z][A-Za-z0-9_]*)\s*(?:,[^)]*)?\)\s*=>/g)) set.add(m[1]);
  // `function Stat({ icon: Icon })` renames a prop into a component name.
  for (const m of src.matchAll(/[:,{]\s*([A-Z][A-Za-z0-9_]*)\s*[,}=]/g)) set.add(m[1]);
  return set;
};

for (const f of files.filter((x) => x.endsWith('.jsx'))) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  /* Strip comments first. `<Route>` and friends are named in doc comments all
     over this codebase, and matching them there produced five confident
     findings about components nobody renders. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const have = declared(src);
  for (const tag of new Set([...code.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))) {
    if (!have.has(tag)) {
      problems += 1;
      console.log(`  JSX     ${short(f)}  <${tag}> is rendered but never imported or declared`);
    }
  }
}

console.log(problems === 0
  ? `  CLEAN — ${parsed} file(s) parsed and checked`
  : `  ${problems} problem(s) across ${files.length} file(s)`);
process.exit(problems ? 1 : 0);
