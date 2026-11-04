import { csrfEndpoint, STORAGE } from './config.js';

// A refresh resets everything except the login, the failsafe queue and offline mode.
try {
  const keep = [STORAGE.AUTH, STORAGE.FAILSAFE, STORAGE.OFFLINE].map(k => [k, localStorage.getItem(k)]);
  localStorage.clear();
  for (const [k, v] of keep) if (v !== null) localStorage.setItem(k, v);
} catch {}
// [date, csrfToken] from the last successful login.
export function getSavedKey() {
  try { const saved = localStorage.getItem(STORAGE.AUTH); return saved ? saved.split("|") : [null,null]; }
  catch { return [null,null]; }
}
const today = () => new Date().toISOString().slice(0, 10);

export function isAuthValid() {
  const [date, key] = getSavedKey();
  return date === today() && !!key;
}

export function clearSavedKey() {
  try { localStorage.removeItem(STORAGE.AUTH); } catch {}
}

export function isCredentialFault(status) {
  return status === 401 || status === 403;
}

// Only the backend can check the password, so when it is unreachable supporters get in without
// one, and responses wait in the failsafe queue.
export function isOfflineMode() {
  try { return localStorage.getItem(STORAGE.OFFLINE) === today(); }
  catch { return false; }
}

export function setOfflineMode(on) {
  try {
    if (on) localStorage.setItem(STORAGE.OFFLINE, today());
    else    localStorage.removeItem(STORAGE.OFFLINE);
  } catch {}
  document.getElementById('offlineBadge')?.classList.toggle('hidden', !on);
}

export function showLogin() {
  document.getElementById("loginModal").classList.remove("hidden");
  document.getElementById("mainWrapper").classList.add("pointer-events-none", "opacity-40");
  setTimeout(() => { const inp = document.getElementById("accessCodeInput"); if (inp) { inp.focus(); inp.select(); } }, 0);
}
export function hideLogin() {
  document.getElementById("loginModal").classList.add("hidden");
  document.getElementById("mainWrapper").classList.remove("pointer-events-none", "opacity-40");
  document.getElementById("loginError").classList.add("hidden");
}

export function wireLogin() {
  const submit = async () => {
    const input = document.getElementById("accessCodeInput").value.trim();
    let reachable = true;
    const token = await fetch(csrfEndpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: input }),
      signal: AbortSignal.timeout?.(10_000),  // a hang counts as unreachable: offline mode
    }).then(r => r.status >= 500 ? Promise.reject() : r.ok ? r.json().then(j => j.csrfToken) : null)
      .catch(() => { reachable = false; return null; });

    document.getElementById("accessCodeInput").value = "";

    if (token) {
      try { localStorage.setItem(STORAGE.AUTH, `${today()}|${token}`); } catch {}
      setOfflineMode(false);
      hideLogin();
      import('./failsafe.js').then(m => m.retryPending()).catch(() => {});
    } else if (!reachable) {
      setOfflineMode(true);
      hideLogin();
    } else {
      document.getElementById("loginError").classList.remove("hidden");
    }
  };

  document.getElementById("codeSubmit").addEventListener("click", submit);
  document.getElementById("accessCodeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('loginModal');
    if (modal && !modal.classList.contains('hidden') && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
}
