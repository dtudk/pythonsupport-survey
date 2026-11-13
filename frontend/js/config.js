export const endpoint       = '/api/responses/';
export const csrfEndpoint   = '/api/csrf/';
export const tokenEndpoint  = '/api/links/';
export const qrEndpoint     = '/api/qr-codes/';
export const problemLogEndpoint = '/api/problem-logs/';

export const STORAGE = {
  AUTH: 'surveySupportAuth',
  FAILSAFE: 'surveyFailsafeQueue',
  OFFLINE: 'surveyOfflineMode',
};

export const params = new URLSearchParams(location.search);
export const linkToken = params.get('t');
export const qpBuilding = params.get('b');
export const qpWD = params.get('wd') === '1';
export const isQrLink = params.has('b');
// Link and QR flows are students: they must never see a login prompt.
export const isSupporterDevice = !linkToken && !isQrLink;

export const state = {
  selectedBuilding: qpBuilding ? Number(qpBuilding) : null,
};

if (params.get('reset') === '1') {
  try { localStorage.removeItem(STORAGE.AUTH); } catch {}
  ['reset','t','b','wd'].forEach(k=>params.delete(k));
  const next = location.pathname + (params.toString() ? `?${params.toString()}` : '');
  location.replace(next);
}