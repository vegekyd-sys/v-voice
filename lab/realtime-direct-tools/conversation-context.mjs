import {conversationReplyText} from '../../lib/conversation-replies.mjs';
/** Carry dialogue, not raw tool payloads or serialized command arguments. */
export function voiceConversationContext(messages, maxChars = 12000) {
  const lines = [];
  for (const message of messages) {
    if (!['user', 'assistant'].includes(message?.role)) continue;
    const parts = typeof message.content === 'string' ? [message.content]
      : Array.isArray(message.content) ? message.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text) : [];
    const text = parts.map(conversationReplyText).join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();
    if (text) lines.push(`${message.role === 'user' ? '人' : 'V'}：${text}`);
  }
  return lines.join('\n\n').slice(-maxChars);
}
