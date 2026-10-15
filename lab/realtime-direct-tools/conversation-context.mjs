/** Carry dialogue, not raw tool payloads or serialized command arguments. */
export function voiceConversationContext(messages, maxChars = 12000) {
  const lines = [];
  for (const message of messages) {
    if (!['user', 'assistant'].includes(message?.role)) continue;
    // Delegation envelopes are host instructions for an old task, not dialogue.
    // Do not seed a new telephone model with their goals or backend reports.
    if (message.__openclaw?.runId?.startsWith('voice-')) continue;
    const parts = typeof message.content === 'string' ? [message.content]
      : Array.isArray(message.content) ? message.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text) : [];
    const text = parts.join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();
    if (message.role === 'user' && text.startsWith('天意本人在语音电话里交给 V 的任务。')) continue;
    if (text) lines.push(`${message.role === 'user' ? '人' : 'V'}：${text}`);
  }
  return lines.join('\n\n').slice(-maxChars);
}
