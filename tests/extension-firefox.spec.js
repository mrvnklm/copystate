// Firefox kann Playwright keine Extensions laden. Deshalb: Selenium + geckodriver gegen das installierte
// Firefox, headless, das Add-on wird temporär installiert wie über about:debugging.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { startFixtureServer } from './serve.js';

const GECKO_ID = 'copystate@mrvnklm.github.io';
const UUID = '5b2c3f0e-6a1d-4e8b-9c7f-1a2b3c4d5e6f'; // feste interne Id, damit die moz-extension-URL bekannt ist
const FIREFOX = process.env.FIREFOX_BIN || '/Applications/Firefox.app/Contents/MacOS/firefox';
const extensionDir = fileURLToPath(new URL('../dist/firefox-test', import.meta.url));

if (process.env.CI && !existsSync(FIREFOX)) throw new Error(`kein Firefox unter ${FIREFOX}: in CI muss der Test laufen (FIREFOX_BIN setzen)`);
test.skip(!existsSync(FIREFOX), `kein Firefox unter ${FIREFOX} (FIREFOX_BIN setzen)`);
test.setTimeout(180_000);

test('Firefox: popup previews safely, opens dropdowns on request and copies on click', async () => {
  const work = mkdtempSync(join(tmpdir(), 'copystate-ff-'));
  const xpi = join(work, 'extension.xpi');
  execFileSync('zip', ['-qr', xpi, '.'], { cwd: extensionDir });

  const { server, origin } = await startFixtureServer();
  const options = new firefox.Options()
    .setBinary(FIREFOX)
    .addArguments('-headless')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: UUID }))
    .setPreference('intl.locale.requested', 'en-US')
    // MV3-Host-Rechte sind in Firefox optional; im Testprofil werden sie bei der Installation vergeben
    .setPreference('extensions.originControls.grantByDefault', true);
  // Der Browser-Kontext (Zwischenablage, echte Klicks) muss geckodriver ausdrücklich erlaubt werden
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  try {
    await driver.installAddon(xpi, true);
    const pageUrl = `${origin}/patterns.html`;
    await driver.get(pageUrl);
    const pageHandle = await driver.getWindowHandle();

    // Extension-Seiten sind für WebDriver tabu. Alles Weitere läuft deshalb im privilegierten Browser-Kontext:
    // Zwischenablage lesen und schreiben, Status aus dem Tab-Titel lesen, echte Klicks über windowUtils.
    const chrome = (script, ...args) => driver.executeScript(script, ...args);
    const setClipboard = (text) =>
      chrome(`Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(arguments[0]);`, text);
    const readClipboard = () =>
      chrome(`
        const trans = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
        trans.init(null);
        trans.addDataFlavor('text/plain');
        try {
          Services.clipboard.getData(trans, Services.clipboard.kGlobalClipboard, null);
          const data = {};
          trans.getTransferData('text/plain', data);
          return data.value.QueryInterface(Ci.nsISupportsString).data;
        } catch (e) {
          return '';
        }`);
    // Titel des Popups: "<state>: <text> | probe@x,y | copy@x,y" (nur in Test-Builds, siehe popup.js)
    const popupTitle = () => chrome('return gBrowser.selectedTab.label');
    // previous: Titel vor dem Klick. Der Zustand nach dem Klick muss sich davon unterscheiden.
    const waitForState = async (state, previous) => {
      let title = '';
      try {
        await driver.wait(async () => (title = await popupTitle()).startsWith(`${state}: `) && title !== previous, 45_000);
      } catch {
        throw new Error(`Popup nicht im Zustand ${state}. Titel: ${title}`);
      }
      return title;
    };
    // Klick wie von einem Menschen: geht durch den Browser in den Content-Prozess und zählt als User Activation
    const click = async (button) => {
      const at = (await popupTitle()).match(new RegExp(`${button}@(\\d+),(\\d+)`));
      if (!at) throw new Error(`${button} nicht sichtbar: ${await popupTitle()}`);
      // Marionette-Actions im Browser-Kontext: Koordinaten relativ zum Browserfenster
      const origin = await chrome('const r = gBrowser.selectedBrowser.getBoundingClientRect(); return [r.left, r.top];');
      await driver
        .actions()
        .move({ x: Math.round(origin[0] + Number(at[1])), y: Math.round(origin[1] + Number(at[2])), origin: 'viewport' })
        .press()
        .release()
        .perform();
    };

    await driver.switchTo().newWindow('tab');
    const popupHandle = await driver.getWindowHandle();
    await driver.get(`${origin}/patterns.html?opener`);
    await driver.setContext(firefox.Context.CHROME);
    await setClipboard('before');
    await driver.setContext(firefox.Context.CONTENT);

    // 1. Öffnen: nur lesen. Die Navigation kommt von der Seite, WebDriver selbst darf nicht nach moz-extension://
    const popupUrl = `moz-extension://${UUID}/popup.html?url=${encodeURIComponent(pageUrl)}`;
    await driver.executeScript('location.href = arguments[0]', popupUrl);
    await driver.setContext(firefox.Context.CHROME);
    let title = await waitForState('ready');
    expect(title).toMatch(/^ready: \d+ fields · [\d,]+ characters · ≈\S+ tokens/);
    expect(title).toMatch(/probe@\d+,\d+/); // Button sichtbar, also ungeöffnete Dropdowns erkannt
    expect(await readClipboard()).toBe('before');
    await driver.setContext(firefox.Context.CONTENT);
    await driver.switchTo().window(pageHandle);
    expect(await driver.executeScript('return { events: window.events, submits: window.submits };')).toEqual({ events: 0, submits: 0 });
    await driver.switchTo().window(popupHandle);

    // 2. Dropdowns öffnen: weiterhin nichts kopiert, Button verschwindet
    await driver.setContext(firefox.Context.CHROME);
    await click('probe');
    title = await waitForState('ready', title);
    expect(title).not.toMatch(/probe@\d/);
    expect(await readClipboard()).toBe('before');

    // 3. Kopieren per Klick: ohne clipboardWrite, nur mit User Activation
    await click('copy');
    await waitForState('ok');
    const clipboard = await readClipboard();
    await driver.setContext(firefox.Context.CONTENT);

    expect(clipboard.startsWith('# Patterns')).toBe(true);
    expect(clipboard).toContain('- **Country**: `Germany` _(dropdown)_\n  - [x] Germany');
    expect(clipboard).toContain('- **Ring time**: `20 s` _(dropdown)_\n  - _Hint:_ Forwarding starts after this.\n  - [ ] 10 s');
    expect(clipboard).toContain('- **Protocol**: `TCP` _(dropdown)_\n  - [ ] UDP');
    expect(clipboard).toContain('- **Name**: `Office` _(text, required)_');
    expect(clipboard).not.toContain('hunter2');

    // Seite ist danach unverändert: nichts offen, nichts abgesendet
    await driver.switchTo().window(pageHandle);
    const after = await driver.executeScript(
      'return { expanded: document.querySelectorAll("[aria-expanded=\\"true\\"]").length, submits: window.submits };',
    );
    expect(after).toEqual({ expanded: 0, submits: 0 });
  } finally {
    await driver.quit();
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
