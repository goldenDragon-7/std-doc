# Conformance — the byte-diff regression oracle

This directory is the **byte-level regression baseline** for the `stddoc`
renderer: one set of inputs, one set of canonical outputs, and one rule —
**byte-identical or it's wrong.** (Historically it was the cross-language
contract that proved the Go port matched the original engine byte-for-byte;
that port is done, so the cases now anchor the Go renderer against drift.)

## Layout

```
conformance/
  run_go.sh           the harness (builds stddoc, diffs its output)
  cases/<case>/
    input.json        the ONLY input — a doc-tree (or layout:page) source
    expected/*.html   the canonical rendered output, byte-for-byte
```

Nothing language-specific lives in a case: the input is plain JSON, the expected
output is plain HTML, the comparison is a byte compare.

## Usage

```bash
bash conformance/run_go.sh          # build stddoc, diff every case (nonzero exit on drift)
cd go && go test ./internal/core/   # the same gate, wired into `go test`
```

The gate also runs as `go/internal/core/conformance_test.go`, so a drift breaks
`go test ./...`. A byte-diff proves the output is *exactly* right — not merely
that a marker substring is present.

## Cases

| case | what it exercises |
|---|---|
| `golden` | the tiny deterministic doc-tree (human-readable diff) |
| `flat` | legacy `groups` + per-node `group` (one synthesized level) |
| `twolevel` / `fourlevel` | author-nested `children`, legal numbering |
| `self-doc` | std-doc documenting itself — nearly every primitive |
| `prd-python-prep` | the historical Go-migration work plan, as a living doc |

## Reseeding

The expected outputs are the renderer's canonical output and the **baseline of
record**. Reseed a case *only* for an intended render change, by republishing
its input and reviewing the diff before committing:

```bash
stddoc publish cases/<case>/input.json cases/<case>/expected
```

An unreviewed reseed silently launders a regression into the baseline — review
the diff every time.
