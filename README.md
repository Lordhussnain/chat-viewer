# chat-viewer

A browser-based viewer for exported AI chat history. Open many chats at once in tabs, read them, and edit them.

## Run it

### As a Windows desktop app (no terminal needed)

The repo builds a Windows installer and a portable `.exe` automatically on GitHub:

1. Open the repo on GitHub → **Actions** → **Desktop app (Windows)**, and choose the latest successful run.
2. Under **Artifacts**, download `chat-viewer-windows`. It contains:
   - `Chat Viewer Setup <version>.exe` – installer; adds a Start menu entry.
   - `ChatViewer-Portable-<version>.exe` – runs directly, no installation.
3. Run it. Windows may show "Windows protected your PC" because the app is not code-signed. Click **More info → Run anyway**.

The desktop app is Electron (`electron/main.cjs`). It opens the single-file viewer in its own window, and external links open in your normal browser. Chats are never uploaded. Artifacts are kept for 30 days, and every push to the branch builds new ones.

To try the desktop window locally on a machine with Node.js: `npm install`, then `npm run desktop:run`.

### As a standalone app file (no terminal needed to use it)

```bash
npm install
npm run build:single   # writes dist-single/chat-viewer.html
```

Double-click `dist-single/chat-viewer.html` to open the viewer in your browser. The file is self-contained and works offline. Everything you open stays in the browser; nothing is uploaded. To keep it as an app-like window, use your browser's "Install" or "Create shortcut / Open as window" option for the file.

You only need to run `npm run build:single` again when the code changes.

### For development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # parser, loader, and rendering tests
npm run build      # type-check + production build into dist/
```


## Using it

1. Click **Open files** (or drop files anywhere on the window). You can select several at once.
2. Every chat found in the files appears in the left list. Search filters by title and message text.
3. Click a chat to open it in a tab. Open as many as you like; middle-click or × closes a tab.
4. Click **◫ Split** in the tab bar to show two chats side by side. Click a pane to focus it (its tab is highlighted) — then clicking a tab or a chat in the list opens in that pane. Drag the divider to resize, double-click it for an even split, and **× Close split** for the single view again.
5. The sidebar's display settings change text size, zoom, content width (slide from the comfortable reading width to the full screen), and the page layout: one page, or two pages flowing side by side like an open book.
6. In a chat you can:
   - edit the title at the top,
   - edit, delete, or move any message (↑ / ↓), change a message's role,
   - insert a new message after any message, or add one at the end,
   - **Save to file** to write your edits back into the file they came from,
   - **Export JSON** / **Export Markdown** to save a copy in the generic format,
   - **Revert** to restore the chat as it was when loaded (asks first).

### Saving changes back to the original file

**Save to file** is enabled when a chat has unsaved edits and its source file can be written. It asks for confirmation, then writes the edited chat into the original file in that file's own format. Other chats from the same file that have unsaved edits are saved in the same write.

- **Desktop app:** the original is kept as `<name>.bak` before the first save of a file, so you can always get back to the version you opened. The `.bak` copy is never overwritten. Writes go to a temporary file first and then replace the original, so a crash cannot leave half a file.
- **Chrome or Edge (browser):** open files with **Open files** or by dropping them on the window. Both give the viewer write access, and the browser may ask you to allow writing. Other browsers can view and export, but cannot save back to the file.
- **Changed on disk:** before writing, the viewer re-reads the file. If it has changed since you opened it, nothing is written. Reopen the file, then save again.
- **Read-only:** a few exports can be viewed but not written back, because their structure is not fully known. The viewer says why. ChatGPT exports without a `current_node` pointer and Open WebUI exports that only have the older flat `chat.messages` list are read-only.

A saved chat shows a notice with the file name and the backup path. Anything the format cannot hold exactly is reported in the notice, and the viewer then shows what the file actually contains.

Known limits of write-back:
- Attachment lines (for example `📎 name.pdf`) are rebuilt from the file's attachment list. They can be removed from a message, but not edited as text.
- In a Qwen / Open WebUI answer that contains a generated image, the image is stored apart from the answer text. If you type new text after the image, it is saved in front of the image. Message order is otherwise kept exactly.
- Inserting a message between an assistant's reasoning and its answer moves the answer into a new message node.

Unsaved edits live in memory until you save or export. The browser warns before you close a tab or page with unsaved edits, and closing a tab with unsaved edits asks for confirmation.

## Supported input formats

Open any mix of these in one go:

| Input | How it is handled |
| --- | --- |
| ChatGPT export (`conversations.json`) | objects with a `mapping` tree; the current branch (`current_node`) is followed |
| Claude export | objects with a `chat_messages` array (`sender`, `text`, `content` blocks) |
| Qwen Chat / Open WebUI-style export | objects with `chat.history` (a tree of messages with `parentId` and `childrenIds`, active leaf in `currentId`). The active branch is shown. Reasoning (`thinking_summary`) is collapsed, generated images are shown inline, and attachments in `files` are shown as images or `📎` names. |
| ChatGPT Exporter (`.json` or `.md`) | the `chatgptexporter.com` format: JSON with `metadata` and `messages` (`role`, `say`, `time`, `model`), or markdown split on `## Prompt:` / `## Response:` headings. Title and dates come from the header; the timestamp under each heading becomes the message time. Images in the markdown are shown inline. |
| Generic JSON | `{ "title", "messages": [{ "role", "text" or "content", "createdAt" }] }`, a bare message array, or `{ "conversations": [...] }` |
| JSON Lines | one JSON value per line |
| AI Studio / markdown transcript (`.md`) | split on headings `## 👤 User`, `## 🤖 Model`, and `## 🤖 Model (Reasoning)`. Reasoning is shown collapsed. Other `.md` files become a single note. |
| Images (`.jpg`, `.png`, …) | matched by file name to `![name](name)` links in the transcript and shown inline |
| Zip archive (e.g. AI Studio export) | the transcript and images inside are read directly; no need to unzip first |

