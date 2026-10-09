import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Message, Role } from '../types';
import { MarkdownImage } from '../assets';
import { normalizeMath } from '../math';

const ROLES: Role[] = ['user', 'assistant', 'reasoning', 'system', 'tool', 'other'];

const REMARK_PLUGINS = [remarkMath];
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false }]] as const;
const MD_COMPONENTS = { img: MarkdownImage };

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS as any}
        components={MD_COMPONENTS}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}

interface Props {
  message: Message;
  index: number;
  total: number;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { role: Role; text: string }) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onInsertAfter: () => void;
}

function MessageCardImpl(props: Props) {
  const { message, index, total, editing } = props;
  if (editing) return <EditForm {...props} />;

  const when = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
  let body;
  if (message.role === 'tool' || message.role === 'system') {
    body = (
      <details className="collapsible">
        <summary>{message.role} output ({message.text.length.toLocaleString()} chars)</summary>
        <pre className="raw">{message.text}</pre>
      </details>
    );
  } else if (message.role === 'reasoning') {
    body = (
      <details className="collapsible">
        <summary>Model reasoning ({message.text.length.toLocaleString()} chars)</summary>
        <Markdown>{message.text}</Markdown>
      </details>
    );
  } else {
    body = <Markdown>{message.text}</Markdown>;
  }

  return (
    <article className={`msg role-${message.role}`}>
      <header className="msg-head">
        <span className="role">{message.role}</span>
        {when && <span className="time">{when}</span>}
        <span className="spacer" />
        <button title="Edit" onClick={props.onStartEdit}>Edit</button>
        <button title="Move up" disabled={index === 0} onClick={() => props.onMove(-1)}>↑</button>
        <button title="Move down" disabled={index === total - 1} onClick={() => props.onMove(1)}>↓</button>
        <button title="Insert a new message after this one" onClick={props.onInsertAfter}>+ After</button>
        <button className="danger" title="Delete message" onClick={() => {
          if (window.confirm('Delete this message?')) props.onDelete();
        }}>Delete</button>
      </header>
      {body}
    </article>
  );
}

function EditForm({ message, onSave, onCancelEdit }: Props) {
  const [role, setRole] = useState<Role>(message.role);
  const [text, setText] = useState(message.text);
  const rows = Math.min(30, Math.max(4, text.split('\n').length + 1));

  const save = () => onSave({ role, text });

  return (
    <article className={`msg editing role-${role}`}>
      <header className="msg-head">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <span className="spacer" />
        <span className="hint">Ctrl/⌘+Enter to save · Esc to cancel · Markdown and $LaTeX$ supported</span>
      </header>
      <textarea
        autoFocus
        className="editor"
        rows={rows}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
          if (e.key === 'Escape') onCancelEdit();
        }}
      />
      <div className="row">
        <button className="primary" onClick={save}>Save</button>
        <button onClick={onCancelEdit}>Cancel</button>
      </div>
    </article>
  );
}

export const MessageCard = memo(MessageCardImpl);
