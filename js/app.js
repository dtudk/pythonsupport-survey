import { STORAGE, linkToken, hasOneTimeToken, isQrLink, state } from './config.js';
import { isAuthValid, showLogin, hideLogin, wireLogin } from './auth.js';
import { wireKiosk, applyKiosk, isKiosk, syncFabVisibility } from './kiosk.js';
import { wireBuildingPage, showBuildingSelection, showSurveyForm, applySidebarVisibility } from './building.js';
import { wireSurveyForm } from './survey.js';

async function loadPartial(selector, url){
  const host = document.querySelector(selector);
  const res = await fetch(url);
  host.innerHTML = await res.text();
}

// Load all partials first
await loadPartial('#sidebarContainer',   './partials/sidebar.html');
await loadPartial('#buildingSelectionContainer', './partials/building-selection.html');
await loadPartial('#surveyContainer',    './partials/survey-form.html');
await loadPartial('#analyticsContainer', './partials/analytics.html');
await loadPartial('#modalsContainer',    './partials/modals.html');

// Wire features that depend on DOM
wireLogin();
wireKiosk();
wireBuildingPage();
wireSurveyForm();

// Student-flow layout rule: hide header/pages for students (token/QR or kiosk)
function applyStudentFlowLayout() {
  const on = !!(linkToken || isQrLink || isKiosk());
  document.body.classList.toggle('student-flow', on);
}
applyStudentFlowLayout();

// Show/hide login
if (hasOneTimeToken || isQrLink) { hideLogin(); }
else if (isAuthValid())          { hideLogin(); }
else                             { showLogin(); }

// Initial page
if (hasOneTimeToken)      showSurveyForm();
else if (state.selectedBuilding === null && !isQrLink) showBuildingSelection();
else                         showSurveyForm();

// Ensure sidebar matches mode, and FABs too
applySidebarVisibility();
applyStudentFlowLayout();
syncFabVisibility();

// Expose to window for inline onclicks in partials (already set by building.js, but safe)
window.showBuildingSelection = showBuildingSelection;
window.selectBuilding = (b)=>{ import('./building.js').then(m=>m.selectBuilding(b)); };
window.selectCustomBuilding = ()=>{ import('./building.js').then(m=>m.selectCustomBuilding()); };
window.handleEnterKey = (e)=>{ import('./building.js').then(m=>m.handleEnterKey(e)); };