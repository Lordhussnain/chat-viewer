import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Chat } from './types';
import { loadFiles } from './loader';
import { applyDisplay, loadDisplay, saveDisplay, type DisplaySettings } from './display';
import { AssetsProvider } from './assets';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { ChatView } from './components/ChatView';

const THEME_KEY = 'chat-viewer-theme';

function initialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be unavailable (e.g. privacy settings); fall back to the system setting.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [display, setDisplay] = useState<DisplaySettings>(loadDisplay);
  useEffect(() => {
    applyDisplay(display);
    saveDisplay(display);
  }, [display]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore: the choice just won't persist
    }
  }, [theme]);

  // All loaded chats, keyed by id.
  const [chats, setChats] = useState<Record<string, Chat>>({});
  // Library order (display order is by date, applied below).
  const [order, setOrder] = useState<string[]>([]);
  // Image object URLs, keyed by file name (e.g. "image-1.jpg").
  const [assets, setAssets] = useState<Record<string, string>>({});
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

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const result = await loadFiles(Array.from(files));
      const newErrors = [...result.errors];

      const newAssets: Record<string, string> = {};
      for (const [name, blob] of Object.entries(result.images)) {
        newAssets[name] = URL.createObjectURL(blob);
      }
      if (Object.keys(newAssets).length) {
        setAssets((prev) => ({ ...prev, ...newAssets }));
      }

      const loaded = result.chats;
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

  const imageCount = Object.keys(assets).length;

  return (
    <AssetsProvider value={assets}>
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
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      >
        <Sidebar
          chats={filtered}
          openIds={openIds}
          activeId={activeId}
          query={query}
          onQuery={setQuery}
          onOpen={openChat}
          onPickFiles={(f) => void addFiles(f)}
          imageCount={imageCount}
          errors={errors}
          onDismissErrors={() => setErrors([])}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          display={display}
          onDisplayChange={(patch) => setDisplay((d) => ({ ...d, ...patch }))}
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
                Open chat files (JSON, markdown, or a zip export), plus any images they reference. Drop
                them anywhere on this window, then pick a chat from the list to open it in a tab.
              </p>
              {allChats.length > 0 && (
                <p className="muted">{allChats.length} chats loaded — select one on the left.</p>
              )}
            </div>
          )}
        </main>

        {dragging && <div className="drop-overlay">Drop files to load chats and images</div>}
      </div>
    </AssetsProvider>
  );
}
