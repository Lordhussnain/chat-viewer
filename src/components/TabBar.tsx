import type { Chat } from '../types';

interface Props {
  tabs: Chat[];
  /** The chat shown in the focused pane; its tab is highlighted. */
  activeId: string | null;
  /** Which chat each split pane shows, or null when the split view is off. */
  panes: { left: string | null; right: string | null } | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onToggleSplit: () => void;
}

export function TabBar({ tabs, activeId, panes, onSelect, onClose, onToggleSplit }: Props) {
  return (
    <div className="tabbar" role="tablist">
      <div className="tabbar-tabs">
        {tabs.map((c) => {
          const pane = panes ? (panes.left === c.id ? 'left' : panes.right === c.id ? 'right' : null) : null;
          return (
            <div
              key={c.id}
              role="tab"
              aria-selected={c.id === activeId}
              className={`tab ${c.id === activeId ? 'active' : ''} ${pane ? `in-pane pane-${pane}` : ''}`}
              title={`${c.title}\n${c.fileName}`}
              onClick={() => onSelect(c.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(c.id);
              }}
            >
              {pane && (
                <span className="pane-mark" title={`Shown in the ${pane} pane`}>
                  {pane === 'left' ? '◧' : '◨'}
                </span>
              )}
              {c.dirty && <span className="dirty-dot" title="Unsaved edits" />}
              <span className="tab-title">{c.title}</span>
              <button
                className="tab-close"
                aria-label={`Close ${c.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(c.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="tabbar-tools">
        <button
          className="split-toggle"
          onClick={onToggleSplit}
          disabled={!panes && tabs.length === 0}
          title={panes ? 'Close the split view' : 'Show two chats side by side'}
        >
          {panes ? '× Close split' : '◫ Split'}
        </button>
      </div>
    </div>
  );
}
