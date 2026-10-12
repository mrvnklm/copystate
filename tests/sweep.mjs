// Diagnose: läuft den Kern auf echten Seiten und meldet, was danach offen geblieben ist.
// Aufruf: node tests/sweep.mjs [chromium|firefox] [url...]
import { chromium, firefox } from '@playwright/test';
import { pageToMarkdown } from '../src/page-to-markdown.js';

const SOURCE = pageToMarkdown.toString();
const [engine = 'chromium', ...urls] = process.argv.slice(2);
const DEFAULT_URLS = [
  'https://mui.com/material-ui/react-select/',
  'https://ant.design/components/select',
  'https://element-plus.org/en-US/component/select.html',
  'https://vuetifyjs.com/en/components/selects/',
  'https://www.radix-ui.com/primitives/docs/components/select',
  'https://react-select.com/home',
  'https://headlessui.com/react/listbox',
  'https://www.reka-ui.com/docs/components/select',
  'https://primevue.org/select/',
  'https://getbootstrap.com/docs/5.3/components/dropdowns/',
  'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/',
];

const snapshot = () => {
  const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const describe = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}[${e.getAttribute('role') || ''}] ${(e.className?.baseVal ?? e.className ?? '').toString().slice(0, 60)}`;
  return {
    expanded: [...document.querySelectorAll('[aria-expanded="true"]')].map(describe),
    popups: [...document.querySelectorAll('[role=listbox],[role=menu],[role=dialog],[role=tree],[role=grid]')].filter(shown).map(describe),
    options: [...document.querySelectorAll('[role=option]')].filter(shown).length,
    focus: document.activeElement ? describe(document.activeElement) : '',
    url: location.href,
  };
};
const diff = (a, b) => b.filter((x) => !a.includes(x));

const browser = await (engine === 'firefox' ? firefox : chromium).launch();
for (const url of urls.length ? urls : DEFAULT_URLS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const before = await page.evaluate(snapshot);
    const md = await page.evaluate(([src]) => (0, eval)(`(${src})`)({}), [SOURCE]);
    await page.waitForTimeout(500);
    const after = await page.evaluate(snapshot);
    const left = {
      expanded: diff(before.expanded, after.expanded),
      popups: diff(before.popups, after.popups),
      options: after.options - before.options,
      focus: before.focus === after.focus ? undefined : `${before.focus} -> ${after.focus}`,
      url: before.url === after.url ? undefined : after.url,
    };
    const dropdowns = (md.match(/_\(dropdown/g) || []).length;
    const unread = (md.match(/options not readable/g) || []).length;
    const clean = !left.expanded.length && !left.popups.length && left.options <= 0 && !left.url;
    console.log(`${clean ? 'OK  ' : 'OPEN'} ${url}  dropdowns=${dropdowns} unread=${unread}`);
    if (!clean) console.log(JSON.stringify(left, null, 1));
  } catch (e) {
    console.log(`ERR  ${url}  ${String(e.message).split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
