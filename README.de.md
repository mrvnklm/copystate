# Copystate

[English](README.md) · [Website](https://mrvnklm.github.io/copystate/) · [Datenschutz](https://mrvnklm.github.io/copystate/privacy.html) · [Demo-Seite](https://mrvnklm.github.io/copystate/demo.html)

Browser-Extension für Firefox und Chrome. Sie kopiert die aktuelle Seite als Markdown, mit jedem Formularfeld, seinem Wert
und allen Optionen der Dropdowns, und ist fertig zum Einfügen in ein LLM.

| Was | Wie |
|---|---|
| Benutzen | Icon klicken oder `Alt+Shift+M`: Vorschau ohne jeden Eingriff in die Seite. „Dropdowns öffnen“ liest deren Optionen, „Kopieren“ legt das Markdown in die Zwischenablage |
| Ohne Extension | `dist/console-snippet.js` in die DevTools-Console pasten |
| Bauen | `bun install`, danach `bun run build` → `dist/chrome`, `dist/firefox` |
| Pakete | `bun run package` → `dist/artifacts/*.zip` |
| Store | `store/README.md`: Texte, Bilder, Felder für Chrome Web Store und AMO. `bun run submit:firefox` reicht bei AMO ein |
| Testen | `bun run test`: Kern in Chromium, Firefox und WebKit, echte Dropdown-Bibliotheken, Extension in Chrome und Firefox mit echtem Klick und Zwischenablage |

<details>
<summary>Was gelesen wird und was nicht</summary>

- **Gelesen:** native Felder, Radios und Checkboxen, Switches, `select`, ARIA-Comboboxen und Custom Dropdowns, getestet
  mit MUI, Ant Design, Element Plus, PrimeVue, Radix, Reka UI, Headless UI und react-select. Custom Dropdowns werden nur
  auf Klick auf „Dropdowns öffnen“ kurz geöffnet und wieder geschlossen. Dazu kommen Tabellen (auch mit Feldern in
  Zellen), Tabs, Dialoge außerhalb von `main` sowie der Fließtext mit Hinweisen.
- **Nicht gelesen:** Inhalt hinter nicht gewählten Radios oder inaktiven Tabs (rendert erst nach der Auswahl),
  zugeklappte `details` und iframes (dafür steht ein Hinweis in der Ausgabe). Open Shadow DOM wird gelesen.
- **Umfang:** „Hauptinhalt“ liest `main` und offene Dialoge, „Ganze Seite“ zusätzlich Header, Navigation und Sidebar.
  Im Hauptinhalt steht am Ende, wie viele Felder außerhalb liegen.
- **Geschwärzt:** Formularfelder für Passwörter (auch aufgedeckte), Kreditkarte, PIN, IBAN, OTP und `token`/`secret`,
  erkannt über Typ, `autocomplete`, Name, Label und Placeholder. In URLs werden Userinfo, Token-Parameter und
  Token-Pfadsegmente geschwärzt. Text, den die Seite nur anzeigt, wird nicht geschwärzt.
- **Fremdinhalt:** Seitentext wird escaped. Text, Labels und Werte können keine Felder, Überschriften oder Links
  vortäuschen.
- **Seiteneffekte:** Das Popup liest beim Öffnen nur und schickt der Seite kein einziges Event. Dropdowns werden
  erst auf Klick geöffnet. Dabei sind Submit und Link-Navigation blockiert, Fokus und Scroll-Position werden
  wiederhergestellt. Das Zeitbudget liegt bei 20 s.
- **Schließen:** der Reihe nach, bis das Dropdown zu ist: Klick auf den Trigger, Escape am Trigger, Escape im Popup
  (MUI), Klick außerhalb, Blur. `bun run sweep [chromium|firefox] [url…]` prüft das auf echten Seiten (MUI, Ant Design,
  Element Plus, Vuetify, PrimeVue, Radix, Reka, react-select) und meldet, was offen geblieben ist.
- **Bekannte Grenze:** Escape wird am `body` gestoppt. Ein Modal, das Escape am `document` in der Capture-Phase
  abfängt, kann trotzdem mit zugehen.

</details>

<details>
<summary>Aufbau</summary>

- `src/page-to-markdown.js`: der Kern, eine in sich geschlossene Funktion. Das Popup injiziert sie per
  `scripting.executeScript({ func })` in die isolated world. Sie darf deshalb nichts von außen referenzieren.
- `scripts/build.mjs`: baut aus dem einen `src/manifest.json` die Firefox-Variante (Gecko-Id,
  `data_collection_permissions`) und die Chrome-Variante.
- Test-Builds (`dist/*-test`) haben Host-Rechte, `clipboardRead` und `TEST_HOOKS = true` im Popup. Damit wählen die
  Tests den Ziel-Tab über `?url=`. Die Store-Builds enthalten nichts davon.
- Der Firefox-Extension-Test läuft über Selenium und geckodriver gegen `/Applications/Firefox.app` (`FIREFOX_BIN`
  überschreibt den Pfad), weil Playwright in Firefox keine Extensions lädt.
- Gate gegen deutsche Bezeichner: `scripts/dev/detect-identifiers.ts`, pre-commit in `.githooks/`, PostToolUse-Hook in
  `.claude/`. Nach einem Clone einmal `git config core.hooksPath .githooks` ausführen.

</details>

MIT-Lizenz, siehe [LICENSE](LICENSE).
