# Captain Synthesis Brief

## When you reach for this template
**The reader trusts your evidence already and only wants the verdict, the
risk, and the decision they need to make.** Use this as the compressed
companion to a Detective Findings Report — same underlying investigation,
aimed at a strategist/captain who will act on it, not re-derive it.

Don't reach for this as a standalone doc for a reader who's never seen the
system — it assumes the full evidence trail exists somewhere (linked or
alongside) and deliberately omits it.

## The document's shape

| # | Section | What it's FOR |
|---|---|---|
| 1 | Hero | Names the lane/system + explicitly states "this is the compressed view" |
| 1.5 | Synthesis note | One sentence naming what the predecessor investigation found — the REAL corpus component (`synthesis-note`), not a generic callout |
| 2 | Stat row | Same orientation numbers as the full report, kept for scale continuity |
| 3 | Axiom/thesis callout | The one assumption that's wrong, stated as the frame for everything below |
| 4 | Verdict box | A single named verdict slug + one-sentence justification — the captain's stamp |
| 5 | Decision matrix | Aspirational vs as-built — table-forward, no prose padding |
| 6 | Card cluster (grouped findings) | Findings grouped by category (Critical / Drift / Undocumented), not narrated |
| 7 | Open questions + cross-lane pointers | A `kv` list, not prose paragraphs — terse, handed off, this format does not editorialize |

## Primitives used

| Section | Primitive | Notes |
|---|---|---|
| Hero | `hero` | |
| Stats | `stats-bar` | batch-1 primitive — `value`+`label`+optional `kind` |
| Axiom | `callout` | |
| Synthesis note | `synthesis-note` | landed on main (`c79b518`) mid-survey — the REAL primitive for SURVEY-NOTES.md Finding F2's `synthesis-note` class ("captain-variant callout for what the predecessor detective found"), swapped in during the depth pass for what was originally a generic `callout` |
| Verdict | `verdict-box` | batch-1 primitive — `label`+`verdict`+`kind`+`text`; **this is the primitive that makes the format work** — it's the direct translation of the corpus's `verdict-flawed`/`verdict-appropriate`/`verdict-haunted` classes (03-leo captain variants) |
| Aspirational/as-built | `decisionmatrix` | same primitive as the findings report, but this is the ONLY table in the doc — no accompanying prose walkthrough |
| Grouped findings | `cardcluster` | groups map directly to the corpus's h3 subsections (Critical / Drift / Load-bearing-undocumented / Orphans / …) — one `cardcluster` group per h3, one card per finding |
| Closing | `kv` | landed on main (`c79b518`) mid-survey — swapped in for what were two prose paragraphs, matching this format's own "no re-narrating" rule better than prose does |

## Worked example

`source.json` in this directory, updated in a depth pass to use the real
`synthesis-note` and `kv` primitives once they landed on main. Published and
**rendered clean** — zero `std-doc-error` markers, `stddoc lint` clean.

## Anti-patterns

- **Re-narrating the evidence.** The whole point of this format is that it is
  NOT the findings report. If a captain brief needs a paragraph explaining
  *why* a finding is true, that content belongs in the linked detective
  report, not duplicated here in prose.
- **Skipping the verdict-box.** `01_surfaces-report_captain.html` sometimes
  buries its verdict inside a `synthesis-note` callout instead of giving it
  the dedicated `verdict-*` treatment — the corpus itself is inconsistent
  here, and the inconsistent ones are harder to skim. Always give the verdict
  its own box.
- **Treating card-cluster groups as a place for new findings.** This format
  compresses; it should not introduce evidence the linked findings report
  doesn't already carry. If cardcluster surfaces something new, that's a sign
  the detective report is incomplete, not that the brief should carry it.

## Evidence (corpus `file:line`)

- `curate/samples/03-leo/01_surfaces-report_captain.html` — `axiom-violation`,
  `verdict-flawed`/`verdict-appropriate`/`verdict-haunted`, `synthesis-note`,
  findings grouped by h3 (Drift / Haunted code / Load-bearing undocumented /
  Orphans / Manual steps), "Cross-Lane Pointers" closing section
- SURVEY-NOTES.md Finding F2 — "captain version is table-forward and
  synthesis-led; detective version is tab-forward and evidence-led" — this is
  the design thesis the whole template encodes
- `curate/samples/03-leo/02_orchestrator-report_captain.html` through
  `10_lifecycle-report_captain.html` — confirms the pattern repeats across
  all 10 lanes, not a one-off
