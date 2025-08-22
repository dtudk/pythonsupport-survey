// QR Code generation module
import { CONFIG, QR_CONFIG } from './config.js';
import { showError } from './errors.js';

export class QRManager {
  constructor(authManager, buildingManager) {
    this.authManager = authManager;
    this.buildingManager = buildingManager;
    this.setupEventListeners();
  }

  setupEventListeners() {
    const qrModal = document.getElementById('qrModal');
    const qrCreate = document.getElementById('qrCreate');
    const qrClose = document.getElementById('qrClose');
    const qrCopy = document.getElementById('qrCopy');
    const qrBuildingInp = document.getElementById('qrBuilding');
    const qrWorkshopDay = document.getElementById('qrWorkshopDay');
    const qrInlineError = document.getElementById('qrInlineError');

    // Open QR modal
    document.getElementById('btnGenerateQR')?.addEventListener('click', () => {
      this.openQrModal();
    });

    // Quick select buttons
    qrModal.querySelectorAll('.qr-quick').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-building');
        qrBuildingInp.value = v;
        if (qrInlineError) {
          qrInlineError.textContent = '';
          qrInlineError.classList.add('hidden');
        }
      });
    });

    // Building input
    if (qrBuildingInp) {
      qrBuildingInp.addEventListener('input', () => {
        if (qrInlineError) {
          qrInlineError.textContent = '';
          qrInlineError.classList.add('hidden');
        }
      });
    }

    // Modal controls
    qrCreate.addEventListener('click', () => this.createQr());
    qrClose.addEventListener('click', () => this.closeQrModal());
    qrCopy.addEventListener('click', async () => {
      const qrLinkInp = document.getElementById('qrLink');
      try {
        await navigator.clipboard.writeText(qrLinkInp.value);
      } catch {}
    });
  }

  openQrModal() {
    const qrBuildingInp = document.getElementById('qrBuilding');
    const qrWorkshopDay = document.getElementById('qrWorkshopDay');
    const qrImg = document.getElementById('qrImg');
    const qrCanvas = document.getElementById('qrCanvas');
    const qrResult = document.getElementById('qrResult');
    const qrInlineError = document.getElementById('qrInlineError');
    const qrModal = document.getElementById('qrModal');

    const selectedBuilding = this.buildingManager.getSelectedBuilding();
    if (selectedBuilding !== null && !isNaN(selectedBuilding)) {
      qrBuildingInp.value = String(selectedBuilding);
    } else {
      qrBuildingInp.value = '';
    }

    qrWorkshopDay.checked = (localStorage.getItem(CONFIG.storage.workshopDay) === 'true');
    
    if (qrImg) {
      qrImg.src = '';
      qrImg.classList.add('hidden');
    }
    
    qrCanvas.classList.remove('hidden');
    qrResult.classList.add('hidden');
    
    if (qrInlineError) {
      qrInlineError.textContent = '';
      qrInlineError.classList.add('hidden');
    }
    
    qrModal.classList.remove('hidden');
  }

  closeQrModal() {
    document.getElementById('qrModal').classList.add('hidden');
  }

  async createQr() {
    const qrBuildingInp = document.getElementById('qrBuilding');
    const qrWorkshopDay = document.getElementById('qrWorkshopDay');
    const qrInlineError = document.getElementById('qrInlineError');
    const qrCanvas = document.getElementById('qrCanvas');
    const qrImg = document.getElementById('qrImg');
    const qrLinkInp = document.getElementById('qrLink');
    const qrResult = document.getElementById('qrResult');

    const bVal = qrBuildingInp.value.trim();
    const bNum = Number(bVal);
    
    if (bVal === '' || isNaN(bNum) || bNum < 0 || bNum > 990) {
      if (qrInlineError) {
        qrInlineError.textContent = 'Please enter a valid building between 000 and 990 or use a quick option.';
        qrInlineError.classList.remove('hidden');
      }
      return;
    } else if (qrInlineError) {
      qrInlineError.textContent = '';
      qrInlineError.classList.add('hidden');
    }

    try {
      // Ask backend to return a SIGNED STATIC URL for printing
      const resp = await fetch(`${CONFIG.endpoints.qrSign}?sign=1&b=${encodeURIComponent(String(bNum))}&wd=${qrWorkshopDay.checked ? 1 : 0}`, {
        method: 'GET',
        headers: { 'x-api-key': this.authManager.getApiKey() }
      });
      
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        showError('Could not create static QR. ' + (txt || ''), resp.status);
        return;
      }
      
      const data = await resp.json();
      const url = data.url;

      // Render QR – library if present, otherwise image fallback
      qrLinkInp.value = url;
      const hasLib = !!(window.QRCode && QRCode.toCanvas);
      
      if (hasLib) {
        const ctx = qrCanvas.getContext('2d');
        ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        await QRCode.toCanvas(qrCanvas, url, { 
          width: QR_CONFIG.size, 
          margin: QR_CONFIG.margin 
        });
        qrCanvas.classList.remove('hidden');
        qrImg.classList.add('hidden');
      } else {
        const encoded = encodeURIComponent(url);
        qrCanvas.classList.add('hidden');
        qrImg.classList.remove('hidden');
        qrImg.src = `${QR_CONFIG.fallbackServices[0]}${encoded}`;
        qrImg.onerror = function () {
          qrImg.onerror = null;
          qrImg.src = `${QR_CONFIG.fallbackServices[1]}${encoded}`;
        };
      }
      
      if (qrInlineError) {
        qrInlineError.textContent = '';
        qrInlineError.classList.add('hidden');
      }
      
      qrResult.classList.remove('hidden');
    } catch (e) {
      console.error(e);
      showError('Unexpected error while generating the QR.');
    }
  }
}