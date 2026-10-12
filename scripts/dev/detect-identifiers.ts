/**
 * Detektor für fremdsprachige Bezeichner -- liest AUSSCHLIESSLICH Deklarationsnamen aus dem
 * AST, nie Kommentare und nie String-Literale. Damit ist er der Messpunkt und später das
 * Gate für "Code ist immer englisch" (oder welche Sprache das Projekt festlegt).
 *
 *   bun detect-identifiers.ts                      # voller Lauf, Markdown-Bericht auf stdout
 *   bun detect-identifiers.ts --json out.json      # voller Bericht als JSON (das liest ein Gate)
 *   bun detect-identifiers.ts --files a.ts b.vue   # nur diese Dateien, Exit 1 bei Treffern
 *   bun detect-identifiers.ts --dump-all --json x  # JEDER Bezeichner (Recall-Gegenprobe)
 *   bun detect-identifiers.ts --baseline-write     # Baseline neu schreiben
 *
 * KONFIGURATION: `.mass-rename.json` im Repo-Wurzelverzeichnis (oder --config <pfad>):
 *   {
 *     "roots":     ["apps/*", "packages/*", "scripts"],   // Globs eine Ebene tief
 *     "skipDirs":  ["node_modules", "dist", "fixtures"],
 *     "words":     "scripts/dev/foreign-words.json",      // { "words": ["versatz", ...] }
 *     "allow":     "scripts/dev/foreign-identifiers.allow.json",
 *     "baseline":  "scripts/dev/foreign-identifiers.baseline.json",
 *     "translitUmlaut": true                              // ae/oe/ue als Signal (deutsch)
 *   }
 *
 * DIE ZAHL IST EINE UNTERGRENZE. Die Wortliste kennt, was jemand eingetragen hat --
 * `--dump-all` plus ein Wörterbuchabgleich ist die einzige ehrliche Gegenprobe (siehe
 * SKILL.md, Schritt 1).
 */
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname, extname } from 'node:path'

const argv = process.argv.slice(2)
const arg = (flag: string, fallback = '') => {
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback
}
const REPO = arg('--repo', process.cwd())
const CONFIG_PATH = arg('--config', join(REPO, '.mass-rename.json'))
type Config = {
  roots: string[]
  skipDirs: string[]
  words: string
  allow: string
  baseline: string
  translitUmlaut: boolean
  exts: string[]
}
const defaults: Config = {
  roots: ['src'],
  skipDirs: ['node_modules', '.git', 'dist', 'build', '.nuxt', '.output', 'generated', '_generated',
    '.turbo', 'coverage', '.wrangler', 'fixtures', '__snapshots__', 'vendor'],
  words: '',
  allow: '',
  baseline: '',
  translitUmlaut: false,
  exts: ['.ts', '.tsx', '.mts', '.cts', '.vue', '.mjs', '.js'],
}
const cfg: Config = { ...defaults, ...(existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : {}) }
const EXTS = new Set(cfg.exts)
const SKIP_DIRS = new Set(cfg.skipDirs)
const DUMP_ALL = argv.includes('--dump-all')

const WORDS: Set<string> = new Set(
  cfg.words && existsSync(join(REPO, cfg.words))
    ? (JSON.parse(readFileSync(join(REPO, cfg.words), 'utf8')).words as string[])
    : [],
)
type Allow = Record<string, string>
const allowRaw: Allow = cfg.allow && existsSync(join(REPO, cfg.allow))
  ? JSON.parse(readFileSync(join(REPO, cfg.allow), 'utf8'))
  : {}
/** Der Schlüssel `//` trägt den Kopftext (JSON kennt keine Kommentare), keine Ausnahme. */
export const allow: Allow = Object.fromEntries(Object.entries(allowRaw).filter(([k]) => !k.startsWith('//')))

// ---------------------------------------------------------------- Heuristik

