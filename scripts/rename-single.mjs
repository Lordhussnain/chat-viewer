// Renames the single-file build output so it is easy to recognise.
import { renameSync } from 'node:fs';

renameSync('dist-single/index.html', 'dist-single/chat-viewer.html');
console.log('Wrote dist-single/chat-viewer.html');
