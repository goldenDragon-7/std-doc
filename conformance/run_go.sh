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
  # Scope the diff to the goldened pages: search-index.{js,json} are legitimate
  # publish sidecars (data derived from the doc, presence-guarded by
  # search_capability_test.go) but are not byte-goldened here — same scope as the
  # Go TestConformanceCases_ByteIdentical, which only compares expected/ HTML.
  DIFF_X=(-x 'search-index.js' -x 'search-index.json')

  # Normalize away <html data-style-default="…">, which the PUBLISH COMMAND adds
  # after core.Publish has rendered (see cmd/stddoc/stylestamp.go) so that
  # serve's style-lock honors the doc's published --style instead of repainting
  # it techno-dark.
  #
  # WHY NORMALIZE RATHER THAN RE-SEED: expected/ is a LANGUAGE-NEUTRAL golden of
  # core.Publish — the Python-parity contract — and it has a second consumer,
  # internal/core's TestConformanceCases_ByteIdentical, which calls core.Publish
  # directly and therefore never sees the stamp. Re-seeding the goldens with the
  # stamp turns THAT test red (measured: 2026-10-13, internal/core FAIL, "first
  # diff byte at ~20"). One golden set, two consumers, so the post-render
  # attribute is stripped here instead.
  #
  # The stamp itself is NOT left unguarded: cmd/stddoc/stylestamp_test.go pins
  # its exact form and idempotence, and TestPublishStampsThePublishedStyle runs
  # the real publish command and asserts the attribute is present.
  for f in "$out"/*.html; do
    [ -f "$f" ] || continue
    LC_ALL=C sed -i '' -E 's/ data-style-default="[^"]*"//g' "$f"
  done

  if diff -r "${DIFF_X[@]}" "$out" "$expected" >/dev/null 2>&1; then
    echo "✓ $case"
  else
    echo "✗ $case — diff vs expected/:"
    diff -r "${DIFF_X[@]}" "$expected" "$out" | sed 's/^/    /' | head -40
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
