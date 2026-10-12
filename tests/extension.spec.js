import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, serveFixtures } from './serve.js';

const extensionDir = fileURLToPath(new URL('../dist/chrome-test', import.meta.url));

test('Chrome: popup previews safely, opens dropdowns on request and copies on click', async () => {
  const extensionId = readFileSync(join(extensionDir, 'extension-id.txt'), 'utf8').trim();
  const profile = mkdtempSync(join(tmpdir(), 'copystate-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  try {
    await serveFixtures(context);
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/patterns.html`);
    const pageState = () =>
      page.evaluate(() => ({
        events: window.events,
        submits: window.submits,
        expanded: document.querySelectorAll('[aria-expanded="true"]').length,
      }));

    const popup = await context.newPage();
    const status = popup.locator('#status');
    const output = popup.locator('#output');
    const clipboard = () => popup.evaluate(() => navigator.clipboard.readText());
    // Zwischenablage vorbelegen, von einer Extension-Seite aus (die Fixture ist kein secure context)
    await popup.goto(`chrome-extension://${extensionId}/popup.html?url=none`);
    await popup.evaluate(() => navigator.clipboard.writeText('before'));

    // 1. Öffnen: nur lesen. Kein Event an die Seite, nichts in der Zwischenablage.
    await popup.goto(`chrome-extension://${extensionId}/popup.html?url=${encodeURIComponent(`${ORIGIN}/patterns.html`)}`);
    await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(status).toHaveText(/^\d+ (fields|Felder) · [\d.,]+ (characters|Zeichen) · ≈\S+ Tokens$/i);
    expect(await output.inputValue()).toContain('- **Country**: `Germany` _(dropdown)_\n  - _(options not read: dropdown not opened)_');
    await expect(popup.locator('#probe')).toHaveText(/\((6)\)$/);
    await expect(popup.locator('#copy')).toBeFocused();
    expect(await pageState()).toEqual({ events: 0, submits: 0, expanded: 0 });
    expect(await clipboard()).toBe('before');

    // 2. Dropdowns öffnen: Optionen da, Seite danach wieder zu, weiterhin nichts kopiert
    // Wie im echten Einsatz: die Seite ist der sichtbare Tab. Im Hintergrund drosselt Chrome ihre Timer auf ~1 s.
    await page.bringToFront();
    await popup.locator('#probe').click();
    await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    expect(await output.inputValue()).toContain('- **Country**: `Germany` _(dropdown)_\n  - [x] Germany');
    await expect(popup.locator('#probe-row')).toBeHidden();
    expect(await pageState()).toMatchObject({ submits: 0, expanded: 0 });
    expect(await clipboard()).toBe('before');

    // 3. Kopieren per Enter auf dem fokussierten Button
    await expect(popup.locator('#copy')).toBeFocused();
    await popup.keyboard.press('Enter');
    await expect(status).toHaveAttribute('data-state', 'ok');
    await expect(status).toHaveText(/^(Copied|Kopiert): \d+ (fields|Felder) · ≈\S+ Tokens$/i);
    expect(await clipboard()).toBe(await output.inputValue());

    // 4. Umfang „ganze Seite“ liest neu und nimmt die Navigation mit
    await popup.getByText(/^(Whole page|Ganze Seite)$/).click();
    await expect(status).toHaveAttribute('data-state', 'ready');
    expect(await output.inputValue()).toContain('Site nav (outside main)');
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
