// A static server for the spike folder. No caching, correct types, nothing else.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = import.meta.dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};
export const PORT = Number(process.env.PORT ?? 8791);

export function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const file = join(ROOT, path);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      try {
        if ((await stat(file)).isDirectory()) throw new Error('dir');
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(await readFile(file));
      } catch { res.writeHead(404).end('not found'); }
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === import.meta.filename) {
  await serve();
  console.log(`http://127.0.0.1:${PORT}/web/index.html?lib=silurus&f=samples/thesis.docx`);
}
