// One host-owned policy for backend documents; provider captions remain captions.
export const LONG_RESULT_NOTICE = '详细方案在屏幕上，需要的话也可以整理成文档发给你。';
export const BACKEND_RESULT_INSTRUCTIONS = '电话结果呈现：如果最终结果是较长方案，最后一次回答同时写语音摘要和完整正文，不另起任务。严格使用这两个标题：\n【语音摘要】\n两到三句自然中文，100字以内，直接说最重要的结论、推荐或下一步，保留影响结论的必要条件和未完成项。不能只说完成了或让用户看屏幕，不能编造原结果没有的事实。\n【完整方案】\n完整Markdown正文，保留全部事实、来源、条件和细节。不要把摘要当成正文的替代。普通短答案直接回答，不需要这两个标题。';
export function backendResultQuestion(question) {
  return `${question}\n\n${BACKEND_RESULT_INSTRUCTIONS}`;
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
  const summary = long ? parsed.summary ?? extractResultSummary(text) : null;
  return {text, long, spokenText: long ? `${summary} ${LONG_RESULT_NOTICE}` : text};
}
