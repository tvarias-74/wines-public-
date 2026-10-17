// Serves a built folder under /wines-public-/ the way GitHub Pages does (404 everywhere else),
// so the tests can prove the app works from a sub-path and not just from a domain root.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const [root = 'dist', port = '4180'] = process.argv.slice(2);
const PREFIX = '/wines-public-/';
const base = resolve(root);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

http
  .createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = path.startsWith(PREFIX) ? join(base, path.slice(PREFIX.length) || 'index.html') : null;
    if (!file || !file.startsWith(base) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  })
  .listen(Number(port), () => console.log(`Serving ${base} at http://localhost:${port}${PREFIX}`));
