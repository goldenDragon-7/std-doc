# Conformance — the cross-language byte-diff oracle

This directory is the **language-neutral contract** between the current Python
engine and any future port (the Go binary). It is the thing that makes the
port a *transcription, not a redesign*: there is one set of inputs, one set of
canonical outputs, and one rule — **byte-identical or it's wrong.**

## Layout

```
conformance/
  run.py              the harness (stdlib only)
  cases/<case>/
    input.json        the ONLY input — a doc-tree (or layout:page) source
    expected/*.html   the canonical rendered output, byte-for-byte
```

Nothing language-specific lives in a case: the input is plain JSON, the expected
output is plain HTML, the comparison is a byte compare. A port re-runs *this same
harness shape* against *these same cases* and must produce the same bytes.

## Usage

```bash
python3 conformance/run.py            # check every case (nonzero exit on drift)
python3 conformance/run.py --update   # (re)seed expected/ from the current engine
python3 conformance/run.py golden ... # restrict to named cases
```

It is also wired into pytest as `engine/tests/test_conformance.py`, so a drift
breaks the suite. This **supersedes the old `assertIn` substring tests**: a
substring proves a marker is present; a byte-diff proves the output is exactly
right.

## Cases

| case | what it exercises |
|---|---|
| `golden` | the tiny deterministic doc-tree (human-readable diff) |
| `flat` | legacy `groups` + per-node `group` (one synthesized level) |
| `twolevel` / `fourlevel` | author-nested `children`, legal numbering |
| `self-doc` | std-doc documenting itself — 29 pages, nearly every primitive |
| `prd-python-prep` | this very work plan, as a living doc |

## Reseeding

The expected outputs are the Python engine's canonical output and are the
**spec-of-record**. Reseed (`--update`) *only* for an intended render change, and
review the diff before committing — an unreviewed reseed silently launders a
regression into the baseline.
