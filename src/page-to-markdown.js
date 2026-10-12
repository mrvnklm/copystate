// Copystate: rendert die Live-Seite als Markdown, Formularfelder samt Wert und Optionen an ihrer Stelle im Text.
//
// Die Funktion muss in sich geschlossen bleiben (keine Imports, keine Referenzen nach außen):
// die Extension übergibt sie per scripting.executeScript({ func }), das serialisiert sie über toString().
//
// Rückgabe: der Markdown-String, oder { busy: true }, wenn auf derselben Seite schon ein Lauf aktiv ist.
// (Kein null: Chrome liefert bei einer Exception im Script ebenfalls null als Ergebnis.)
export async function pageToMarkdown(options = {}) {
  const PROBE = options.probe !== false; // Custom Dropdowns kurz öffnen, weil ihre Optionen erst dann im DOM stehen
  const WHOLE_PAGE = options.scope === 'page'; // sonst nur der Hauptinhalt (main) plus offene Dialoge
  const deadline = Date.now() + (options.budgetMs ?? 20_000); // Gesamtbudget für das Öffnen von Dropdowns

  // Zwei Läufe gleichzeitig würden dieselben Dropdowns gegeneinander auf- und zuklappen.
  // Ein Lock älter als eine Minute gilt als Überbleibsel eines abgebrochenen Laufs.
  const LOCK = Symbol.for('copystate.running');
  if (globalThis[LOCK] && Date.now() - globalThis[LOCK] < 60_000) return { busy: true };
  globalThis[LOCK] = Date.now();

  // Dropdowns geben den Fokus teils asynchron an ihren Trigger zurück und scrollen dabei.
  // Deshalb einmal für den ganzen Lauf merken und am Ende wiederherstellen, nicht nur pro Probe.
  const initialFocus = document.activeElement;
  const initialScroll = [window.scrollX, window.scrollY];
  let probed = false;

  try {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // Pollt statt fest zu warten: schnell, wenn die Seite schnell ist, geduldig, wenn sie unter Last steht
    const until = async (cond, ms) => {
      for (const end = Date.now() + ms; !cond() && Date.now() < end; ) await wait(40);
      return cond();
    };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

    // Seitentext ist Fremdinhalt: Markdown-Zeichen escapen, damit er keine Felder, Überschriften oder Links fälscht
    const esc = (s) => String(s).replace(/([\\`*_[\]<>|])/g, '\\$1');
    const neutralizeStart = (s) => s.replace(/^(\s*)(#|>|[-+](?=\s)|\d+[.)](?=\s))/, '$1\\$2');
    const linkTarget = (href) => href.replace(/[()\s]/g, (c) => encodeURIComponent(c));

    const CONTROL = [
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])',
      'select', 'textarea', '[contenteditable=""]', '[contenteditable=true]',
      '[role=combobox]', '[aria-haspopup=listbox]', '[role=listbox]', '[role=switch]', '[role=checkbox]', '[role=radio]',
      '[role=slider]', '[role=spinbutton]', '[role=textbox]', '[role=searchbox]',
    ].join(',');

    // --- Sichtbarkeit -------------------------------------------------------------------------

    // aria-hidden/inert verstecken meist nur Icons. Liegt ein Control darunter (Hintergrund eines
    // offenen Modals), bleibt der Teilbaum lesbar.
    const hiddenByAria = (el) => {
      const h = el.closest('[aria-hidden="true"], [inert]');
      return !!h && !h.querySelector(CONTROL);
    };
    const isRendered = (el) => {
      if (el.closest('[hidden], script, style, template, noscript') || hiddenByAria(el)) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      // display: contents hat nie eigene Rects, sichtbar ist es, wenn der Elternteil es ist
      if (cs.display === 'contents') return el.parentElement ? isRendered(el.parentElement) : true;
      return el.getClientRects().length > 0;
    };
    const visibleCache = new WeakMap();
    const visible = (el) => {
      if (!visibleCache.has(el)) visibleCache.set(el, isRendered(el));
      return visibleCache.get(el);
    };
    // Native Checkbox/Radio per CSS versteckt, das sichtbare Label ist der eigentliche Schalter
    const isToggleInput = (el) => el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type);

    // --- Text ---------------------------------------------------------------------------------

    // Text-Nodes eines Teilbaums, ohne Controls, Icons und optional ohne einen ausgeschlossenen Teilbaum
    const textNodes = (root, exclude, includeHidden = false) => {
      const out = [];
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode()); ) {
        const p = n.parentElement;
        if (!p || (exclude && exclude.contains(n))) continue;
        // nur Controls INNERHALB von root überspringen, sonst wäre eine Option nicht mehr lesbar
        const skip = p.closest('select, textarea, [role=listbox], [role=option], svg, script, style');
        if (skip && skip !== root && root.contains(skip)) continue;
        if (!includeHidden && !visible(p)) continue;
        if (clean(n.textContent)) out.push(n);
      }
      return out;
    };
    const chunks = (root, exclude, includeHidden = false) =>
      textNodes(root, exclude, includeHidden).map((n) => clean(n.textContent));
    const textOf = (node, exclude) => chunks(node, exclude).join(' ');
    const idList = (el, ...attrs) => attrs.flatMap((a) => (el.getAttribute(a) || '').split(/\s+/)).filter(Boolean);
    // Ids gelten im eigenen Tree: im Shadow DOM ist das die ShadowRoot, nicht das Document
    const byId = (el, id) => {
      const root = el.getRootNode();
      return (root.getElementById ? root : document).getElementById(id);
    };
    const byIds = (el, ids) =>
      clean(ids.map((id) => byId(el, id)).filter(Boolean).map((n) => chunks(n, null, true).join(' ')).join(' '));

    // Inline-Code, dessen Fence länger ist als jede Backtick-Folge im Wert
    const code = (value) => {
      const s = String(value);
      const longest = Math.max(0, ...(s.match(/`+/g) || []).map((m) => m.length));
      const fence = '`'.repeat(longest + 1);
      const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
      return `${fence}${pad}${s}${pad}${fence}`;
    };
    // Mehrzeiliger Wert als eingerückter Block, damit Zeilen im Wert keine Felder oder Überschriften fälschen
    const block = (value) => {
      const longest = Math.max(2, ...(value.match(/`+/g) || []).map((m) => m.length));
      const fence = '`'.repeat(longest + 1);
      return [`  ${fence}text`, ...value.split('\n').map((l) => `  ${l}`), `  ${fence}`];
    };

    // --- Privacy ------------------------------------------------------------------------------

    const SENSITIVE_NAME =
      /pass|pwd|otp|(^|[^a-z])pin([^a-z]|$)|pin_?code|cvc|cvv|csc|iban|token|secret|api[-_]?key|card_?num|ccnum|ssn|kennwort/i;
    const SENSITIVE_LABEL =
      /\b(passwor[dt]|kennwort|pin|tan|cvc|cvv|iban|kartennummer|card number|credit card|security code|one-time code|einmalcode)\b/i;
    const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp(-month|-year)?)\b/i;
    const isSensitive = (el, label = '') => {
      if ((el.getAttribute('type') || '').toLowerCase() === 'password') return true;
      if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '')) return true;
      if (SENSITIVE_NAME.test(`${el.getAttribute('name') || ''} ${el.id || ''}`)) return true;
      if (SENSITIVE_LABEL.test(`${label} ${el.getAttribute('placeholder') || ''}`)) return true;
      const security = getComputedStyle(el).webkitTextSecurity;
      return !!security && security !== 'none';
    };
    const SENSITIVE_PARAM = /token|code|key|secret|sig|auth|session|sid|password|otp|jwt|ticket|nonce|state/i;
    // Pfadsegmente, die nach Token aussehen (lang, mindestens 3 Ziffern, kein Wort-Slug)
    const isTokenSegment = (seg) =>
      /^(?=(?:\D*\d){3})[A-Za-z0-9_-]{20,}$/.test(seg) && !/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(seg);
    const redactUrl = (href) => {
      try {
        const u = new URL(href, location.href);
        u.username = '';
        u.password = '';
        for (const k of [...u.searchParams.keys()]) if (SENSITIVE_PARAM.test(k)) u.searchParams.set(k, 'REDACTED');
        u.pathname = u.pathname.split('/').map((seg) => (isTokenSegment(seg) ? 'REDACTED' : seg)).join('/');
        if (/[=&]|token|eyJ/.test(u.hash)) u.hash = '#REDACTED';
        return u.href;
      } catch {
        return href;
      }
    };
    // Titel und URL gehen auch hier durch esc und redactUrl
    const heading = () => `# ${esc(clean(document.title))}\n\nURL: ${redactUrl(location.href)}`;
    if (!document.body) return `${heading()}\n\n_(this document has no HTML body to read, e.g. an image or SVG)_\n`;

    // --- Labels -------------------------------------------------------------------------------

    const consumed = new WeakSet(); // Text, der schon als Label dient und im Fließtext nicht nochmal auftauchen soll
    const hasOtherControl = (container, el) =>
      [...container.querySelectorAll(CONTROL)].some((c) => c !== el && !el.contains(c) && !c.contains(el));

    // Label aus dem Umfeld, wenn das Control keins hat (z. B. Switch neben einer Überschrift).
    // Klettert nur, solange der Container kein anderes Control enthält, sonst wäre es dessen Text.
    const contextLabel = (el) => {
      for (let a = el.parentElement, depth = 0; a && a !== document.body && depth < 6; a = a.parentElement, depth++) {
        if (hasOtherControl(a, el)) return '';
        const nodes = textNodes(a, el);
        if (!nodes.length) continue;
        const own = nodes.map((n) => clean(n.textContent));
        // Kurze Captions wie „Blockieren / Erlauben“: eine Ebene höher nach der eigentlichen Überschrift suchen
        if (own.length >= 2 && own.join(' ').length <= 40 && a.parentElement && !hasOtherControl(a.parentElement, el)) {
          const head = textNodes(a.parentElement, a)[0];
          if (head) {
            [...nodes, head].forEach((n) => consumed.add(n));
            return `${clean(head.textContent)} (${own.join(' / ')})`;
          }
        }
        consumed.add(nodes[0]);
        return own[0].length > 120 ? `${own[0].slice(0, 117)}…` : own[0];
      }
      return '';
    };

    // Der Wert gehört nie in die Kette: bei einem Feld ohne Label stünde er sonst (auch ein Passwort) als Label da.
    // Ohne Selbstverweis: Headless UI hängt die eigene Id an aria-labelledby, das Label wäre sonst „Country Germany“.
    const labelOf = (el) =>
      byIds(el, idList(el, 'aria-labelledby').filter((id) => !byId(el, id)?.contains(el))) ||
      clean(el.getAttribute('aria-label')) ||
      clean([...(el.labels || [])].map((l) => textOf(l, el)).join(' ')) ||
      (el.closest('label') ? textOf(el.closest('label'), el) : '') ||
      contextLabel(el) ||
      clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.id) ||
      '(no label)';

    const isDisabled = (el) => el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
    const meta = (el, kind) => {
      const f = [kind];
      if (el.getAttribute('name') && kind === 'radio') f.push(`group ${code(el.getAttribute('name'))}`);
      if (el.required || el.getAttribute('aria-required') === 'true') f.push('required');
      if (isDisabled(el)) f.push('disabled');
      if (el.readOnly || el.getAttribute('aria-readonly') === 'true') f.push('read-only');
      if (el.getAttribute('aria-invalid') === 'true') f.push('invalid');
      const ph = el.getAttribute('placeholder');
      if (ph) f.push(`placeholder "${esc(clean(ph))}"`);
      for (const a of ['min', 'max', 'step', 'minlength', 'maxlength', 'pattern']) {
        if (el.getAttribute(a)) f.push(`${a} ${esc(el.getAttribute(a))}`);
      }
      return ` _(${f.join(', ')})_`;
    };
    const hintLines = (el) => {
      const h = byIds(el, idList(el, 'aria-describedby'));
      return h ? [`  - _Hint:_ ${esc(h)}`] : [];
    };

    // --- Optionen und Probe -------------------------------------------------------------------

    const isSelected = (o) =>
      o.selected === true ||
      o.getAttribute('aria-selected') === 'true' ||
      o.getAttribute('aria-checked') === 'true' ||
      o.getAttribute('data-state') === 'checked' ||
      /\bselected\b/.test(o.getAttribute('data-headlessui-state') || '');
    const optionLines = (opts) => opts.map((o) => `  - [${o.selected ? 'x' : ' '}] ${esc(o.text)}`);
    const readOptions = (opts) =>
      opts.map((o) => ({ text: chunks(o, null, true).join(' ') || clean(o.getAttribute('aria-label')), selected: isSelected(o) }));

    const fire = (el, type, Ctor, init = {}) =>
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...init }));
    const popupOf = (el) => idList(el, 'aria-controls', 'aria-owns').map((id) => byId(el, id)).filter(Boolean);
    const popupOptions = (el) => popupOf(el).flatMap((p) => [...p.querySelectorAll('[role=option]')]);
    // ohne Cache: dieselbe Option ist vor dem Öffnen unsichtbar und danach sichtbar
    const isShown = (o) => o.isConnected && o.getClientRects().length > 0 && getComputedStyle(o).visibility !== 'hidden';
    const shownOptions = () => [...document.querySelectorAll('[role=option]')].filter(isShown);
    const isOpen = (el) => el.getAttribute('aria-expanded') === 'true' || popupOptions(el).some(isShown);

    // Während des Probes darf ein Klick weder ein Formular absenden noch einen Link öffnen
    const blockSubmit = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const blockLinks = (e) => {
      if (e.target?.closest?.('a[href]')) e.preventDefault();
    };

    let budgetExhausted = false;
    const NOT_OPENED = Symbol('not opened');

    // Öffnet ein Custom Dropdown auf drei Wegen (click, pointerdown, Tastatur), liest die Optionen, schließt es wieder.
    // Rückgabe: Optionen, [] wenn es sich nicht öffnen ließ, null wenn das Zeitbudget aufgebraucht ist,
    // NOT_OPENED wenn das Öffnen ausgeschaltet ist.
    const probe = async (el) => {
      const present = popupOptions(el);
      if (present.length) return readOptions(present); // Listbox liegt schon im DOM, kein Öffnen nötig
      if (isDisabled(el)) return [];
      if (!PROBE) return NOT_OPENED;
      if (Date.now() > deadline) {
        budgetExhausted = true;
        return null;
      }

      probed = true;
      const before = new Set(shownOptions());
      const prevFocus = document.activeElement;
      const { scrollX, scrollY } = window;
      const found = () => {
        const own = popupOptions(el).filter(isShown);
        return own.length ? own : shownOptions().filter((o) => !before.has(o));
      };
      // Auch Dropdowns ohne aria-expanded/aria-controls gelten als offen, solange neue Optionen sichtbar sind
      const stillOpen = () => isOpen(el) || shownOptions().some((o) => !before.has(o));
      const attempts = [
        () => el.click(),
        () => {
          fire(el, 'pointerdown', PointerEvent, { pointerType: 'mouse' });
          fire(el, 'mousedown', MouseEvent);
          fire(el, 'pointerup', PointerEvent, { pointerType: 'mouse' });
          fire(el, 'mouseup', MouseEvent);
        },
        () => {
          el.focus({ preventScroll: true });
          fire(el, 'keydown', KeyboardEvent, { key: 'ArrowDown', code: 'ArrowDown' });
        },
      ];

      document.addEventListener('submit', blockSubmit, true);
      document.addEventListener('click', blockLinks, true);
      let result = [];
      let openedBy = -1;
      try {
        for (const [i, attempt] of attempts.entries()) {
          attempt();
          await until(() => found().length || stillOpen(), 400);
          if (!found().length && stillOpen()) await until(() => found().length, 500); // offen, Optionen kommen noch
          const opts = found();
          if (opts.length || stillOpen()) openedBy = i;
          if (opts.length) {
            result = readOptions(opts);
            break;
          }
          if (openedBy >= 0) break; // offen ohne Optionen: nicht mit dem nächsten Versuch wieder zuklappen
        }
      } finally {
        try {
          // Bibliotheken schließen auf verschiedenen Wegen, deshalb der Reihe nach, bis es zu ist.
          // Escape erreicht Trigger, Popup und React-Root, wird aber am body gestoppt: Handler am document oder
          // window (typisch für Modals) sehen es nicht und schließen deshalb nicht das umgebende Modal.
          const escape = (target) => {
            const stop = (e) => e.stopPropagation();
            document.body.addEventListener('keydown', stop);
            try {
              fire(target, 'keydown', KeyboardEvent, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
            } finally {
              document.body.removeEventListener('keydown', stop);
            }
          };
          const fresh = () => shownOptions().filter((o) => !before.has(o));
          const closers = [
            () => (openedBy === 0 ? el.click() : false),
            () => void escape(el),
            () => {
              // Fokus ist ins Popup gewandert (MUI): dort hört die Bibliothek auf Escape, nicht am Trigger.
              // Nur ein Element im Popup selbst, nie das Feld, in dem der User vorher stand.
              const active = document.activeElement;
              const popups = [...popupOf(el), ...fresh().map((o) => o.closest('[role=listbox], [role=menu]') || o)];
              const inPopup = active && active !== prevFocus && active !== el && popups.some((p) => p.contains(active));
              const target = inPopup ? active : fresh()[0];
              return target ? void escape(target) : false;
            },
            () => {
              // Click-outside auf ein leeres Hilfselement: im Dialog bleiben und nie den Dialog selbst treffen,
              // sonst greift das Backdrop-Muster (Klick mit target === dialog schließt das Modal)
              const host = el.closest('dialog, [role=dialog], [aria-modal=true]') || document.body;
              const spot = document.createElement('div');
              spot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
              host.append(spot);
              try {
                fire(spot, 'pointerdown', PointerEvent, { pointerType: 'mouse' });
                fire(spot, 'mousedown', MouseEvent);
                fire(spot, 'pointerup', PointerEvent, { pointerType: 'mouse' });
                fire(spot, 'mouseup', MouseEvent);
                spot.click();
              } finally {
                spot.remove();
              }
            },
            () => {
              const field = innerField(el) || el;
              fire(field, 'blur', FocusEvent, { bubbles: false });
              fire(field, 'focusout', FocusEvent);
            },
            () => (openedBy !== 0 ? el.click() : false), // Toggle, der weder Escape noch Klick außerhalb kennt
          ];
          for (const close of closers) {
            if (!stillOpen()) break;
            if (close() === false) continue; // Weg passt nicht zu diesem Dropdown
            await until(() => !stillOpen(), 250);
          }
          if (prevFocus && prevFocus !== document.activeElement && prevFocus.focus) prevFocus.focus({ preventScroll: true });
          else if (!prevFocus || prevFocus === document.body) el.blur?.();
          window.scrollTo(scrollX, scrollY);
        } finally {
          document.removeEventListener('submit', blockSubmit, true);
          document.removeEventListener('click', blockLinks, true);
        }
      }
      return result;
    };

    // --- Controls -----------------------------------------------------------------------------

    const done = new WeakSet();
    const labels = new Map(); // vorab berechnet, damit Kontext-Text schon vor dem Durchlauf als verbraucht gilt

    const isComboLike = (el) => el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox';
    const innerField = (el) => el.querySelector('input, textarea');
    const rangeValue = (el) => el.getAttribute('aria-valuetext') ?? el.getAttribute('aria-valuenow');
    const isChecked = (el) =>
      'checked' in el && (el.type === 'checkbox' || el.type === 'radio')
        ? el.checked
        : el.getAttribute('aria-checked') === 'true' || isSelected(el);

    const valueOf = (el) => {
      if (isComboLike(el)) {
        const field = 'value' in el && el.tagName !== 'BUTTON' ? el : innerField(el);
        return clean(field?.value ?? '') || textOf(el);
      }
      if (el.isContentEditable) return el.innerText ?? el.textContent;
      if ('value' in el && el.tagName !== 'BUTTON') return el.value ?? '';
      return rangeValue(el) ?? '';
    };

    const controlLines = async (el, label = labels.get(el) || labelOf(el)) => {
      done.add(el);
      const inner = innerField(el);
      if (inner) done.add(inner);
      const role = el.getAttribute('role');
      const type = (el.getAttribute('type') || '').toLowerCase();
      const name = `**${esc(label)}**`;

      if (isComboLike(el)) {
        const current = isSensitive(inner || el, label) ? '[redacted]' : valueOf(el);
        const opts = await probe(el);
        // Der Text "dropdown not opened" ist Vertrag: das Popup zählt daran die noch ungelesenen Dropdowns
        const missing = opts === NOT_OPENED
          ? '  - _(options not read: dropdown not opened)_'
          : opts === null
            ? '  - _(options not read: time budget for opening dropdowns used up)_'
            : '  - _(options not readable: the dropdown did not open via script)_';
        return [
          `- ${name}: ${current ? code(current) : '_(empty)_'}${meta(el, 'dropdown')}`,
          ...hintLines(el),
          ...(Array.isArray(opts) && opts.length ? optionLines(opts) : [missing]),
        ];
      }
      if (el.tagName === 'SELECT') {
        const opts = [...el.options].map((o) => ({ text: clean(o.textContent), selected: o.selected }));
        return [`- ${name}${meta(el, el.multiple ? 'multi-select' : 'select')}`, ...hintLines(el), ...optionLines(opts)];
      }
      if (type === 'radio' || role === 'radio') {
        return [`- (${isChecked(el) ? '•' : ' '}) ${name}${meta(el, 'radio')}`, ...hintLines(el)];
      }
      if (type === 'checkbox' || role === 'checkbox' || role === 'switch') {
        return [`- [${isChecked(el) ? 'x' : ' '}] ${name}${meta(el, role === 'switch' ? 'switch' : 'checkbox')}`, ...hintLines(el)];
      }
      if (role === 'listbox') {
        return [`- ${name}${meta(el, 'listbox')}`, ...hintLines(el), ...optionLines(readOptions([...el.querySelectorAll('[role=option]')]))];
      }
      const kind = el.tagName === 'TEXTAREA' ? 'textarea' : type || role || 'text';
      const raw = String(valueOf(el) ?? '');
      if (isSensitive(el, label)) return [`- ${name}: ${raw ? '`[redacted]`' : '_(empty)_'}${meta(el, kind)}`, ...hintLines(el)];
      if (raw.includes('\n')) return [`- ${name}:${meta(el, kind)}`, ...hintLines(el), ...block(raw)];
      return [`- ${name}: ${raw ? code(raw) : '_(empty)_'}${meta(el, kind)}`, ...hintLines(el)];
    };

    // Kurzform für Controls in Tabellenzellen; Pipes würden die Tabelle zerschneiden
    const inlineValue = (el) => {
      done.add(el);
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = el.getAttribute('role');
      if (type === 'radio' || role === 'radio') return isChecked(el) ? '(•)' : '( )';
      if (type === 'checkbox' || role === 'checkbox' || role === 'switch') return isChecked(el) ? '[x]' : '[ ]';
      if (el.tagName === 'SELECT') return code([...el.selectedOptions].map((o) => clean(o.textContent)).join(', ')).replace(/\|/g, '\\|');
      if (isSensitive(el, labelOf(el))) return '`[redacted]`';
      const v = clean(String(valueOf(el) ?? ''));
      return v ? code(v).replace(/\|/g, '\\|') : '_(empty)_';
    };

    const cellText = (cell) => {
      const controls = [...cell.querySelectorAll(CONTROL)].filter(visible);
      return [esc(textOf(cell)), ...controls.map(inlineValue)].filter(Boolean).join(' ');
    };
    const tableLines = (table) => {
      const rows = [...table.rows].filter(visible);
      // Vue/React erzeugen auch <thead><th> ohne <tr>; der HTML-Parser würde das <tr> ergänzen, das DOM-API nicht
      const headCells = table.tHead ? [...table.tHead.querySelectorAll('th, td')] : [];
      const headRow = headCells.length ? null : [...(rows[0]?.cells || [])].every((c) => c.tagName === 'TH') ? rows[0] : null;
      const header = headCells.length ? headCells.map(cellText) : headRow ? [...headRow.cells].map(cellText) : [];
      const body = rows.filter((r) => r !== headRow && !table.tHead?.contains(r)).map((r) => [...r.cells].map(cellText));
      const width = Math.max(header.length, ...body.map((r) => r.length), 0);
      if (!width) return [];
      const pad = (r) => [...r, ...Array(width - r.length).fill('')];
      return [`| ${pad(header).join(' | ')} |`, `|${' --- |'.repeat(width)}`, ...body.map((r) => `| ${pad(r).join(' | ')} |`)];
    };

    // --- Durchlauf ----------------------------------------------------------------------------

    const main = WHOLE_PAGE ? null : [...document.querySelectorAll('main, [role=main]')].find(visible);
    const roots = main
      ? [main, ...[...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]')]
        .filter((d) => !main.contains(d) && visible(d))]
        .filter((d, i, all) => !all.some((o, j) => j !== i && o.contains(d) && o !== d))
      : [document.body];

    const allControls = roots.flatMap((r) => [...r.querySelectorAll(CONTROL)]).filter((c) => visible(c) || isToggleInput(c));
    const labelIds = new Set(allControls.flatMap((c) => idList(c, 'aria-labelledby', 'aria-describedby')));
    // Nur Popups überspringen, deren Optionen controlLines tatsächlich ausgibt
    const popupIds = new Set(allControls.filter(isComboLike).flatMap((c) => idList(c, 'aria-controls', 'aria-owns')));
    const skipElement = (el) =>
      !!el.id &&
      ((labelIds.has(el.id) && !el.matches(CONTROL) && !el.querySelector(CONTROL)) ||
        (popupIds.has(el.id) && el.matches('[role=listbox], [role=menu]')));

    for (const c of allControls) {
      try {
        labels.set(c, labelOf(c));
      } catch {
        // Label wird dann beim Rendern noch einmal versucht
      }
    }
    // Sichtbare <label> ohne Zuordnung, deren Text schon als Label eines Controls erscheint (aria-label-Dopplung)
    const labelTexts = new Set(labels.values());

    const out = [];
    let buf = [];
    const push = (line) => out.push(line);
    const flush = () => {
      const t = clean(buf.join(' '));
      buf = [];
      if (t) push(neutralizeStart(t));
    };
    const safe = async (el, render) => {
      try {
        (await render()).forEach(push);
      } catch (err) {
        push(`- **${esc(labels.get(el) || el.tagName.toLowerCase())}** _(could not be read: ${esc(clean(String(err?.message || err)))})_`);
      }
    };
    // Controls in Überschriften, Legends, Summaries und Links, deren Text sonst nur als Text erschiene
    const nestedControls = async (el) => {
      for (const c of el.querySelectorAll(CONTROL)) {
        if (!done.has(c) && (visible(c) || isToggleInput(c))) await safe(c, () => controlLines(c));
      }
    };

    const walk = async (node) => {
      const assigned = node.tagName === 'SLOT' ? node.assignedNodes({ flatten: true }) : [];
      for (const child of assigned.length ? assigned : [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (!consumed.has(child) && child.parentElement && visible(child.parentElement)) buf.push(esc(child.textContent));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const el = child;
        if (el.matches('svg, script, style, template, noscript') || done.has(el) || skipElement(el)) continue;

        if (el.tagName === 'LABEL') {
          const ctrl = el.control;
          if (ctrl && done.has(ctrl)) continue;
          if (ctrl && (visible(ctrl) || isToggleInput(ctrl)) && visible(el)) {
            flush();
            await safe(ctrl, () => controlLines(ctrl, textOf(el, ctrl) || labels.get(ctrl) || labelOf(ctrl)));
            continue;
          }
          if (!ctrl && labelTexts.has(textOf(el))) continue;
        }
        if (!visible(el)) continue;

        if (el.tagName === 'IFRAME') {
          flush();
          push(`_(embedded frame not read: ${esc(redactUrl(el.src || 'about:blank'))})_`);
          continue;
        }
        if (el.matches(CONTROL)) {
          flush();
          await safe(el, () => controlLines(el));
          continue;
        }
        if (el.matches('h1, h2, h3, h4, h5, h6, [role=heading], legend')) {
          flush();
          const level = el.tagName === 'LEGEND' ? 4 : Number(el.getAttribute('aria-level') || el.tagName.slice(1)) || 3;
          const text = textOf(el);
          if (text) push(`${'#'.repeat(Math.min(Math.max(level, 2), 6))} ${esc(text)}`);
          await nestedControls(el);
          continue;
        }
        if (el.tagName === 'TABLE') {
          flush();
          await safe(el, () => tableLines(el));
          continue;
        }
        if (el.matches('[role=tablist]')) {
          flush();
          const tabs = [...el.querySelectorAll('[role=tab]')].filter(visible)
            .map((t) => (t.getAttribute('aria-selected') === 'true' ? `**${esc(textOf(t))}** (active)` : esc(textOf(t))));
          push(`Tabs: ${tabs.join(' · ')}`);
          continue;
        }
        if (el.matches('details:not([open])')) {
          flush();
          const summary = el.querySelector('summary');
          push(`- ▸ ${summary ? esc(textOf(summary)) : 'Details'} _(collapsed, content not read)_`);
          if (summary) await nestedControls(summary);
          continue;
        }
        if (el.matches('button, [role=button], input[type=submit], input[type=button], input[type=reset]')) {
          const link = el.querySelector('a[href]');
          const text = clean(textOf(el) || el.value || el.getAttribute('aria-label'));
          if (!text) continue;
          flush();
          const flags = [];
          if (isDisabled(el)) flags.push('disabled');
          if (el.getAttribute('aria-expanded') === 'false') flags.push('collapsed');
          if (el.type === 'submit') flags.push('submit');
          push(link
            ? `[${esc(text)}](${linkTarget(redactUrl(link.href))})`
            : `[Button: ${esc(text)}]${flags.length ? ` _(${flags.join(', ')})_` : ''}`);
          continue;
        }
        if (el.tagName === 'A' && el.getAttribute('href')) {
          const text = textOf(el);
          if (text) buf.push(`[${esc(text)}](${linkTarget(redactUrl(el.href))})`);
          if (el.querySelector(CONTROL)) {
            flush();
            await nestedControls(el);
          }
          continue;
        }
        const display = getComputedStyle(el).display;
        const isBlock = !display.startsWith('inline') && display !== 'contents';
        if (isBlock) flush();
        await walk(el.shadowRoot || el);
        if (isBlock) flush();
      }
    };

    for (const [i, root] of roots.entries()) {
      if (i > 0) {
        flush();
        const name = byIds(root, idList(root, 'aria-labelledby')) || clean(root.getAttribute('aria-label')) || 'Dialog';
        push(`## Dialog: ${esc(name)}`);
      }
      await walk(root);
      flush();
    }

    const outside = [...document.querySelectorAll(CONTROL)].filter((c) => visible(c) && !roots.some((r) => r.contains(c))).length;
    if (outside) push(`_(${outside} field(s) outside the main content were not read, e.g. header search or sidebar)_`);
    if (budgetExhausted) push('_(time budget for opening dropdowns used up, some options were not read)_');

    const isItem = (l) => /^(\s+|- |\| )/.test(l);
    const body = out.reduce((acc, line, i) => acc + (i === 0 ? '' : isItem(line) && isItem(out[i - 1]) ? '\n' : '\n\n') + line, '');
    return `${heading()}\n\n${body}\n`;
  } finally {
    if (probed) {
      await new Promise((r) => setTimeout(r, 100));
      const active = document.activeElement;
      if (!initialFocus || initialFocus === document.body) active?.blur?.(); // Trigger holen sich den Fokus teils spät zurück
      else if (initialFocus !== active && initialFocus.focus) initialFocus.focus({ preventScroll: true });
      window.scrollTo(...initialScroll);
    }
    delete globalThis[LOCK];
  }
}
