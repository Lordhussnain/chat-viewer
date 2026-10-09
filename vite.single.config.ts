import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config';

// Builds one self-contained HTML file (JS, CSS and images inlined) that opens
// by double-clicking, with no server or Node.js needed.
export default mergeConfig(
  base,
  defineConfig({
    plugins: [viteSingleFile()],
    build: {
      outDir: 'dist-single',
      emptyOutDir: true,
    },
  }),
);
