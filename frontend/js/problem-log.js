import { problemLogEndpoint } from './config.js';
import { getSavedKey, clearSavedKey, isCredentialFault, showLogin } from './auth.js';
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
    try {
      const resp = await fetch(problemLogEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getSavedKey()[1] || '' },
        body: JSON.stringify({ problems, other: text }),
      });
      if (isCredentialFault(resp.status)) {
        clearSavedKey();
        showLogin();
        say('Your supporter session has expired. Log in and submit again.');
        return;
      }
      if (!resp.ok) throw new Error(await errorText(resp) || `Request failed (${resp.status}).`);
      form.reset();
      success.classList.remove('hidden');
    } catch (err) {
      say(err instanceof TypeError ? 'Could not reach the server. Please try again.' : err.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Submit Problem';
    }
  });

  document.getElementById('closeProblemLogSuccess').addEventListener('click', () => success.classList.add('hidden'));
}
