// A submission the backend will not take is queued in localStorage, re-sent once the backend
// answers again, and can be downloaded as a tab-separated file.
import { endpoint, linkToken, isQrLink, STORAGE } from './config.js';
import { getSavedKey, clearSavedKey, isCredentialFault, showLogin } from './auth.js';

const RETRY_MS = 60_000;
// Above gunicorn's 30 s worker timeout. ?.(): older tablets lack AbortSignal.timeout.
export const SUBMIT_TIMEOUT_MS = 35_000;

// Link and QR flows are students: they must never see a login prompt.
const isSupporterDevice = !linkToken && !isQrLink;

const COLUMNS = [
  'saved_at','role','student_number','username','satisfaction',
  'course_number','building','workshop','used_ai'
];

function readQueue() {
  try { return JSON.parse(localStorage.getItem(STORAGE.FAILSAFE) || '[]'); }
  catch { return []; }
}

function writeQueue(records) {
  try { localStorage.setItem(STORAGE.FAILSAFE, JSON.stringify(records)); return true; }
  catch (err) { console.error('failsafe: queue write failed:', err); return false; }
}

const pendingCount = () => readQueue().length;

// Re-read so a record queued while a fetch was pending survives.
function settle(rec) {
  writeQueue(readQueue().flatMap(r => r.ts !== rec.ts ? [r] : rec.sent ? [] : [rec]));
}

export function saveFailedSubmission(payload, reason = 'network error') {
  const stored = writeQueue(readQueue().concat({
    ts: new Date().toISOString(),
    reason,
    payload
  }));
  notify();
  return { stored, pending: pendingCount() };
}

function tsv(rec) {
  const p = rec.payload || {};
  const cell = (v) => (v === null || v === undefined || v === '')
    ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim();
  return [
    rec.ts, p.role, p.student_number, p.username, p.satisfaction,
    p.course_number, p.building_number,
    p.workshop ? 'yes' : 'no', p.used_ai == null ? '' : p.used_ai ? 'yes' : 'no'
  ].map(cell).join('\t');
}

// Always the whole queue, so a second download is a full copy, not the rest. Records stay queued.
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

  // Rejected records will never go up; the file is now their only copy.
  writeQueue(records.filter(r => !r.rejected));
  notify();
  return records.length;
}

let retrying = false;

export async function retryPending() {
  if (retrying || !navigator.onLine) return 0;
  const records = readQueue();
  if (!records.length) return 0;

  retrying = true;
  let sent = 0;
  try {
    for (const rec of records) {
      if (rec.rejected) continue;

      const headers = { 'Content-Type': 'application/json', 'X-CSRFToken': getSavedKey()[1] || '' };

      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST', credentials: 'include', headers, body: JSON.stringify({ ...rec.payload, saved_at: rec.ts }),
          signal: AbortSignal.timeout?.(SUBMIT_TIMEOUT_MS),
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
      }
      settle(rec);
    }
  } finally {
    retrying = false;
  }

  if (sent) notify();
  return sent;
}

let showPending = () => {};
function notify() { try { showPending(pendingCount()); } catch {} }

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
  showPending = render;
  render(pendingCount());

  window.addEventListener('online', () => { retryPending(); });
  setInterval(() => { if (pendingCount()) retryPending(); }, RETRY_MS);
  retryPending();
}
