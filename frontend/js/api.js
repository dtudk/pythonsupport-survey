// No DOM here, so the tests can import the decisions.
import { STORAGE } from './config.js';

// Above gunicorn's 30 s worker timeout.
const TIMEOUT_MS = 35_000;

// [date, csrfToken] from the last successful login.
export function getSavedKey() {
  try { const saved = localStorage.getItem(STORAGE.AUTH); return saved ? saved.split("|") : [null,null]; }
  catch { return [null,null]; }
}

// Never throws: status 0 means no answer, from a network error or the timeout. data is {} when
// the body isn't JSON, such as Django's HTML error pages.
export async function apiFetch(url, body = {}, timeout = TIMEOUT_MS) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getSavedKey()[1] || '' },
      body: JSON.stringify(body),
      // ?.(): older tablets lack AbortSignal.timeout; they get no deadline instead of no requests.
      signal: AbortSignal.timeout?.(timeout),
    });
  } catch {
    return { ok: false, status: 0, data: {} };
  }
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data: data ?? {} };
}

const isOk = status => status >= 200 && status < 300;
const isDown = status => status === 0 || status >= 500;

// Only the backend can check the code: when it can't answer, supporters get in offline.
export const loginResult = status => isOk(status) ? 'in' : isDown(status) ? 'offline' : 'wrong';

// Only a 403 means the link is gone. A server error says nothing about the link, and no answer at
// all stays silent: the submit will tell.
export const linkCheckResult = status =>
  status === 403 ? 'expired' : isOk(status) || status === 0 ? 'ok' : 'warn';

// Supporter devices queue what the backend can't take now; students' phones never do, so their
// form stays filled. Django answers 403 for an expired session.
export function submitResult(status, supporterDevice) {
  if (isOk(status)) return 'sent';
  if (!supporterDevice) return 'rejected';
  if (status === 403) return 'login';
  return isDown(status) || status === 429 ? 'queue' : 'rejected';
}
