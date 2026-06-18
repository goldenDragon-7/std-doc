#!/usr/bin/env bash
# Go acceptance gate: build stddoc, then diff its publish output against the
# language-neutral goldens the Python reference already seeded on disk.
# Green = empty diff on all cases. See prd/go-build/build-plan.md §0.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
CASES="$HERE/cases"

echo "building stddoc…"
if ! (cd "$REPO/go" && go build -o "$REPO/go/stddoc" ./cmd/stddoc); then
  echo "BUILD FAILED" >&2
  exit 1
fi
BIN="$REPO/go/stddoc"

fail=0
total=0
for dir in "$CASES"/*/; do
  case="$(basename "$dir")"
  input="$dir/input.json"
  expected="$dir/expected"
  [ -f "$input" ] || continue
  [ -d "$expected" ] || continue
  total=$((total + 1))
  out="$(mktemp -d)"
  err="$(mktemp)"
  if ! "$BIN" publish "$input" "$out" >/dev/null 2>"$err"; then
    echo "✗ $case — publish errored:"; sed 's/^/    /' "$err"
    fail=$((fail + 1)); rm -rf "$out"; rm -f "$err"; continue
  fi
  if diff -r "$out" "$expected" >/dev/null 2>&1; then
    echo "✓ $case"
  else
    echo "✗ $case — diff vs expected/:"
    diff -r "$expected" "$out" | sed 's/^/    /' | head -40
    fail=$((fail + 1))
  fi
  rm -rf "$out"; rm -f "$err"
done

echo "----"
if [ "$fail" -eq 0 ]; then
  echo "conformance (Go) OK — $total case(s) byte-identical"
  exit 0
else
  echo "conformance (Go) RED — $fail/$total case(s) diverged"
  exit 1
fi
