import { csrfEndpoint, STORAGE } from './config.js';
import { apiFetch, getSavedKey, loginResult } from './api.js';

// A refresh resets everything except the login, the failsafe queue and offline mode.
try {
  const keep = [STORAGE.AUTH, STORAGE.FAILSAFE, STORAGE.OFFLINE].map(k => [k, localStorage.getItem(k)]);
  localStorage.clear();
  for (const [k, v] of keep) if (v !== null) localStorage.setItem(k, v);
} catch {}
const today = () => new Date().toISOString().slice(0, 10);

export function isAuthValid() {
  const [date, key] = getSavedKey();
  return date === today() && !!key;
}

export function clearSavedKey() {
  try { localStorage.removeItem(STORAGE.AUTH); } catch {}
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
    // A hang counts as unreachable: offline mode.
    const { status, data } = await apiFetch(csrfEndpoint, { password: input }, 10_000);
    const result = loginResult(status);

    document.getElementById("accessCodeInput").value = "";

    if (result === 'in' && data.csrfToken) {
      try { localStorage.setItem(STORAGE.AUTH, `${today()}|${data.csrfToken}`); } catch {}
      setOfflineMode(false);
      hideLogin();
      import('./failsafe.js').then(m => m.retryPending()).catch(() => {});
    } else if (result === 'offline') {
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
