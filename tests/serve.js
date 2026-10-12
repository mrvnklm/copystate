import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'http://fixtures.test';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml' };
const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const read = (name) => {
  try {
    return { status: 200, contentType: TYPES[extname(name)] || 'application/octet-stream', body: readFileSync(fixturePath(name)) };
  } catch {
    return { status: 404, contentType: 'text/plain', body: 'not found' };
  }
};

// Liefert tests/fixtures/* unter http://fixtures.test aus, ohne echten Server (Playwright)
export const serveFixtures = (target) =>
  target.route(`${ORIGIN}/**`, (route) => {
    const res = read(new URL(route.request().url()).pathname.slice(1));
    route.fulfill({ status: res.status, contentType: res.contentType, body: res.body });
  });

// Echter Server für Browser, die Playwright nicht steuert (Selenium/Firefox)
export const startFixtureServer = () =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const r = read(new URL(req.url, 'http://localhost').pathname.slice(1));
      res.writeHead(r.status, { 'content-type': r.contentType });
      res.end(r.body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
