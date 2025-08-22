// Authentication module
import { CONFIG } from './config.js';

export class AuthManager {
  constructor() {
    this.handleReset();
    this.setupLoginHandler();
  }

  handleReset() {
    const params = new URLSearchParams(location.search);
    if (params.get('reset') === '1') {
      try { 
        localStorage.removeItem(CONFIG.storage.auth); 
        localStorage.removeItem(CONFIG.storage.building); 
      } catch {}
      
      params.delete('reset');
      params.delete('t');
      params.delete('token');
      params.delete('b');
      params.delete('wd');
      
      const next = location.pathname + (params.toString() ? `?${params.toString()}` : '');
      location.replace(next);
    }
  }

  getSavedKey() {
    const saved = localStorage.getItem(CONFIG.storage.auth);
    if (!saved) return [null, null];
    return saved.split("|");
  }

  isAuthValid() {
    const [date] = this.getSavedKey();
    const today = new Date().toISOString().slice(0, 10);
    return date === today;
  }

  showLogin() {
    document.getElementById("loginModal").classList.remove("hidden");
    document.getElementById("mainWrapper").classList.add("pointer-events-none", "opacity-40");
  }

  hideLogin() {
    document.getElementById("loginModal").classList.add("hidden");
    document.getElementById("mainWrapper").classList.remove("pointer-events-none", "opacity-40");
  }

  checkAuthStatus() {
    const urlParams = new URLSearchParams(window.location.search);
    const hasOneTimeToken = urlParams.get('t') || urlParams.get('token');
    const hasQRCode = urlParams.get('b');
    
    // Skip authentication for one-time links and QR code access
    if (hasOneTimeToken || hasQRCode) {
      this.hideLogin();
    } else if (this.isAuthValid()) {
      this.hideLogin();
    } else {
      this.showLogin();
    }
  }

  setupLoginHandler() {
    document.getElementById("codeSubmit").addEventListener("click", async () => {
      const input = document.getElementById("accessCodeInput").value.trim();
      const ok = await fetch(CONFIG.endpoints.survey, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": input },
        body: JSON.stringify({ ping: true })
      }).then(r => r.ok).catch(() => false);

      if (ok) {
        const today = new Date().toISOString().slice(0, 10);
        localStorage.setItem(CONFIG.storage.auth, `${today}|${input}`);
        this.hideLogin();
        document.getElementById("loginError").classList.add("hidden");
        document.getElementById("accessCodeInput").value = "";
      } else {
        document.getElementById("loginError").classList.remove("hidden");
      }
    });
  }

  getApiKey() {
    return this.getSavedKey()[1] || "";
  }
}