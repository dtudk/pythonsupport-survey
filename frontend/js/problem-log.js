import { problemLogEndpoint } from './config.js';
import { clearSavedKey, showLogin } from './auth.js';
import { apiFetch } from './api.js';
import { errorText } from './errors.js';

export function wireProblemLog() {
  const form = document.getElementById('problemLogForm');
  const button = document.getElementById('problemSubmitButton');
  const error = document.getElementById('problemLogError');
  const other = document.getElementById('problemOther');
  const success = document.getElementById('problemLogSuccessModal');

  const say = (msg) => { error.textContent = msg; error.classList.toggle('hidden', !msg); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    say('');

    const problems = Array.from(form.querySelectorAll('input[name="problems"]:checked'), i => i.value);
    const text = other.value.trim();
    if (!problems.length && !text) {
      say('Select at least one problem or describe another problem.');
      other.focus();
      return;
    }

    button.disabled = true;
    button.textContent = 'Submitting…';
    const { ok, status, data } = await apiFetch(problemLogEndpoint, { problems, other: text });
    button.disabled = false;
    button.textContent = 'Submit Problem';

    if (ok) {
      form.reset();
      success.classList.remove('hidden');
    } else if (status === 403) {
      clearSavedKey();
      showLogin();
      say('Your supporter session has expired. Log in and submit again.');
    } else {
      say(status ? errorText(data) || `Request failed (${status}).` : 'Could not reach the server. Please try again.');
    }
  });

  document.getElementById('closeProblemLogSuccess').addEventListener('click', () => success.classList.add('hidden'));
}
