// Serves logs/tools/wsr_test on localhost:8123 and captures POSTed log lines
// to wsr_test_results.jsonl. Usage: node logs/tools/wsr_test/server.mjs
import { createServer } from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const outFile = join(root, 'wsr_test_results.jsonl');

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      appendFileSync(outFile, body + '\n');
      res.writeHead(204).end();
    });
    return;
  }
  const path = req.url === '/' ? '/index.html' : req.url;
  try {
    const data = readFileSync(join(root, path));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(data);
  } catch (e) {
    res.writeHead(404).end();
  }
});
server.listen(8123, '127.0.0.1', () => console.log('diag server on http://127.0.0.1:8123'));
