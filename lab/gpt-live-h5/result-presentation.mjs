import { mediaReferences } from './media-references.mjs';
// One host-owned policy for backend documents; provider captions remain captions.
export const LONG_RESULT_NOTICE = '详细方案在屏幕上，需要的话也可以整理成文档发给你。';
export const MAKARON_MEDIA_INSTRUCTIONS = '仅当用户要求生成或修改媒体时：通过 exec 调用已有 makaron CLI（优先 makaron chat --project auto -b --json），复用已有凭据，不读或输出 key。同一作品复用 projectId；保留 runId，仅用 makaron responses get 同一ID --wait --json 和原生 process 跟进，不重复付费提交或用 nohup。仅以 completed 的实际图片/视频为成品，返回可访问HTTPS链接（图片Markdown、视频MP4）；不拿计划、JSON或本地路径代替。用户指定 Makaron 不换工具。普通查询不生成媒体。';
export const BACKEND_RESULT_INSTRUCTIONS = '电话结果呈现：普通查询默认直接回答，不主动扩成报告。用户要求完整方案、清单、表格、代码或答案确实很长时，在同一次最终回复使用两个标题：\n【语音摘要】\n100字以内的两到三句自然中文，直接说具体结论、例子和必要条件，不用开场白或让用户看屏幕代替答案。用户指定要念的范围、项目和数字必须完整保留，不因字数丢掉关键要求。\n【完整方案】\n完整Markdown正文，保留全部事实、来源和未完成项。摘要不能替代正文。不另起总结任务，不虚构成果或发送回执。';
export const VOICE_RESULT_DELIVERY_INSTRUCTIONS = '电话任务的交付职责：用户要求挂断后把本任务的进展、报告或最终结果发到当前绑定飞书群时，Voice 主机会依据真实用户授权负责投递和核对回执。你继续完成原任务并返回完整结果，不要为这项结果交付再查询群、搜索会话ID、调用 message/sessions_send 或另建发送任务；不要把群ID等内部路由标识提交给 web_search。不得在没有发送回执时声称已发送。用户单独要求给指定对象发一条消息、发往其他目标或修改飞书资料，是独立业务操作，仍按用户已有明确授权实际调用工具，不能以主机交付为由省略。';
export function backendResultQuestion(question) {
  return `${question}\n\n${VOICE_RESULT_DELIVERY_INSTRUCTIONS}\n\n${MAKARON_MEDIA_INSTRUCTIONS}\n\n${BACKEND_RESULT_INSTRUCTIONS}`;
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
  const pair = /^([\s\S]*?)【语音摘要】\s*\n([\s\S]*?)\n【完整方案】\s*\n([\s\S]+)$/u.exec(raw);
  // A short backend preface must not hide its actual prepared summary. Keep
  // every substantive prefix in the document, never select it as the answer.
  const text = pair && !pair[1].trim() ? pair[3] : raw;
  const supplied = pair ? pair[2].trim() : result?.spokenSummary;
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
