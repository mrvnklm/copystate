// Store-Bilder aus der echten Extension: Popup über der Demo-Seite (docs/demo.html), 1280×800, plus Promo-Tile 440×280.
// Voraussetzung: node scripts/build.mjs (dist/chrome-test). Ergebnis: store/screenshots/, store/promo-440x280.png
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const extensionDir = join(root, 'dist/chrome-test');
const outDir = join(root, 'store/screenshots');
const ORIGIN = 'https://mrvnklm.github.io/copystate'; // lokal geroutet, damit im Bild die echte Adresse steht
const DEMO = `${ORIGIN}/demo.html`;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' };
const WINDOW = { x: 36, y: 44, width: 860, height: 712, bar: 40 }; // Browserfenster im Bild
const POPUP_SCALE = 1.4; // Popup größer als 1:1, damit die Monospace-Schrift in der Store-Galerie lesbar bleibt

mkdirSync(outDir, { recursive: true });
const extensionId = readFileSync(join(extensionDir, 'extension-id.txt'), 'utf8').trim();
const profile = mkdtempSync(join(tmpdir(), 'copystate-assets-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  colorScheme: 'light',
  deviceScaleFactor: 2,
  args: ['--lang=en-US', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});
await context.route(`${ORIGIN}/**`, (route) => {
  const path = new URL(route.request().url()).pathname.replace(/^\/copystate\/?/, '') || 'index.html';
  route.fulfill({ body: readFileSync(join(root, 'docs', path)), contentType: TYPES[extname(path)] ?? 'application/octet-stream' });
});

const page = await context.newPage();
await page.setViewportSize({ width: WINDOW.width, height: WINDOW.height - WINDOW.bar });
await page.goto(DEMO);

const popup = await context.newPage();
await popup.setViewportSize({ width: 420, height: 640 });
await popup.goto(`chrome-extension://${extensionId}/popup.html?url=${encodeURIComponent(DEMO)}`);
const ready = (previous) =>
  popup.waitForFunction(
    (prev) => document.getElementById('status').dataset.state === 'ready' && document.getElementById('output').value !== prev,
    previous,
  );
const output = () => popup.locator('#output').inputValue();

// Seite auf den Abschnitt scrollen und das Feld markieren, um das es im Bild geht
const shootPage = async (heading, mark) => {
  await page.evaluate(
    ([text, selector]) => {
      document.querySelectorAll('[data-shot-mark]').forEach((el) => {
        el.style.outline = '';
        el.removeAttribute('data-shot-mark');
      });
      const h = [...document.querySelectorAll('h1, h2')].find((el) => el.textContent.trim() === text);
      window.scrollTo(0, h ? h.getBoundingClientRect().top + window.scrollY - 24 : 0);
      for (const el of selector ? document.querySelectorAll(selector) : []) {
        el.dataset.shotMark = '';
        el.style.outline = '3px solid #ffb800';
        el.style.outlineOffset = '4px';
      }
    },
    [heading, mark],
  );
  return page.screenshot({ scale: 'css' });
};

// Popup in doppelter Auflösung, Textarea an die Stelle gescrollt, um die es geht
const shootPopup = async (needle) => {
  await popup.evaluate((text) => {
    const out = document.getElementById('output');
    const lineHeight = parseFloat(getComputedStyle(out).lineHeight);
    const line = out.value.slice(0, Math.max(0, out.value.indexOf(text))).split('\n').length - 1;
    out.scrollTop = line * lineHeight;
    document.activeElement?.blur();
  }, needle);
  const { height } = await popup.evaluate(() => document.body.getBoundingClientRect());
  return popup.screenshot({ clip: { x: 0, y: 0, width: 420, height: Math.ceil(height) } });
};

const data = (png) => `data:image/png;base64,${png.toString('base64')}`;
const compose = async (file, popupPng, pagePng) => {
  const composer = await context.newPage();
  await composer.setViewportSize({ width: 1280, height: 800 });
  const w = WINDOW;
  await composer.setContent(`<style>
      html,body{margin:0;width:1280px;height:800px;overflow:hidden}
      body{background:linear-gradient(135deg,#e8f1fd 0%,#f6f8fb 55%,#fff6db 100%);font-family:system-ui,-apple-system,sans-serif}
      .window{position:absolute;left:${w.x}px;top:${w.y}px;width:${w.width}px;height:${w.height}px;border-radius:12px;overflow:hidden;
        background:#fff;box-shadow:0 24px 60px rgb(10 40 90 / .18),0 0 0 1px rgb(0 0 0 / .08)}
      .bar{height:${w.bar}px;background:#f1f3f6;border-bottom:1px solid #e1e4e8;display:flex;align-items:center;gap:8px;padding:0 14px}
      .dot{width:12px;height:12px;border-radius:50%;background:#d6d9de}
      .url{margin-left:18px;flex:1;height:24px;border-radius:12px;background:#fff;border:1px solid #e1e4e8;font-size:13px;color:#5f6368;
        display:flex;align-items:center;padding:0 12px}
      .tool{width:22px;height:22px;border-radius:6px;background:url(${data(readFileSync(join(root, 'src/icons/icon-32.png')))}) center/18px no-repeat;
        box-shadow:0 0 0 2px #0a66d8}
      .page{display:block;width:${w.width}px;height:${w.height - w.bar}px}
      .popup{position:absolute;right:36px;top:${w.y + w.bar + 6}px;width:${Math.round(420 * POPUP_SCALE)}px;border-radius:12px;
        box-shadow:0 24px 60px rgb(10 40 90 / .28),0 0 0 1px rgb(0 0 0 / .1)}
    </style>
    <div class="window"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
      <span class="url">mrvnklm.github.io/copystate/demo.html</span><span class="tool"></span></div>
      <img class="page" src="${data(pagePng)}"></div>
    <img class="popup" src="${data(popupPng)}">`);
  await composer.evaluate(() => Promise.all([...document.images].map((img) => img.decode()))); // sonst halb gemalte Kacheln
  await composer.screenshot({ path: join(outDir, file), scale: 'css' });
  await composer.close();
};

await ready('');

// 1. Sichere Vorschau: Dropdown noch nicht geöffnet, Button „Open dropdowns (1)“
await compose('1-preview.png', await shootPopup('## Plan'), await shootPage('Plan', '#plan'));

// 2. Nach „Open dropdowns“: alle Optionen des Custom Dropdowns
let previous = await output();
await popup.locator('#probe').click();
await ready(previous);
await compose('2-dropdown-options.png', await shootPopup('## Plan'), await shootPage('Plan', '#plan'));

// 3. Schwärzung: IBAN und Passwort
await compose('3-redaction.png', await shootPopup('## Payment'), await shootPage('Payment', '#iban, #pw'));

// 4. Kopiert, Anfang der Ausgabe
await popup.locator('#copy').click();
await popup.waitForFunction(() => document.getElementById('status').dataset.state === 'ok');
await compose('4-copied.png', await shootPopup('# Account settings'), await shootPage('Account settings'));

// Promo-Tile 440×280
const tile = await context.newPage();
await tile.setViewportSize({ width: 440, height: 280 });
const icon = readFileSync(join(root, 'src/icons/icon-128.png')).toString('base64');
await tile.setContent(`<style>
    html,body{margin:0;width:440px;height:280px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    body{background:linear-gradient(135deg,#eef5ff,#ffffff 60%,#fff6db);color:#1d1d1f;box-sizing:border-box;padding:30px 30px}
    .head{display:flex;align-items:center;gap:16px}
    img{width:64px;height:64px}
    h1{margin:0;font-size:34px;letter-spacing:-.5px}
    p{margin:2px 0 0;font-size:15px;color:#4a4a52}
    .map{margin-top:26px;display:flex;align-items:center;gap:14px}
    .field{border:1.5px solid #8e8e93;border-radius:8px;padding:8px 12px;background:#fff;font-size:15px;min-width:92px;display:flex;justify-content:space-between;gap:10px}
    .arrow{font-size:22px;color:#0a66d8}
    pre{margin:0;padding:8px 12px;background:#f2f4f7;border-radius:8px;font:13px/1.45 ui-monospace,Menlo,monospace;border:1px solid #e1e4e8}
  </style>
  <div class="head"><img src="data:image/png;base64,${icon}"><div><h1>Copystate</h1><p>Page &amp; form state as Markdown for your AI</p></div></div>
  <div class="map"><div class="field"><span>Team</span><span>▾</span></div><span class="arrow">→</span>
    <pre>- [ ] Free
- [x] Team
- [ ] Business</pre></div>`);
await tile.screenshot({ path: join(root, 'store/promo-440x280.png'), scale: 'css' });

await context.close();
rmSync(profile, { recursive: true, force: true });
console.log('store/screenshots/*.png, store/promo-440x280.png geschrieben');
