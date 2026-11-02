import { linkToken, isQrLink } from './config.js';
import { keyboardOcclusion, isKeyboardOpen, ensureVisible, openPanelFor } from './viewport.js';

let __kiosk = false;
let __wakeLock = null;
let __wakeHandlersBound = false;
let __vvBound = false;
let __kbdOpen = false;
let __lastOcclusion = -1;

async function requestWakeLock() {
  if (!navigator.wakeLock) return;
  try {
    __wakeLock = await navigator.wakeLock.request('screen');
    __wakeLock.addEventListener('release', () => {
      if (isKiosk()) { tryReacquireWakeLockSoon(); }
    });
  } catch {
    tryReacquireWakeLockSoon();
  }
}

function releaseWakeLock() {
  try { if (__wakeLock) { __wakeLock.release?.(); } } catch {}
  __wakeLock = null;
}

function tryReacquireWakeLockSoon() {
  if (!isKiosk()) return;
  setTimeout(() => { if (isKiosk()) requestWakeLock(); }, 600);
}

async function ensureFullscreen() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen().catch(()=>{});
    }
  } catch {}
}

async function ensureOrientation() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape').catch(()=>{});
    }
  } catch {}
}

function isTextField(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

export function keepFocusVisible(behavior = 'auto') {
  const ae = document.activeElement;
  if (!isTextField(ae)) return;
  ensureVisible(ae, { companion: openPanelFor(ae), behavior });
}

function updateKbdOffset() {
  if (!isKiosk()) return;
  if (!window.visualViewport) return;

  // #surveyPage pads its bottom by this, making room to scroll lower fields above the keyboard.
  const occlusion = keyboardOcclusion();
  const changed = occlusion !== __lastOcclusion;
  __lastOcclusion = occlusion;
  if (changed) {
    try { document.documentElement.style.setProperty('--kbd-offset', `${occlusion}px`); } catch {}
  }

  const nowOpen = isKeyboardOpen();
  if (nowOpen && !__kbdOpen) {
    __kbdOpen = true;
    // The padding-bottom above only lands after a layout pass.
    requestAnimationFrame(() => keepFocusVisible('smooth'));
  } else if (!nowOpen && __kbdOpen) {
    __kbdOpen = false;
  } else if (nowOpen && changed) {
    // Keyboard resized. Only on change, so plain scrolling doesn't snap the page back.
    keepFocusVisible('auto');
  }
}

// Moving between fields with the keyboard up doesn't resize the visual viewport.
function onKioskFocusIn() {
  if (!isKiosk() || !__kbdOpen) return;
  requestAnimationFrame(() => keepFocusVisible('smooth'));
}

function bindVisualViewport() {
  if (__vvBound || !window.visualViewport) return;
  try {
    window.visualViewport.addEventListener('resize', updateKbdOffset);
    window.visualViewport.addEventListener('scroll', updateKbdOffset);
    window.addEventListener('resize', updateKbdOffset);
    document.addEventListener('focusin', onKioskFocusIn);
    __vvBound = true;
    updateKbdOffset();
  } catch {}
}

function unbindVisualViewport() {
  if (!__vvBound) return;
  try {
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', updateKbdOffset);
      window.visualViewport.removeEventListener('scroll', updateKbdOffset);
    }
    window.removeEventListener('resize', updateKbdOffset);
    document.removeEventListener('focusin', onKioskFocusIn);
  } catch {}
  __vvBound = false;
  __kbdOpen = false;
  __lastOcclusion = -1;
  try { document.documentElement.style.removeProperty('--kbd-offset'); } catch {}
}

const kioskEnterBtn = () => document.getElementById('kioskEnter');
const kioskExitBtn  = () => document.getElementById('kioskExit');

export function isKiosk(){ return __kiosk; }

function setViewportLock(lock, scale = 1.0) {
  const vp = document.querySelector('meta[name="viewport"]');
  if (!vp) return;
  vp.setAttribute('content', lock
    ? `width=device-width, initial-scale=${scale}, maximum-scale=${scale}, user-scalable=no`
    : 'width=device-width, initial-scale=1.0');
}

