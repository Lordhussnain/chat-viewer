import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chat, LoadedFile, WriteTarget } from './types';
import { loadFiles } from './loader';
import { applyDisplay, loadDisplay, saveDisplay, type DisplaySettings } from './display';
import { AssetsProvider } from './assets';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { ChatView } from './components/ChatView';
import { SplitPanes } from './components/SplitPanes';
import {
  canOpenWithHandles,
  desktopTarget,
  handlesFromDrop,
  pickFilesWithHandles,
  readTarget,
  writeTarget,
} from './fileAccess';
import { planSave, sameBytes, type PendingEdit } from './save';

const THEME_KEY = 'chat-viewer-theme';
const SIDEBAR_KEY = 'chat-viewer-sidebar-collapsed';

function initialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(initialSidebarCollapsed);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore: the choice just won't persist
    }
  }, [sidebarCollapsed]);
  // Scroll offset per open chat. A ref, not state: it changes on every scroll and must not re-render.
  const scrollMemory = useRef(new Map<string, number>()).current;
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
  // Files the chats came from, keyed by id. Saves start from their bytes.
  const [files, setFiles] = useState<Record<string, LoadedFile>>({});
  // Image object URLs, keyed by file name (e.g. "image-1.jpg").
  const [assets, setAssets] = useState<Record<string, string>>({});
  // Open tabs, in display order.
  const [tabIds, setTabIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Split view: the right pane's chat, and which pane tab and sidebar clicks go to.
  const [splitOn, setSplitOn] = useState(false);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [splitFocus, setSplitFocus] = useState<'left' | 'right'>('left');
  const [errors, setErrors] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
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

  /**
   * Show a chat in the focused pane. Clicking the chat that is already in the other pane
   * just focuses that pane, so the same chat never occupies both sides.
   */
  const openChat = useCallback(
    (id: string) => {
      setTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      if (splitOn && splitFocus === 'right') {
        if (id === activeId) setSplitFocus('left');
        else setSplitId(id);
      } else if (splitOn && id === splitId) {
        setSplitFocus('right');
      } else {
        setActiveId(id);
      }
    },
    [splitOn, splitFocus, activeId, splitId],
  );

  /** Same routing as openChat, for tabs that are already open. */
  const selectTab = (id: string) => {
    if (splitOn && splitFocus === 'right') {
      if (id === activeId) setSplitFocus('left');
      else setSplitId(id);
    } else if (splitOn && id === splitId) {
      setSplitFocus('right');
    } else {
      setActiveId(id);
    }
  };

  const toggleSplit = () => {
    if (splitOn) {
      setSplitOn(false);
      setSplitId(null);
      setSplitFocus('left');
      return;
    }
    setSplitOn(true);
    setSplitId(tabIds.find((t) => t !== activeId) ?? null);
    setSplitFocus('left');
  };

  const addFiles = useCallback(
    async (fileList: FileList | File[], targets?: (WriteTarget | undefined)[]) => {
      const list = Array.from(fileList);
      const targetMap = new Map<File, WriteTarget | undefined>();
      // In the desktop app the real path is the target (it gets a .bak copy); otherwise use the browser handle.
      list.forEach((f, i) => targetMap.set(f, desktopTarget(f) ?? targets?.[i]));
      const result = await loadFiles(list, targetMap);
      const newErrors = [...result.errors];

      const newAssets: Record<string, string> = {};
      for (const [name, blob] of Object.entries(result.images)) {
        newAssets[name] = URL.createObjectURL(blob);
      }
      if (Object.keys(newAssets).length) {
        setAssets((prev) => ({ ...prev, ...newAssets }));
      }

      if (result.files.length) {
        setFiles((prev) => {
          const next = { ...prev };
          for (const f of result.files) next[f.id] = f;
          return next;
        });
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

  /**
   * Write the edited chat(s) back to their file. Every dirty chat from the same file is saved
   * together, because they share the file's bytes.
   */
  const saveChat = async (id: string) => {
    const chat = chats[id];
    const file = chat?.origin ? files[chat.origin.fileId] : undefined;
    if (!chat || !file) return;
    if (!file.target) {
      setErrors((prev) => [...prev, `"${file.name}" can only be exported, not saved. Use Open files in Chrome or Edge, or the desktop app.`]);
      return;
    }
    const pending = Object.values(chats).filter((c) => c.dirty && c.origin?.fileId === file.id);
    const saveable = pending.filter((c) => !c.writeBlocked);
    const blocked = pending.filter((c) => c.writeBlocked);
    if (saveable.length === 0) {
      setErrors((prev) => [...prev, ...blocked.map((c) => `"${c.title}" can't be saved: ${c.writeBlocked}`)]);
      return;
    }

    setSaving(true);
    try {
      const current = await readTarget(file.target);
      if (!sameBytes(current, file.bytes)) {
        throw new Error(`"${file.name}" changed on disk since it was opened. Reopen it, then save again.`);
      }
      const edits: PendingEdit[] = saveable.map((c) => ({
        chat: c,
        edit: {
          title: c.title,
          originalTitle: c.original.title,
          original: c.original.messages,
          edited: c.messages,
        },
      }));
      const plan = await planSave(file, edits);
      const backup = await writeTarget(file.target, plan.bytes);

      setFiles((prev) => ({ ...prev, [file.id]: { ...file, bytes: plan.bytes } }));
      setChats((prev) => {
        const next = { ...prev };
        for (const u of plan.updates) {
          const cur = next[u.chatId];
          if (!cur) continue;
          next[u.chatId] = {
            ...u.chat,
            id: cur.id,
            origin: cur.origin,
            writeBlocked: cur.writeBlocked,
            dirty: false,
          };
        }
        return next;
      });

      const mismatched = plan.updates.filter((u) => u.mismatch).map((u) => `"${u.chat.title}"`);
      const done: string[] = [`Saved ${saveable.length === 1 ? `"${chat.title}"` : `${saveable.length} chats`} to ${file.name}.`];
      if (backup) done.push(`The previous version was kept as ${backup}.`);
      if (mismatched.length) {
        done.push(
          `Some edits to ${mismatched.join(', ')} could not be stored exactly in this format. The viewer now shows what the file contains.`,
        );
      }
      if (plan.notes.length) done.push(...plan.notes);
      if (blocked.length) done.push(...blocked.map((c) => `"${c.title}" was not saved: ${c.writeBlocked}`));
      setNotices((prev) => [...prev, ...done]);
    } catch (e) {
      setErrors((prev) => [...prev, `Save failed: ${(e as Error).message}`]);
    } finally {
      setSaving(false);
    }
  };

  /** Remove a tab; if it was active, activate its neighbour. */
  const dropTab = (id: string) => {
    scrollMemory.delete(id);
    const i = tabIds.indexOf(id);
    const next = tabIds.filter((t) => t !== id);
    setTabIds(next);
    if (activeId === id) setActiveId(next[i] ?? next[i - 1] ?? null);
    if (splitId === id) setSplitId(null);
  };

  const closeTab = (id: string) => {
    const c = chats[id];
    if (
      c?.dirty &&
      !window.confirm(
        `"${c.title}" has unsaved edits. Close anyway?\n(Save to the original file or export it first to keep changes.)`,
      )
    ) {
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

  const splitChat = splitId ? chats[splitId] ?? null : null;
  /** The chat in the focused pane drives the tab and sidebar highlight. */
  const focusedChatId = splitOn && splitFocus === 'right' ? splitId : activeId;

  const renderChat = (chat: Chat) => (
    <ChatView
      key={chat.id}
      chat={chat}
      onEdit={(patch) => editChat(chat.id, patch)}
      onRevert={() => revertChat(chat.id)}
      onRemove={() => removeChat(chat.id)}
      onSave={() => void saveChat(chat.id)}
      save={saveInfo(chat)}
      scrollMemory={scrollMemory}
    />
  );

  const paneHint = (side: 'left' | 'right') => (
    <div className="pane-empty">
      <p className="muted">
        {side === 'right'
          ? 'This pane is empty. Click it, then pick a chat — clicks open in the focused pane.'
          : 'No chat open in the left pane. Pick one from the list.'}
      </p>
    </div>
  );

  const saveInfo = (c: Chat): { canSave: boolean; hint: string; target: string } => {
    const file = c.origin ? files[c.origin.fileId] : undefined;
    if (!file) return { canSave: false, hint: 'This chat is not tied to a file.', target: '' };
    if (c.writeBlocked) return { canSave: false, hint: c.writeBlocked, target: file.name };
    if (!file.target) {
      return {
        canSave: false,
        hint: 'This file was opened without write access. Use Open files in Chrome or Edge, or the desktop app, to save back.',
        target: '',
      };
    }
    return { canSave: true, hint: `Write these edits back to ${file.name}`, target: file.name };
  };

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
          if (!e.dataTransfer.files.length) return;
          const files = Array.from(e.dataTransfer.files);
          // Read the handles now, inside the drop event; the browser only hands them out here.
          const pending = handlesFromDrop(e.dataTransfer);
          void (async () => {
            const handles = pending ? await pending : [];
            const aligned = handles.length === files.length ? handles : undefined;
            await addFiles(files, aligned);
          })();
        }}
      >
        <Sidebar
          chats={filtered}
          openIds={openIds}
          activeId={focusedChatId}
          query={query}
          onQuery={setQuery}
          onOpen={openChat}
          onPickFiles={(f) => void addFiles(f)}
          onOpenWithPicker={
            canOpenWithHandles()
              ? () =>
                  void pickFilesWithHandles()
                    .then((picked) =>
                      addFiles(
                        picked.map((p) => p.file),
                        picked.map((p) => p.target),
                      ),
                    )
                    .catch((e: Error) => setErrors((prev) => [...prev, e.message]))
              : undefined
          }
          imageCount={imageCount}
          errors={errors}
          onDismissErrors={() => setErrors([])}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          display={display}
          onDisplayChange={(patch) => setDisplay((d) => ({ ...d, ...patch }))}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        />

        <main className="main">
          <TabBar
            tabs={tabs}
            activeId={focusedChatId}
            panes={splitOn ? { left: activeId, right: splitId } : null}
            onSelect={selectTab}
            onClose={closeTab}
            onToggleSplit={toggleSplit}
          />
          {notices.length > 0 && (
            <div className="notices" role="status">
              {notices.map((n, i) => (
                <p key={i} className="notice">
                  {n}
                </p>
              ))}
              <button onClick={() => setNotices([])}>Dismiss</button>
            </div>
          )}
          {splitOn && (activeChat || splitChat) ? (
            <SplitPanes
              focus={splitFocus}
              onFocus={setSplitFocus}
              left={activeChat ? renderChat(activeChat) : paneHint('left')}
              right={splitChat ? renderChat(splitChat) : paneHint('right')}
            />
          ) : activeChat ? (
            renderChat(activeChat)
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
        {saving && (
          <div className="busy" role="status">
            Saving…
          </div>
        )}
      </div>
    </AssetsProvider>
  );
}
