import { tokenEndpoint, qrEndpoint, state, linkToken, isQrLink, qpWD } from './config.js';
import { getSavedKey } from './auth.js';
import { showError, errorText } from './errors.js';
import { isKiosk, syncFabVisibility } from './kiosk.js';

const overlay = () => document.getElementById('sidebarOverlay');
const sidebar = () => document.getElementById('sidebar');
const openBtn  = () => document.getElementById('openSidebar');

export function openSidebar(){ if (!isKiosk()) { sidebar().classList.remove('-translate-x-full'); overlay().classList.remove('hidden'); document.body.classList.add('overflow-hidden'); }}
export function closeSidebar(){ sidebar().classList.add('-translate-x-full'); overlay().classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }

// Each page has an outer container (index.html) and an inner page (partial); show one, hide the rest.
const PAGES = ['modeSelection', 'buildingSelection', 'survey', 'problemLog'];
function showPage(name){
  for (const p of PAGES) {
    document.getElementById(`${p}Container`).classList.toggle('hidden', p !== name);
    document.getElementById(`${p}Page`)?.classList.toggle('hidden', p !== name);
  }
  syncBackSelectorVisibility();
  syncFabVisibility();
}

export function showModeSelection(){
  if (isKiosk()) return;
  showPage('modeSelection');
}

export function showProblemLog(){
  if (isKiosk()) return;
  showPage('problemLog');
}

export function showBuildingSelection(){
  if (isKiosk()) return;
  showPage('buildingSelection');
}

export function showSurveyForm(){
  showPage('survey');

  const preferWD = qpWD || !!document.getElementById('workshopDayToggle')?.checked;
  const yes = document.getElementById('workshop_yes');
  const no  = document.getElementById('workshop_no');
  if (yes && no) { yes.checked = !!preferWD; no.checked = !preferWD; }
}

export function switchToSurvey(e){
  if (e) e.preventDefault();
  if (isKiosk()) { showSurveyForm(); return; }
  if (state.selectedBuilding === null) showBuildingSelection(); else showSurveyForm();
  closeSidebar();
}

export function selectBuilding(b){ if (isKiosk()) return; state.selectedBuilding = b; showSurveyForm(); }
export function selectCustomBuilding(){
  if (isKiosk()) return;
  const input = document.getElementById('customBuilding');
  const n = parseInt(input.value, 10);
  if (!input.value || isNaN(n) || n <= 100 || n >= 500) return showError('Please enter a valid building number (101-499).');
  selectBuilding(n);
}
export function handleEnterKey(e){ if (e.key === 'Enter') selectCustomBuilding(); }

async function generateOneTimeLink() {
  if (isKiosk()) return;
  try {
    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRFToken': getSavedKey()[1] || '' },
    });
    if (!resp.ok) {
      showError('Could not generate link. ' + await errorText(resp), resp.status);
      return;
    }
    const { token } = await resp.json();
    const baseUrl = window.location.origin + window.location.pathname;
    const wd = (document.getElementById('workshopDayToggle')?.checked) ? '&wd=1' : '';
    const url = `${baseUrl}?token=${encodeURIComponent(token)}${wd}`;
    try { await navigator.clipboard.writeText(url); } catch {}
    alert('Discord link copied to clipboard:\n' + url);
  } catch (e) {
    console.error(e);
    showError('Unexpected error while generating the link.');
  }
}

