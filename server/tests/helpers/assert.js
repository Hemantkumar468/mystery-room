/* eslint-disable no-console */
/**
 * Minimal assertion helpers shared by the regression suites.
 *
 * Deliberately dependency-free: these suites drive the real services against
 * a real MongoDB, so what they need is clear reporting and an exit code, not
 * a test framework. Adding one would be a build-tooling decision of its own.
 */
const state = { pass: 0, fail: 0 };

export const ok = (name, detail = '') => {
  state.pass += 1;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
};

export const no = (name, detail = '') => {
  state.fail += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Run `fn`, expecting it to succeed. Rethrows so a broken fixture stops the suite. */
export async function step(name, fn) {
  try {
    const value = await fn();
    ok(name);
    return value;
  } catch (err) {
    no(name, `[${err.code}] ${err.message}`);
    throw err;
  }
}

/** Run `fn`, expecting it to be REJECTED — optionally with a specific error code. */
export async function denies(name, fn, code) {
  try {
    await fn();
    no(name, 'expected a rejection, but the call SUCCEEDED');
  } catch (err) {
    if (code && err.code !== code) no(name, `code=${err.code}, expected=${code} — ${err.message}`);
    else ok(name, String(err.code ?? ''));
  }
}

/** Run `fn`, expecting rejection whose message matches `re`. */
export async function refusesWith(name, fn, re) {
  try {
    await fn();
    no(name, 'expected a refusal, but the call SUCCEEDED');
  } catch (err) {
    (re.test(err.message) ? ok : no)(name, err.message.slice(0, 80));
  }
}

export const counts = () => ({ ...state });

/** Print the summary and exit non-zero if anything failed. */
export function finish(label) {
  console.log(`\n${'='.repeat(60)}\n${label}   ${state.pass} passed, ${state.fail} failed`);
  return state.fail;
}
