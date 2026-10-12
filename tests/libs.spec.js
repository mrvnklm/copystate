import { expect, test } from '@playwright/test';
import { pageToMarkdown } from '../src/page-to-markdown.js';
import { ORIGIN, serveFixtures } from './serve.js';

const SOURCE = pageToMarkdown.toString();
const render = (page, options = {}) =>
  page.evaluate(([src, opts]) => (0, eval)(`(${src})`)(opts), [SOURCE, options]);

// Nach dem Lesen: nichts offen, nichts abgesendet, keine Auswahl verändert
const sideEffects = (page) =>
  page.evaluate(() => ({
    expanded: [...document.querySelectorAll('[aria-expanded="true"]')].map((e) => e.id || e.tagName),
    shownOptions: [...document.querySelectorAll('[role=option]')].filter((o) => o.getClientRects().length > 0).length,
    submits: window.submits ?? 0,
  }));

test('Vue: Headless UI Listbox, Reka Select, Reka Combobox', async ({ page }) => {
  await serveFixtures(page);
  await page.goto(`${ORIGIN}/libs/vue.html`);
  await page.locator('#hui-button').waitFor();
  const md = await render(page);

  expect(md).toContain('- **Country**: `Germany` _(dropdown)_\n  - [x] Germany\n  - [ ] Austria\n  - [ ] Switzerland');
  expect(md).toContain('- **Protocol**: `TCP` _(dropdown)_\n  - [ ] UDP\n  - [x] TCP\n  - [ ] TLS');
  expect(md).toMatch(/- \*\*City\*\*: `Berlin` _\(dropdown\)_\n {2}- \[x\] Berlin\n {2}- \[ \] Hamburg\n {2}- \[ \] Munich/);
  expect(await sideEffects(page)).toEqual({ expanded: [], shownOptions: 0, submits: 0 });
  await expect(page.locator('#hui-button')).toHaveText('Germany');
  await expect(page.locator('#reka-select')).toHaveText('TCP');
  await expect(page.locator('#reka-combobox')).toHaveValue('Berlin');
});

test('React: Radix Select, react-select', async ({ page }) => {
  await serveFixtures(page);
  await page.goto(`${ORIGIN}/libs/react.html`);
  await page.locator('#radix-select').waitFor();
  const md = await render(page);

  expect(md).toContain('- **Plan**: `Business` _(dropdown)_\n  - [ ] Basic\n  - [x] Business\n  - [ ] Enterprise');
  expect(md).toMatch(/- \*\*City\*\*: .*\n {2}- \[.\] Berlin\n {2}- \[.\] Hamburg\n {2}- \[.\] Munich/);
  expect(await sideEffects(page)).toEqual({ expanded: [], shownOptions: 0, submits: 0 });
  await expect(page.locator('#radix-select')).toHaveText('Business');
  await expect(page.getByText('Hamburg')).toBeVisible();
});
