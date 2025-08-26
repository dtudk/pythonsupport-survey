import { endpoint, STORAGE, state, linkToken, qpWD } from './config.js';
import { getSavedKey } from './auth.js';
import { showError, friendlyError } from './errors.js';
import { syncFabVisibility } from './kiosk.js';

// --- TEMP: allow scrolling in kiosk mode (undo hard lock) ---
let __kioskScrollPatched = false;
function enableKioskScrolling() {
  if (__kioskScrollPatched) return;
  if (!document.body || !document.body.classList.contains('kiosk-mode')) return;

  // Override CSS locks with inline styles
  try {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.position = 'static';
    document.body.style.inset = 'auto';
    document.body.style.height = 'auto';
    document.body.style.width = 'auto';
    const mw = document.getElementById('mainWrapper');
    if (mw) { mw.style.height = 'auto'; mw.style.overflow = 'auto'; }
  } catch {}

  // Neutralize global preventDefault handlers from kiosk.js
  const allowScroll = (e) => {
    if (document.body.classList.contains('kiosk-mode')) {
      // Stop the blocking handler from firing
      try { e.stopImmediatePropagation(); } catch {}
    }
  };
  window.addEventListener('touchmove', allowScroll, { capture: true, passive: true });
  window.addEventListener('wheel', allowScroll, { capture: true, passive: true });

  __kioskScrollPatched = true;
}

// Center the survey card in the viewport (used on tablet mode open/close keyboard)
function centerSurveyCard(smooth = true) {
  const card = document.getElementById('surveyCard');
  if (!card) return;
  const behavior = smooth ? 'smooth' : 'auto';
  try {
    card.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
  } catch {
    try {
      const rect = card.getBoundingClientRect();
      const top = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
      window.scrollTo({ top, behavior });
    } catch {}
  }
}

export async function verifyOneTimeToken() {
  if (!linkToken) return true;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-token': linkToken },
      body: JSON.stringify({ ping: true })
    });
    if (!resp.ok) {
      showError('Oops, this link has expired. Please request a new one-time link from your supporter.', resp.status);
      document.querySelectorAll('#surveyForm input, #surveyForm select, #surveyForm textarea, #surveyForm button')
        .forEach(el => { if (el.id !== 'closeErrorModal') el.disabled = true; });
      return false;
    }
    return true;
  } catch { return true; }
}

