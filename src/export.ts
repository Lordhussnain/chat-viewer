import type { Chat, Role } from './types';

const ROLE_LABEL: Record<Role, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  other: 'Other',
};

/** JSON in a simple, re-importable shape: { title, messages: [{ role, text, createdAt }] }. */
export function chatToJson(chat: Chat): string {
  const out = {
    title: chat.title,
    source: chat.source,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    exportedAt: new Date().toISOString(),
    messages: chat.messages.map((m) => ({
      role: m.role,
      text: m.text,
      ...(m.createdAt ? { createdAt: m.createdAt } : {}),
    })),
  };
  return JSON.stringify(out, null, 2);
}

export function chatToMarkdown(chat: Chat): string {
  const parts: string[] = [`# ${chat.title}`];
  for (const m of chat.messages) {
    const when = m.createdAt ? ` · ${new Date(m.createdAt).toLocaleString()}` : '';
    parts.push(`## ${ROLE_LABEL[m.role]}${when}\n\n${m.text}`);
  }
  return parts.join('\n\n---\n\n') + '\n';
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
  return cleaned || 'chat';
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
