import type { Chat } from '../types';

interface Props {
  tabs: Chat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, activeId, onSelect, onClose }: Props) {
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((c) => (
        <div
          key={c.id}
          role="tab"
          aria-selected={c.id === activeId}
          className={`tab ${c.id === activeId ? 'active' : ''}`}
          title={`${c.title}\n${c.fileName}`}
          onClick={() => onSelect(c.id)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(c.id);
          }}
        >
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
      ))}
    </div>
  );
}
