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

// Imported after the stubs, since config.js reads location at load.
const { STORAGE } = await import('../js/config.js');
const { apiFetch, loginResult, linkCheckResult, submitResult } = await import('../js/api.js');

// Status 0 is no answer: a network error or a timeout.
const table = (decide, rows) => {
  for (const [status, expected] of rows) assert.equal(decide(status), expected, `status ${status}`);
};

test('login: only no answer or a broken backend starts offline mode', () => {
  table(loginResult, [[200, 'in'], [403, 'wrong'], [400, 'wrong'], [429, 'wrong'], [500, 'offline'], [502, 'offline'], [0, 'offline']]);
});

test('link check: only a 403 locks the form', () => {
  table(linkCheckResult, [[200, 'ok'], [0, 'ok'], [403, 'expired'], [400, 'warn'], [500, 'warn'], [502, 'warn']]);
});

test('submit on a supporter device: queue what the backend cannot take now', () => {
  table(s => submitResult(s, true), [
    [201, 'sent'], [403, 'login'], [500, 'queue'], [502, 'queue'], [429, 'queue'], [0, 'queue'], [400, 'rejected'],
  ]);
});

test("submit on a student's phone: never queue", () => {
  table(s => submitResult(s, false), [[201, 'sent'], [403, 'rejected'], [502, 'rejected'], [0, 'rejected'], [400, 'rejected']]);
});

test('apiFetch sends the CSRF token, JSON and a deadline', async () => {
  store.set(STORAGE.AUTH, '2026-11-03|token');
  let sent;
  globalThis.fetch = async (_, options) => { sent = options; return new Response('{"id": 1}', { status: 201 }); };

  assert.deepEqual(await apiFetch('/api/responses/', { satisfaction: 5 }), { ok: true, status: 201, data: { id: 1 } });
  assert.equal(sent.headers['X-CSRFToken'], 'token');
  assert.equal(sent.body, '{"satisfaction":5}');
  assert.ok(sent.signal instanceof AbortSignal);
});

test('apiFetch never throws', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await apiFetch('/api/responses/'), { ok: false, status: 0, data: {} });

  globalThis.fetch = async () => new Response('<h1>Server Error (500)</h1>', { status: 500 });
  assert.deepEqual(await apiFetch('/api/responses/'), { ok: false, status: 500, data: {} });
});
