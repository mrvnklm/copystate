// Baut dist/chrome, dist/firefox, dist/chrome-test (nur für die E2E-Tests) und das Console-Snippet.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageToMarkdown } from '../src/page-to-markdown.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}src`;
const dist = `${root}dist`;
// Die Version steht nur in package.json
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const base = { ...JSON.parse(readFileSync(`${src}/manifest.json`, 'utf8')), version };

const GECKO_ID = 'copystate@mrvnklm.github.io';

// Für die Chrome-Tests: Public Key ins Manifest, daraus folgt die Extension-Id (sha256 des DER, a–p kodiert)
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const TEST_KEY = der.toString('base64');
const TEST_ID = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('');

const manifests = {
  chrome: { ...base, minimum_chrome_version: '102' },
  firefox: {
    ...base,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      // data_collection_permissions gibt es erst ab Firefox 140 (Desktop) bzw. 142 (Android)
      gecko_android: { strict_min_version: '142.0' },
    },
  },
};
// Test-Builds: Host-Rechte, weil es activeTab in der Automatisierung ohne Klick aufs Icon nicht gibt,
// und clipboardRead, damit der Test den Inhalt der Zwischenablage zurücklesen kann
const testExtras = { host_permissions: ['<all_urls>'], permissions: [...base.permissions, 'clipboardRead'] };
manifests['chrome-test'] = { ...manifests.chrome, ...testExtras, key: TEST_KEY };
// WebDriver darf nicht direkt nach moz-extension:// navigieren, die Testseite darf es, wenn das Popup freigegeben ist
manifests['firefox-test'] = {
  ...manifests.firefox,
  ...testExtras,
  web_accessible_resources: [{ resources: ['popup.html'], matches: ['<all_urls>'] }],
};

rmSync(dist, { recursive: true, force: true });
for (const [target, manifest] of Object.entries(manifests)) {
  const out = `${dist}/${target}`;
  mkdirSync(out, { recursive: true });
  for (const entry of ['page-to-markdown.js', 'popup.html', 'popup.css', 'popup.js', '_locales', 'icons']) {
    cpSync(`${src}/${entry}`, `${out}/${entry}`, { recursive: true });
  }
  writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  if (target.endsWith('-test')) {
    const popup = readFileSync(`${out}/popup.js`, 'utf8');
    if (!popup.includes('const TEST_HOOKS = false;')) throw new Error('TEST_HOOKS-Zeile in popup.js nicht gefunden');
    writeFileSync(`${out}/popup.js`, popup.replace('const TEST_HOOKS = false;', 'const TEST_HOOKS = true;'));
  }
}

writeFileSync(`${dist}/chrome-test/extension-id.txt`, TEST_ID);

const snippet = `// Copystate: in die DevTools-Console pasten (Firefox + Chrome). Kopiert das Ergebnis in die Zwischenablage.
(${pageToMarkdown.toString()})({ probe: true }).then((md) => {
  try { copy(md); console.log('Copystate: copied to clipboard'); } catch { console.log('Copystate: copy() unavailable, text below'); }
  console.log(md);
});
`;
writeFileSync(`${dist}/console-snippet.js`, snippet);
console.log('dist/chrome, dist/firefox, dist/chrome-test, dist/console-snippet.js gebaut');
