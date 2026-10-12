# Store-Unterlagen

Alles, was die beiden Stores beim Einreichen abfragen. Bilder neu erzeugen: `bun run store-assets` (Icon: `bun run icons`).

| Datei | Wofür |
|---|---|
| `amo-metadata.json` | AMO-Listing, wird von `bun run submit:firefox` mitgeschickt |
| `description.en.txt`, `description.de.txt` | lange Beschreibung, für das CWS-Dashboard zum Einfügen |
| `icon-128.png` | CWS-Store-Icon (96 px Motiv, 16 px Rand) |
| `screenshots/*.png` | 1280×800, für CWS (Pflicht, 1–5) und AMO |
| `promo-440x280.png` | CWS Small Promo Tile (Pflicht) |

## Chrome Web Store: Felder im Dashboard

| Feld | Inhalt |
|---|---|
| Name, Summary | kommen aus dem Manifest (`_locales/*/messages.json`) |
| Kategorie | Productivity → Tools (im Dashboard prüfen, ob es Developer Tools besser trifft) |
| Sprache | English, zusätzlich Deutsch |
| Homepage | https://mrvnklm.github.io/copystate/ |
| Support | https://github.com/mrvnklm/copystate/issues |
| Privacy Policy | https://mrvnklm.github.io/copystate/privacy.html |
| Trader-Status (EU DSA) | Non-trader: privates, nicht kommerzielles Projekt |

### Privacy-Tab (Texte zum Einfügen)

**Single purpose**

```text
Copystate copies the current web page as Markdown, including the current values and available options of its form fields, so the user can paste it into an AI assistant. It reads only the active tab and only after the user clicks its toolbar button or presses its shortcut.
```

**activeTab**

```text
Needed to read the page the user is currently viewing, only after the user explicitly invokes the extension (toolbar button or shortcut). No host permissions are requested; no other tab or site is accessible.
```

**scripting**

```text
Used with activeTab to run the extension's own bundled function (scripting.executeScript with func) in the active tab. It reads the page content and form fields and returns Markdown to the popup. Only when the user clicks "Open dropdowns" does it briefly open custom dropdown menus to read their options and close them again, without selecting anything. No remote code; nothing is transmitted.
```

| Frage | Antwort |
|---|---|
| Remote code | No, I am not using remote code |
| Data usage: was wird verarbeitet | **Website content** und **Personally identifiable information** ankreuzen. Die Extension liest eingegebene Formularwerte (z. B. Name, Adresse). Prüfe im Dashboard, ob „Authentication information“ und „Financial and payment information“ auch passen: Passwörter und IBANs werden gelesen und vor der Anzeige geschwärzt |
| Certifications | alle drei setzen (kein Verkauf, keine Nutzung außerhalb des Zwecks, keine Bonitätsprüfung) |

## AMO: was nicht in den Metadaten steht

| Feld | Inhalt |
|---|---|
| Screenshots | `screenshots/*.png` im Dev Hub hochladen, Captions unten |
| Slug | `copystate` steht in den Metadaten, sonst bildet AMO ihn aus dem langen Namen |
| Android | `gecko_android` bleibt im Manifest (sonst warnt `web-ext lint`). Will AMO Android-Kategorien, im Dev Hub nachtragen oder Android abwählen |

| Screenshot | Caption EN | Caption DE |
|---|---|---|
| 1-preview | The popup previews the page without touching it | Das Popup zeigt eine Vorschau, ohne die Seite anzufassen |
| 2-dropdown-options | "Open dropdowns" reads options that only exist while a dropdown is open | „Dropdowns öffnen“ liest Optionen, die es nur bei offenem Dropdown gibt |
| 3-redaction | Passwords and IBANs are redacted | Passwörter und IBANs werden geschwärzt |
| 4-copied | Copied: paste it into any AI assistant | Kopiert: einfach in einen KI-Assistenten einfügen |