function loadCourses() {
  (async () => {
    try {
      const res = await fetch('./data/courses.csv');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csv = await res.text();
      const lines = csv.split('\n');
      const records = [];
      let buffer = '', inQuotes = false;
      lines.forEach(line => {
        const quoteCount = (line.match(/"/g) || []).length;
        if (!inQuotes) { buffer = line; if (quoteCount % 2 !== 0) inQuotes = true; else records.push(buffer); }
        else { buffer += '\n' + line; if (quoteCount % 2 !== 0) { inQuotes = false; records.push(buffer); } }
      });
      records.shift();
      const dl = document.getElementById('courses');
      records.forEach(record => {
        const idx = record.indexOf(',');
        const code = record.slice(0, idx).trim();
        let rawName = record.slice(idx + 1);
        rawName = rawName.replace(/\r/g, '').replace(/CR$/, '').replace(/^"+|"+$/g, '').trim();
        const opt = document.createElement('option');
        opt.value = `${code} - ${rawName}`;
        dl.appendChild(opt);
      });
    } catch (err) {
      console.error('Error loading courses.csv:', err);
    }
  })();
}

export function wireSurveyForm(){
  loadCourses();
  verifyOneTimeToken();

  // Bring back scrolling when entering tablet (kiosk) mode
  enableKioskScrolling();

  // If starting in kiosk, center the card once the layout settles
  if (typeof inKiosk === 'function' && inKiosk()) {
    setTimeout(() => centerSurveyCard(true), 150);
  }

  // If tablet mode is toggled later, re-apply
  try {
    const __kioskClassWatcher = new MutationObserver(() => {
      if (document.body.classList.contains('kiosk-mode')) {
        enableKioskScrolling();
        // Center after enabling scroll so the card is vertically balanced
        setTimeout(() => centerSurveyCard(true), 150);
      }
    });
    __kioskClassWatcher.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } catch {}

  // Re-center on viewport changes in kiosk mode (e.g., orientation or keyboard height changes)
  window.addEventListener('resize', () => {
    if (typeof inKiosk === 'function' && inKiosk()) {
      setTimeout(() => centerSurveyCard(false), 200);
    }
  });

  const form = document.getElementById("surveyForm");
  const thankYou = document.getElementById("thankYouModal");
  const closeBtn = document.getElementById("closeModal");
  const submitButton = document.getElementById("submitButton");

  const studentWrapper  = document.getElementById('studentWrapper');
  const usernameWrapper = document.getElementById('usernameWrapper');
  const studentNumInput = document.getElementById('student_number');
  const usernameInput   = document.getElementById('dtu_username');

  // --- Kiosk UX helpers & hardening for inputs ---
  // Hint mobile keyboards and constrain length at the DOM level
  if (studentNumInput) {
    try {
      studentNumInput.setAttribute('inputmode', 'numeric');
      studentNumInput.setAttribute('enterkeyhint', 'next');
      studentNumInput.setAttribute('maxlength', '6');
      studentNumInput.setAttribute('autocomplete', 'one-time-code');
    } catch {}
  }

  // Local helper to jump to the satisfaction row without auto-selecting
  function jumpToSatisfaction() {
    const firstSmile = document.querySelector('input[name="satisfaction"]');
    if (firstSmile) {
      try { firstSmile.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
      try { firstSmile.focus({ preventScroll: true }); } catch {}
    }
  }

  // Digits-only enforcement for the student number
  if (studentNumInput) {
    // Block non-digits before they land
    studentNumInput.addEventListener('beforeinput', (e) => {
      // Allow deletions/moves
      const t = e.inputType || '';
      if (t.startsWith('delete') || t.startsWith('history') || t.includes('format')) return;
      const data = (e.data ?? '');
      if (data && /\D/.test(data)) { e.preventDefault(); }
    });

    // Strip any stray non-digits (incl. from auto-fill) and cap to 6
    studentNumInput.addEventListener('input', () => {
      const cleaned = (studentNumInput.value || '').replace(/\D/g, '').slice(0, 6);
      if (studentNumInput.value !== cleaned) studentNumInput.value = cleaned;
    });

    // Guard paste
    studentNumInput.addEventListener('paste', (e) => {
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      const cleaned = txt.replace(/\D/g, '').slice(0, 6);
      const start = studentNumInput.selectionStart ?? studentNumInput.value.length;
      const end   = studentNumInput.selectionEnd ?? studentNumInput.value.length;
      const v = studentNumInput.value;
      const next = (v.slice(0, start) + cleaned + v.slice(end)).replace(/\D/g, '').slice(0, 6);
      studentNumInput.value = next;
      // Trigger validation UI
      studentNumInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Allow only control keys + digits on keydown
    studentNumInput.addEventListener('keydown', (e) => {
      const allowedKeys = new Set(['Backspace','Delete','ArrowLeft','ArrowRight','Home','End','Tab']);
      const isDigit = (e.key && /^[0-9]$/.test(e.key)) || (e.code && /^Numpad[0-9]$/.test(e.code));
      if (e.key === 'Enter') {
        // Enter/Next moves to satisfaction
        e.preventDefault();
        jumpToSatisfaction();
        return;
      }
      if (allowedKeys.has(e.key) || isDigit) return;
      // Allow shortcuts like Cmd/Ctrl+A/C/V/X
      if ((e.ctrlKey || e.metaKey) && ['a','c','v','x','A','C','V','X'].includes(e.key)) return;
      e.preventDefault();
    });
  }

  // Smoothly center the active input in kiosk mode
  [studentNumInput, usernameInput].forEach((inp) => {
    if (!inp) return;
    inp.addEventListener('focus', () => {
      if (inKiosk && typeof inKiosk === 'function' && inKiosk()) {
        setTimeout(() => { try { inp.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch {} }, 120);
      }
    });
    inp.addEventListener('blur', () => {
      if (inKiosk && typeof inKiosk === 'function' && inKiosk()) {
        // Let the keyboard retract, then center the card
        setTimeout(() => centerSurveyCard(true), 220);
      }
    });
  });

  // Tap anywhere outside inputs to dismiss the keyboard (tablet mode only)
  if (!window.__surveyTapToDismissAttached) {
    document.addEventListener('pointerdown', (e) => {
      if (!(inKiosk && typeof inKiosk === 'function' && inKiosk())) return;
      const t = e.target;
      // Keep focus if tapping an input/select/textarea/datalist or their UI
      if (t && (t.closest('input, textarea, select, datalist, .ui-keep-focus'))) return;
      const active = document.activeElement;
      if (active && active.matches && active.matches('input, textarea, select')) {
        try { active.blur(); } catch {}
        // After dismissing, re-center the survey card
        setTimeout(() => { if (inKiosk && typeof inKiosk === 'function' && inKiosk()) centerSurveyCard(true); }, 180);
      }
    }, { passive: true });
    window.__surveyTapToDismissAttached = true;
  }

  // role toggle + clean abandoned field
  function toggleRole() {
    const isStudent = form.role.value === 'student';
    studentWrapper.classList.toggle('hidden', !isStudent);
    usernameWrapper.classList.toggle('hidden',  isStudent);
    studentNumInput.required = isStudent;
    usernameInput.required   = !isStudent;
    if (isStudent) {
      studentNumInput.disabled = false;
      usernameInput.disabled = true;
      usernameInput.value = '';
      usernameInput.setCustomValidity('');
    } else {
      usernameInput.disabled = false;
      studentNumInput.disabled = true;
      studentNumInput.value = '';
      studentNumInput.setCustomValidity('');
    }
  }
  form.querySelectorAll('input[name="role"]').forEach(r => r.addEventListener('change', toggleRole));
  toggleRole();


  function setStudentCustomValidation() {
    const isStudent = (form.role.value === 'student');
    if (!isStudent || studentNumInput.disabled) { studentNumInput.setCustomValidity(''); return; }
    const v = (studentNumInput.value || '').trim();
    if (!v)      studentNumInput.setCustomValidity("Please enter your student number: type the 6 digits after 's' (e.g. s123456).");
    else if (!/^\d{6}$/.test(v)) studentNumInput.setCustomValidity("Format: exactly 6 digits. Example: s123456. Don’t type the 's'—it's already filled in.");
    else         studentNumInput.setCustomValidity('');
  }
  studentNumInput.addEventListener('input', () => studentNumInput.setCustomValidity(''));
  studentNumInput.addEventListener('blur', setStudentCustomValidation);
  studentNumInput.addEventListener('invalid', setStudentCustomValidation);

  let redirectOnThankYouClose = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    submitButton.classList.add('opacity-50', 'cursor-not-allowed');

    const isStudent = form.role.value === 'student';
    const payload = {
      role: form.role.value,
      student_number: isStudent ? 's' + studentNumInput.value.trim() : null,
      username:        !isStudent ? usernameInput.value.trim() : null,
      satisfaction: Number(form.querySelector('input[name="satisfaction"]:checked').value),
      course_number: (document.getElementById('course_number').value || '').trim() || null,
      building_Number: linkToken ? null : state.selectedBuilding,
      workshop: (form.elements['workshop'] && form.elements['workshop'].value === 'yes'),
      token: linkToken || null,
    };

    try {
      const headers = { "Content-Type": "application/json" };
      if (linkToken) { headers["x-token"] = linkToken; } else { headers["x-api-key"] = getSavedKey()[1] || ""; }
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });

      if (response.ok) {
        if (linkToken) {
          thankYou.classList.remove('hidden');
          redirectOnThankYouClose = true;
          setTimeout(() => { window.location.replace('https://pythonsupport.dtu.dk/'); }, 7000);
        } else {
          thankYou.classList.remove('hidden');
          form.reset();
          form.role.value = 'student';
          toggleRole();
          const preferWD = qpWD || (localStorage.getItem(STORAGE.WORKSHOP) === 'true');
          document.getElementById('workshop_yes').checked = !!preferWD;
          document.getElementById('workshop_no').checked  = !preferWD;
          studentNumInput.value = '';
          studentNumInput.focus();
          document.activeElement?.blur();
          setTimeout(() => { thankYou.classList.add('hidden'); }, 3000);
        }
      } else {
        let raw = '';
        try {
          const ct = (response.headers.get('Content-Type') || '').toLowerCase();
          if (ct.includes('application/json')) {
            const j = await response.json();
            raw = j?.message || (typeof j === 'string' ? j : JSON.stringify(j));
          } else {
            const t = await response.text(); if (t && t.trim().length) raw = t.trim();
          }
        } catch {}
        showError(friendlyError(raw, response.status, !!linkToken), response.status);
        if (form.role.value === 'student') { studentNumInput.focus(); } else { usernameInput?.focus(); }
      }
    } catch (err) {
      console.error("submit failed:", err);
      showError('A network error occurred. Please check your connection and try again.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit Survey';
      submitButton.classList.remove('opacity-50', 'cursor-not-allowed');
      syncFabVisibility();
    }
  });

  closeBtn.addEventListener('click', () => {
    if (redirectOnThankYouClose && linkToken) window.location.replace('https://pythonsupport.dtu.dk/');
    else thankYou.classList.add('hidden');
  });
}

(function () {
  const courseInput = document.getElementById('course_number');
  if (!courseInput) return;

  // Re-center and keep the caret editable after choosing an option
  courseInput.addEventListener('change', () => {
    if (!document.body.classList.contains('kiosk-mode')) return;
    // Keep focus & put caret at the end so it’s easy to edit
    courseInput.focus({ preventScroll: true });
    const len = courseInput.value.length;
    try { courseInput.setSelectionRange(len, len); } catch {}
    // Center it (again) in case the keyboard changed layout
    setTimeout(() => { try { courseInput.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch {} }, 50);
  });

  // Also center on plain focus
  courseInput.addEventListener('focus', () => {
    if (document.body.classList.contains('kiosk-mode')) {
      setTimeout(() => { try { courseInput.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch {} }, 150);
    }
  });

  // When leaving the field (keyboard hides), center the whole card again
  courseInput.addEventListener('blur', () => {
    if (document.body.classList.contains('kiosk-mode')) {
      setTimeout(() => { try { centerSurveyCard(true); } catch {} }, 220);
    }
  });
})();


function inKiosk() {
  return document.body.classList.contains('kiosk-mode');
}
