import { linkToken, isQrLink } from './config.js';

// '' when the body isn't JSON, such as Django's HTML error pages.
export async function errorText(response) {
  const data = (await response.json().catch(() => null)) || {};
  const fieldErrors = Object.values(data.errors || {}).flat().map(err => err.message || err);
  return data.error || fieldErrors.join(' ');
}

export function friendlyError(text, status = 0) {
  let title = "We couldn't submit your response";
  let message = text || 'Please try again in a moment.';

  if (text.toLowerCase().includes('link has expired')) {
    title = "Oops, this link has expired"; message = 'This one-time link has already been used or expired. Please request a new link from your supporter.';
  } else if (isQrLink && !linkToken && status === 403) {
    // ?b= QR codes without a token: the backend only takes them from a logged-in device.
    title = 'This QR code no longer works'; message = 'Your response was not saved. Please ask a supporter for a new QR code.';
  } else if (status >= 500) {
    title = 'Service temporarily unavailable'; message = 'We are experiencing a temporary problem. Please try again in a minute.';
  }

  return { title, message };
}

export function showError(input, status) {
  const usingToken = !!linkToken;
  const { title, message } = (typeof input === 'string')
    ? friendlyError(input, status)
    : (input && typeof input === 'object') ? input : friendlyError('', status);

  const titleEl = document.getElementById('errorTitle');
  if (titleEl) titleEl.textContent = title;
  document.querySelector('.error-message').textContent = message;

  const isExpiredTokenError = (usingToken || isQrLink) && /link has expired|no longer works/i.test(`${title} ${message}`);
  const closeBtn = document.getElementById('closeErrorModal');
  if (closeBtn) {
    closeBtn.textContent = isExpiredTokenError ? 'Go to Python Support' : 'Try Again';
    closeBtn.onclick = () => {
      document.getElementById('errorModal').classList.add('hidden');
      if (isExpiredTokenError) { window.location.replace('https://pythonsupport.dtu.dk/'); }
    };
  }

  document.getElementById('errorModal').classList.remove('hidden');
}
