import { pageToMarkdown } from './page-to-markdown.js';

const api = globalThis.browser ?? globalThis.chrome;
const t = (key, subs) => api.i18n.getMessage(key, subs) || key;

// Nur in Test-Builds true (scripts/build.mjs ersetzt die Zeile): ?tabId=<id> oder ?url=<url> wählt den Tab
const TEST_HOOKS = false;

const statusEl = document.getElementById('status');
const output = document.getElementById('output');
const probeRow = document.getElementById('probe-row');
const probeButton = document.getElementById('probe');
const copyButton = document.getElementById('copy');
const scopeInputs = [...document.querySelectorAll('input[name=scope]')];

document.documentElement.lang = api.i18n.getUILanguage();
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
output.setAttribute('aria-label', t('previewLabel'));

const SCOPE_KEY = 'scope';
try {
  const saved = localStorage.getItem(SCOPE_KEY);
  for (const input of scopeInputs) input.checked = input.value === (saved === 'page' ? 'page' : 'main');
} catch {
  // ohne Storage gilt der Default (Hauptinhalt)
}
const scope = () => scopeInputs.find((input) => input.checked)?.value ?? 'main';

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return r.width ? `${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)}` : '';
};
const setStatus = (text, state) => {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
  // Firefox-Test: das Popup-DOM ist für WebDriver tabu, er liest den Tab-Titel und klickt auf die Koordinaten
  if (TEST_HOOKS) document.title = `${state}: ${text} | probe@${rectOf(probeButton)} | copy@${rectOf(copyButton)}`;
};

const countFields = (md) => md.split('\n').filter((line) => /^- (\*\*|\[[ x]\] \*\*|\([ •]\) \*\*)/.test(line)).length;
// Diesen Text schreibt der Kern für jedes Dropdown, das er im sicheren Modus nicht geöffnet hat
const countUnopened = (md) => (md.match(/_\(options not read: dropdown not opened\)_/g) || []).length;
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const statsOf = (md) => [
  String(countFields(md)),
  md.length.toLocaleString(),
  compact.format(Math.ceil(md.length / 4)), // grobe Faustregel: 4 Zeichen pro Token
];

const targetTabId = async () => {
  if (TEST_HOOKS) {
    const params = new URLSearchParams(location.search);
    if (params.get('tabId')) return Number(params.get('tabId'));
    if (params.get('url')) return (await api.tabs.query({})).find((tab) => tab.url === params.get('url'))?.id;
  }
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ein Lauf zur Zeit. Liefert der Kern { busy: true }, läuft auf der Seite noch ein früherer Lauf (Popup wurde
// mittendrin geschlossen und neu geöffnet): dann warten, bis er fertig ist. null heißt in Chrome: Exception.
const inject = async (probe) => {
  const tabId = await targetTabId();
  if (!tabId) throw new Error(t('errorNoTab'));
  for (let attempt = 0; attempt < 30; attempt++) {
    if (attempt) await wait(1000);
    const [injection] = await api.scripting.executeScript({
      target: { tabId },
      func: pageToMarkdown,
      args: [{ probe, scope: scope() }],
    });
    if (injection?.result?.busy) {
      setStatus(t('statusBusy'), 'busy');
      continue;
    }
    if (typeof injection?.result !== 'string') throw new Error(injection?.error?.message || 'the page script failed');
    return injection.result;
  }
  return null;
};

let busy = false;
const setBusy = (on) => {
  busy = on;
  for (const control of [probeButton, ...scopeInputs]) control.disabled = on;
  copyButton.disabled = on || !output.value;
};

// probe false: nur lesen, die Seite bekommt kein einziges Event. probe true: Dropdowns kurz öffnen.
// Kopiert wird hier nie, das macht nur der Klick auf „Kopieren“.
const read = async (probe) => {
  if (busy) return;
  const focusInScope = scopeInputs.includes(document.activeElement); // Tastatur-Nutzer bleiben in der Gruppe
  setBusy(true);
  setStatus(t(probe ? 'statusOpening' : 'statusReading'), 'busy');
  let state = 'error';
  let text;
  try {
    const md = await inject(probe);
    if (md === null) {
      text = t('errorBusy');
    } else {
      output.value = md;
      const unopened = countUnopened(md);
      probeRow.hidden = unopened === 0;
      probeButton.textContent = t('probeButton', [String(unopened)]);
      state = 'ready';
      text = t('statusReady', statsOf(md));
    }
  } catch (err) {
    output.value = '';
    probeRow.hidden = true;
    const message = String(err?.message || err);
    const restricted = /cannot access|cannot be scripted|missing host permission|extensions gallery|restricted|privileged/i.test(message);
    text = restricted ? t('errorRestricted') : t('errorFailed', [message]);
  }
  setBusy(false);
  // erst nach dem Enable fokussieren, sonst verpufft der Fokus
  if (focusInScope) scopeInputs.find((input) => input.checked)?.focus();
  else if (!copyButton.disabled) copyButton.focus();
  setStatus(text, state);
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    output.select();
    return document.execCommand('copy');
  }
};

for (const input of scopeInputs) {
  input.addEventListener('change', () => {
    try {
      localStorage.setItem(SCOPE_KEY, scope());
    } catch {
      // Einstellung wird dann nur nicht gemerkt
    }
    read(false);
  });
}
probeButton.addEventListener('click', () => read(true));
copyButton.addEventListener('click', async () => {
  if (await copyText(output.value)) setStatus(t('statusCopied', statsOf(output.value)), 'ok');
  else setStatus(t('statusNotCopied'), 'error');
});

read(false);
