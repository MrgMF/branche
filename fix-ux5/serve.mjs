import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = '/home/claude/branche/fix-ux5/dist';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.ico': 'image/x-icon', '.css': 'text/css' };

createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  let file = join(ROOT, p);
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    // SPA fallback
    try {
      const buf = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  }
}).listen(8383, () => console.log('serving on 8383'));
