// Hand-drawn marks for the call board: the ring, underline, tick and cross V's
// pen leaves on the things it is talking about. Each is one SVG path in a
// 100 x 100 box (stretched over its target), wobbly in a way that depends only
// on the seed, so the same item always gets the same stroke. Pure geometry.

// Small deterministic generator; quality does not matter, repeatability does.
export function seeded(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.codePointAt(0), 16777619);
  return () => {
    state = Math.imul(state ^ state >>> 15, 2246822507);
    state = Math.imul(state ^ state >>> 13, 3266489909);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}
const round = value => Math.round(value * 10) / 10;
// A smooth curve through points (Catmull-Rom as cubic Béziers).
function through(points) {
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    d += ` C${round(p1[0] + (p2[0] - p0[0]) / 6)} ${round(p1[1] + (p2[1] - p0[1]) / 6)} ${round(p2[0] - (p3[0] - p1[0]) / 6)} ${round(p2[1] - (p3[1] - p1[1]) / 6)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return d;
}
const jitter = (random, amount) => (random() - .5) * 2 * amount;

/** A loop drawn in one go: it starts a little off, wobbles, and overshoots where it closes. */
export function ring(seed) {
  const random = seeded(seed), start = -2.2 + jitter(random, .5), turn = Math.PI * 2 * (1.06 + random() * .08), steps = 14, points = [];
  const squash = .9 + random() * .08, lean = jitter(random, 3);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, angle = start + turn * t;
    // The pen drifts outward as it comes round, so the end passes outside the start.
    const radius = 46 + t * 4 + jitter(random, 1.6);
    points.push([50 + Math.cos(angle) * radius + lean * Math.sin(angle), 50 + Math.sin(angle) * radius * squash]);
  }
  return through(points);
}
/** One stroke under a word, with the slight bow of a quick hand. */
export function underline(seed) {
  const random = seeded(seed), bow = 18 + random() * 22, tilt = jitter(random, 14);
  return through([[1, 50 + tilt], [30 + jitter(random, 6), 50 + tilt / 3 - bow * .5], [68 + jitter(random, 6), 50 - tilt / 3 + bow * .35], [99, 50 - tilt + jitter(random, 8)]]);
}
export function check(seed) {
  const random = seeded(seed);
  return `M${round(8 + jitter(random, 3))} ${round(52 + jitter(random, 4))} L${round(36 + jitter(random, 4))} ${round(84 + jitter(random, 3))} L${round(92 + jitter(random, 3))} ${round(14 + jitter(random, 5))}`;
}
export function cross(seed) {
  const random = seeded(seed), p = amount => round(jitter(random, amount));
  return `M${14 + p(4)} ${14 + p(4)} L${86 + p(4)} ${86 + p(4)} M${86 + p(4)} ${14 + p(4)} L${14 + p(4)} ${86 + p(4)}`;
}
/** A five-point star in one stroke, the way it is drawn on paper. */
export function star(seed) {
  const random = seeded(seed), points = [];
  for (let i = 0; i <= 5; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 4 / 5;
    points.push(`${round(50 + Math.cos(angle) * (44 + jitter(random, 3)))} ${round(52 + Math.sin(angle) * (44 + jitter(random, 3)))}`);
  }
  return 'M' + points.join(' L');
}
/** A small arrow, pen pointing right: "this one, now". */
export function pointer(seed) {
  const random = seeded(seed), y = 50 + jitter(random, 4);
  return `M6 ${round(y + jitter(random, 5))} C30 ${round(y - 8)} 60 ${round(y + 6)} 90 ${round(y)} M64 ${round(y - 24 + jitter(random, 4))} L92 ${round(y)} L66 ${round(y + 22 + jitter(random, 4))}`;
}
/** A curved connector between two points of a 100 x 100 box, with its arrow head. */
export function arrow(seed, from, to) {
  const random = seeded(seed), dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy) || 1;
  const bend = jitter(random, .12) + .1, mid = [(from[0] + to[0]) / 2 - dy * bend, (from[1] + to[1]) / 2 + dx * bend];
  const angle = Math.atan2(to[1] - mid[1], to[0] - mid[0]), head = Math.min(9, length * .3);
  const wing = side => `${round(to[0] - Math.cos(angle + side * .5) * head)} ${round(to[1] - Math.sin(angle + side * .5) * head)}`;
  return `M${round(from[0])} ${round(from[1])} Q${round(mid[0])} ${round(mid[1])} ${round(to[0])} ${round(to[1])} M${wing(1)} L${round(to[0])} ${round(to[1])} L${wing(-1)}`;
}
export const MARK_PATHS = Object.freeze({ring, underline, check, cross, star});
/**
 * A path from the 100 x 100 box, re-expressed for a box of `width` x `height`.
 * Strokes are drawn at their real size so the pen keeps one thickness and a
 * stroke's drawn-on length is exact; every command here is absolute x y pairs.
 */
export function fitPath(d, width, height) {
  let x = true;
  return d.replace(/-?\d+(?:\.\d+)?/gu, value => { const scaled = Number(value) * (x ? width : height) / 100; x = !x; return String(round(scaled)); });
}
/** A piece of paper's small rotation, in degrees: the same piece always lies the same way. */
export const tilt = (seed, most = 2.2) => round((seeded(seed)() - .5) * 2 * most);
