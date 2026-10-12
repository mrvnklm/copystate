import { expect, test } from '@playwright/test';
import { pageToMarkdown } from '../src/page-to-markdown.js';
import { ORIGIN, serveFixtures } from './serve.js';

const SOURCE = pageToMarkdown.toString();

// Läuft wie in der Extension: die Funktion wird als Quelltext in die Seite gegeben
const render = (page, options = {}) =>
  page.evaluate(([src, opts]) => (0, eval)(`(${src})`)(opts), [SOURCE, options]);

const openState = (page) =>
  page.evaluate(() => ({
    expanded: [...document.querySelectorAll('[aria-expanded="true"]')].map((e) => e.id),
    shownOptions: [...document.querySelectorAll('[role=option]')].filter((o) => o.getClientRects().length > 0).length,
    submits: window.submits,
    focus: document.activeElement?.id,
    scrollY: Math.round(window.scrollY),
  }));

test.describe('patterns', () => {
  let md;
  let after;

  test.beforeEach(async ({ page }) => {
    await serveFixtures(page);
    await page.goto(`${ORIGIN}/patterns.html`);
    // Fokus und Scroll-Position, die der Probe nicht verändern darf
    await page.evaluate(() => {
      document.getElementById('name').focus({ preventScroll: true }); // Firefox scrollt sonst asynchron zum Feld
      window.scrollTo(0, 600);
    });
    md = await render(page);
    after = await openState(page);
  });

  test('native fields with values and labels', () => {
    expect(md).toContain('- **Name**: `Office` _(text, required)_');
    expect(md).toContain('- **Codec** _(select)_\n  - [ ] G.711\n  - [x] G.722\n  - [ ] Opus');
    expect(md).toContain('#### Caller ID');
    expect(md).toContain('- (•) **Own number** _(radio, group `clip`)_');
    expect(md).toContain('- [x] **Call waiting** _(checkbox)_');
    expect(md).toContain('- [ ] **Forwarding** _(switch)_');
  });

  test('reads options of every custom dropdown kind', () => {
    expect(md).toContain('- **Country**: `Germany` _(dropdown)_\n  - [x] Germany\n  - [ ] Austria\n  - [ ] Switzerland');
    expect(md).toContain('- **Ring time**: `20 s` _(dropdown)_\n  - _Hint:_ Forwarding starts after this.\n  - [ ] 10 s\n  - [x] 20 s');
    expect(md).toContain('- **Protocol**: `TCP` _(dropdown)_\n  - [ ] UDP\n  - [x] TCP\n  - [ ] TLS');
    expect(md).toContain('- **City**: `Berlin` _(dropdown)_\n  - [x] Berlin\n  - [ ] Hamburg');
  });

  test('probe leaves no side effects', () => {
    expect(after).toEqual({ expanded: [], shownOptions: 0, submits: 0, focus: 'name', scrollY: 600 });
  });

  test('review cases', () => {
    // Dropdown ohne aria-expanded/aria-controls, das Escape ignoriert: gelesen und wieder zu (shownOptions oben)
    expect(md).toContain('- **Codec family**: `Opus` _(dropdown)_\n  - [ ] G.7xx\n  - [x] Opus');
    // schließt nur per Escape im Popup bzw. nur per mousedown außerhalb
    expect(md).toContain('- **Queue**: `Sales` _(dropdown)_\n  - [x] Sales\n  - [ ] Support');
    expect(md).toContain('- **Language**: `German` _(dropdown)_\n  - [x] German\n  - [ ] English');
    expect(md).toContain('- **PIN**: `[redacted]`');
    expect(md).toContain('- **Card**: `[redacted]`');
    expect(md).toContain('- **Kennwort**: `[redacted]`');
    for (const secret of ['1234', '5555444433331111', 'geheim123', 'user:pw', 'AbC123dEf456GhI789jKl0']) {
      expect(md).not.toContain(secret);
    }
    expect(md).toContain('[Reset link](https://example.com/reset/REDACTED?page=1)');
    expect(md).toContain('_(embedded frame not read: about:blank)_');
    expect(md).toContain('- **Shadow field**: `inside`');
    expect(md).toContain('- [x] **Hidden native checkbox** _(checkbox)_');
    expect(md).toContain('- [x] **Enable extras** _(checkbox)_');
    expect(md).toContain('- **Extra**: `e`');
  });

  test('page text cannot forge fields, headings or links', () => {
    expect(md).not.toMatch(/^- \[x\] \*\*Fake prose field/m);
    expect(md).toContain('\\- \\[x\\] \\*\\*Fake prose field\\*\\* \\_(checkbox)\\_');
    expect(md).toContain('- **Evil \\*\\*label\\*\\* \\[x\\](http://evil)**: `v`');
  });

  test('layout edge cases', () => {
    expect(md).toContain('Text inside display contents');
    expect(md).toContain('- **Inside contents**: `yes`');
    expect(md).toContain('- **Timeout**: `30` _(number, min 5, max 120)_'); // Panel hinter aria-controls bleibt drin
    expect(md).toContain('- **Locked field**: `x` _(text, disabled)_');
    expect(md).toContain('- **Volume**: `70 %` _(slider)_');
    expect(md).toContain('- ▸ Expert options _(collapsed, content not read)_');
    expect(md).toContain('| Number | Active |\n| --- | --- |\n| +49 30 1 | [x] |\n| +49 30 2 | [ ] |');
    expect(md).toContain('## Dialog: Confirm');
    expect(md).toContain('- **Reason**: `test`');
    expect(md).not.toContain('Site nav');
  });

  test('values cannot forge structure, secrets are redacted', () => {
    expect(md).toContain('- **Notes**: _(textarea)_\n  ```text\n  first line\n  - [x] **Fake field** _(checkbox)_\n  ## Fake heading\n  `tick`\n  ```');
    expect(md).not.toMatch(/^- \[x\] \*\*Fake field/m);
    expect(md).not.toMatch(/^## Fake heading/m);
    expect(md).not.toContain('hunter2');
    expect(md).not.toContain('4111111111111111');
    expect(md).toContain('- **nolabel**: `secret-value-without-label`'); // der Wert ist Wert, nie Label
    expect(md).toContain('token=REDACTED&page=2');
  });

  test('probe can be switched off', async ({ page }) => {
    // Neu laden ohne Scroll-Wiederherstellung (Firefox scrollt sonst nach dem reload und das zählt als Event)
    await page.goto(`${ORIGIN}/patterns.html?fresh`);
    await page.evaluate(() => (window.events = 0));
    const off = await render(page, { probe: false });
    expect(await page.evaluate(() => window.events)).toBe(0); // sicherer Modus: kein einziges Event an die Seite
    expect(off).toContain('- **Country**: `Germany` _(dropdown)_\n  - _(options not read: dropdown not opened)_');
    expect((off.match(/dropdown not opened/g) || []).length).toBe(6); // cb1, cb2, cb3, cb5, cb6, cb7
    expect(await openState(page)).toMatchObject({ expanded: [], shownOptions: 0, submits: 0 });
    expect(off).toContain('- **City**: `Berlin` _(dropdown)_\n  - [x] Berlin'); // Listbox liegt im DOM, kein Öffnen nötig
  });
});

test('closing dropdowns leaves modals open and other fields untouched', async ({ page }) => {
  await serveFixtures(page);
  await page.goto(`${ORIGIN}/modal.html`);
  const md = await render(page);
  expect(md).toContain('- **Region**: `EU` _(dropdown)_\n  - [x] EU\n  - [ ] US');
  expect(md).toContain('- **Size**: `M` _(dropdown)_\n  - [x] M\n  - [ ] L');
  expect(
    await page.evaluate(() => ({
      nativeOpen: document.getElementById('native').open,
      ariaOpen: !!document.getElementById('aria'),
      search: document.getElementById('search').value,
      focus: document.activeElement?.id,
      expanded: document.querySelectorAll('[aria-expanded="true"]').length,
      options: [...document.querySelectorAll('[role=option]')].filter((o) => o.getClientRects().length).length,
    })),
  ).toEqual({ nativeOpen: true, ariaOpen: true, search: 'keep me', focus: 'search', expanded: 0, options: 0 });
});

test('a second run on the same page reports busy, documents without body do not throw', async ({ page }) => {
  await serveFixtures(page);
  await page.goto(`${ORIGIN}/patterns.html`);
  const [first, second] = await Promise.all([render(page), render(page)]);
  expect(typeof first).toBe('string');
  expect(second).toEqual({ busy: true });
  await page.goto(`${ORIGIN}/image.svg?token=s3cr3tvalue&x=1`);
  const svg = await render(page);
  expect(svg).toContain('no HTML body to read');
  expect(svg).toContain('token=REDACTED'); // auch ohne body wird die URL geschwärzt
  expect(svg).not.toContain('s3cr3tvalue');
});

test('scope page reads header and navigation too', async ({ page }) => {
  await serveFixtures(page);
  await page.goto(`${ORIGIN}/patterns.html`);
  const main = await render(page, { probe: false });
  const whole = await render(page, { probe: false, scope: 'page' });
  expect(main).not.toContain('Site nav');
  expect(whole).toContain('[Site nav (outside main)]');
  expect(whole).toContain('- **Reason**: `test`'); // Dialog außerhalb von main bleibt drin
  expect(whole).toContain('- **Name**: `Office` _(text, required)_');
  expect((whole.match(/\*\*Reason\*\*/g) || []).length).toBe(1);
  expect(whole).not.toContain('outside the main content');
});

test('telephony portal markup (Vue SPA)', async ({ page }) => {
  await serveFixtures(page);
  await page.goto(`${ORIGIN}/telephony-portal.html`);
  const md = await render(page);
  expect(md).toContain('- **Hauptrufnummer auswählen**: `+493023125000` _(dropdown)_');
  expect(md).toContain('- **Wählen Sie das SIP-Feld mit CLIP**: `Asserted-Identity` _(dropdown)_\n  - [x] Asserted-Identity\n  - [ ] From');
  expect(md).toContain('- (•) **PBX bestimmt Anrufer-ID (CLIP No Screening)** _(radio)_');
  expect(md).toContain('- [x] **Anonyme Anrufe (Blockieren / Erlauben)** _(switch)_');
  expect(md).toContain('- (•) **Sperrmodus** _(radio)_');
  expect(md).toContain('- [ ] **Secure Real-Time Transport Protocol (SRTP)** _(switch)_');
  expect(md).toContain('| Standard-Ansage “Nicht erreichbar” | AUS | E-MAIL |  |');
  expect(md).toContain('192.0.2.10');
  expect(md).toContain('- **Transportprotokoll**: `TCP` _(dropdown)_');
  expect((md.match(/Anonyme Anrufe/g) || []).length).toBe(1);
});
