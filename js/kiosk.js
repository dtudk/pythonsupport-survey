import { STORAGE, linkToken } from './config.js';

// --- HARD KIOSK & WAKE LOCK SUPPORT ---
// If true, users cannot exit via the 5-tap corner or other soft exits.
const HARD_KIOSK = false;

// Screen Wake Lock (modern browsers) + NoSleep fallback (older iOS)
let __wakeLock = null;
let __noSleep = null;
let __wakeHandlersBound = false;

// VisualViewport keyboard offset helpers
let __vvBound = false;
let __kbdOpen = false;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && navigator.wakeLock?.request) {
      __wakeLock = await navigator.wakeLock.request('screen');
      __wakeLock.addEventListener?.('release', () => {
        if (isKiosk()) { tryReacquireWakeLockSoon(); }
      });
    } else {
      if (!__noSleep) {
        await loadNoSleepLib();
        __noSleep = new window.NoSleep();
      }
      try { __noSleep.enable(); } catch {}
    }
  } catch {
    tryReacquireWakeLockSoon();
  }
}

function releaseWakeLock() {
  try { if (__wakeLock) { __wakeLock.release?.(); } } catch {}
  __wakeLock = null;
  try { if (__noSleep) { __noSleep.disable?.(); } } catch {}
}

function tryReacquireWakeLockSoon() {
  if (!isKiosk()) return;
  setTimeout(() => { if (isKiosk()) requestWakeLock(); }, 600);
}

function loadNoSleepLib() {
  return new Promise((resolve) => {
    if (window.NoSleep) return resolve();
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/nosleep.js@0.12.0/dist/NoSleep.min.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
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

// --- VisualViewport-aware keyboard offset (tablet mode) ---
function updateKbdOffset() {
  if (!isKiosk()) return;
  const vv = window.visualViewport;
  if (!vv) return;

  // How much of the layout viewport is occluded by the keyboard
  const occlusion = Math.max(0, (window.innerHeight || 0) - (vv.height || 0) - (vv.offsetTop || 0));

  // Expose to CSS so #surveyPage can add bottom padding
  try { document.documentElement.style.setProperty('--kbd-offset', `${occlusion}px`); } catch {}

  const nowOpen = occlusion > 80; // heuristic
  if (nowOpen && !__kbdOpen) {
    __kbdOpen = true;
    // Gently keep the focused control visible without re-centering the card
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {
      try { ae.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch {}
    }
  } else if (!nowOpen && __kbdOpen) {
    __kbdOpen = false;
  }
}

function bindVisualViewport() {
  if (__vvBound || !window.visualViewport) return;
  try {
    window.visualViewport.addEventListener('resize', updateKbdOffset);
    window.visualViewport.addEventListener('scroll', updateKbdOffset);
    window.addEventListener('resize', updateKbdOffset);
    __vvBound = true;
    updateKbdOffset(); // init
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
  } catch {}
  __vvBound = false;
  __kbdOpen = false;
  try { document.documentElement.style.removeProperty('--kbd-offset'); } catch {}
}

// --- Kiosk plumbing ---
const kioskEnterBtn = () => document.getElementById('kioskEnter');
const kioskExitBtn  = () => document.getElementById('kioskExit');

export function isKiosk(){ try { return localStorage.getItem(STORAGE.KIOSK) === '1'; } catch { return false; } }

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

    // Always-on + resilience
    requestWakeLock();
    bindWakeLockWatchers();

    // Keyboard-safe padding & nudge
    bindVisualViewport();

    // iPad/Samsung UI bars animation settle
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
  try { v ? localStorage.setItem(STORAGE.KIOSK,'1') : localStorage.removeItem(STORAGE.KIOSK); } catch {}
  applyKiosk(v);
}

export function wireKiosk() {
  // enter
  kioskEnterBtn()?.addEventListener('click', ()=> setKiosk(true));

  // exit by 5 taps (top-right)
  let taps = 0, timer = null;
  const reset = ()=>{ taps = 0; if (timer) { clearTimeout(timer); timer = null; } };
  const handleTap = ()=>{ taps += 1; if (!timer) { timer = setTimeout(reset, 1500); } if (taps >= 5) { reset(); setKiosk(false); } };

  if (!HARD_KIOSK) {
    kioskExitBtn()?.addEventListener('click', handleTap, {passive:true});
    kioskExitBtn()?.addEventListener('touchstart', (e)=>{ e.preventDefault(); handleTap(); }, {passive:false});
  }

  // block navigation keys in kiosk
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

  // leave kiosk if fullscreen gets closed via ESC (recover, do not exit)
  function fsChange(){
    if (isKiosk() && !document.fullscreenElement) {
      ensureFullscreen();
      // keep kiosk mode active
    }
  }
  document.addEventListener('fullscreenchange', fsChange);
  document.addEventListener('webkitfullscreenchange', fsChange);

  // Wake lock can drop on tab switches / power events
  window.addEventListener('focus', () => { if (isKiosk()) tryReacquireWakeLockSoon(); }, {passive:true});

  // initial FAB visibility
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

// Ensure the "Enter Tablet mode" FAB appears whenever the survey is visible
export function syncFabVisibility() {
  const btn = document.getElementById('kioskEnter');
  if (!btn) return;

  // Students coming via Discord/QR (token or building in URL) never see the FAB
  const params = new URLSearchParams(location.search);
  const tokenMode = !!(params.get('t') || params.get('token') || params.get('b'));

  const sc = document.getElementById('surveyContainer'); // container that gets toggled
  const sp = document.getElementById('surveyPage');      // inner partial

  const containerVisible = sc && !sc.classList.contains('hidden');
  const innerVisible     = !sp || !sp.classList.contains('hidden');

  const onSurvey = containerVisible && innerVisible;
  const kioskActive = typeof isKiosk === 'function' ? isKiosk() : false;

  btn.style.display = (!tokenMode && onSurvey && !kioskActive) ? '' : 'none';
}