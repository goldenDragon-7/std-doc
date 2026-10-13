# Detective Findings Report

## When you reach for this template
**You investigated ONE system and need to hand someone the evidence, not just
the verdict.** Use this when the reader will ask "how do you know?" and expects
you to be able to answer — a root-cause investigation, a capability audit, a
per-system architecture deep-dive, a pre-release health check.

Don't reach for this when: you're orienting someone to a landscape they've
never seen (→ Macro Overview family, not yet built), or the reader only wants
the synthesis and trusts your evidence already (→ Captain Synthesis Brief,
`docs/templates/captain-synthesis-brief/`).

## The document's shape

| # | Section | What it's FOR |
|---|---|---|
| 1 | Hero | Names the system under investigation, one line, no hedging |
| 2 | Stat/badge row | Orients scale before detail — files inventoried, finding count, confidence |
| 3 | Thesis callout | The one-sentence root cause, stated BEFORE the evidence — reader should be able to stop here and already know the point |
| 3.5 | Standing-rule quote (optional) | A `quote` block naming the investigative posture this report is written from — matches Dialect A's own `quote`/`quote-attr` vocabulary |
| 4 | Lede prose | One paragraph: what was traced and from where to where |
| 5 | Component card grid | The named parts of the system, entity-colored by role (core/consumer/risk) |
| 6 | Flow / pipeline | How data or control actually moves, step by step, evidenced |
| 7 | Compare (works-well / smells) | The paired-opposition pattern (SURVEY-NOTES.md Finding F6) — what's confirmed good vs what's confirmed wrong, side by side |
| 8 | Decision matrix | Documented-vs-observed verdict grid — this is where "measured, not claimed" gets a visual proof surface |
| 8.5 | Mechanism diagram | The load-bearing idea earns a diagram (the project conventions §3 Covenant II) — not a decoration, the actual causal chain from trigger to failure, drawn |
| 9 | Finding(s) | Each finding is its own `finding` block, most severe first — an id, a `where`, and its evidence, not a generic callout |
| 10 | Open questions | Handed to the strategist/reader explicitly — a detective doesn't decide, it hands off |

## Primitives used

| Section | Primitive | Notes |
|---|---|---|
| Hero | `hero` | fields are `text` + `sub`, **not** `title`/`kicker` — see gotcha below |
| Stat row | `badges` | batch-1 also shipped `stats-bar` (`value`+`label`+`kind`) — prefer `stats-bar` for numeric stats, `badges` for key:value facts |
| Thesis / findings | `callout` | `kind` must be a palette entity you declared (see gotcha) |
| Standing-rule quote | `quote` | landed on main (`c79b518`) mid-survey, part of the same leaf-gap worklist batch as `synthesis-note`/`kv` — `text`+`who`, direct match for Dialect A's own `quote`/`quote-attr` class pair |
| Lede | `prose` with `"lede": true` | |
| Components | `cardgrid` | `ent` on each card is also a palette-entity reference |
| Flow | `flow` | use `pipeline` instead if any step has a done/active/pending state — std-doc's own lint told me this (see below) |
| Works-well/smells | `compare` | `left`/`right` each take `title`+`pill`+`items[]` |
| Verdict grid | `decisionmatrix` | `cells[].verdict` ∈ have/miss/part/unknown/neutral, drives color |
| Mechanism diagram | `mermaid` | client-rendered; use for the CAUSAL chain, not a generic architecture box diagram — the point is "this step causes that step," matching the project conventions' "DRAW the load-bearing idea" rule, not decoration |
| Findings | `finding` | landed on main (`e01ee4d`) mid-survey — the top-ranked candidate in the whole corpus scout per std-doc, and it's the right primitive: `id`+`severity`+`headline`+`where`+`evidence` is exactly what a finding IS, versus the generic `callout` this template originally faked it with. Swapped in during the depth pass — see gotcha below. `where`/`evidence` also got `richcode` support (`d25d2d9`, closing GAPS.md gap #2) — this template's worked example now carries REAL backtick citations (`` `CronList()` ``, `` `loop_gate.py:112` ``) that render as genuine `<code>` chips, not literal backtick characters. This was the exact missing atom flagged in `the inline-code finding`. |
| Open questions | `prose` | plain, still no `richcode` opt-in for `prose.text` — the fix landed for `finding.where`/`evidence` specifically (protecting existing golden masters), not globally. If your open-questions prose needs inline citations, consider a closing `finding`-shaped block instead of plain prose. |

