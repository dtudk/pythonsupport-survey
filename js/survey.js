import { endpoint, STORAGE, state, linkToken, isQrLink, qpWD } from './config.js';
import { getSavedKey, isAuthValid, clearSavedKey, isCredentialFault } from './auth.js';
import { showError, friendlyError } from './errors.js';
import { syncFabVisibility } from './kiosk.js';
import { visualViewportBox, ensureVisible } from './viewport.js';
import { saveFailedSubmission } from './failsafe.js';

const isSupporterDevice = !linkToken && !isQrLink;


function setupCourseAutocomplete() {
  const input = document.getElementById('course_number');
  const list  = document.getElementById('course-ac-list');
  const wrap  = input?.closest('.course-ac');
  if (!input || !list || !wrap) return;

  const MAX = 50;          
  let courses = [];
  let activeIndex = -1;

  
  (async () => {
    try {
      const res = await fetch('./data/courses.csv', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      const lines = text.split(/\r?\n/);
      const records = [];
      let buf = '', inQuotes = false;
      for (const line of lines) {
        const q = (line.match(/"/g) || []).length;
        if (!inQuotes) {
          buf = line;
          if (q % 2 === 1) { inQuotes = true; continue; }
        } else {
          buf += '\n' + line;
          if (q % 2 === 1) inQuotes = false;
          if (inQuotes) continue;
        }
        records.push(buf);
      }
      if (records.length && /course|code/i.test(records[0])) records.shift();

      const out = [];
      for (const rec of records) {
        const idx = rec.indexOf(',');
        if (idx === -1) continue;
        const code = rec.slice(0, idx).trim();
        const name = rec.slice(idx + 1)
          .replace(/\r/g, '').replace(/CR$/, '').replace(/^"+|"+$/g, '').trim();
        if (!code || !name) continue;
        out.push(`${code} - ${name}`);
      }
      courses = out;
    } catch (err) {
      console.error('courses.csv load failed:', err);
    }
  })();

  function filter(q) {
    q = q.trim().toLowerCase();
    if (!q) return courses.slice(0, MAX);
    const starts = [], contains = [];
    for (const c of courses) {
      const i = c.toLowerCase().indexOf(q);
      if (i === 0) starts.push(c);
      else if (i > 0) contains.push(c);
    }
    return starts.concat(contains);
  }

  const LIST_MIN  = 96;    // never squash below ~2 suggestions
  const GAP       = 12;
  let adjusting   = false; // re-entrancy guard: our own scrolling fires events

  // Fit the dropdown into whatever the keyboard has left of the visual viewport,
  // flipping it above the field when there is more room up there.
  function positionList() {
    if (list.hidden) return;

    // Drop our inline cap first so we can read the one CSS defines for the
    // current mode (16rem supporter / 22rem kiosk) and never exceed it.
    list.style.maxHeight = '';
    const cssMax = parseFloat(getComputedStyle(list).maxHeight) || Infinity;

    const vp = visualViewportBox();
    const r  = input.getBoundingClientRect();
    const below = vp.bottom - r.bottom - GAP;
    const above = r.top - vp.top - GAP;

    const flip = below < LIST_MIN && above > below && above >= LIST_MIN;
    list.classList.toggle('is-above', flip);
    const room = Math.max(LIST_MIN, flip ? above : below);
    list.style.maxHeight = `${Math.round(Math.min(room, cssMax))}px`;
  }

  // Size the panel, scroll field + panel clear of the keyboard, then re-size
  // against the position we actually ended up at.
  function reveal() {
    if (adjusting) return;
    adjusting = true;
    try {
      positionList();
      ensureVisible(input, { companion: list.hidden ? null : list });
      positionList();
    } finally { adjusting = false; }
  }

  function open()  {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    reveal();
  }
  function close() {
    list.hidden = true;
    list.classList.remove('is-above');
    list.style.maxHeight = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }
  function choose(val) {
    input.value = val;
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function render(items) {
    list.innerHTML = '';
    if (!items.length) { close(); return; }
    const frag = document.createDocumentFragment();
    items.slice(0, MAX).forEach((val, i) => {
      const li = document.createElement('li');
      li.className = 'course-ac-item';
      li.id = `course-ac-opt-${i}`;
      li.setAttribute('role', 'option');
      li.textContent = val;
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(val); });
      frag.appendChild(li);
    });
    list.appendChild(frag);
    open();
  }

  function setActive(i) {
    const items = list.querySelectorAll('.course-ac-item');
    if (!items.length) return;
    activeIndex = (i + items.length) % items.length;
    items.forEach(el => el.classList.remove('is-active'));
    const el = items[activeIndex];
    el.classList.add('is-active');
    el.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', el.id);
  }

  input.addEventListener('input', () => render(filter(input.value)));
  input.addEventListener('focus', () => render(filter(input.value)));
  input.addEventListener('blur',  () => setTimeout(close, 120));

  input.addEventListener('keydown', (e) => {
    if (list.hidden) {
      if (e.key === 'ArrowDown') render(filter(input.value));
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(activeIndex + 1); break;
      case 'ArrowUp':   e.preventDefault(); setActive(activeIndex - 1); break;
      case 'Enter':
        if (activeIndex >= 0) {
          e.preventDefault();
          choose(list.querySelectorAll('.course-ac-item')[activeIndex].textContent);
        }
        break;
      case 'Escape': close(); break;
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  // The keyboard opening/closing/resizing changes the visual viewport without
  // any scroll or input event, so re-fit the open dropdown when it does.
  const onViewportChange = () => { if (!list.hidden) reveal(); };
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
  window.addEventListener('scroll', () => {
    if (!list.hidden && !adjusting) positionList();
  }, { passive: true });
}


function loadCourseSchedule() {
  (async () => {
    try {
      const res = await fetch('./data/courseSchedule.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const courseSchedule = await res.json();

      let dateTime = new Date();
      let dayOfTheWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateTime.getDay()];
      let time = dateTime.getHours();
      let timeSlot = (time >= 12) ? "afternoon" : "morning";

      if (dayOfTheWeek === "Saturday" || dayOfTheWeek === "Sunday") {
        return;
      }

      let currentCourses = courseSchedule[dayOfTheWeek][timeSlot] ?? [];

      let buttonArray = document.getElementById("course_button_array");
      for (const course of currentCourses) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = course["abbreviation"];
        button.name = course["name"];
        button.courseNumber = course["number"];
        button.className = 'px-6 py-3 text-lg bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors w-full h-full';

        button.addEventListener('click', () => {
          document.getElementById('course_number').value = `${button.courseNumber} - ${button.name}`;
          document.querySelectorAll('#course_button_array button')
            .forEach(b => b.classList.remove('bg-yellow-700', 'ring-2'));
          button.classList.add('bg-yellow-700', 'ring-2');
        });

        buttonArray.appendChild(button);
      }
      buttonArray.className = 'grid gap-x-8';
      buttonArray.style.gridTemplateColumns = `repeat(${currentCourses.length}, 1fr)`;
      

    } catch (err) {
      console.error('courseSchedule.json load failed:', err);
    }
  })();
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

export function wireSurveyForm(){
  verifyOneTimeToken();
  setupCourseAutocomplete(); 
  loadCourseSchedule();
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch {}

  const form = document.getElementById("surveyForm");
  const thankYou = document.getElementById("thankYouModal");
  const closeBtn = document.getElementById("closeModal");
  const submitButton = document.getElementById("submitButton");

  const studentWrapper  = document.getElementById('studentWrapper');
  const usernameWrapper = document.getElementById('usernameWrapper');
  const studentNumInput = document.getElementById('student_number');
  const usernameInput   = document.getElementById('dtu_username');

  // --- Kiosk UX helpers & hardening for inputs ---
  if (studentNumInput) {
    try {
      studentNumInput.setAttribute('inputmode', 'numeric');
      studentNumInput.setAttribute('enterkeyhint', 'next');
      studentNumInput.setAttribute('maxlength', '6');
      studentNumInput.setAttribute('autocomplete', 'one-time-code');
    } catch {}
  }

  // Move to satisfaction row without forcing center
  function jumpToSatisfaction() {
    const firstSmile = document.querySelector('input[name="satisfaction"]');
    if (firstSmile) {
      try { firstSmile.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
      try { firstSmile.focus({ preventScroll: true }); } catch {}
    }
  }

  // Digits-only enforcement for the student number
  if (studentNumInput) {
    studentNumInput.addEventListener('beforeinput', (e) => {
      const t = e.inputType || '';
      if (t.startsWith('delete') || t.startsWith('history') || t.includes('format')) return;
      const data = (e.data ?? '');
      if (data && /\D/.test(data)) { e.preventDefault(); }
    });

    studentNumInput.addEventListener('input', () => {
      const cleaned = (studentNumInput.value || '').replace(/\D/g, '').slice(0, 6);
      if (studentNumInput.value !== cleaned) studentNumInput.value = cleaned;
    });

    studentNumInput.addEventListener('paste', (e) => {
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      const cleaned = txt.replace(/\D/g, '').slice(0, 6);
      const start = studentNumInput.selectionStart ?? studentNumInput.value.length;
      const end   = studentNumInput.selectionEnd ?? studentNumInput.value.length;
      const v = studentNumInput.value;
      const next = (v.slice(0, start) + cleaned + v.slice(end)).replace(/\D/g, '').slice(0, 6);
      studentNumInput.value = next;
      studentNumInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    studentNumInput.addEventListener('keydown', (e) => {
      const allowedKeys = new Set(['Backspace','Delete','ArrowLeft','ArrowRight','Home','End','Tab']);
      const isDigit = (e.key && /^[0-9]$/.test(e.key)) || (e.code && /^Numpad[0-9]$/.test(e.code));
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpToSatisfaction();
        return;
      }
      if (allowedKeys.has(e.key) || isDigit) return;
      if ((e.ctrlKey || e.metaKey) && ['a','c','v','x','A','C','V','X'].includes(e.key)) return;
      e.preventDefault();
    });
  }

  // Tap anywhere outside inputs to dismiss the keyboard (tablet mode only)
  if (!window.__surveyTapToDismissAttached) {
    document.addEventListener('pointerdown', (e) => {
      if (!(inKiosk && typeof inKiosk === 'function' && inKiosk())) return;
      const t = e.target;
      if (t && (t.closest('input, textarea, select, datalist, .ui-keep-focus'))) return;
      const active = document.activeElement;
      if (active && active.matches && active.matches('input, textarea, select')) {
        try { active.blur(); } catch {}
        // no re-centering here
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

  // The response is safely accounted for, thank the respondent and reset.
  function accept() {
    if (linkToken) {
      thankYou.classList.remove('hidden');
      redirectOnThankYouClose = true;
      setTimeout(() => { window.location.replace('https://pythonsupport.dtu.dk/'); }, 7000);
      return;
    }

    thankYou.classList.remove('hidden');

    form.reset();
    form.role.value = 'student';
    toggleRole();
    const buttonArray = document.getElementById("course_button_array");
    buttonArray.innerHTML = '';
    loadCourseSchedule();
    const preferWD = qpWD || (localStorage.getItem(STORAGE.WORKSHOP) === 'true');
    document.getElementById('workshop_yes').checked = !!preferWD;
    document.getElementById('workshop_no').checked  = !preferWD;
    studentNumInput.value = '';

    if (document.body.classList.contains('kiosk-mode')) {
      try { document.activeElement?.blur(); } catch {}
    } else {
      try { studentNumInput.focus({ preventScroll: true }); } catch {}
    }

    setTimeout(() => {
      thankYou.classList.add('hidden');
    }, 3000);
  }

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
      used_ai: (form.elements['used_ai'] && form.elements['used_ai'].value === 'yes'),
      token: linkToken || null,
    };

    try {
      if (isSupporterDevice && !isAuthValid()) {
        saveFailedSubmission(payload, 'offline — no code yet');
        accept();
        return;
      }

      const headers = { "Content-Type": "application/json" };
      if (linkToken) { headers["x-token"] = linkToken; } else { headers["x-api-key"] = getSavedKey()[1] || ""; }
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });

      if (response.ok) {
        accept();
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

        if (isSupporterDevice && isCredentialFault(response.status)) {
          clearSavedKey();
          saveFailedSubmission(payload, `HTTP ${response.status} — code refused`);
          accept();
          return;
        }

        const { title, message } = friendlyError(raw, response.status, !!linkToken);
        const keepable = response.status >= 500 || response.status === 429;
        const saved = keepable
          ? saveFailedSubmission(payload, `HTTP ${response.status}`)
          : null;
        showError({ title, message: saved ? `${message} ${savedNote(saved)}` : message }, response.status);
        if (form.role.value === 'student') { studentNumInput.focus(); } else { usernameInput?.focus(); }
      }
    } catch (err) {
      console.error("submit failed:", err);
      const saved = saveFailedSubmission(payload, err?.message || 'network error');
      showError({
        title: "We couldn't reach the server",
        message: `A network error occurred. ${savedNote(saved)}`
      });
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

function inKiosk() {
  return document.body.classList.contains('kiosk-mode');
}

// What to tell the user once the failsafe has taken the response.
function savedNote(saved) {
  if (!saved?.stored)  return 'The response could not be saved — please write it down.';
  if (!isSupporterDevice) return 'Your response is saved and will be sent automatically when the connection is back.';
  return 'The response is saved on this device and will be sent automatically when the connection is back. Use “Download backup file” to also keep a copy.';
}