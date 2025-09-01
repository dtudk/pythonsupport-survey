import { isKiosk, setKiosk, ensureFullscreen, ensureOrientation, tryReacquireWakeLockSoon, requestWakeLock, releaseWakeLock, bindWakeLockWatchers, unbindWakeLockWatchers, bindVisualViewport, unbindVisualViewport, updateKbdOffset } from './kiosk-utils.js';

export function wireKiosk(){
  document.getElementById('kioskToggle').addEventListener('click', () => {
    setKiosk(!isKiosk());
  });

  document.addEventListener('fullscreenchange', fsChange);

  function fsChange(){
    if (!isKiosk()) return;
    // If fullscreen was lost, let the guardian try recovery; do not leave kiosk here.
    startKioskGuardian();
  }
}

export function applyKiosk(state){
  if(state){
    requestWakeLock();
    bindWakeLockWatchers();
    bindVisualViewport();
    setTimeout(() => {
      ensureFullscreen().catch(() => {});
      ensureOrientation().catch(() => {});
      tryReacquireWakeLockSoon();
      updateKbdOffset();
    }, 400);
    startKioskGuardian();
  } else {
    releaseWakeLock();
    unbindWakeLockWatchers();
    unbindVisualViewport();
    stopKioskGuardian();
  }
}

export function unbindVisualViewport(){
  try { window.visualViewport.removeEventListener('resize', updateKbdOffset); }
  catch {}
  try { document.documentElement.style.removeProperty('--kbd-offset'); } catch {}
}

// --- Kiosk Guardian: keep kiosk healthy or cleanly exit if recovery fails ---
let __guardTimer = null;
let __guardFailCount = 0;

function stopKioskGuardian(){
  if (__guardTimer) { clearInterval(__guardTimer); __guardTimer = null; }
  __guardFailCount = 0;
}

function startKioskGuardian(){
  if (__guardTimer) return;
  __guardFailCount = 0;
  __guardTimer = setInterval(async () => {
    if (!isKiosk()) { stopKioskGuardian(); return; }

    const visible = (document.visibilityState === 'visible');
    const inFullscreen = !!document.fullscreenElement;

    // Healthy state: visible and fullscreen
    if (visible && inFullscreen) { __guardFailCount = 0; return; }

    // Attempt recovery only when visible
    if (visible) {
      try {
        await ensureFullscreen();
        await ensureOrientation();
        tryReacquireWakeLockSoon();
        updateKbdOffset();
      } catch {}
      // Count failures while visible and still not fullscreen
      if (!document.fullscreenElement) { __guardFailCount++; } else { __guardFailCount = 0; }
    }

    // If recovery keeps failing, cleanly exit kiosk to avoid "stuck" limbo state
    if (__guardFailCount >= 5) {
      setKiosk(false);
      stopKioskGuardian();
    }
  }, 1000);
}