## Worked example

`source.json` in this directory, now with a `mermaid` mechanism diagram
between the verdict grid and the critical finding — added in a depth pass
after the first six families landed, per the project conventions §3 Covenant II
("don't ship it flat") — the existing families get made beautiful before we
reach for more. Published and **rendered clean** —
`stddoc publish docs/templates/detective-findings-report/source.json
docs/templates/detective-findings-report/published --style techno-dark`
produces zero `std-doc-error` markers (confirmed by grep on the output HTML,
not by trusting the exit code).

## Gotchas (cost me real render errors — save yourself the loop)

1. **`hero` takes `text` + `sub`, not `title`/`kicker`.** Authoring it with
   `title`/`kicker` silently drops both — the hero renders with an empty
   headline and no error. (This predates the lint landing on main 2462bae;
   worth asking whether hero's missing-required-field case is covered by that
   lint yet.)
2. **`callout.kind` and `cardgrid.cards[].ent` are palette-entity references,
   not free-form color names.** `"kind": "amber"` renders a **visible
   std-doc-error banner in the page** ("unknown palette entity 'amber';
   declared: []") unless you declare `"palette": {"amber": {"label":...,
   "color":"#f59e0b"}}` at the document root. This is loud (good — not a
   silent drop), but it means every findings-report author needs to seed a
   palette block up front. Recommend the four I used (`glow`/`amber`/`red`/
   `green`) become a documented "findings-report starter palette" so authors
   copy-paste instead of rediscovering the entity contract.
3. **`finding.severity` is a palette-entity reference too** — same mechanism
   as `callout.kind`/`cardgrid.ent`. I declared `high`/`medium` entries
   alongside the color-name ones (`amber`/`red`/`green`) in the same palette
   block; nothing stops you from naming severities and colors identically in
   the palette, and doing so kept the JSON readable.
4. **`stddoc lint` gave a real, correct suggestion**: my `flow` with 3
   sequential steps where later steps are `state: "done"`/`"active"` was
   flagged to prefer `pipeline`. I kept `flow` deliberately (my steps are a
   trace narrative, not a phase tracker) but authors should run `lint` before
   publish — it caught something real, for free.

## Anti-patterns

- **Verdict before evidence, no callout separating them.** The 03-leo captain
  variants show what happens when synthesis and evidence collapse into one
  undifferentiated scroll — readers can't tell "this is the conclusion" from
  "this is why." Always give the thesis its own `callout`, distinct from the
  narrative `prose`.
- **Findings without a companion verdict grid.** `01_personality-report.html`
  and `fis--report.html` both list findings as prose bullets with no
  documented-vs-observed table — a reader has to reconstruct the "why should I
  believe this" table themselves. Use `decisionmatrix` even for a 3-row case.
- **Numbering everything, including the thesis.** Don't let the thesis
  callout become "§1" — it should read before the numbered body starts, or it
  reads as one finding among many instead of the point of the report.

## Evidence (corpus `file:line`)

- `curate/samples/02-kingdom-review/01_personality-report.html` — stats-bar,
  thesis-as-first-section, `card-grid`, `pipeline` w/ `.active`, chaos/verdict
  split into "What works well" / "What smells" (h3 pair under "Design
  verdict")
- `curate/samples/05-architecture-subdirs/fis--report.html` — component
  cardgrid equivalent (`schema-grid`), coupling/contract paired-opposition
  (SURVEY-NOTES.md Finding F6)
- `curate/samples/01-styleref/kingdom-example-report.html` — the `badge-*`
  and `stat`/`stat-val`/`stat-lbl` vocabulary this template's stat row derives
  from
