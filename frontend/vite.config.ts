import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * pdf.js's own files, served at /pdfjs/: its WebAssembly decoders (a scan's
 * black and white pages, CCITT and JBIG2, are drawn by them: without them they
 * stay blank), its character maps and its standard fonts. Read from
 * node_modules in dev, copied into the build, so they follow its version.
 */
const pdfjsFiles = (): Plugin => {
  const root = path.resolve(__dirname, 'node_modules/pdfjs-dist');
  const folders = ['wasm', 'cmaps', 'standard_fonts'];
  let outDir = 'build';
  return {
    name: 'pdfjs-files',
    configResolved: config => { outDir = path.resolve(config.root, config.build.outDir); },
    configureServer: server => {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const [folder, ...rest] = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '').split('/');
        const file = path.join(root, folder, ...rest);
        if (!folders.includes(folder) || !file.startsWith(path.join(root, folder)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { next(); return; }
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle: () => {
      for (const folder of folders) fs.cpSync(path.join(root, folder), path.join(outDir, 'pdfjs', folder), { recursive: true });
    },
  };
};

export default defineConfig({
  plugins: [
    react(),
    pdfjsFiles(),
  ],
  build: {
    outDir: 'build',
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      // Posters and backdrops saved before /api/images are stored as /images/…
      '/images': 'http://localhost:3001',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
});
