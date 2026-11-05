// An installation may take longer than the server's five-minute binding grant.
// Refresh on expiry or browser return, without starting an automatic app launch.
export function refreshBindingOnExpiry({expiresAt, refresh, window: win = window, document: doc = document, now = Date.now}) {
  if (!Number.isFinite(expiresAt)) return () => {};
  let refreshed = false;
  const check = () => {
    if (!refreshed && !doc.hidden && now() >= expiresAt) { refreshed = true; refresh(); }
  };
  const timer = win.setTimeout(check, Math.max(0, expiresAt - now()));
  doc.addEventListener('visibilitychange', check);
  win.addEventListener('pageshow', check);
  return () => {
    refreshed = true; win.clearTimeout(timer);
    doc.removeEventListener('visibilitychange', check);
    win.removeEventListener('pageshow', check);
  };
}

// Run only from a user gesture. A custom scheme has no installation-query API:
// leaving the page cancels the fallback; staying here opens the download page.
export function openAppWithFallback({appUrl, downloadUrl, window: win = window, document: doc = document, delay = 2200}) {
  let timer, finished = false;
  const clear = () => { win.clearTimeout(timer); timer = undefined; };
  const dispose = () => {
    finished = true; clear();
    doc.removeEventListener('visibilitychange', visibility);
    win.removeEventListener('pagehide', dispose);
    win.removeEventListener('blur', clear);
    win.removeEventListener('focus', schedule);
  };
  const fallback = () => {
    if (finished || doc.hidden || !doc.hasFocus()) return;
    dispose();
    if (downloadUrl) win.location.assign(downloadUrl);
  };
  const schedule = () => {
    clear();
    if (!finished && !doc.hidden && doc.hasFocus() && downloadUrl) timer = win.setTimeout(fallback, delay);
  };
  const visibility = () => { if (doc.hidden) dispose(); };
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('pagehide', dispose);
  // Do not race the browser's native "Open in App?" confirmation dialog.
  win.addEventListener('blur', clear);
  win.addEventListener('focus', schedule);
  schedule();
  try { win.location.assign(appUrl); } catch { fallback(); }
  return dispose;
}
