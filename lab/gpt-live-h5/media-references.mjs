export function mediaReferences(text, base = 'https://voice.invalid/voice/') {
  const result = [], seen = new Set(), origin = new URL(base).origin;
  for (const match of String(text).matchAll(/(!?)\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)) {
    let url;
    try { url = new URL(match[3], base); } catch { continue; }
    if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === origin))) continue;
    const video = /\.(mp4|webm|mov)$/iu.test(url.pathname);
    const image = match[1] === '!' || /\.(png|jpe?g|webp|gif|avif)$/iu.test(url.pathname);
    if ((!image && !video) || seen.has(url.href)) continue;
    seen.add(url.href);
    result.push({kind: video ? 'video' : 'image', title: match[2] || (video ? '视频' : '图片'), url: url.href});
  }
  // OpenClaw may strip its MEDIA: attachment directive and leave a plain link
  // in the visible reply. Preserve that reply and recognize the same asset.
  for (const match of String(text).matchAll(/https?:\/\/[^\s<>"\u3002\uff0c\uff01\uff1f\uff1b]+/gu)) {
    let url;
    try { url = new URL(match[0].replace(/[)\],.;!?]+$/gu, '')); } catch { continue; }
    if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === origin))) continue;
    const video = /\.(mp4|webm|mov)$/iu.test(url.pathname);
    const image = /\.(png|jpe?g|webp|gif|avif)$/iu.test(url.pathname);
    if ((!image && !video) || seen.has(url.href)) continue;
    seen.add(url.href);
    result.push({kind: video ? 'video' : 'image', title: video ? '视频' : '图片', url: url.href});
  }
  return result;
}
