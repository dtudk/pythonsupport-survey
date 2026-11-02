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
export const linkToken = params.get('t') || params.get('token') || null;
export const qpBuilding = params.get('b');
export const qpWD = params.get('wd') === '1';
export const isQrLink = params.has('b');

export const state = {
  selectedBuilding: qpBuilding ? Number(qpBuilding) : null,
};

if (params.get('reset') === '1') {
  try { localStorage.removeItem(STORAGE.AUTH); } catch {}
  ['reset','t','token','b','wd'].forEach(k=>params.delete(k));
  const next = location.pathname + (params.toString() ? `?${params.toString()}` : '');
  location.replace(next);
}