import type { Chat } from '../types';
import { TEXT_SCALES, ZOOM_LEVELS, type DisplaySettings } from '../display';

const pct = (n: number) => `${Math.round(n * 100)}%`;

interface Props {
  chats: Chat[];
  openIds: Set<string>;
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onPickFiles: (files: FileList) => void;
  /** When set, Open uses this instead of the plain file input (browser handles, for write-back). */
  onOpenWithPicker?: () => void;
  imageCount: number;
  errors: string[];
  onDismissErrors: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  display: DisplaySettings;
  onDisplayChange: (patch: Partial<DisplaySettings>) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
  onOpenWithPicker,
  imageCount,
  errors,
  onDismissErrors,
  theme,
  onToggleTheme,
  display,
  onDisplayChange,
  collapsed,
  onToggleCollapsed,
}: Props) {
  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button
          className="collapse-toggle"
          onClick={onToggleCollapsed}
          aria-label="Show sidebar"
          aria-expanded={false}
          title="Show sidebar"
        >
          ☰
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <button
            className="collapse-toggle"
            onClick={onToggleCollapsed}
            aria-label="Hide sidebar"
            aria-expanded={true}
            title="Hide sidebar"
          >
            ⟨
          </button>
          <h1>Chat Viewer</h1>
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
        <div className="display-settings">
          <label>
            Text size
            <select
              value={display.textScale}
              onChange={(e) => onDisplayChange({ textScale: Number(e.target.value) })}
            >
              {TEXT_SCALES.map((s) => (
                <option key={s} value={s}>{pct(s)}</option>
              ))}
            </select>
          </label>
          <label>
            Zoom
            <select
              value={display.zoom}
              onChange={(e) => onDisplayChange({ zoom: Number(e.target.value) })}
            >
              {ZOOM_LEVELS.map((z) => (
                <option key={z} value={z}>{pct(z)}</option>
              ))}
            </select>
          </label>
        </div>
        {onOpenWithPicker ? (
          <button className="primary" onClick={onOpenWithPicker}>
            Open files
          </button>
        ) : (
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
        )}
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
