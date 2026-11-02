// Endpoints (change here only)
export const endpoint       = "https://python-support-proxy.azurewebsites.net/api/surveyProxy";
export const tokenEndpoint  = "https://python-support-proxy.azurewebsites.net/api/issueToken";
export const qrSignEndpoint = "https://python-support-proxy.azurewebsites.net/api/qrRedirect";

export const STORAGE = {
  AUTH: 'surveySupportAuth',
  BUILDING: 'selectedBuilding',
  WORKSHOP: 'workshopDay',
  KIOSK: 'kioskMode',
};

export const params = new URLSearchParams(location.search);
export const linkToken = params.get('t') || params.get('token') || null;
export const qpBuilding = params.get('b');
export const qpWD = params.get('wd') === '1';
export const isQrLink = params.has('b');
export const hasOneTimeToken = !!linkToken;

// mutable state shared by modules
export const state = {
  selectedBuilding: (() => {
    if (qpBuilding) return Number(qpBuilding);
    try { const v = localStorage.getItem(STORAGE.BUILDING); return v ? Number(v) : null; }
    catch { return null; }
  })()
};

export function saveSelectedBuilding(v){
  state.selectedBuilding = v;
  try { localStorage.setItem(STORAGE.BUILDING, String(v)); } catch {}
}

// reset=1 helper (kept same behavior)
if (params.get('reset') === '1') {
  try { localStorage.removeItem(STORAGE.AUTH); } catch {}
  try { localStorage.removeItem(STORAGE.BUILDING); } catch {}
  ['reset','t','token','b','wd'].forEach(k=>params.delete(k));
  const next = location.pathname + (params.toString() ? `?${params.toString()}` : '');
  location.replace(next);
}