export function applyKiosk(state){
  if(state){
    document.body.classList.add('kiosk-mode');
    setViewportLock(true, 1.30);
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{}); } catch {}
    try { const el=document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(()=>{}); } catch {}
    window.scrollTo(0,0);
    requestWakeLock();
    bindWakeLockWatchers();
    bindVisualViewport();
    // Again once the iPad/Samsung UI bars have settled.
    setTimeout(() => { try { ensureFullscreen(); ensureOrientation(); updateKbdOffset(); } catch {} }, 400);
  } else {
    document.body.classList.remove('kiosk-mode');
    setViewportLock(false);
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{}); } catch {}
    releaseWakeLock();
    unbindWakeLockWatchers();
    unbindVisualViewport();
  }
  syncFabVisibility();
}

export function setKiosk(v){
  __kiosk = v;
  applyKiosk(v);
}

export function wireKiosk() {
  kioskEnterBtn()?.addEventListener('click', ()=> setKiosk(true));

  let taps = 0, timer = null;
  const reset = ()=>{ taps = 0; if (timer) { clearTimeout(timer); timer = null; } };
  const handleTap = ()=>{ taps += 1; if (!timer) { timer = setTimeout(reset, 1500); } if (taps >= 5) { reset(); setKiosk(false); } };

  kioskExitBtn()?.addEventListener('click', handleTap, {passive:true});
  kioskExitBtn()?.addEventListener('touchstart', (e)=>{ e.preventDefault(); handleTap(); }, {passive:false});

  window.addEventListener('keydown', (e)=>{
    if (!isKiosk()) return;
    const tag = (e.target && e.target.tagName) || '';
    const editable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
    if (e.key === 'Backspace' && !editable) e.preventDefault();
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (e.key === 'F5' || (ctrlOrCmd && (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 'n'))) e.preventDefault();
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault();
    if (e.key === 'Escape') e.preventDefault();
  });

  window.addEventListener('contextmenu', (e)=>{ if (isKiosk()) e.preventDefault(); });

// Leaving fullscreen by any means exits kiosk mode, so it never gets stuck.
function fsChange(){
  if (isKiosk() && !document.fullscreenElement) {
    setKiosk(false);
  }
}
document.addEventListener('fullscreenchange', fsChange);
document.addEventListener('webkitfullscreenchange', fsChange);
  syncFabVisibility();
}

function bindWakeLockWatchers() {
  if (__wakeHandlersBound) return;
  document.addEventListener('visibilitychange', onVisibilityChange, false);
  window.addEventListener('focus', onWindowFocus, false);
  window.addEventListener('orientationchange', onOrientationChange, false);
  __wakeHandlersBound = true;
}
function unbindWakeLockWatchers() {
  if (!__wakeHandlersBound) return;
  document.removeEventListener('visibilitychange', onVisibilityChange, false);
  window.removeEventListener('focus', onWindowFocus, false);
  window.removeEventListener('orientationchange', onOrientationChange, false);
  __wakeHandlersBound = false;
}
function onVisibilityChange() { if (isKiosk() && document.visibilityState === 'visible') { tryReacquireWakeLockSoon(); ensureFullscreen(); updateKbdOffset(); } }
function onWindowFocus()      { if (isKiosk()) { tryReacquireWakeLockSoon(); updateKbdOffset(); } }
function onOrientationChange(){ if (isKiosk()) { ensureOrientation(); setTimeout(updateKbdOffset, 100); } }

export function syncFabVisibility() {
  const btn = document.getElementById('kioskEnter');
  if (!btn) return;

  const tokenMode = !!(linkToken || isQrLink);

  const sc = document.getElementById('surveyContainer');
  const sp = document.getElementById('surveyPage');

  const containerVisible = sc && !sc.classList.contains('hidden');
  const innerVisible     = !sp || !sp.classList.contains('hidden');

  const onSurvey = containerVisible && innerVisible;
  btn.style.display = (!tokenMode && onSurvey && !isKiosk()) ? '' : 'none';
}