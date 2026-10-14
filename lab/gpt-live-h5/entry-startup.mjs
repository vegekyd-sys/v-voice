// Start the existing entry authorization/status request independently of the
// audio, avatar and Markdown module graph. No microphone or call is started.
export function startVoiceEntry({ location, fetch: request, replaceState, initialStatus, mark = () => {} }) {
  return (async () => {
    try {
      mark('voice.entry.start');
      const phone = new URLSearchParams(location.search).get('phone');
      const query = phone ? `phone=${encodeURIComponent(phone)}` : 'entry=tianyi';
      const access = new URLSearchParams(location.hash.slice(1)).get('access');
      if (access) {
        const response = await request(`./api/access?${query}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify({ access }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? '暂时无法连接 V，请稍后重试。');
        const search = new URLSearchParams(location.search);
        if (!phone) search.set('entry', 'tianyi');
        replaceState(`${location.pathname}?${search}`);
      }
      mark('voice.status.start');
      if (!access && initialStatus && typeof initialStatus.ready === 'boolean') {
        mark('voice.status.inline');
        mark('voice.status.complete');
        return { status: initialStatus };
      }
      const response = await request(`./api/status?${query}`);
      const status = await response.json();
      if (!response.ok) throw new Error(status.error ?? '暂时无法连接 V，请稍后重试。');
      mark('voice.status.complete');
      return { status };
    } catch (error) {
      // Resolve failure as data: the main module can be late or unavailable,
      // and a standalone preload must never leave an unhandled rejection.
      mark('voice.entry.failed');
      return { error: error.message ?? '暂时无法连接 V，请稍后重试。' };
    }
  })();
}

function initialEntryStatus() {
  try { return JSON.parse(window.document.getElementById('voiceEntryStatus')?.textContent ?? 'null'); }
  catch { return null; }
}

export const entryStartup = typeof window !== 'undefined' && window.document
  ? startVoiceEntry({ initialStatus: initialEntryStatus(), location: window.location, fetch: (...args) => fetch(...args),
    replaceState: url => window.history.replaceState(null, '', url),
    mark: name => performance.mark?.(name) })
  : null;
