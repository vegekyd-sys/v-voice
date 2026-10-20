import { mediaReferences } from "./media-references.mjs";
import { renderMarkdown } from "./markdown.mjs";

const plain = (text) =>
  String(text)
    .replace(/!?(\[[^\]]*\])\([^)]*\)/gu, "$1")
    .replace(/[#*_`>|]/gu, "")
    .trim();
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

// One reader holds the original controls: opening content never recreates the
// call, microphone, event subscriptions, task ownership, or avatar renderer.
export function createContentView(document, window, { onReading = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const layer = $("contentReader"),
    surface = $("readerSurface"),
    body = $("readerBody");
  let current = null,
    origin = null,
    closing = false,
    automatic = new Set(),
    animations = [];
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
    const asset = (entry) => {
      const media = document.createElement(entry.kind === "video" ? "video" : "img");
      media.className = "media-asset";
      if (entry.kind === "video") {
        media.controls = true; media.playsInline = true; media.preload = "none";
        media.setAttribute("aria-label", entry.title);
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
    if (content.kind === "report") {
      const loaded = new Set();
      const entries = new Map(content.media.map(entry => [entry.url, entry]));
      renderMarkdown(body, content.text, document, {media: href => {
        let url; try { url = new URL(href, window.location.href).href; } catch { return null; }
        const entry = entries.get(url); if (!entry) return null;
        if (loaded.has(url)) return document.createDocumentFragment();
        loaded.add(url); return asset(entry);
      }});
    } else body.append(asset(content));
    if (content.kind === "report") {
      const blob = new Blob([content.text], {
        type: "text/markdown;charset=utf-8",
      });
      $("readerDownload").href = URL.createObjectURL(blob);
      $("readerDownload").download =
        content.title.replace(/[\\/:*?"<>|]/gu, "-") + ".md";
      $("readerDownload").hidden = false;
    } else $("readerDownload").hidden = true;
    // The page renders its status line and call controls into the reader
    // dock; the call itself, its microphone and its listeners never move.
    onReading(true);
    $("readerBack").focus({ preventScroll: true });
    void morph(from, surface.getBoundingClientRect());
  }
  async function close({ immediate = false } = {}) {
    if (!current || closing) return;
    closing = true;
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
    render(target, item, { auto = false } = {}) {
      const contents = contentItems(item, window.location.href);
      if (!contents.length) {
        renderMarkdown(target, item.text, document);
        return;
      }
      target.replaceChildren();
      for (const content of contents) {
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
        // Short factual lookups remain quiet cards; reports and explicit media
        // can open automatically while the current call is connected.
        const shouldOpen =
          content.kind !== "report" || content.media?.length > 0 ||
          item.text.length > 450 ||
          /^#{1,3}\s/mu.test(item.text);
        if (auto && shouldOpen && !automatic.has(content.id)) {
          automatic.add(content.id);
          window.requestAnimationFrame(() => {
            if (
              !current &&
              card.isConnected &&
              ["connected", "ending"].includes(document.body.dataset.callState)
            )
              open(content, card);
          });
        }
      }
    },
    reset() {
      automatic.clear();
      void close({ immediate: true });
    },
  };
}