function wireQRModal(){
  const modal = document.getElementById('qrModal');
  const qrCreate  = document.getElementById('qrCreate');
  const qrClose   = document.getElementById('qrClose');
  const qrCopy    = document.getElementById('qrCopy');
  const qrImg     = document.getElementById('qrImg');
  const qrLinkInp = document.getElementById('qrLink');
  const qrResult  = document.getElementById('qrResult');
  const qrBuildingInp = document.getElementById('qrBuilding');
  const qrWD = document.getElementById('qrWorkshopDay');
  const qrDaysInp = document.getElementById('qrValidDays');
  const inlineErr = document.getElementById('qrInlineError');

  function open() {
    if (isKiosk()) return;
    qrBuildingInp.value = (state.selectedBuilding ?? '').toString();
    qrWD.checked = !!document.getElementById('workshopDayToggle')?.checked;
    qrResult.classList.add('hidden');
    if (inlineErr) { inlineErr.textContent=''; inlineErr.classList.add('hidden'); }
    modal.classList.remove('hidden');
  }
  function close(){ modal.classList.add('hidden'); }

  document.getElementById('btnGenerateQR')?.addEventListener('click', open);
  modal?.querySelectorAll('.qr-quick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      qrBuildingInp.value = btn.getAttribute('data-building');
      inlineErr.classList.add('hidden');
    });
  });

  qrBuildingInp?.addEventListener('input', ()=> inlineErr.classList.add('hidden'));
  qrDaysInp?.addEventListener('input', ()=> inlineErr.classList.add('hidden'));

  async function create(){
    if (isKiosk()) return;
    const val = qrBuildingInp.value.trim(); const num = Number(val);
    if (val==='' || isNaN(num) || num<101 || num>499){
      inlineErr.textContent='Please enter a valid building between 101 and 499 or use a quick option.';
      inlineErr.classList.remove('hidden'); return;
    }
    const days = Number(qrDaysInp.value);
    if (!Number.isInteger(days) || days<1 || days>365){
      inlineErr.textContent='Please enter how many days the QR code stays valid (1-365).';
      inlineErr.classList.remove('hidden'); return;
    }
    const resp = await fetch(qrEndpoint, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/json', 'X-CSRFToken': getSavedKey()[1] || '' },
      body: JSON.stringify({ building_number: num, valid_days: days, workshop_day: qrWD.checked })
    });
    if (!resp.ok) return showError('Could not create QR. ' + await errorText(resp), resp.status);
    const { url, qr } = await resp.json();
    qrLinkInp.value = url;
    qrImg.src = qr;
    qrResult.classList.remove('hidden');
  }
  qrCreate?.addEventListener('click', create);
  qrClose?.addEventListener('click', close);
  qrCopy?.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(qrLinkInp.value);}catch{} });
}

export function applySidebarVisibility(){
  const hide = isKiosk() || !!linkToken || isQrLink;
  if (sidebar()) {
    if (hide){ sidebar().hidden=true; sidebar().style.display='none'; sidebar().setAttribute('aria-hidden','true'); sidebar().setAttribute('inert',''); }
    else { sidebar().hidden=false; sidebar().style.display=''; sidebar().removeAttribute('aria-hidden'); sidebar().removeAttribute('inert'); }
  }
  document.getElementById('openSidebar').style.display = hide ? 'none' : '';
  overlay().classList.add('hidden'); overlay().style.display='none';
}

export function syncBackSelectorVisibility(){
  const link = document.getElementById('backSelectorTab');
  if (!link) return;
  const onSelector = !document.getElementById('buildingSelectionContainer').classList.contains('hidden');
  link.style.display = onSelector ? 'none' : '';
}

export function wireBuildingPage(){
  // For the partials' inline onclick handlers.
  window.selectBuilding = selectBuilding;
  window.selectCustomBuilding = selectCustomBuilding;
  window.handleEnterKey = handleEnterKey;
  window.showBuildingSelection = showBuildingSelection;

  document.getElementById('btnGenerateLink')?.addEventListener('click', generateOneTimeLink);
  wireQRModal();

  document.getElementById('openSidebar')?.addEventListener('click', openSidebar);
  document.getElementById('closeSidebar')?.addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);

  document.getElementById('surveyTab')?.addEventListener('click', switchToSurvey);
  document.getElementById('modeSurvey')?.addEventListener('click', switchToSurvey);
  document.getElementById('modeProblemLog')?.addEventListener('click', showProblemLog);
  document.getElementById('modeTab')?.addEventListener('click', e => { e.preventDefault(); showModeSelection(); closeSidebar(); });
  document.getElementById('backSelectorTab')?.addEventListener('click', e => { e.preventDefault(); showBuildingSelection(); closeSidebar(); });
  document.getElementById('resetTab')?.addEventListener('click', e => { e.preventDefault(); location.href = location.pathname + '?reset=1'; });

  applySidebarVisibility();
  syncBackSelectorVisibility();
  syncFabVisibility();
}