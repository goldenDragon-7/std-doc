# Macro Overview

## When you reach for this template
**The reader has never seen this landscape and needs to orient, not
investigate.** Use this for a cross-cutting taxonomy — "here are the seven
planes of the kingdom," "here are the three autonomics," a system-of-systems
map. The reader's posture is survey mode, not scrutiny mode.

Don't reach for this for a single system's deep-dive (→ Domain/System
Reference or Detective Findings Report) — SURVEY-NOTES.md's refined rule
(after the architecture-subdir survey corrected an earlier wrong hypothesis)
is explicit: architecture-vs-capability is NOT the divider between this
family and the others. **Scope and posture are the divider** — many things
classified, reader orienting → this family; one thing deep, reader
scrutinizing → Detective/Reference.

## The document's shape

| # | Section | What it's FOR |
|---|---|---|
| 1 | Hero | Names the landscape being surveyed |
| 1.5 | Stamp | Document-header signature block (role + date + caption) — direct match for Dialect B's `header.top` right-side stamp |
| 2 | Lede prose | States explicitly that this is orientation, not audit — sets reader expectation before the classification starts |
| 3 | Legend | Declares the semantic vocabulary (temperature kinds) BEFORE using it — corpus rule (CF guide's own §"9 · Legend — the vocabulary, stated BEFORE it is used") |
| 3.5 | Pattern header | A framed chapter-opening h2 (era + title + descriptor) — marks where the classification section actually begins, distinct from the hero's page-opening statement |
| 4 | Panels (the members) | One `panel` per named thing being classified, `kind` = its temperature — the REAL Dialect B component, not a substitute (see below) |
| 5 | Phase strip | If the landscape has a lifecycle/sequence dimension, show it as phases, each temperature-colored |
| 6 | Compare (frozen vs evolving) | The paired-opposition pattern again, but here classifying stability, not right/wrong |
| 7 | Closing prose | States explicitly why the classification matters — what a reader should trust vs double-check |

## Primitives used

| Section | Primitive | Notes |
|---|---|---|
| Hero | `hero` | |
| Stamp | `stamp` | landed on main (`7822635`) mid-survey — `roles[].kind` is palette-referenced same as everything else; caught my own documented gotcha live (used `"accent"` without declaring it, got the loud error banner, added it to the palette block, fixed) |
| Legend | `legend` | direct match for Dialect B's own `legend`/`.swatch` vocabulary (SURVEY-NOTES.md Finding F5) |
| Pattern header | `pattern-header` | landed on main (`e01ee4d`) mid-survey, closing GAPS.md gap #7 — swapped in during the depth pass. Fields: `era`+`title`+`desc`, exact match for Dialect B's framed h2 |
| Members | `panel` | `kind` (palette-referenced, same `palette_var` mechanism as `callout`/`tag`) landed on main (`d25d2d9`, closing GAPS.md gap #6) mid-survey. This template originally worked around the missing field with `cardgrid`'s `ent`; swapped to real `panel` in the depth pass — confirmed rendering with a real `--ent-hot`/`--ent-warm`/`--ent-cold` border color, not a substitute. |
| Lifecycle | `phase-strip` | batch-1 primitive, `kind` per phase — direct match for Dialect B's `phase-strip` + 7 temperature-colored `phase` cards |
| Stability | `compare` | reused from the findings-report family, but classifying stability not correctness |

## Worked example

`source.json` in this directory. Published and **rendered clean** — zero
`std-doc-error` markers, `stddoc lint` clean.

## Gaps hit building this family (see `../GAPS.md` for the full tracked list)

- ~~**LEAF — `panel` has no `kind`/temperature parameter.**~~ **RESOLVED**
  during this survey (main `d25d2d9`) — this template now uses the real
  `panel.kind`, not the `cardgrid.ent` workaround it originally shipped with.
- ~~**LEAF — no `pattern-header`.**~~ **RESOLVED** during this survey (main
  `e01ee4d`) — now used in this template's own worked example, above.
- **CONTAINER — no `plane-grid`-equivalent auto-fit grid-of-panels container.**
  I substituted `cardgrid` (already a flex-wrap grid) — functionally similar
  enough that I'm not confident this is a real gap versus just an unfamiliar
  name; flagging as unconfirmed rather than filing to GAPS.md as a firm miss.

## Anti-patterns

- **Treating this like a findings report.** No `callout` with a verdict, no
  `decisionmatrix`. If you catch yourself wanting to say "and X is broken,"
  that content belongs in a Detective Findings Report about X specifically —
  link to it, don't inline it here.
- **Skipping the legend.** Every Dialect B corpus doc states its vocabulary
  before using it. Using `hot`/`cold`/etc. as card colors without a `legend`
  first forces the reader to reverse-engineer your color scheme.
- **One giant card grid with no lifecycle dimension.** If the landscape has an
  inherent sequence (arm → idle → wake, or plane 1 → plane 7), a flat grid
  loses it. Use `phase-strip` when order matters, `cardgrid` when it doesn't.

## Evidence (corpus `file:line`)

- `curate/samples/02-kingdom-review/00_KINGDOM_ARCHITECTURE.html` — "Care has
  seven shapes.", "The Seven Planes", temperature `panel`/`phase` classes,
  `legend`, "Glossary" as closing section
- SURVEY-NOTES.md "DIALECT B — Overview" section — full palette, temperature
  semantics table (hot/warm/cold/frozen/evol), component vocabulary
  (`panel`, `phase-strip`, `plane-grid`, `legend`)
- SURVEY-NOTES.md "Which dialect for which doc? — REFINED" — the corrected
  rule (scope+posture, not architecture-vs-capability) that defines this
  family's boundary against Detective Findings Report and Domain/System
  Reference
