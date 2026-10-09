import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Chat, Message, Role } from '../types';
import { MessageCard } from './MessageCard';
import { chatToJson, chatToMarkdown, downloadText, safeFilename } from '../export';
import { newId } from '../parse';

interface Props {
  chat: Chat;
  /** Replace the chat's title and/or messages. Marks the chat dirty. */
  onEdit: (patch: Partial<Pick<Chat, 'title' | 'messages'>>) => void;
  onRevert: () => void;
  onRemove: () => void;
  /** Write the edits back to the source file. */
  onSave: () => void;
  /** Whether saving is possible here, why not, and which file it would write to. */
  save: { canSave: boolean; hint: string; target: string };
  /** Scroll offset per chat id, kept by the parent so it survives switching tabs. */
  scrollMemory: Map<string, number>;
}

export function ChatView({ chat, onEdit, onRevert, onRemove, onSave, save, scrollMemory }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Go back to where the reader was. This runs before paint, so there is no visible jump.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const saved = scrollMemory.get(chat.id);
    if (el && saved !== undefined) el.scrollTop = saved;
  }, [chat.id, scrollMemory]);
  const messages = chat.messages;

  const stats = useMemo(() => {
    let chars = 0;
    for (const m of messages) chars += m.text.length;
    return { chars };
  }, [messages]);

  const setMessages = (next: Message[]) => onEdit({ messages: next });

  const insertAt = (index: number, role: Role) => {
    const msg: Message = { id: newId('m'), role, text: '' };
    const next = [...messages.slice(0, index), msg, ...messages.slice(index)];
    setMessages(next);
    setEditingId(msg.id);
  };

  const oppositeRole = (r: Role): Role => (r === 'user' ? 'assistant' : 'user');

  const exportJson = () =>
    downloadText(`${safeFilename(chat.title)}.json`, chatToJson(chat), 'application/json');
  const exportMd = () =>
    downloadText(`${safeFilename(chat.title)}.md`, chatToMarkdown(chat), 'text/markdown');

  return (
    <div
      className="chat-view"
      ref={scrollRef}
      onScroll={(e) => scrollMemory.set(chat.id, e.currentTarget.scrollTop)}
    >
      <div className="chat-header">
        <input
          className="title-input"
          value={chat.title}
          aria-label="Chat title"
          onChange={(e) => onEdit({ title: e.target.value })}
        />
        <div className="chat-meta">
          {chat.source} · {messages.length} messages · {stats.chars.toLocaleString()} chars · from{' '}
          <code>{chat.fileName}</code>
          {' · '}
          {save.canSave ? (
            <span>
              saves to <code>{save.target}</code>
            </span>
          ) : (
            <span className="muted">export only</span>
          )}
        </div>
        <div className="toolbar">
          <button
            className="primary"
            disabled={!chat.dirty || !save.canSave}
            title={save.hint}
            onClick={() => {
              if (
                window.confirm(
                  `Write the edits to "${save.target}"? In the desktop app the previous version is kept as a .bak copy.`,
                )
              ) {
                onSave();
              }
            }}
          >
            Save to file
          </button>
          <button onClick={exportJson}>Export JSON</button>
          <button onClick={exportMd}>Export Markdown</button>
          <button disabled={!chat.dirty} onClick={() => {
            if (window.confirm('Discard edits made since this chat was opened or last saved?')) onRevert();
          }}>
            Revert
          </button>
          <span className="spacer" />
          <button className="danger" onClick={() => {
            if (!chat.dirty || window.confirm('This chat has unsaved edits. Remove it from the viewer?')) onRemove();
          }}>
            Remove
          </button>
        </div>
      </div>

      <div className="messages">
        {messages.map((m, i) => (
          <MessageCard
            key={m.id}
            message={m}
            index={i}
            total={messages.length}
            editing={editingId === m.id}
            onStartEdit={() => setEditingId(m.id)}
            onCancelEdit={() => {
              // A brand-new, still-empty message is discarded on cancel.
              if (editingId === m.id && m.text === '') {
                setMessages(messages.filter((x) => x.id !== m.id));
              }
              setEditingId(null);
            }}
            onSave={({ role, text }) => {
              setMessages(messages.map((x) => (x.id === m.id ? { ...x, role, text } : x)));
              setEditingId(null);
            }}
            onDelete={() => {
              setMessages(messages.filter((x) => x.id !== m.id));
              if (editingId === m.id) setEditingId(null);
            }}
            onMove={(dir) => {
              const j = i + dir;
              if (j < 0 || j >= messages.length) return;
              const next = [...messages];
              [next[i], next[j]] = [next[j], next[i]];
              setMessages(next);
            }}
            onInsertAfter={() => insertAt(i + 1, oppositeRole(m.role))}
          />
        ))}
      </div>

      <div className="add-row">
        <span className="muted">Add message at end:</span>
        <button onClick={() => insertAt(messages.length, 'user')}>+ User</button>
        <button onClick={() => insertAt(messages.length, 'assistant')}>+ Assistant</button>
      </div>
    </div>
  );
}
