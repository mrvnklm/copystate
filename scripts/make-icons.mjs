// Rendert das Icon (SVG) in die PNG-Größen für Manifest und Chrome Web Store. Ergebnis wird committet.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../src/icons/', import.meta.url));
const storeDir = fileURLToPath(new URL('../store/', import.meta.url));
mkdirSync(outDir, { recursive: true });

// Markdown-„M“ mit Häkchen für den Formularzustand. Höchstens zwei Formen, damit es bei 16 px lesbar bleibt.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="8" y="8" width="112" height="112" rx="26" fill="#0a66d8"/>
  <path d="M22 88V40l16 24 16-24v48" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M74 70l10 11 21-35" fill="none" stroke="#ffd23f" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (path, size, artwork = size) => {
  await page.setViewportSize({ width: size, height: size });
  const pad = (size - artwork) / 2;
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${artwork}px;height:${artwork}px;display:block;margin:${pad}px}</style>${svg}`,
  );
  await page.screenshot({ path, omitBackground: true });
};
for (const size of [16, 32, 48, 96, 128]) await render(`${outDir}icon-${size}.png`, size);
// Chrome Web Store: 128 px, davon 96 px Motiv und 16 px transparenter Rand
mkdirSync(storeDir, { recursive: true });
await render(`${storeDir}icon-128.png`, 128, 96);
await browser.close();
console.log(`Icons geschrieben nach ${outDir}`);
