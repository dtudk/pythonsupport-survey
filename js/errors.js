// Error handling module
import { CONFIG } from './config.js';

export function friendlyError(raw, status = 0, usingToken = false) {
  const text = (typeof raw === 'string') ? raw : (raw?.message || '');
  const l = (text || '').toLowerCase();
  let title = "We couldn't submit your response";
  let message = 'Please try again in a moment.';

  const roleNow = (document.querySelector('input[name="role"]:checked')?.value || 'student');
  
  if (l.includes('study number does not exist') || l.includes('student number does not exist')) {
    if (roleNow === 'employee') {
      title = 'DTU username not found';
      message = "We couldn't find that DTU username. Please enter your DTU credentials (letters only, e.g. 'manufer') and try again.";
    } else {
      title = 'Student number not found';
      message = "We couldn't find that student number. Please check the six digits after 's' on your DTU ID (e.g. s123456) and try again.";
    }
  } else if (l.includes('invalid or used token') || l.includes('token expired') || (status === 401 && usingToken) || l.includes('link has expired')) {
    title = "Oops, this link has expired";
    message = 'This one-time link has already been used or expired. Please request a new link from your supporter.';
  } else if (l.includes('unauthorized')) {
    title = 'Not authorised';
    message = 'Your session has expired. Please refresh and try again.';
  } else if (l.includes('triggerinputschemamismatch') || l.includes('invalid type') || l.includes('schema')) {
    title = 'Form not recognised';
    message = 'Some information was in the wrong format. Please refresh the page and try again.';
  } else if (status >= 500) {
    title = 'Service temporarily unavailable';
    message = 'We are experiencing a temporary problem. Please try again in a minute.';
  } else if (status === 429) {
    title = 'Too many attempts';
    message = 'Please wait a moment and try again.';
  } else if (l.includes('could not generate link')) {
    title = 'Could not generate link';
    message = 'Please confirm you are signed in and try again.';
  } else if (l.includes('qr generator failed')) {
    title = 'QR generator unavailable';
    message = 'Network access to the QR service is blocked. Try again or use the copy-link option.';
  } else if (text && text.trim()) {
    try {
      const maybe = JSON.parse(text);
      if (maybe && typeof maybe.message === 'string') {
        message = maybe.message;
      } else {
        message = text;
      }
    } catch { 
      message = text; 
    }
  }
  
  return { title, message };
}

export function showError(input, status) {
  const linkToken = new URLSearchParams(window.location.search).get('t') || 
                   new URLSearchParams(window.location.search).get('token');
  const usingToken = !!linkToken;
  
  const { title, message } = (typeof input === 'string')
    ? friendlyError(input, status, usingToken)
    : (input && typeof input === 'object') ? input : friendlyError('', status, usingToken);
    
  const titleEl = document.getElementById('errorTitle');
  if (titleEl) titleEl.textContent = title;
  
  const messageEl = document.querySelector('.error-message');
  if (messageEl) messageEl.textContent = message;

  // For expired/invalid token, closing should redirect
  let redirectOnErrorClose = false;
  const combo = (title + ' ' + message).toLowerCase();
  const isExpiredTokenError = usingToken && (
    combo.includes('link has expired') ||
    combo.includes('invalid or used token') ||
    combo.includes('token expired')
  );
  
  const closeBtn = document.getElementById('closeErrorModal');
  if (closeBtn) {
    if (isExpiredTokenError) {
      redirectOnErrorClose = true;
      closeBtn.textContent = 'Go to Python Support';
    } else {
      closeBtn.textContent = 'Try Again';
    }
    
    closeBtn.onclick = () => {
      document.getElementById('errorModal').classList.add('hidden');
      if (redirectOnErrorClose && linkToken) {
        window.location.replace(CONFIG.urls.pythonSupport);
      }
    };
  }

  document.getElementById('errorModal').classList.remove('hidden');
}