Markdown in messages is rendered, and LaTeX (`$…$`, `$$…$$`) is typeset with KaTeX.

Images are matched by file name across everything loaded in the session. If a transcript shows `[image not loaded: image-3.jpg]`, load that file too. Web images (for example ChatGPT Exporter attachments) are loaded from their link; when a link carries a file name (in the URL's `fn` parameter or as alt text), a loaded file of that name is used instead, which keeps working after the link expires.

The JSON export from this app uses the generic shape, so exported files can be opened again here. Markdown export keeps image links as text, so load the image files alongside it to see them again.

Parsing lives in `src/parse.ts` (chat formats) and `src/loader.ts` (files, zips, images). To add another format, write an adapter in `src/parse.ts` and add a detection branch.

## Project layout

- `src/parse.ts` – chat format detection and adapters (tested in `src/parse.test.ts`)
- `src/writeback.ts` – writes edits back into each format (tested in `src/writeback.test.ts`)
- `src/save.ts` – plans a save for a file: re-reads and checks the result before writing
- `src/fileAccess.ts` – reads and writes the original file (desktop bridge or browser file handles)
- `src/loader.ts` – reads files, zips, and images (tested in `src/loader.test.ts`)
- `src/assets.tsx` – image lookup for markdown image links
- `src/export.ts` – JSON / Markdown export and download
- `src/App.tsx` – library, tabs, and state
- `src/components/` – sidebar, tab bar, chat view, message card
- `src/render.test.tsx` – checks message rendering (images, LaTeX, reasoning)
- `examples/` – small synthetic sample file to try the viewer
- `electron/` – desktop app: `main.cjs` (window and file access) and `preload.cjs` (the narrow bridge to the page). Built on GitHub Actions by `.github/workflows/desktop.yml`.
