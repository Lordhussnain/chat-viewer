import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Chat } from './types';
import { parseChatFile } from './parse';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { ChatView } from './components/ChatView';

export default function App() {
  // All loaded chats, keyed by id.
  const [chats, setChats] = useState<Record<string, Chat>>({});
  // Library order (newest first is applied when rendering).
  const [order, setOrder] = useState<string[]>([]);
  // Open tabs, in display order.
  const [tabIds, setTabIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);

  const allChats = useMemo(
    () =>
      order
        .map((id) => chats[id])
        .filter(Boolean)
        .sort((a, b) => {
          const ta = Date.parse(a.updatedAt ?? a.createdAt ?? '') || 0;
          const tb = Date.parse(b.updatedAt ?? b.createdAt ?? '') || 0;
          return tb - ta;
        }),
    [chats, order],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allChats;
    return allChats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.text.toLowerCase().includes(q)),
    );
  }, [allChats, query]);

  const tabs = tabIds.map((id) => chats[id]).filter(Boolean);
  const activeChat = activeId ? chats[activeId] ?? null : null;
  const openIds = useMemo(() => new Set(tabIds), [tabIds]);
  const anyDirty = Object.values(chats).some((c) => c.dirty);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  const openChat = useCallback((id: string) => {
    setTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }, []);

  const loadFiles = useCallback(
    async (files: FileList | File[]) => {
      const newErrors: string[] = [];
      const loaded: Chat[] = [];
      for (const file of Array.from(files)) {
        try {
          loaded.push(...parseChatFile(file.name, await file.text()));
        } catch (e) {
          newErrors.push((e as Error).message);
        }
      }
      if (loaded.length) {
        setChats((prev) => {
          const next = { ...prev };
          for (const c of loaded) next[c.id] = c;
          return next;
        });
        setOrder((prev) => [...prev, ...loaded.map((c) => c.id)]);
        // Open the first newly loaded chat so something is visible straight away.
        openChat(loaded[0].id);
      }
      if (newErrors.length) setErrors((prev) => [...prev, ...newErrors]);
    },
    [openChat],
  );

  const editChat = (id: string, patch: Partial<Pick<Chat, 'title' | 'messages'>>) => {
    setChats((prev) => {
      const c = prev[id];
      if (!c) return prev;
      return { ...prev, [id]: { ...c, ...patch, dirty: true } };
    });
  };

  const revertChat = (id: string) => {
    setChats((prev) => {
      const c = prev[id];
      if (!c) return prev;
      return {
        ...prev,
        [id]: { ...c, title: c.original.title, messages: c.original.messages, dirty: false },
      };
    });
  };

  /** Remove a tab; if it was active, activate its neighbour. */
  const dropTab = (id: string) => {
    const i = tabIds.indexOf(id);
    const next = tabIds.filter((t) => t !== id);
    setTabIds(next);
    if (activeId === id) setActiveId(next[i] ?? next[i - 1] ?? null);
  };

  const closeTab = (id: string) => {
    const c = chats[id];
    if (c?.dirty && !window.confirm(`"${c.title}" has unsaved edits. Close anyway?\n(Export it first to keep changes.)`)) {
      return;
    }
    dropTab(id);
  };

  const removeChat = (id: string) => {
    setChats((prev) => {
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
    setOrder((prev) => prev.filter((x) => x !== id));
    dropTab(id);
  };

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void loadFiles(e.dataTransfer.files);
      }}
    >
      <Sidebar
        chats={filtered}
        openIds={openIds}
        activeId={activeId}
        query={query}
        onQuery={setQuery}
        onOpen={openChat}
        onPickFiles={(f) => void loadFiles(f)}
        errors={errors}
        onDismissErrors={() => setErrors([])}
      />

      <main className="main">
        <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} />
        {activeChat ? (
          <ChatView
            key={activeChat.id}
            chat={activeChat}
            onEdit={(patch) => editChat(activeChat.id, patch)}
            onRevert={() => revertChat(activeChat.id)}
            onRemove={() => removeChat(activeChat.id)}
          />
        ) : (
          <div className="empty">
            <h2>No chat open</h2>
            <p>
              Open one or more exported chat JSON files (or drop them anywhere on this window), then
              pick a chat from the list to open it in a tab.
            </p>
            {allChats.length > 0 && <p className="muted">{allChats.length} chats loaded — select one on the left.</p>}
          </div>
        )}
      </main>

      {dragging && <div className="drop-overlay">Drop JSON files to load chats</div>}
    </div>
  );
}
