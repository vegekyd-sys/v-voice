// The call owns the lock; browser visibility and the OS remain authoritative.
export function createScreenWakeLock({ navigator, document, onState = () => {} }) {
  let active = false, sentinel = null, pending = null, generation = 0;
  const visible = () => document.visibilityState !== 'hidden';
  function release() {
    generation++;
    const old = sentinel;
    sentinel = null;
    if (old) void old.release().catch(() => {});
  }
  function ensure() {
    if (!active || !visible() || sentinel || pending) return pending;
    if (!navigator.wakeLock?.request) { onState('unavailable'); return; }
    const owner = generation;
    onState('requesting');
    pending = Promise.resolve().then(() => navigator.wakeLock.request('screen')).then(lock => {
      if (!active || !visible() || owner !== generation) { void lock.release().catch(() => {}); return; }
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel !== lock) return;
        sentinel = null;
        onState('released');
      });
      onState('held');
    }).catch(() => onState(active ? 'denied' : 'idle')).finally(() => {
      pending = null;
      if (active && visible() && owner !== generation) ensure();
    });
    return pending;
  }
  document.addEventListener?.('visibilitychange', () => {
    if (visible()) ensure();
    else { release(); onState(active ? 'released' : 'idle'); }
  });
  return {
    ensure,
    setActive(value) {
      if (active !== value) { active = value; generation++; }
      if (active) ensure();
      else { release(); onState('idle'); }
    },
  };
}
