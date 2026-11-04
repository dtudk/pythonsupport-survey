// Run with: node --test 'frontend/tests/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.location = { search: '', pathname: '/' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

// Imported after the stubs, since config.js and auth.js read them at load.
const { STORAGE } = await import('../js/config.js');
const { saveFailedSubmission, retryPending } = await import('../js/failsafe.js');

const queue = () => JSON.parse(localStorage.getItem(STORAGE.FAILSAFE) || '[]');
const tick = () => new Promise(r => setTimeout(r, 2));

test('a response queued while a retry is in flight is kept', async () => {
  store.clear();
  saveFailedSubmission({ satisfaction: 1 });
  let answer;
  globalThis.fetch = () => new Promise(r => { answer = r; });

  const retry = retryPending();
  await tick();
  saveFailedSubmission({ satisfaction: 2 });
  answer({ ok: true, status: 201 });
  await retry;

  assert.deepEqual(queue().map(r => r.payload.satisfaction), [2]);
});

test('each answer sends, rejects or keeps the records', async () => {
  const state = r => !r ? 'sent' : r.rejected ? 'rejected' : 'kept';
  for (const [answer, expected] of [[201, 'sent'], [400, 'rejected'], [502, 'kept'], [429, 'kept'], ['network', 'kept']]) {
    store.clear();
    saveFailedSubmission({ satisfaction: 1 });
    await tick();
    saveFailedSubmission({ satisfaction: 2 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (answer === 'network') throw new TypeError('Failed to fetch');
      return { ok: answer < 300, status: answer };
    };
    await retryPending();
    assert.deepEqual(queue().map(state), expected === 'sent' ? [] : [expected, expected], String(answer));
    assert.equal(calls, answer === 'network' ? 1 : 2, `${answer}: a network error stops the pass`);

    // The next pass, with the server back: kept records go up, rejected ones never do.
    globalThis.fetch = async () => ({ ok: true, status: 201 });
    await retryPending();
    assert.deepEqual(queue().map(state), expected === 'rejected' ? ['rejected', 'rejected'] : [], String(answer));
  }
});

test('a 403 on a supporter device keeps the record and asks for the login again', async () => {
  store.clear();
  localStorage.setItem(STORAGE.AUTH, '2026-11-02|token');
  saveFailedSubmission({ satisfaction: 1 });
  let modalHidden = true;
  globalThis.document = {
    getElementById: id => ({
      classList: { add() {}, remove(c) { if (id === 'loginModal' && c === 'hidden') modalHidden = false; } },
      focus() {}, select() {},
    }),
  };
  globalThis.fetch = async () => ({ ok: false, status: 403 });

  await retryPending();

  assert.deepEqual(queue().map(r => r.rejected), [undefined]);
  assert.equal(localStorage.getItem(STORAGE.AUTH), null);
  assert.equal(modalHidden, false);
});

test('a retry request has a deadline', async () => {
  store.clear();
  saveFailedSubmission({ satisfaction: 1 });
  let signal;
  globalThis.fetch = async (url, options) => { signal = options.signal; return { ok: true, status: 201 }; };
  await retryPending();
  assert.ok(signal instanceof AbortSignal);
});

test('a record is still sent after a long run of server errors', async () => {
  store.clear();
  saveFailedSubmission({ satisfaction: 1 });
  globalThis.fetch = async () => ({ ok: false, status: 502 });
  for (let i = 0; i < 25; i++) await retryPending();

  globalThis.fetch = async () => ({ ok: true, status: 201 });
  assert.equal(await retryPending(), 1);
  assert.deepEqual(queue(), []);
});
