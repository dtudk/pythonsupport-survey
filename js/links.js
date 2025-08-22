// One-time link generation module
import { CONFIG } from './config.js';
import { showError } from './errors.js';

export class LinkManager {
  constructor(authManager, buildingManager) {
    this.authManager = authManager;
    this.buildingManager = buildingManager;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Generate one-time link button
    const btnGenerateLink = document.getElementById('btnGenerateLink');
    if (btnGenerateLink) {
      btnGenerateLink.addEventListener('click', () => this.generateOneTimeLink());
    }

    // Workshop day toggle
    const wdToggle = document.getElementById('workshopDayToggle');
    if (wdToggle) {
      wdToggle.checked = localStorage.getItem(CONFIG.storage.workshopDay) === 'true';
      wdToggle.addEventListener('change', () => {
        localStorage.setItem(CONFIG.storage.workshopDay, String(wdToggle.checked));
      });
    }
  }

  async generateOneTimeLink() {
    try {
      const expiresHours = 24;
      const selectedBuilding = this.buildingManager.getSelectedBuilding();
      const buildingPayload = (selectedBuilding === null) ? 'Online' : selectedBuilding;

      const resp = await fetch(CONFIG.endpoints.token, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.authManager.getApiKey()
        },
        body: JSON.stringify({ 
          expiresHours, 
          building_Number: buildingPayload 
        })
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        showError('Could not generate link. ' + (txt || ''), resp.status);
        return;
      }

      const data = await resp.json().catch(() => ({}));
      const baseUrl = window.location.origin + window.location.pathname;
      const addB = (selectedBuilding !== null);
      const wd = (document.getElementById('workshopDayToggle')?.checked) ? '&wd=1' : '';
      const url = data.url || `${baseUrl}?t=${encodeURIComponent(data.token)}${addB ? `&b=${encodeURIComponent(String(selectedBuilding))}` : ''}${wd}`;

      try {
        await navigator.clipboard.writeText(url);
      } catch {}
      
      alert('One-time survey link copied to clipboard:\n' + url);
    } catch (e) {
      console.error(e);
      showError('Unexpected error while generating the link.');
    }
  }
}