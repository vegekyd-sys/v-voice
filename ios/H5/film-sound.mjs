// The sound of a video on the page, played by the App. The page never makes sound during a call: a web
// view's sound is another process's audio session, and starting it takes the phone's audio from the call
// (production 11/22: the microphone stopped, or the call was interrupted and connected anew). So the picture
// plays silent here, and the App plays the sound through the call's own engine, following the picture: it
// starts, stops, jumps and goes round when the picture does. One video is heard at a time.

// How far the sound may be from the picture before it is put back, in seconds; how often that is looked at.
export const DRIFT = .12, CHECK_MS = 700;
const EVENTS = ['play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'ended', 'emptied'];

/**
 * `post`: one `film` command to the App ({op, url?, at?}). `address`: a media element's https address, or ''
 * (a promise of one will do). `clock`: {setInterval, clearInterval}.
 */
export function createFilmSound({post, address, clock = globalThis}) {
  let current = null;
  const loads = new Map();
  // The sound's length, in seconds: 0 when the video has none, null when it could not be had (asked again next time).
  function load(url) {
    if (!url) return Promise.resolve(null);
    if (!loads.has(url)) {
      const loading = Promise.resolve(post({op: 'load', url})).then(value => Number.isFinite(value?.seconds) ? value.seconds : null, () => null);
      loads.set(url, loading);
      void loading.then(seconds => { if (seconds === null) loads.delete(url); });
    }
    return loads.get(url);
  }
  const tell = payload => Promise.resolve(post(payload)).catch(() => null);
  function sync() {
    const it = current;
    if (!it?.url) return;
    const {media} = it, going = media.isConnected !== false && !media.paused && !media.ended && !media.seeking && media.readyState >= 3;
    if (!going) { if (it.going) { it.going = false; void tell({op: 'stop'}); } return; }
    it.going = true;
    void tell({op: 'play', url: it.url, at: media.currentTime});
  }
  // Looked at now and then: the two clocks drift, the App's audio may have been set up anew, and an element
  // taken off the page says nothing.
  async function check() {
    const it = current;
    if (!it) return;
    if (it.media.isConnected === false) { off(it.media); return; }
    if (!it.going || it.checking) return;
    it.checking = true;
    const heard = await tell({op: 'at'});
    it.checking = false;
    if (current !== it || !it.going || it.media.paused || it.media.seeking) return;
    const at = heard?.at;
    if (Number.isFinite(at) ? Math.abs(at - it.media.currentTime) > DRIFT : it.media.currentTime < it.seconds - .4) sync();
  }
  /** This video is heard (the one heard before it is not any more, and is told). Resolves false when it has no sound to play. */
  async function on(media, {lost} = {}) {
    if (current && current.media !== media) { const before = current; off(before.media); before.lost?.(); }
    if (current) { current.lost = lost ?? current.lost; sync(); return Boolean(current.url); }
    const it = current = {media, lost, url: '', seconds: 0, going: false, timer: null};
    it.listen = () => sync();
    for (const type of EVENTS) media.addEventListener(type, it.listen);
    let url = '', seconds = null;
    try { url = await address(media); seconds = await load(url); } catch { /* Not to be had: the picture goes on silent. */ }
    if (current !== it) return false;
    if (!seconds) { off(media); return false; }
    it.url = url; it.seconds = seconds;
    it.timer = clock.setInterval(() => void check(), CHECK_MS);
    sync();
    return true;
  }
  function off(media) {
    const it = current;
    if (!it || media && it.media !== media) return;
    current = null;
    for (const type of EVENTS) it.media.removeEventListener(type, it.listen);
    if (it.timer !== null) clock.clearInterval(it.timer);
    if (it.going) void tell({op: 'stop'});
  }
  return {
    on, off, check,
    /** Fetched ahead, so that the sound starts with the picture. */
    ready: async media => { try { return Boolean(await load(await address(media))); } catch { return false; } },
    heard: media => current?.media === media,
    stop: () => off(),
  };
}
