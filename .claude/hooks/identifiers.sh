#!/usr/bin/env bash
# PostToolUse-Hook (Edit|Write|MultiEdit): meldet einen fremdsprachigen Bezeichner
# in der Sekunde, in der die Datei geschrieben wird. Der Hook kennt die Sprache
# des Auftrags nicht, das ist der Punkt.
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"

input="$(cat)"
file_path="$(node -e '
let d = ""
process.stdin.on("data", (c) => { d += c })
process.stdin.on("end", () => {
  try { process.stdout.write(JSON.parse(d).tool_input?.file_path ?? "") } catch { /* leer bleibt leer */ }
})
' <<< "$input")"

[ -z "$file_path" ] && exit 0

out="$(bun scripts/dev/detect-identifiers.ts --files "$file_path" 2>&1)" && exit 0
echo "$out" >&2
exit 2
