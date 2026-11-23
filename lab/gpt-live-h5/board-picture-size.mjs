// How large a picture is, read from its first bytes, and a larger copy of one
// that is too small to be a reference. Pictures the board finds are often
// thumbnails (180 x 180), and a video model refuses a reference under 256 px a
// side (call of 11/21: four photographs given, one of them a thumbnail, and
// nothing was made). No image library: the size is in the file's header, and
// the larger copy is made by ffmpeg where the host has it.
import {spawn} from 'node:child_process';

/** {width, height} of a PNG, JPEG, GIF or WebP, or null. */
export function pictureSize(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47) return {width: data.readUInt32BE(16), height: data.readUInt32BE(20)};
  if (data.length >= 10 && data.toString('latin1', 0, 3) === 'GIF') return {width: data.readUInt16LE(6), height: data.readUInt16LE(8)};
  if (data.length >= 30 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    const kind = data.toString('latin1', 12, 16);
    if (kind === 'VP8X') return {width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3)};
    if (kind === 'VP8 ') return {width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff};
    if (kind === 'VP8L') { const bits = data.readUInt32LE(21); return {width: 1 + (bits & 0x3fff), height: 1 + (bits >> 14 & 0x3fff)}; }
    return null;
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    // The frame header (SOF0-SOF15, but not the tables that share the range) holds the size.
    for (let at = 2; at + 9 < data.length;) {
      if (data[at] !== 0xff) { at++; continue; }
      const marker = data[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return {width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5)};
      if (marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7 || marker === 0x01 || marker === 0xff) { at += marker === 0xff ? 1 : 2; continue; }
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  return null;
}

/**
 * The picture, at least `least` px on its shorter side. One already that large
 * (or of unknown size, or where no larger copy can be made) is returned as it
 * is. `run` is ffmpeg by default; a larger copy is a PNG.
 */
export async function roomyPicture(picture, {least = 512, most = 2048, binary = 'ffmpeg', timeoutMs = 8000} = {}) {
  const size = pictureSize(picture?.bytes);
  if (!size || !size.width || !size.height || Math.min(size.width, size.height) >= least) return picture;
  const scale = Math.min(least / Math.min(size.width, size.height), most / Math.max(size.width, size.height));
  if (!(scale > 1)) return picture;
  const width = Math.round(size.width * scale / 2) * 2, height = Math.round(size.height * scale / 2) * 2;
  const bytes = await new Promise(resolve => {
    const chunks = [];
    let done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    let child;
    try { child = spawn(binary, ['-loglevel', 'error', '-i', 'pipe:0', '-vf', `scale=${width}:${height}:flags=lanczos`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'], {stdio: ['pipe', 'pipe', 'ignore']}); } catch { return finish(null); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(null); }, timeoutMs);
    child.on('error', () => finish(null));
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('close', code => finish(code === 0 && chunks.length ? Buffer.concat(chunks) : null));
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(picture.bytes));
  });
  const made = bytes && pictureSize(bytes);
  return made && Math.min(made.width, made.height) >= Math.min(least, Math.round(Math.min(size.width, size.height) * scale) - 2) ? {...picture, bytes, type: 'image/png', enlargedFrom: size} : picture;
}
