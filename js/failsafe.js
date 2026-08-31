// Offline failsafe: a submission the Azure proxy will not take must never be
// lost. It is queued in localStorage, re-sent automatically once the proxy
// answers again, and can be downloaded as a tab-separated file at any time.
import { endpoint, linkToken, isQrLink, STORAGE } from './config.js';
import { getSavedKey, clearSavedKey, isCredentialFault, showLogin } from './auth.js';

const RETRY_MS     = 60_000;
const MAX_ATTEMPTS = 20;

// Only a supporter's own device has a daily code and somewhere to put a file.
// One-time links and QR links are student flows: they carry their own
// credentials (or none, as before) and must never see a login prompt.
const isSupporterDevice = !linkToken && !isQrLink;

const COLUMNS = [
  'saved_at','role','student_number','username','satisfaction',
  'course_number','building','workshop','used_ai'
];

/* ---------------------------------------------------------------- queue --- */

function readQueue() {
  try { return JSON.parse(localStorage.getItem(STORAGE.FAILSAFE) || '[]'); }
  catch { return []; }
}

function writeQueue(records) {
  try { localStorage.setItem(STORAGE.FAILSAFE, JSON.stringify(records)); return true; }
  catch (err) { console.error('failsafe: queue write failed:', err); return false; }
}

const pendingCount = () => readQueue().length;

/** Queue a submission that could not be delivered. */
export function saveFailedSubmission(payload, reason = 'network error') {
  const stored = writeQueue(readQueue().concat({
    ts: new Date().toISOString(),
    reason,
    payload
  }));
  notify();
  return { stored, pending: pendingCount() };
}

/* ------------------------------------------------------------- download --- */

function tsv(rec) {
  const p = rec.payload || {};
  const cell = (v) => (v === null || v === undefined || v === '')
    ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim();
  return [
    rec.ts, p.role, p.student_number, p.username, p.satisfaction,
    p.course_number, p.building_Number,
    p.workshop ? 'yes' : 'no', p.used_ai ? 'yes' : 'no'
  ].map(cell).join('\t');
}

/**
 * Hand over everything still queued as one tab-separated file. Always a
 * complete snapshot, so downloading twice gives two identical copies rather
 * than two halves — nobody should lose responses to a mistimed click. Records
 * still stay queued and are re-sent as usual once the proxy is back.
 */
export function downloadBackupFile() {
  const records = readQueue();
  if (!records.length) return 0;

  const text = `${COLUMNS.join('\t')}\n${records.map(tsv).join('\n')}\n`;
  const url  = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `python-support-survey-backup-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  // Records the proxy has refused for good will never go up, and the file is
  // now their only home
  writeQueue(records.filter(r => !r.rejected));
  notify();
  return records.length;
}

/* ------------------------------------------------------------------ retry --- */

let retrying = false;

/** Re-send everything queued. Records the backend rejects are kept, not retried. */
export async function retryPending() {
  if (retrying || !navigator.onLine) return 0;
  const records = readQueue();
  if (!records.length) return 0;

  retrying = true;
  let sent = 0;
  try {
    for (const rec of records) {
      if (rec.rejected || (rec.attempts || 0) >= MAX_ATTEMPTS) continue;

      const headers = { 'Content-Type': 'application/json' };
      if (rec.payload?.token) headers['x-token'] = rec.payload.token;
      else headers['x-api-key'] = getSavedKey()[1] || '';

      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST', headers, body: JSON.stringify(rec.payload)
        });
      } catch { break; }

      if (response.ok) { rec.sent = true; sent++; }
      else if (isSupporterDevice && isCredentialFault(response.status)) {
        clearSavedKey();
        showLogin();
        break;
      }
      else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        rec.rejected = true;
        rec.reason = `${rec.reason} / rejected ${response.status}`;
      } else {
        rec.attempts = (rec.attempts || 0) + 1;
      }
    }
  } finally {
    retrying = false;
  }

  writeQueue(records.filter(r => !r.sent));
  if (sent) notify();
  return sent;
}

/* --------------------------------------------------------------------- UI --- */

const listeners = new Set();
function notify() { const n = pendingCount(); listeners.forEach(fn => { try { fn(n); } catch {} }); }

export function wireFailsafe() {
  const saveBtn = document.getElementById('saveBackupBtn');
  const tab     = document.getElementById('backupTab');
  const tabCnt  = document.getElementById('backupCount');

  saveBtn?.addEventListener('click', () => {
    const n = downloadBackupFile();
    saveBtn.textContent = n ? `Downloaded ${n} response${n === 1 ? '' : 's'}` : 'Nothing to save';
  });
  tab?.addEventListener('click', (e) => { e.preventDefault(); downloadBackupFile(); });

  const render = (n) => {
    const show = !!(n && isSupporterDevice);
    if (saveBtn) {
      saveBtn.classList.toggle('hidden', !show);
      saveBtn.textContent = 'Download backup file';
    }
    if (tab) {
      tab.classList.toggle('hidden', !show);
      tab.classList.toggle('flex', show);
      if (tabCnt) tabCnt.textContent = String(n);
    }
  };
  listeners.add(render);
  render(pendingCount());

  window.addEventListener('online', () => { retryPending(); });
  setInterval(() => { if (pendingCount()) retryPending(); }, RETRY_MS);
  retryPending();
}
