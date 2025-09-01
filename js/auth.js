import { endpoint, STORAGE } from './config.js';

export function getSavedKey() {
  try { const saved = localStorage.getItem(STORAGE.AUTH); return saved ? saved.split("|") : [null,null]; }
  catch { return [null,null]; }
}
export function isAuthValid() {
  const [date, key] = getSavedKey();
  const today = new Date().toISOString().slice(0, 10);
  return date === today && !!key;
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
    const ok = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": input },
      body: JSON.stringify({ ping: true })
    }).then(r => r.ok).catch(() => false);

    if (ok) {
      const today = new Date().toISOString().slice(0, 10);
      try { localStorage.setItem(STORAGE.AUTH, `${today}|${input}`); } catch {}
      hideLogin();
      document.getElementById("accessCodeInput").value = "";
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