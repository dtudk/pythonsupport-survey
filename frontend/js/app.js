import { linkToken, isQrLink } from './config.js';
import { isAuthValid, showLogin, hideLogin, wireLogin, isOfflineMode, setOfflineMode } from './auth.js';
import { wireKiosk } from './kiosk.js';
import { wireBuildingPage, showSurveyForm, showModeSelection } from './building.js';
import { wireSurveyForm } from './survey.js';
import { wireFailsafe } from './failsafe.js';
import { wireProblemLog } from './problem-log.js';

async function loadPartial(selector, url){
  const host = document.querySelector(selector);
  const res = await fetch(url);
  host.innerHTML = await res.text();
}

await loadPartial('#sidebarContainer',   './partials/sidebar.html');
await loadPartial('#modeSelectionContainer', './partials/mode-selection.html');
await loadPartial('#buildingSelectionContainer', './partials/building-selection.html');
await loadPartial('#surveyContainer',    './partials/survey-form.html');
await loadPartial('#problemLogContainer', './partials/problem-log.html');
await loadPartial('#modalsContainer',    './partials/modals.html');

wireLogin();
wireKiosk();
wireBuildingPage();
wireSurveyForm();
wireFailsafe();
wireProblemLog();

document.body.classList.toggle('student-flow', !!(linkToken || isQrLink));

if (linkToken || isQrLink)  { hideLogin(); }
else if (isAuthValid())     { hideLogin(); }
else if (isOfflineMode())   { setOfflineMode(true); hideLogin(); }
else                        { showLogin(); }

if (linkToken || isQrLink) showSurveyForm();
else                       showModeSelection();