function splitSegments(name: string): string[] {
  return name
    .replace(/[_\-.$]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean)
}

/**
 * Umlaut-Transliteration als stammunabhängiges Signal (nur mit translitUmlaut). `que`/`gue`
 * und ein wortfinales `ue` sind ausgenommen: query, request, sequence, queue, value, true,
 * unique tragen die Buchstabenfolge, ohne deutsch zu sein.
 */
const TRANSLIT_SAFE = new Set([
  'fuel', 'fuels', 'cruel', 'duel', 'duet', 'fluent', 'influence', 'bluetooth', 'suede', 'does',
  'goes', 'shoe', 'shoes', 'toe', 'toes', 'coerce', 'phoenix', 'oem', 'poet', 'noes', 'caesar',
  'aesthetic', 'aeon', 'daemon', 'daemons', 'aes', 'ae', 'oe', 'ue', 'uefi', 'enoent',
])
function hasTranslitUmlaut(seg: string): boolean {
  if (TRANSLIT_SAFE.has(seg)) return false
  if (/ae|oe/.test(seg)) return true
  return /(?<![qg])ue(?![sd]?$)/.test(seg)
}

function isForeignSegment(seg: string): boolean {
  if (DUMP_ALL) return seg.length >= 3
  if (seg.length < 3) return false
  if (/[äöüßéèêàçñ]/.test(seg)) return true
  if (cfg.translitUmlaut && hasTranslitUmlaut(seg)) return true
  return WORDS.has(seg)
}
const foreignSegments = (name: string) => splitSegments(name).filter(isForeignSegment)

// ---------------------------------------------------------------- Dateien

function expandRoot(pattern: string): string[] {
  if (!pattern.includes('*')) {
    if (!existsSync(join(REPO, pattern))) throw new Error(`Wurzel gibt es nicht: ${pattern}`)
    return [pattern]
  }
  const [head, ...rest] = pattern.split('*')
  const base = join(REPO, head)
  if (!existsSync(base)) return []
  return readdirSync(base)
    .map((e) => join(head, e, rest.join('*')).replace(/\/+/g, '/'))
    .filter((p) => existsSync(join(REPO, p)))
}
function walk(dir: string, out: string[]): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.has(extname(entry)) && !entry.endsWith('.d.ts')) out.push(full)
  }
}

// ---------------------------------------------------------------- AST

type Kind = 'function' | 'variable' | 'parameter' | 'class' | 'interface' | 'typeAlias' | 'enum'
  | 'enumMember' | 'property' | 'method' | 'file'
export type Hit = { file: string; pkg: string; name: string; kind: Kind; line: number; exported: boolean; segments: string[] }

/** .vue: nur die <script>-Blöcke; das Template trägt keine Deklarationen. */
function scriptOf(file: string, text: string): { text: string; offset: number } {
  if (!file.endsWith('.vue')) return { text, offset: 0 }
  const parts: string[] = []
  let offset = 0
  const re = /<script(?:"[^"]*"|'[^']*'|[^>])*>([\s\S]*?)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (parts.length === 0) offset = text.slice(0, m.index).split('\n').length - 1
    parts.push(m[1]!)
  }
  return { text: parts.join('\n'), offset }
}

/**
 * Teuer (`exported`) ist ein Name nur, wenn ihn jemand ANDERES liest. Alles in einem
 * Funktionsrumpf ist lokal, auch in einer exportierten Funktion; Parameter sind immer lokal
 * (sie stehen positionell, kein Aufrufer nennt ihren Namen).
 */
function isExportedNode(node: ts.Node): boolean {
  if (ts.isParameter(node)) return false
  let cur: ts.Node | undefined = node
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isFunctionLike(cur) && cur !== node) return false
    const flags = ts.canHaveModifiers(cur) ? ts.getCombinedModifierFlags(cur as ts.Declaration) : 0
    if (flags & ts.ModifierFlags.Export) return true
    cur = cur.parent
  }
  return false
}

