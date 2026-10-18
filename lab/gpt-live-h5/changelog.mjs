// Product-facing notes for shipped Voice updates. Keep newest entries first;
// experiments and unaccepted capabilities do not belong in this list.
export const VOICE_UPDATES = [
  {
    date: '2026-10-13', title: '报告收起后，回到熟悉的位置',
    items: [
      '修复 iPhone Safari 打开、滚动、收起报告后，头像和底部通话条偏移的问题。',
      '完善报告在屏幕上的交付确认，减少说了“已放到屏幕上”却没有展示内容的情况。',
    ],
  },
  {
    date: '2026-10-13', title: '说话、插话、挂断，更顺畅',
    items: [
      '改善 GPT Live 在后台任务完成后的插话体验；你开始说话时，V 会停下旧的回复。',
      '完善忙碌时的语音挂断。快速工具做不了的请求，会继续交给后台处理。',
    ],
  },
  {
    date: '2026-10-11', title: '飞书工具接力，长通话更稳',
    items: [
      '修复语音查询本人飞书日程的工具入口；其他任务可以继续交给后台，写操作遵循你的授权。',
      '改善豆包长时间通话遇到临时断连时的恢复，恢复失败时给出明确提示。',
    ],
  },
  {
    date: '2026-10-10', title: '边聊边看，内容展开就清楚',
    items: [
      '重新整理 Web 和手机布局，突出 V 的头像与对话；手机文字输入可从通话条展开。',
      '完整报告、图片和视频以内容卡片呈现，点开阅读或观看，收起后回到对话。支持通过语音把创作任务交给 Makaron。',
      '默认使用豆包 SeedDuplex；挂断后回到初始拨号页。支持的浏览器会在通话时保持屏幕常亮。',
    ],
  },
  {
    date: '2026-10-09', title: 'V 有了更灵动的反应',
    items: [
      '头像会结合你说的话和 V 的回复做出反应，在倾听、陪伴、思考和回应之间切换。',
      '优化方形头像和轻量图片，让 Web 与手机上的表情更清楚、加载更轻。',
    ],
  },
  {
    date: '2026-10-07', title: '同一个 V，多种声音',
    items: [
      'GPT Live、豆包 SeedDuplex 和 Grok Voice 共用通话界面，可在模型菜单中选择。',
      '后台任务执行时可以继续聊天；长结果先说摘要，再把完整内容留在屏幕上。',
    ],
  },
  {
    date: '2026-10-06', title: '语音也能调用工具、接住任务',
    items: [
      '加入豆包 SeedDuplex 和 Grok Voice，支持快速工具查询与后台任务接力。',
      '任务进行时，头像用不同的动作显示查记忆、查资料和后台处理等状态。',
    ],
  },
  {
    date: '2026-10-04', title: 'GPT Live 加入电话入口',
    items: [
      '接入 GPT Live，拨号后可以自然开聊、收到 V 的招呼，也能把复杂任务交给后台。',
      '区分拨号与通话界面，让手机上的头像、对话和结束通话更清楚。',
    ],
  },
  {
    date: '2026-09-22', title: '第一版：在浏览器里和 V 通话',
    items: [
      '上线独立的“小何”网页语音入口，点击拨号即可与 V 对话。',
      '加入 V 的人物头像、通话文字与任务状态，让语音交流有了可见的陪伴。',
    ],
  },
];

export function mountChangelog(document, view = globalThis) {
  const trigger = document.getElementById('changelogOpen');
  const dialog = document.getElementById('changelogDialog');
  const closeButton = document.getElementById('changelogClose');
  const list = document.getElementById('changelogEntries');
  if (!trigger || !dialog || !closeButton || !list || !dialog.showModal) return;

  // An isolated candidate may show its own notes without changing shipped notes.
  let candidate;try{candidate=JSON.parse(document.getElementById('voiceCandidateRelease')?.textContent??'null');}catch{}
  const entries=candidate&&typeof candidate.date==='string'&&typeof candidate.title==='string'&&Array.isArray(candidate.items)?[candidate,...VOICE_UPDATES]:VOICE_UPDATES;
  if(entries!==VOICE_UPDATES)list.setAttribute?.('aria-label','候选与已发布更新');
  for (const entry of entries) {
    const section = document.createElement('section');
    section.className = 'changelog-entry';
    const date = document.createElement('time');
    date.dateTime = entry.date;
    date.textContent = entry.date.replaceAll('-', '.');
    const title = document.createElement('h3');
    title.textContent = entry.title;
    const items = document.createElement('ul');
    for (const text of entry.items) {
      const item = document.createElement('li');
      item.textContent = text;
      items.append(item);
    }
    section.append(date, title, items);
    list.append(section);
  }

  let closing = false;
  const close = async () => {
    if (!dialog.open || closing) return;
    closing = true;
    if (dialog.animate && !view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try {
        await dialog.animate([
          { opacity: 1, transform: 'translateY(0) scale(1)' },
          { opacity: 0, transform: 'translateY(10px) scale(.985)' },
        ], { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished;
      } catch { /* Closing still restores focus if the animation is interrupted. */ }
    }
    dialog.close();
    for (const animation of dialog.getAnimations?.() ?? []) animation.cancel();
    closing = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  };
  trigger.addEventListener('click', () => {
    if (dialog.open || closing) return;
    dialog.showModal();
    list.scrollTop = 0;
    trigger.setAttribute('aria-expanded', 'true');
  });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) void close();
  });
  return { close };
}
