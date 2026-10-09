# chat-viewer

A browser-based viewer for exported AI chat history. Open many chats at once in tabs, read them, and edit them.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # parser tests
npm run build      # type-check + production build into dist/
```

## Using it

1. Click **Open JSON files** (or drop files anywhere on the window). You can select several files at once.
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

Detected automatically per chat:

| Format | How it is recognised |
| --- | --- |
| ChatGPT export (`conversations.json`) | objects with a `mapping` tree; the current branch (`current_node`) is followed |
| Claude export | objects with a `chat_messages` array (`sender`, `text`, `content` blocks) |
| Generic | `{ "title", "messages": [{ "role", "text" or "content", "createdAt" }] }`, a bare message array, or `{ "conversations": [...] }` |
| JSON Lines | one JSON value per line |

The JSON export from this app uses the generic shape, so exported files can be opened again here.

Parsing lives in `src/parse.ts`. To add another format, write a `fromX()` adapter there and add a detection branch in `findConversations()`.

## Project layout

- `src/parse.ts` – format detection and adapters (tested in `src/parse.test.ts`)
- `src/export.ts` – JSON / Markdown export and download
- `src/App.tsx` – library, tabs, and state
- `src/components/` – sidebar, tab bar, chat view, message card
- `examples/` – small synthetic sample file to try the viewer