function collect(file: string, rel: string, pkg: string, hits: Hit[], allowUsed: Record<string, number>): boolean {
  const raw = readFileSync(file, 'utf8')
  const { text, offset } = scriptOf(file, raw)
  if (!text.trim()) return true
  const sf = ts.createSourceFile(file.replace(/\.vue$/, '.ts'), text, ts.ScriptTarget.Latest, true)
  // createSourceFile wirft NIE -- es erholt sich still und liefert einen halben Baum. Ohne
  // diese Prüfung zählt eine kaputte Datei einfach weniger Treffer, ohne Warnung.
  const parseErrors = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []

  const push = (nameNode: ts.Node | undefined, kind: Kind, decl: ts.Node) => {
    if (!nameNode || (!ts.isIdentifier(nameNode) && !ts.isPrivateIdentifier(nameNode))) return
    const name = nameNode.text
    const segs = foreignSegments(name)
    if (segs.length === 0) return
    const key = allow[`${rel}:${name}`] !== undefined ? `${rel}:${name}` : allow[name] !== undefined ? name : undefined
    if (key !== undefined) { allowUsed[key] = (allowUsed[key] ?? 0) + 1; return }
    const line = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1 + offset
    hits.push({ file: rel, pkg, name, kind, line, exported: isExportedNode(decl), segments: segs })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) push(node.name, 'function', node)
    else if (ts.isClassDeclaration(node)) push(node.name, 'class', node)
    else if (ts.isInterfaceDeclaration(node)) push(node.name, 'interface', node)
    else if (ts.isTypeAliasDeclaration(node)) push(node.name, 'typeAlias', node)
    else if (ts.isEnumDeclaration(node)) push(node.name, 'enum', node)
    else if (ts.isEnumMember(node)) push(node.name, 'enumMember', node)
    else if (ts.isVariableDeclaration(node)) push(node.name, 'variable', node)
    else if (ts.isBindingElement(node)) push(node.name, 'variable', node)
    else if (ts.isParameter(node)) push(node.name, 'parameter', node)
    else if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) push(node.name, 'property', node)
    else if (ts.isPropertyAssignment(node)) push(node.name, 'property', node)
    else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) push(node.name, 'method', node)
    ts.forEachChild(node, visit)
  }
  visit(sf)

  const base = basename(rel).replace(/\.(test|spec)\./, '.').replace(/\.[a-z]+$/, '')
  const fileSegs = foreignSegments(base)
  if (fileSegs.length > 0) {
    const key = allow[`${rel}:${base}`] !== undefined ? `${rel}:${base}` : allow[base] !== undefined ? base : undefined
    if (key !== undefined) allowUsed[key] = (allowUsed[key] ?? 0) + 1
    else hits.push({ file: rel, pkg, name: base, kind: 'file', line: 0, exported: true, segments: fileSegs })
  }
  return parseErrors.length === 0
}

export type Report = {
  generatedAt: string; filesScanned: number; filesByRoot: Record<string, number>
  words: number; unreadable: string[]; allowUsed: Record<string, number>
  totals: { hits: number; exported: number; local: number; files: number }
  byPackage: Record<string, { total: number; exported: number; local: number; files: number }>
  byKind: Record<string, number>; hits: Hit[]
}

const pkgOf = (rel: string) => {
  const parts = rel.split('/')
  return parts.length > 1 && /^(apps|packages|libs)$/.test(parts[0]!) ? parts.slice(0, 2).join('/') : parts[0]!
}

