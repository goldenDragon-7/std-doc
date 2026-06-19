#!/usr/bin/env bash
# port_parity_extract.sh — materialize the Python surface (from git history) and
# the Go surface (from the live tree), using each language's NATIVE parser, so a
# reviewer can match symbol-by-symbol. Tree-sitter is deliberately NOT used:
# python stdlib `ast` and `go doc` are exact, not heuristic, and zero-install.
#
# Output: briefs/out/parity-raw/  (py_*.txt, go_*.txt, prim_diff.txt)
# Exit 0 always (offline-safe). Run from repo root.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 0
OUT=briefs/out/parity-raw; mkdir -p "$OUT"

# --- locate a commit where the Python engine tree still exists in full ---
# `rev-list -- <file> | head -1` returns the DELETION commit (file already gone);
# the last good snapshot is its PARENT. Fall back to that ref directly.
DEL=$(git log --all --diff-filter=D --format=%H -- engine/primitives/crux.py 2>/dev/null | head -1)
PYREF="${DEL:+${DEL}~1}"
[ -z "$PYREF" ] && PYREF=$(git rev-list --all -- engine/lib/server.py | head -1)
echo "python snapshot ref: $PYREF" | tee "$OUT/_meta.txt"
SNAP=$(mktemp -d)
git archive "$PYREF" engine 2>/dev/null | tar -x -C "$SNAP" 2>/dev/null || \
  echo "WARN: could not archive engine/ at $PYREF" >> "$OUT/_meta.txt"

# --- LAYER 1: registry/surface parity (data, highest signal) -------------
# primitives: one py file per primitive  vs  go templates.json keys
find "$SNAP/engine/primitives" -name '*.py' 2>/dev/null \
  | grep -vE '__init__|_templates|page_atoms' | sed 's#.*/##;s#\.py##' | sort -u > "$OUT/py_primitives.txt"
python3 -c "import json;print('\n'.join(sorted(json.load(open('go/stddoc-lib/templates.json')))))" > "$OUT/go_primitives.txt"
# normalized set-diff (underscore<->hyphen folded so gradient_band==gradient-band)
python3 - "$OUT/py_primitives.txt" "$OUT/go_primitives.txt" > "$OUT/prim_diff.txt" <<'PY'
import sys
norm=lambda s:s.replace('-','_')
py={norm(x) for x in open(sys.argv[1]).read().split()}
go={norm(x) for x in open(sys.argv[2]).read().split()}
print("PY-only (candidate LOST, normalized):", sorted(py-go))
print("GO-only (new in Go):", sorted(go-py))
PY

# CLI surface: python argparse subcommands+flags  vs  go subcommand switch + flag literals
grep -rEn "add_parser\(|add_argument\(" "$SNAP/engine" 2>/dev/null > "$OUT/py_cli.txt" || true
grep -rEn 'case "|flag.String|flag.Int|flag.Bool|MinPort|IdleTimeout|PortScan|default' go/cmd/stddoc go/internal/serve 2>/dev/null > "$OUT/go_cli.txt" || true

# --- LAYER 2: symbol-by-symbol via native AST ----------------------------
# python: every FunctionDef/ClassDef (qualified), via stdlib ast
python3 - "$SNAP/engine" > "$OUT/py_symbols.txt" <<'PY'
import ast,os,sys
root=sys.argv[1]
for dp,_,fs in os.walk(root):
    for f in sorted(fs):
        if not f.endswith('.py'): continue
        p=os.path.join(dp,f); rel=os.path.relpath(p,root)
        try: t=ast.parse(open(p).read())
        except Exception as e:
            print(f"{rel}: PARSE-ERROR {e}"); continue
        for n in ast.walk(t):
            if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
                kind='class' if isinstance(n,ast.ClassDef) else 'func'
                print(f"{rel}:{n.lineno} {kind} {n.name}")
PY
# go: every exported func/type across the module
( cd go && for pkg in $(go list ./... 2>/dev/null); do go doc -all "$pkg" 2>/dev/null \
    | grep -E '^func |^type ' | sed "s#^#${pkg}: #"; done ) > "$OUT/go_symbols.txt" 2>/dev/null

echo "py symbols: $(wc -l < "$OUT/py_symbols.txt" 2>/dev/null)  go symbols: $(wc -l < "$OUT/go_symbols.txt" 2>/dev/null)" | tee -a "$OUT/_meta.txt"
rm -rf "$SNAP"
echo "extraction complete → $OUT/"
