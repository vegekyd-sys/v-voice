import { mediaReferences } from './media-references.mjs';
// One host-owned policy for backend documents; provider captions remain captions.
export const LONG_RESULT_NOTICE = '详细方案在屏幕上，需要的话也可以整理成文档发给你。';
export const MAKARON_MEDIA_INSTRUCTIONS = '媒体生成任务通过 exec 调用已安装的 makaron CLI，复用执行环境已有凭据，不读取或输出 key。优先 makaron chat --project auto -b --json；续做同一作品使用已返回的 projectId。保存返回的 runId/id，仅用 makaron responses get 同一ID --wait --json 跟进，等待命令用原生 process 轮询，不用 nohup 或脱离管理的后台进程。只依据 completed 的 image/video 输出交付，不把计划、提交成功或 design JSON 当成最终图片/MP4；未知状态先查询原任务，不重复付费提交。用户指定 Makaron 时不要改用 image_generate/video_generate。最终保留图片、视频及用户需要的说明文字，不展示命令、私有路径、凭据或内部验收信息。';
export const BACKEND_RESULT_INSTRUCTIONS = '图片、视频任务须实际调用可用的媒体生成能力，跟进同一任务到完成，不重复付费提交；最终给出可访问的HTTPS链接：图片用 ![图片说明](URL)，视频用 [视频说明](实际MP4的URL)。不能只给本地路径、任务ID或假链接。能力或权限不可用时明确说明未完成。\n电话结果呈现：如果最终结果是较长方案，最后一次回答同时写语音摘要和完整正文，不另起任务。严格使用这两个标题：\n【语音摘要】\n两到三句自然中文，100字以内，直接说最重要的结论、推荐或下一步，保留影响结论的必要条件和未完成项。不能只说完成了或让用户看屏幕，不能编造原结果没有的事实。\n【完整方案】\n完整Markdown正文，保留全部事实、来源、条件和细节。不要把摘要当成正文的替代。普通短答案直接回答，不需要这两个标题。';
export function backendResultQuestion(question) {
  return `${question}\n\n${MAKARON_MEDIA_INSTRUCTIONS}\n\n${BACKEND_RESULT_INSTRUCTIONS}`;
}
// A media URL can arrive as a short streamed commentary fragment before the
// canonical final. Keep it for the final screen delivery, never spoken progress.
export function isSpokenBackendProgress(progress) {
  return typeof progress?.text === 'string' &&
    !/(?:https?:\/\/|!\[|(?:^|\n)\s*MEDIA:)/iu.test(progress.text);
}
export function readBackendResult(result) {
  const raw = typeof result === 'string' ? result : result?.result ?? result?.text;
  if (typeof raw !== 'string') return null;
  const pair = /^\s*【语音摘要】\s*\n([\s\S]*?)\n【完整方案】\s*\n([\s\S]+)$/u.exec(raw);
  const text = pair ? pair[2] : raw;
  const supplied = pair ? pair[1].trim() : result?.spokenSummary;
  // A backend that exceeds its summary budget still supplied the summary's
  // source. Extract from that source, rather than accidentally reading a table
  // cell from the full document as the recommendation.
  const candidate = typeof supplied === 'string' && supplied.trim()
    ? supplied.trim().length <= 120 ? supplied.trim() : extractResultSummary(supplied) : null;
  const summary = candidate && candidate.length <= 120 ? candidate : null;
  return {text, summary};
}
// Legacy or nonconforming results still speak actual source content. This is an
// extractive fallback, not another model call or a claim of semantic summary QA.
export function extractResultSummary(text) {
  const clean = text.replace(/```[^\n]*\n[\s\S]*?```/gu, '')
    .replace(/\[([^\]]+)\]\([^\n)]+\)/gu, '$1').replace(/[*_`]/gu, '');
  const allLines = clean.split('\n').map(line => line.trim());
  const conclusion = allLines.findIndex(line => /^#{1,6}\s.*(?:结论|建议|推荐|总结)/u.test(line));
  const lines = (conclusion >= 0 ? allLines.slice(conclusion + 1) : allLines).filter(line => line && !/^#{1,6}\s|^\|?\s*[-:| ]+$/u.test(line));
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|') || !lines[i+1].includes('|')) continue;
    const cells = line => line.replace(/^\||\|$/gu, '').split('|').map(value => value.trim());
    const headers = cells(lines[i]);
    for (let j = i+1; j < lines.length && lines[j].includes('|'); j++) {
      const values = cells(lines[j]);
      if (values.length === headers.length) lines[j] = values.map((value, k) => `${headers[k]}：${value}`).join('，') + '。';
    }
    lines[i] = '';
    break;
  }
  const lead = lines.findIndex(line => /^(?:核心)?(?:结论|建议|推荐)[：:]/u.test(line));
  const candidates = (lead >= 0 ? lines.slice(lead) : lines).flatMap(line => line.match(/[^。！？!?]+[。！？!?]?/gu) ?? []);
  const chosen = [];
  for (const sentence of candidates) {
    const value = sentence.replace(/^[-+]\s+/u, '').trim();
    if (!value || chosen.includes(value) || value.length > 120) continue;
    if ((chosen.join('') + value).length > 120) break;
    chosen.push(value);
    if (chosen.length === 2) break;
  }
  return chosen.join('') || lines.join(' ').slice(0, 110) + '…';
}
export function presentBackendResult(result) {
  if (result?.cancelled || result?.error) return null;
  const parsed = readBackendResult(result);
  if (!parsed?.text.trim()) return null;
  const {text} = parsed;
  const long = [...text].length > 300 || text.split('\n').filter(line => line.trim()).length >= 8 ||
    /^\s*```/mu.test(text) || /^\s*\|?.*\|.*\n\s*\|?\s*:?-{3,}/mu.test(text);
  const media = mediaReferences(text).length > 0;
  const caption = text.replace(/!?\[[^\]]*\]\([^)]*\)/gu, '').replace(/https?:\/\/\S+/gu, '').trim();
  const summary = long ? parsed.summary ?? extractResultSummary(text) : null;
  return {text, long, ...(media ? {media: true} : {}), spokenText: media ? `${parsed.summary ?? (caption ? extractResultSummary(caption) : '可以在屏幕上打开结果。')}` : long ? `${summary} ${LONG_RESULT_NOTICE}` : text};
}
