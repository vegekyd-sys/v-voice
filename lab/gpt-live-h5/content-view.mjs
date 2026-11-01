import { mediaReferences } from "./media-references.mjs";
import { renderMarkdown } from "./markdown.mjs";

const plain = (text) =>
  String(text)
    .replace(/!?(\[[^\]]*\])\([^)]*\)/gu, "$1")
    .replace(/[#*_`>|]/gu, "")
    .trim();
export function contentDownloads(content) {
  const media=content.kind==='report'?(content.media??[]):[content];
  // Prose around an image/video does not turn the user's artwork into Markdown.
  return media.length?media.map(entry=>({...entry,title:entry.title||content.title})):
    [{kind:'document',title:content.title,text:content.text}];
}
const downloadName=(entry,mime='')=>{
  const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'})[mime.split(';')[0]]
    ?? entry.url?.match(/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)(?:[?#]|$)/iu)?.[1]
    ?? (entry.kind==='video'?'mp4':entry.kind==='document'?'md':'jpg');
  return String(entry.title||'作品').replace(/[\\/:*?"<>|]/gu,'-').replace(/\.(md|png|jpe?g|webp|gif|avif|mp4|webm|mov)$/iu,'').slice(0,100)+'.'+ext;
};
export function contentItems(item, base = "https://voice.invalid/voice/") {
  if (item.role !== "assistant" || !item.complete) return [];
  const text = String(item.text ?? ""),
    result = [];
  const document = item.document === true || item.speaker === "V · 完整方案";
  const media = mediaReferences(text, base);
  const caption = text.replace(/!?\[[^\]]*\]\([^)]*\)/gu, "").trim();
  // A completed reply is one deliverable. Keep the exact Markdown and order;
  // only a single media reference with no prose uses the frameless viewer.
  if (media.length === 1 && !caption) {
    return [{id: item.key + ":result", text, ...media[0]}];
  }
  if (media.length || document || text.length > 1100 ||
      (/^#{1,3}\s/mu.test(text) && text.length > 450)) {
    const title = text.match(/^#{1,3}\s+(.+)$/mu)?.[1] ?? media[0]?.title ?? "完整结果";
    const first = caption.split(/\n\s*\n/u).map(plain)
      .find(value => value && value !== plain(title)) ?? "";
    result.push({
      id: item.key + ":result", kind: "report", title: plain(title).slice(0, 80),
      summary: first.slice(0, 120), text, media,
    });
  }
  return result;
}

// A long report stays a card; a picture with a short caption reads as one message.
export const inlineFits = content => content.kind !== "report" || (content.media?.length > 0 && content.text.length <= 450);

// One reader holds the original controls: opening content never recreates the
// call, microphone, event subscriptions, task ownership, or avatar renderer.
export function createContentView(document, window, { onReading = () => {}, onSaveMedia, mediaSaveLabel='保存' } = {}) {
  const $ = (id) => document.getElementById(id);
  const layer = $("contentReader"),
    surface = $("readerSurface"),
    body = $("readerBody");
  let current = null,
    origin = null,
    closing = false,
    automatic = new Set(),
    animations = [], downloadController=null, downloadMenu=null, pendingAuto=null;
  const isMedia=content=>content.kind!=='report'||Boolean(content.media?.length);
  async function openPending() {
    const playing=root=>[...root.querySelectorAll('video')].some(video=>!video.paused&&!video.ended);
    if(!pendingAuto||closing||playing(document)||current&&!isMedia(current))return;
    const next=pendingAuto;pendingAuto=null;
    if(current)await close({immediate:true,openNext:false});
    if(!current&&next.card.isConnected&&['connected','ending'].includes(document.body.dataset.callState))open(next.content,next.card);
  }
  async function saveMedia(entry,button) {
    if(downloadController)return;
    if(onSaveMedia){
      if(button.getAttribute('aria-busy'))return;
      const title=button.textContent;button.textContent='保存中…';button.setAttribute('aria-busy','true');
      let result;try{result=await onSaveMedia(entry);}catch{result='保存失败';}
      button.removeAttribute('aria-busy');button.textContent=result||title;
      if(result)window.setTimeout?.(()=>{button.textContent=title;},2500);
      return;
    }
    const controller=new AbortController();downloadController=controller;
    const title=button.textContent;button.textContent='准备下载…';button.setAttribute('aria-busy','true');
    const timeout=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch(entry.url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw Error('download failed');
      const blob=await response.blob();
      if(!blob.size||blob.type&&blob.type!=='application/octet-stream'&&!blob.type.startsWith(entry.kind+'/'))throw Error('invalid media');
      if(controller.signal.aborted)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=downloadName(entry,blob.type);link.hidden=true;
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch {
      if(current&&downloadController===controller){
        const fallback=document.createElement('a');fallback.href=entry.url;fallback.target='_blank';fallback.rel='noopener noreferrer';
        fallback.className='media-error';fallback.textContent='下载未成功，打开原文件保存';body.append(fallback);
      }
    }finally{clearTimeout(timeout);button.textContent=title;button.removeAttribute('aria-busy');if(downloadController===controller)downloadController=null;}
  }
  function prepareDownload(content) {
    const button=$('readerDownload'),entries=contentDownloads(content),saveLabel=typeof mediaSaveLabel==='function'?mediaSaveLabel():mediaSaveLabel;
    downloadMenu?.remove();downloadMenu=null;button.onclick=null;button.hidden=false;
    delete button.dataset.mediaDownload;
    if(entries[0].kind==='document'){
      button.href=URL.createObjectURL(new Blob([content.text],{type:'text/markdown;charset=utf-8'}));
      button.download=downloadName(entries[0]);button.textContent='↓ 保存文档';return;
    }
    button.dataset.mediaDownload='true';button.removeAttribute('download');
    if(entries.length===1){
      const entry=entries[0];button.href=entry.url;
      button.textContent=`↓ ${saveLabel}${saveLabel==='保存'?(entry.kind==='video'?'视频':'图片'):''}`;
      button.onclick=event=>{event.preventDefault();void saveMedia(entry,button);};return;
    }
    button.href='#';button.textContent=`↓ 选择${saveLabel}`;
    downloadMenu=document.createElement('div');downloadMenu.className='reader-download-menu';downloadMenu.hidden=true;
    entries.forEach((entry,index)=>{
      const link=document.createElement('a');link.href=entry.url;link.textContent=`${entry.kind==='video'?'视频':'图片'} ${index+1} · ${entry.title}`;
      link.onclick=event=>{event.preventDefault();void saveMedia(entry,link);};downloadMenu.append(link);
    });
    button.parentElement.append(downloadMenu);
    button.onclick=event=>{event.preventDefault();downloadMenu.hidden=!downloadMenu.hidden;};
  }
  const cancelAnimations = () => {
    for (const animation of animations) animation.cancel();
    animations = [];
  };
  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function morph(from, to, reverse = false) {
    if (reduced() || !from.width || typeof surface.animate !== "function")
      return Promise.resolve();
    const ghost = $("readerMorph");
    ghost.hidden = false;
    const frames = [
      {
        left: from.x + "px",
        top: from.y + "px",
        width: from.width + "px",
        height: from.height + "px",
        borderRadius: "17px",
        opacity: 1,
      },
      {
        left: to.x + "px",
        top: to.y + "px",
        width: to.width + "px",
        height: to.height + "px",
        borderRadius: "22px",
        opacity: 1,
      },
    ];
    const moving = ghost.animate(frames, {
      duration: reverse ? 340 : 460,
      easing: "cubic-bezier(.22,1,.36,1)",
      fill: "both",
    });
    const fade = surface.animate(
      reverse
        ? [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(10px)" },
          ]
        : [
            { opacity: 0, transform: "translateY(10px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
      {
        duration: reverse ? 180 : 300,
        delay: reverse ? 0 : 120,
        fill: "both",
        easing: "ease-out",
      },
    );
    animations.push(moving, fade);
    return Promise.allSettled([moving.finished, fade.finished]).then(() => {
      ghost.hidden = true;
      cancelAnimations();
    });
  }
  // preload=auto would pull a whole video over the link carrying the call.
  const asset = (entry) => {
    const media = document.createElement(entry.kind === "video" ? "video" : "img");
    media.className = "media-asset";
    if (entry.kind === "video") {
      media.controls = true; media.playsInline = true; media.preload = "metadata";
      media.setAttribute("aria-label", entry.title);
      media.addEventListener('ended',()=>void openPending());
      media.addEventListener("loadedmetadata", () => {
        if (media.videoWidth && media.videoHeight) {
          media.width = media.videoWidth; media.height = media.videoHeight;
          media.style.aspectRatio = `${media.videoWidth} / ${media.videoHeight}`;
        }
        // Decode a poster frame without playing audio or requiring a play tap.
        // A tiny seek also paints the initial frame on WebKit.
        if (media.paused && media.currentTime === 0 && media.duration > 0) {
          media.currentTime = Math.min(0.001, media.duration / 2);
        }
      }, { once: true });
    } else { media.alt = entry.title; media.decoding = "async"; }
    media.referrerPolicy = "no-referrer"; media.src = entry.url;
    const wrap = document.createElement("span");
    wrap.className = "markdown-media";
    const failure = document.createElement("span");
    failure.className = "media-error"; failure.hidden = true;
    failure.textContent = "内容暂时无法加载，可以收起后重试。";
    media.addEventListener("error", () => { failure.hidden = false; });
    wrap.append(media, failure); return wrap;
  };
  const reportMedia = (target, content) => {
    const loaded = new Set();
    const entries = new Map(content.media.map(entry => [entry.url, entry]));
    renderMarkdown(target, content.text, document, {media: href => {
      let url; try { url = new URL(href, window.location.href).href; } catch { return null; }
      const entry = entries.get(url); if (!entry) return null;
      if (loaded.has(url)) return document.createDocumentFragment();
      loaded.add(url); return asset(entry);
    }});
  };
  const keepInView = (figure, media) => {
    media.addEventListener(media.tagName === "VIDEO" ? "loadedmetadata" : "load", () => {
      figure.dataset.loaded = "true";
      const scroller = figure.closest(".turns");
      if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 360) scroller.scrollTop = scroller.scrollHeight;
    }, { once: true });
  };
  const expandButton = (content, figure) => {
    const expand = document.createElement("button");
    expand.type = "button"; expand.className = "inline-media-expand"; expand.textContent = "↗"; expand.setAttribute("aria-label", "放大查看");
    expand.dataset.openContent = "true";
    expand.addEventListener("click", () => { figure.querySelectorAll?.("video").forEach(video => video.pause()); open(content, figure); });
    return expand;
  };
  // A generated image or video opens large, and stays in the conversation as
  // itself once the reader closes.
  const inlineMedia = (content) => {
    const figure = document.createElement("figure");
    figure.className = "inline-media"; figure.dataset.kind = content.kind;
    const wrap = asset(content), media = wrap.querySelector(".media-asset");
    keepInView(figure, media);
    figure.append(wrap);
    if (content.kind === "video") {
      figure.append(expandButton(content, figure));
    } else {
      media.dataset.openContent = "true"; media.tabIndex = 0; media.setAttribute("role", "button"); media.setAttribute("aria-label", "查看大图");
      media.addEventListener("click", () => open(content, figure));
      media.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(content, figure); } });
    }
    return figure;
  };
  // Short factual lookups stay quiet; reports and explicit media open by
  // themselves while the current call is connected, once per result.
  const openAutomatically = (content, anchor, item, auto) => {
    const shouldOpen =
      content.kind !== "report" || content.media?.length > 0 ||
      item.text.length > 450 ||
      /^#{1,3}\s/mu.test(item.text);
    if (!auto || !shouldOpen || automatic.has(content.id)) return;
    automatic.add(content.id);
    window.requestAnimationFrame(() => {
      if(anchor.isConnected&&["connected", "ending"].includes(document.body.dataset.callState)){
        if(isMedia(content)){pendingAuto={content,card:anchor};void openPending();}
        else if(!current)open(content,anchor);
      }
    });
  };
  function open(content, card) {
    if (closing) return;
    if (current) return;
    current = content;
    origin = card;
    cancelAnimations();
    const from = card.getBoundingClientRect();
    layer.hidden = false;
    layer.dataset.kind = content.kind;
    document.body.dataset.reading = "true";
    $("readerTitle").textContent = content.title;
    body.replaceChildren();
    if (content.kind === "report") reportMedia(body, content);
    else body.append(asset(content));
    prepareDownload(content);
    // The page renders its status line and call controls into the reader
    // dock; the call itself, its microphone and its listeners never move.
    onReading(true);
    if(document.documentElement?.dataset?.tv === "true") {
      body.tabIndex = 0;
      body.setAttribute("role", "region");
      body.setAttribute("aria-label", content.kind === "report" ? "文件正文" : "文件内容");
      body.scrollTop = 0;
      body.focus({ preventScroll: true });
    } else $("readerBack").focus({ preventScroll: true });
    void morph(from, surface.getBoundingClientRect());
  }
  async function close({ immediate = false, openNext=true } = {}) {
    if (!current || closing) return;
    closing = true;
    downloadController?.abort();downloadController=null;downloadMenu?.remove();downloadMenu=null;
    cancelAnimations();
    layer.dataset.closing = "true";
    const from = surface.getBoundingClientRect(),
      to = origin?.isConnected ? origin.getBoundingClientRect() : from;
    for (const video of body.querySelectorAll("video")) video.pause();
    if (!immediate) await morph(from, to, true);
    if ($("readerDownload").getAttribute("href")?.startsWith("blob:"))
      URL.revokeObjectURL($("readerDownload").href);
    onReading(false);
    layer.hidden = true;
    body.replaceChildren();
    document.body.dataset.reading = "false";
    delete layer.dataset.closing;
    current = null;
    closing = false;
    origin?.focus({ preventScroll: true });
    if(openNext&&pendingAuto)window.requestAnimationFrame(()=>void openPending());
  }
  $("readerBack").addEventListener("click", () => void close());
  $("readerBackdrop").addEventListener("click", () => void close());
  layer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void close();
    }
    if (event.key === "Tab") {
      const focusable = [
        ...layer.querySelectorAll(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),video[controls]",
        ),
      ].filter(
        (el) =>
          el.getClientRects().length &&
          window.getComputedStyle(el).visibility !== "hidden",
      );
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  return {
    render(target, item, { auto = false, inline = false } = {}) {
      const contents = contentItems(item, window.location.href);
      if (!contents.length) {
        renderMarkdown(target, item.text, document);
        return;
      }
      target.replaceChildren();
      for (const content of contents) {
        if (inline && inlineFits(content)) {
          if (content.kind === "report") {
            const figure = document.createElement("div");
            figure.className = "inline-media inline-report";
            reportMedia(figure, content);
            figure.querySelectorAll(".media-asset").forEach(media => keepInView(figure, media));
            figure.append(expandButton(content, figure));
            target.append(figure);
            openAutomatically(content, figure, item, auto);
          } else {
            const figure = inlineMedia(content);
            target.append(figure);
            openAutomatically(content, figure, item, auto);
          }
          continue;
        }
        const card = document.createElement("button");
        card.type = "button";
        card.className = "content-card";
        card.dataset.contentKind = content.kind;
        const icon = document.createElement("span");
        icon.className = "card-icon";
        icon.textContent =
          content.kind === "report"
            ? "▤"
            : content.kind === "video"
              ? "▷"
              : "▧";
        const label = document.createElement("span"),
          title = document.createElement("strong"),
          subtitle = document.createElement("small"),
          arrow = document.createElement("span");
        title.textContent = content.title;
        subtitle.textContent =
          content.kind === "report"
            ? content.media?.length ? "展开查看" : "完整文档 · 展开阅读"
            : content.kind === "video"
              ? "视频 · 点击播放"
              : "图片 · 查看大图";
        arrow.textContent = "↗";
        arrow.className = "card-arrow";
        label.append(title, subtitle);
        card.append(icon, label, arrow);
        card.addEventListener("click", () => open(content, card));
        target.append(card);
        if (content.kind === "report" && content.summary && !item.document) {
          const summary = document.createElement("p");
          summary.className = "content-summary";
          summary.textContent = content.summary;
          target.prepend(summary);
        }
        openAutomatically(content, card, item, auto);
      }
    },
    reset() {
      pendingAuto=null;
      automatic.clear();
      void close({ immediate: true });
    },
  };
}
