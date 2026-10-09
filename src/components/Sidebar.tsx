import type { Chat } from '../types';

interface Props {
  chats: Chat[];
  openIds: Set<string>;
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onPickFiles: (files: FileList) => void;
  imageCount: number;
  errors: string[];
  onDismissErrors: () => void;
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function Sidebar({
  chats,
  openIds,
  activeId,
  query,
  onQuery,
  onOpen,
  onPickFiles,
  imageCount,
  errors,
  onDismissErrors,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h1>Chat Viewer</h1>
        <label className="button primary file-button">
          Open files
          <input
            type="file"
            multiple
            accept=".json,.jsonl,.md,.markdown,.txt,.zip,image/*,application/json"
            onChange={(e) => {
              if (e.target.files?.length) onPickFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <input
          className="search"
          type="search"
          placeholder="Search titles and messages…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        <div className="count">
          {chats.length} chat{chats.length === 1 ? '' : 's'}
          {imageCount > 0 && ` · ${imageCount} image${imageCount === 1 ? '' : 's'} loaded`}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="errors">
          {errors.map((e, i) => (
            <div key={i} className="error">{e}</div>
          ))}
          <button onClick={onDismissErrors}>Dismiss</button>
        </div>
      )}

      <ul className="chat-list">
        {chats.map((c) => (
          <li
            key={c.id}
            className={`chat-item ${c.id === activeId ? 'active' : ''} ${openIds.has(c.id) ? 'open' : ''}`}
            onClick={() => onOpen(c.id)}
            title={c.fileName}
          >
            <div className="chat-item-title">
              {c.dirty && <span className="dirty-dot" title="Unsaved edits" />}
              {c.title}
            </div>
            <div className="chat-item-meta">
              {c.source} · {c.messages.length} msgs · {shortDate(c.updatedAt ?? c.createdAt)}
            </div>
          </li>
        ))}
      </ul>
      {chats.length === 0 && (
        <p className="muted pad">Open chat files (JSON, markdown, or zip) and their images to begin.</p>
      )}
    </aside>
  );
}