export function scan(roots: readonly string[] = cfg.roots): Report {
  const expanded = roots.flatMap(expandRoot)
  const hits: Hit[] = []; const filesByRoot: Record<string, number> = {}
  const allowUsed: Record<string, number> = {}; const unreadable: string[] = []
  let filesScanned = 0
  for (const root of expanded) {
    const files: string[] = []
    walk(join(REPO, root), files)
    filesByRoot[root] = files.length
    for (const f of files) {
      const rel = relative(REPO, f)
      filesScanned++
      try { if (!collect(f, rel, pkgOf(rel), hits, allowUsed)) unreadable.push(rel) }
      catch (err) { unreadable.push(`${rel} (${(err as Error).message})`) }
    }
  }
  const byPkg = new Map<string, { total: number; exported: number; local: number; files: Set<string> }>()
  for (const h of hits) {
    const e = byPkg.get(h.pkg) ?? { total: 0, exported: 0, local: 0, files: new Set<string>() }
    e.total++; h.exported ? e.exported++ : e.local++; e.files.add(h.file); byPkg.set(h.pkg, e)
  }
  const exported = hits.filter((h) => h.exported).length
  return {
    generatedAt: new Date().toISOString(), filesScanned, filesByRoot, words: WORDS.size, unreadable, allowUsed,
    totals: { hits: hits.length, exported, local: hits.length - exported, files: new Set(hits.map((h) => h.file)).size },
    byPackage: Object.fromEntries([...byPkg.entries()].sort((a, b) => b[1].total - a[1].total)
      .map(([k, v]) => [k, { total: v.total, exported: v.exported, local: v.local, files: v.files.size }])),
    byKind: Object.fromEntries([...hits.reduce((m, h) => m.set(h.kind, (m.get(h.kind) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])),
    hits,
  }
}

/** Eine oder wenige Dateien -- der Modus für pre-commit und Editor-Hook (~50 ms). */
export function scanFiles(paths: readonly string[]): { hits: Hit[]; unreadable: string[]; scanned: number } {
  const hits: Hit[] = []; const unreadable: string[] = []; const allowUsed: Record<string, number> = {}
  const roots = cfg.roots.flatMap(expandRoot)
  let scanned = 0
  for (const p of paths) {
    const abs = p.startsWith('/') ? p : join(REPO, p)
    const rel = relative(REPO, abs)
    if (rel.startsWith('..') || !EXTS.has(extname(rel)) || rel.endsWith('.d.ts')) continue
    if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue
    if (!roots.some((r) => rel === r || rel.startsWith(`${r}/`)) || !existsSync(abs)) continue
    scanned++
    try { if (!collect(abs, rel, pkgOf(rel), hits, allowUsed)) unreadable.push(rel) }
    catch (err) { unreadable.push(`${rel} (${(err as Error).message})`) }
  }
  return { hits, unreadable, scanned }
}

export function baselineFrom(r: Report) {
  return {
    note: 'Bestand 0 ist das Ziel. filesByRoot und words belegen, dass der Detektor noch genauso viel SIEHT.',
    generatedAt: r.generatedAt.slice(0, 10),
    packages: Object.fromEntries(Object.entries(r.byPackage).map(([k, v]) => [k, { total: v.total, exported: v.exported }])),
    files: [...new Set(r.hits.map((h) => h.file))].sort(),
    filesByRoot: r.filesByRoot, words: r.words, allowUsed: r.allowUsed,
  }
}
export const BASELINE_PATH = cfg.baseline ? join(REPO, cfg.baseline) : ''
export function loadBaseline(path = BASELINE_PATH) { return JSON.parse(readFileSync(path, 'utf8')) }

function renderMarkdown(r: Report, topN = 30): string {
  const rows = (o: Record<string, any>, cols: string[]) =>
    Object.entries(o).map(([k, v]) => `| \`${k}\` | ${cols.map((c) => (typeof v === 'number' ? v : v[c])).join(' | ')} |`).join('\n')
  const byFile = new Map<string, number>()
  for (const h of r.hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
  return [
    `# Fremdsprachige Bezeichner — Messung ${r.generatedAt}`, '',
    `Dateien gelesen: ${r.filesScanned} · Treffer: ${r.totals.hits} (exportiert ${r.totals.exported}, lokal ${r.totals.local}) in ${r.totals.files} Dateien`, '',
    '## Je Paket', '', '| Paket | Treffer | exportiert | lokal | Dateien |', '| --- | --: | --: | --: | --: |',
    rows(r.byPackage, ['total', 'exported', 'local', 'files']), '',
    '## Je Art', '', '| Art | Treffer |', '| --- | --: |', rows(r.byKind, ['']), '',
    `## Top ${topN} Dateien`, '', '| Datei | Treffer |', '| --- | --: |',
    [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([f, n]) => `| \`${f}\` | ${n} |`).join('\n'), '',
  ].join('\n')
}

const HELP = `Detektor für fremdsprachige Bezeichner (Deklarationsnamen aus dem AST, nie Prosa).

  bun detect-identifiers.ts [optionen]

  --repo <pfad>      Repo-Wurzel (Vorgabe: aktuelles Verzeichnis)
  --config <pfad>    Vorgabe: <repo>/.mass-rename.json
  --files <p...>     NUR diese Dateien messen (pre-commit, Editor-Hook). Exit 1 bei Treffern.
  --json <pfad>      vollen Bericht als JSON schreiben (das liest ein Gate)
  --dump-all         Gegenprobe: JEDER Bezeichner ab 3 Zeichen (Recall messen)
  --baseline-write   Baseline neu schreiben
  --top <n>          Länge der Top-Dateien-Tabelle (Vorgabe 30)
  --help             dieser Text

Exit 0 = gemessen, 1 = Treffer (nur mit --files), 2 = NICHT gemessen (fehlende Wurzel,
Parse-Fehler). Ein stiller Minderbefund ist der Fehler, den dieser Exit-Code verhindert.`

if (import.meta.main) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    process.exit(0)
  }
  const files = argv.reduce<string[]>((acc, a, i) => (a === '--files' ? [...acc, ...argv.slice(i + 1).filter((x) => !x.startsWith('--'))] : acc), [])
  if (files.length > 0) {
    const { hits, unreadable, scanned } = scanFiles(files)
    for (const h of hits) console.error(`${h.file}:${h.line}  ${h.kind} ${h.name}  (fremd: ${h.segments.join(', ')})`)
    if (unreadable.length > 0) { console.error(`NICHT gemessen: ${unreadable.join(', ')}`); process.exit(2) }
    if (hits.length > 0) {
      console.error(`\n${hits.length} fremdsprachige(r) Bezeichner in ${scanned} geprüften Datei(en).`)
      console.error('Code ist immer englisch. Prosa in Kommentaren und Strings bleibt, wie sie ist.')
      console.error(`Ein echter Fehlbefund gehört in ${cfg.allow || 'die Allowlist'}, mit Begründung.`)
      process.exit(1)
    }
    process.exit(0)
  }
  let report: Report
  try { report = scan() } catch (err) { console.error((err as Error).message); process.exit(2) }
  const jsonOut = arg('--json')
  if (jsonOut) { mkdirSync(dirname(jsonOut), { recursive: true }); writeFileSync(jsonOut, JSON.stringify(report, null, 2)) }
  if (argv.includes('--baseline-write')) {
    if (!BASELINE_PATH) { console.error('keine baseline in der Konfiguration'); process.exit(2) }
    writeFileSync(BASELINE_PATH, JSON.stringify(baselineFrom(report), null, 2) + '\n')
    console.log(`Baseline geschrieben: ${relative(REPO, BASELINE_PATH)}`)
  }
  console.log(renderMarkdown(report, Number(arg('--top', '30'))))
  if (report.unreadable.length > 0) {
    console.error(`NICHT gemessen: ${report.unreadable.length} Datei(en) mit Parse-Fehlern:`)
    for (const f of report.unreadable.slice(0, 20)) console.error(`  ${f}`)
    process.exit(2)
  }
}
