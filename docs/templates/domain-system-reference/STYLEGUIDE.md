# Domain/System Reference

## When you reach for this template
**The reader needs to know what a system CONTAINS and how to call it — not
whether it's healthy, not what's wrong with it.** Use this for a schema
reference, an API/CLI surface reference, a data-model dossier. The register
is descriptive, not evaluative: no verdicts, no findings, no thesis.

Don't reach for this when the point is an argument (→ Detective Findings
Report) or an orientation to a landscape (→ Macro Overview, not yet built).
If you find yourself wanting a `callout` with a verdict in it, you've drifted
into Findings Report territory — split the doc.

## The document's shape

| # | Section | What it's FOR |
|---|---|---|
| 1 | Hero | Names the system, states register ("what it is and what it stores") |
| 2 | Lede prose | One paragraph: the system's job, in plain language, before any schema |
| 3 | Table-list | The flat inventory — every named thing this system owns, one line each |
| 4 | Schema grid | Structured detail for the things that have internal shape (tables, fields, records) |
| 4.5 | Ownership diagram | "What owns what" — a `mermaid` diagram showing which caller writes to which store, drawn BEFORE the call surface so the reader has the shape before the sequence |
| 5 | Flow | The call surface, in the order a new caller would learn it |
| 6 | Code snippet | One realistic, copy-pasteable call — not a toy example |
| 7 | Table (constraints) | Numeric/environmental facts a caller needs before they trust the system — limits, timings, invariants |
| 8 | Legend | Declares any semantic vocabulary (temperature/status kinds) used above, stated once at the end for reference |

## Primitives used

| Section | Primitive | Notes |
|---|---|---|
| Hero | `hero` | |
| Lede | `prose` with `lede:true` | |
| Flat inventory | `table-list` | batch-1 primitive — `name` + `note`, this is the direct match for `fis--report.html`'s repeated `<h3>Source Systems Supported</h3>` flat lists |
| Structured detail | `schema-grid` | batch-1 primitive — direct port of the corpus's own `schema-grid`/`schema-box` class names (SURVEY-NOTES.md Dialect A "specialty" vocabulary) — this is the one place a promoted-from-the-corpus class name and a std-doc primitive name are IDENTICAL |
| Ownership diagram | `mermaid` | drawn with one deliberate dashed edge for the "no caller in the loop" path (silent expiry) — the single fact this reference doc most needs a reader to internalize before trusting the constraints table |
| Call surface | `flow` | lint suggested `pipeline` here too (3+ sequential steps) — kept `flow` because these are three independent calls, not phases of one thing moving through state |
| Example call | `code` mode `snippet` | |
| Constraints | `table` | grouped rows, plain columns |
| Vocabulary | `legend` | batch-1 primitive |

## Worked example

`source.json` in this directory, now with a `mermaid` ownership diagram
added in a depth pass per the project conventions §3 Covenant II. Published and **rendered
clean** — zero `std-doc-error` markers, `stddoc lint` clean (one non-blocking
suggestion, addressed above by explaining why `flow` was kept).

## Anti-patterns

- **Smuggling a verdict into a reference doc.** `fis--report.html` mostly
  avoids this, but its "Coupling Hotspots Requiring Surgery" section is a
  findings section bolted onto a reference doc — it belongs in a companion
  Detective Findings Report, not here. A reference doc that starts making
  claims about what's wrong has stopped being a reference doc.
  and started being one.
- **One giant table for everything.** `fis--report.html` mixes environment
  variables, secret files, and versioned config into a single wall of `<h2>`
  sections with no `schema-grid` structure — readable only by scrolling
  linearly. Group related structured facts into `schema-grid` boxes so a
  reader can jump to the one they need.
- **No call surface before the schema.** Several corpus references
  (`comm-email--report.html`, `comm-slack--report.html`) dive straight into
  schema before saying what a caller actually calls. Put `flow` (or an
  equivalent call-surface primitive) before the deep schema detail — readers
  arrive wanting to use the system, not audit it.

## Evidence (corpus `file:line`)

- `curate/samples/05-architecture-subdirs/fis--report.html` — flat
  `<h3>`-per-source-system lists (Source Systems Supported), `.gauge-formula`
  mono block (→ `code` snippet), "Four Schemas" + "pub.transactions — Core
  Table" (→ `schema-grid`), "Environment Variables" / "Secret Files" (→
  `table` constraints)
- `curate/samples/05-architecture-subdirs/comm-email--report.html`,
  `comm-slack--report.html`, `comm-engine--report.html` — confirm the same
  per-system-reference shape repeats across all `05-architecture-subdirs/`
  siblings, not a one-off for FIS
- SURVEY-NOTES.md Dialect A "specialty vocabulary" note — `schema-grid`,
  `schema-box`, `table-list` were flagged there as "worth promoting"; batch-1
  promoted them verbatim, and this template is the proof they render the
  shape they were promoted for
