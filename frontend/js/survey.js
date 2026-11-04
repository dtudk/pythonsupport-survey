import { endpoint, state, linkToken, isQrLink, isSupporterDevice, qpWD } from './config.js';
import { isAuthValid, clearSavedKey } from './auth.js';
import { apiFetch, linkCheckResult, submitResult } from './api.js';
import { showError, friendlyError, errorText } from './errors.js';
import { syncFabVisibility, isKiosk } from './kiosk.js';
import { visualViewportBox, ensureVisible } from './viewport.js';
import { saveFailedSubmission } from './failsafe.js';


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
      const res = await fetch('./data/courses.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      courses = (await res.json()).map(c => `${c.number} - ${c.name}`);
    } catch (err) {
      console.error('courses.json load failed:', err);
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
  const GAP       = 16;    // ensureVisible's 12px margin + the list's 4px offset from the field
  let adjusting   = false; // re-entrancy guard: our own scrolling fires events

  function positionList() {
    if (list.hidden) return;

    // Clear the inline cap to read the CSS one for the current mode.
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

  // Size again after scrolling, for where the field ended up.
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
      // Not on pointerdown: a finger that starts a scroll would pick the item under it.
      li.addEventListener('mousedown', (e) => e.preventDefault());  // keeps the focus in the field
      li.addEventListener('click', () => choose(val));
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

  // The keyboard changes the visual viewport without any scroll or input event.
  const onViewportChange = () => { if (!list.hidden) reveal(); };
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
  window.addEventListener('scroll', () => {
    if (!list.hidden && !adjusting) positionList();
  }, { passive: true });
}


async function loadCourseSchedule() {
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

    let currentCourses = (courseSchedule[dayOfTheWeek][timeSlot] ?? []).slice(0, 6);

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
    buttonArray.className = 'grid gap-x-8 gap-y-4';
    buttonArray.style.gridTemplateColumns = `repeat(${Math.min(currentCourses.length, 3)}, 1fr)`;
  } catch (err) {
    console.error('courseSchedule.json load failed:', err);
  }
}


function lockForm(error, status) {
  showError(error, status);
  document.querySelectorAll('#surveyForm input, #surveyForm select, #surveyForm textarea, #surveyForm button')
    .forEach(el => { if (el.id !== 'closeErrorModal') el.disabled = true; });
}

export async function verifyOneTimeToken() {
  // Old ?b= posters have no token, so only a logged-in supporter's device can still submit them.
  if (isQrLink && !linkToken && !isAuthValid()) {
    lockForm({ title: 'This QR code no longer works', message: 'Please ask a supporter for a new QR code.' });
    return false;
  }
  if (!linkToken) return true;
  const { status } = await apiFetch(endpoint, { ping: true, token: linkToken });
  const result = linkCheckResult(status);
  if (result === 'expired') {
    lockForm('Oops, this link has expired. Please request a new one-time link from your supporter.', status);
    return false;
  }
  if (result === 'warn') showError('', status);
  return true;
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

  function jumpToSatisfaction() {
    const firstSmile = document.querySelector('input[name="satisfaction"]');
    if (firstSmile) {
      try { firstSmile.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
      try { firstSmile.focus({ preventScroll: true }); } catch {}
    }
  }

  // No maxlength in the HTML, so a pasted "s123456" loses its 's' here instead of its last digit.
  studentNumInput.addEventListener('input', () => {
    const cleaned = studentNumInput.value.replace(/\D/g, '').slice(0, 6);
    if (studentNumInput.value !== cleaned) studentNumInput.value = cleaned;
  });
  studentNumInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); jumpToSatisfaction(); }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!isKiosk()) return;
    const t = e.target;
    if (t && (t.closest('input, textarea, select, datalist, .ui-keep-focus'))) return;
    const active = document.activeElement;
    if (active && active.matches && active.matches('input, textarea, select')) {
      try { active.blur(); } catch {}
    }
  }, { passive: true });

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
    const preferWD = qpWD || !!document.getElementById('workshopDayToggle')?.checked;
    document.getElementById('workshop_yes').checked = !!preferWD;
    document.getElementById('workshop_no').checked  = !preferWD;
    studentNumInput.value = '';

    if (isKiosk()) {
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
      username:        !isStudent ? usernameInput.value.trim().toLowerCase() : null,
      satisfaction: Number(form.querySelector('input[name="satisfaction"]:checked').value),
      course_number: (document.getElementById('course_number').value || '').trim() || null,
      building_number: linkToken ? null : state.selectedBuilding,
      workshop: (form.elements['workshop'] && form.elements['workshop'].value === 'yes'),
      used_ai: { yes: true, no: false }[form.elements['used_ai']?.value] ?? null,
      token: linkToken || null,
    };

    try {
      if (isSupporterDevice && !isAuthValid()) {
        saveFailedSubmission(payload, 'offline — no code yet');
        accept();
        return;
      }

      const { status, data } = await apiFetch(endpoint, payload);
      const result = submitResult(status, isSupporterDevice);
      if (result === 'sent') { accept(); return; }

      if (result === 'login') clearSavedKey();
      const saved = result === 'rejected' ? null : saveFailedSubmission(payload, status ? `HTTP ${status}` : 'no answer');
      // Queued counts as sent: a form left filled invites a second copy via "Try Again".
      if (saved?.stored) { accept(); return; }

      if (!status) {
        showError({
          title: "We couldn't reach the server",
          message: `A network error occurred. ${saved ? NOT_SAVED : 'Check your connection and try again.'}`
        });
        return;
      }
      const { title, message } = friendlyError(errorText(data), status);
      showError({ title, message: saved ? `${message} ${NOT_SAVED}` : message }, status);
      if (form.role.value === 'student') { studentNumInput.focus(); } else { usernameInput?.focus(); }
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

const NOT_SAVED = 'The response could not be saved — please write it down.';