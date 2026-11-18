#!/usr/bin/env bash
# publish_mcp_registry.sh — validate + dry-run npm + dry-run registry publish.
# NEVER runs npm publish or mcp-publisher publish unless --execute is passed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXECUTE=0
for arg in "$@"; do
  case "$arg" in
    --execute) EXECUTE=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/publish_mcp_registry.sh [--execute]

Default (no flags): validate server.json, assert version==package.json,
run npm publish --dry-run, and print the exact live publish commands.

--execute: after the same validations, run npm publish --access public
then mcp-publisher publish. Requires npm login + mcp-publisher DNS login.
EOF
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f server.json ]]; then
  echo "ERROR: server.json missing in $ROOT" >&2
  exit 1
fi
if [[ ! -f package.json ]]; then
  echo "ERROR: package.json missing in $ROOT" >&2
  exit 1
fi

echo "==> JSON-validate server.json"
python3 - <<'PY'
import json, sys
from pathlib import Path
raw = Path("server.json").read_text()
try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    print(f"INVALID JSON: {e}", file=sys.stderr)
    sys.exit(1)
print(f"OK JSON · name={data.get('name')!r} version={data.get('version')!r}")
PY

echo "==> mcp-publisher validate server.json"
if command -v mcp-publisher >/dev/null 2>&1; then
  mcp-publisher validate server.json
else
  echo "WARN: mcp-publisher not on PATH — skipped schema validate" >&2
fi

echo "==> version lock: server.json == package.json == packages[0].version"
python3 - <<'PY'
import json, sys
pkg = json.load(open("package.json"))
srv = json.load(open("server.json"))
pv = pkg.get("version")
sv = srv.get("version")
packs = srv.get("packages") or []
nv = packs[0].get("version") if packs else None
ok = True
if not pv:
    print("ERROR: package.json missing version", file=sys.stderr); ok = False
if sv != pv:
    print(f"ERROR: server.json version {sv!r} != package.json {pv!r}", file=sys.stderr); ok = False
if nv != pv:
    print(f"ERROR: server.json packages[0].version {nv!r} != package.json {pv!r}", file=sys.stderr); ok = False
if pkg.get("mcpName") and srv.get("name") and pkg["mcpName"] != srv["name"]:
    print(f"ERROR: package.json mcpName {pkg['mcpName']!r} != server.json name {srv['name']!r}", file=sys.stderr); ok = False
if not ok:
    sys.exit(1)
print(f"OK versions locked at {pv} · mcpName={pkg.get('mcpName')}")
PY

echo "==> npm publish --dry-run (always)"
npm publish --dry-run --access public

LIVE_CMD=$(cat <<EOF
# LIVE publish (Josef / --execute only) — order matters: npm BEFORE registry
cd $ROOT
npm publish --access public
mcp-publisher publish
# verify:
#   npm view vedetta-mcp version
#   curl -sS 'https://registry.modelcontextprotocol.io/v0.1/servers?search=com.dethboy/vedetta' | head
EOF
)

if [[ "$EXECUTE" -eq 0 ]]; then
  echo
  echo "==> DRY-RUN complete. No npm publish / mcp-publisher publish executed."
  echo "==> Exact live publish command for Josef:"
  echo "$LIVE_CMD"
  exit 0
fi

echo
echo "==> --execute: npm publish --access public"
npm publish --access public

echo "==> --execute: mcp-publisher publish"
mcp-publisher publish

echo "==> LIVE publish finished."
echo "Verify: npm view vedetta-mcp version"
echo "Verify: curl -sS 'https://registry.modelcontextprotocol.io/v0.1/servers?search=com.dethboy/vedetta'"
