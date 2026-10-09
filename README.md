# chat-viewer

A browser-based viewer for exported AI chat history. Open many chats at once in tabs, read them, and edit them.

## Run it

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
4. In a chat you can:
   - edit the title at the top,
   - edit, delete, or move any message (↑ / ↓), change a message's role,
   - insert a new message after any message, or add one at the end,
   - **Export JSON** / **Export Markdown** to save your edited version,
   - **Revert** to restore the chat as it was when loaded.

Edits live in memory for the current browser session. Export a chat to keep your changes; the browser warns before you close a tab or page with unsaved edits.

## Supported input formats

Open any mix of these in one go:

| Input | How it is handled |
| --- | --- |
| ChatGPT export (`conversations.json`) | objects with a `mapping` tree; the current branch (`current_node`) is followed |
| Claude export | objects with a `chat_messages` array (`sender`, `text`, `content` blocks) |
| Generic JSON | `{ "title", "messages": [{ "role", "text" or "content", "createdAt" }] }`, a bare message array, or `{ "conversations": [...] }` |
| JSON Lines | one JSON value per line |
| AI Studio / markdown transcript (`.md`) | split on headings `## 👤 User`, `## 🤖 Model`, and `## 🤖 Model (Reasoning)`. Reasoning is shown collapsed. Other `.md` files become a single note. |
| Images (`.jpg`, `.png`, …) | matched by file name to `![name](name)` links in the transcript and shown inline |
| Zip archive (e.g. AI Studio export) | the transcript and images inside are read directly; no need to unzip first |

Markdown in messages is rendered, and LaTeX (`$…$`, `$$…$$`) is typeset with KaTeX.

Images are matched by file name across everything loaded in the session. If a transcript shows `[image not loaded: image-3.jpg]`, load that file too.

The JSON export from this app uses the generic shape, so exported files can be opened again here. Markdown export keeps image links as text, so load the image files alongside it to see them again.

Parsing lives in `src/parse.ts` (chat formats) and `src/loader.ts` (files, zips, images). To add another format, write an adapter in `src/parse.ts` and add a detection branch.

## Project layout

- `src/parse.ts` – chat format detection and adapters (tested in `src/parse.test.ts`)
- `src/loader.ts` – reads files, zips, and images (tested in `src/loader.test.ts`)
- `src/assets.tsx` – image lookup for markdown image links
- `src/export.ts` – JSON / Markdown export and download
- `src/App.tsx` – library, tabs, and state
- `src/components/` – sidebar, tab bar, chat view, message card
- `src/render.test.tsx` – checks message rendering (images, LaTeX, reasoning)
- `examples/` – small synthetic sample file to try the viewer
