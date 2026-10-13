# Writing a std-doc render primitive

Adding a new visual to std-doc is **adding data, not code** — never editing the
core. The core walks the doc-tree, owns numbering / nav / anchors / freeze
orchestration / the palette / the security gate, and dispatches each typed block
to a registered primitive. A primitive's render logic is *structured data* (the
instruction set in `declarative-format.md`), so a new visual is a new entry in
two JSON files. The golden-master conformance gate guarantees existing pages stay
byte-identical; your new primitive only appears where a block asks for it.

## The contract — a data-template + its CSS

A primitive is two things, both **data** in `go/stddoc-lib/`:

| piece | file | shape |
|---|---|---|
| the render template | `templates.json` | `"<type>": [ …instruction-set nodes… ]` (see `declarative-format.md`) |
| the styling | `primitive_css.json` | `"<type>": ".<class>{…}"` — collected once, deduped, inlined |

The `type` key is the registry discriminator (the `"type"` field a `source.json`
block carries). The core looks the block's `type` up, runs its template through
the interpreter (`go/internal/template`), wraps the output in the block anchor,
and collects the CSS once per page. That is the whole dispatch.

### Invariants you must honor

1. **Anchors are core, never yours.** Emit content only; the core assigns
   `data-cf-anchor` via the `{"anchor": path}` node. Never write your own `data-cf-*`.
2. **No `raw` — every data value flows through `esc` or a closed `lookup`.** That
   is the security property (`declarative-format.md` §safety): a stranger composing
   primitives can never inject markup. A `compose` only nests *other safe blocks*.
3. **Freeze = zero external refs.** Frozen output must contain no `http(s)://`,
   protocol-relative `//host`, or CDN `src`/`href`. The freeze gate
   (`go/internal/gate`) scans it and fails the build naming your `type`.
4. **Be palette-bound where it makes sense.** `{"palette_var": "kind"}` emits
   `var(--ent-<kind>)` and fails loudly on an undeclared entity — so colour stays
   one source of truth (the doc's `palette`).

## Worked example — a `note` primitive

Add the template to `templates.json`:

```json
"note": [
  "<div class='note'",
  {"if": {"truthy": "kind"},
   "then": [" style='--c:", {"palette_var": "kind"}, "'"]},
  ">", {"esc": "text"}, "</div>"
]
```

Add its CSS to `primitive_css.json`:

```json
"note": ".note{border-left:3px solid var(--c,var(--border));padding:.5em .7em}"
```

Author it in a `source.json` node's `blocks[]`:

```json
{ "type": "note", "kind": "writer", "text": "Heads up." }
```

That's the whole loop: add a template entry, add a CSS entry, use it. No core
edit, no recompile, no whole-system release — the binary reads the library as
data at runtime.

## Catalog — primitives landed in v0.11

These shipped after the worked example above; each is a pure data-template in
`templates.json` (`primitive_css.json` for styling), verified live in
`examples/primitive-gallery/`. `canvas` shipped in the same cycle but is
core-owned (Go) — see `protocol/canvas.md`.

### `showcase` — a labeled "LIVE RENDER" frame

Wraps any composed content in a bordered box with a small uppercase label, used
throughout the gallery to frame "here's what this primitive actually renders."

```json
{ "type": "showcase",
  "label": "LIVE RENDER",
  "content": [ { "type": "prose", "text": "A plain paragraph of body text." } ] }
```

`label` is optional (defaults to `"LIVE RENDER"`); `content` is a `compose` —
any array of other primitives.

### `statusboard` — a grouped status matrix

A table of labeled rows × named columns, each cell colored by a `status`
badge. Good for "which build/env has which thing."

```json
{ "type": "statusboard",
  "columns": ["build1", "build2"],
  "groups": [
    { "label": "Core",
      "rows": [
        { "label": "gateway",
          "cells": [ { "status": "LIVE" }, { "status": "DEBT" } ] }
      ] }
  ] }
```

`columns` is a top-level array of column headers, shared across every group.
`groups[]` each have an optional `label` and `rows[]`; each row has a `label`
and `cells[]` (one per column) whose `status` renders as a colored badge —
`LIVE` / `PARTIAL` / `WIP` / `DEBT` (unrecognized values fall back to `WIP`
styling).

### `pipeline` — a linear stage tracker

A left-to-right row of stages joined by arrows, each stage state-colored.

```json
{ "type": "pipeline",
  "stages": [
    { "label": "Design", "state": "done" },
    { "label": "Build", "state": "active", "note": "in progress" },
    { "label": "Ship" }
  ] }
```

Each stage has a `label`, optional `state` (`done` / `active` / defaults to
`pending`), and optional `note` (small caption under the label).

### `rolecard` — a named entity summary card

A compact card for describing one actor/component: name, role, a summary
line, and pill tags.

```json
{ "type": "rolecard",
  "name": "The Renderer",
  "role": "Core",
  "accent": "glow",
  "summary": "Turns a JSON spec into an expressive HTML page.",
  "pills": ["json", "html", "svg"] }
```

`name` is required; `role`, `summary`, and `pills[]` are all optional.
`accent` is a palette entity key (`{"palette_var": "accent"}`) — must be a
color declared in the doc's `palette`, or the render fails loudly.

### `cardcluster` — grouped small cards

Like `cardgrid`, but with named groups above each grid — use when cards need
to be organized by category rather than shown flat.

```json
{ "type": "cardcluster",
  "groups": [
    { "label": "Core",
      "cards": [ { "title": "Gateway", "body": "MCP entrypoint", "ent": "glow" } ] },
    { "label": "Support",
      "cards": [ { "title": "Beam", "body": "file transport" } ] }
  ] }
```

Each group has an optional `label` and `cards[]`; each card has `title`,
`body`, optional `eyebrow`, and optional `ent` (a palette entity key that
accents the card's left edge).

### `decision` — a recorded decision with rejected alternatives

Documents a choice made and what was considered and set aside — the
declarative shape behind every "we picked X because Y, not Z" call.

```json
{ "type": "decision",
  "question": "Which database?",
  "chosen": "Postgres",
  "rationale": "Already deployed fleet-wide.",
  "alternatives": [
    { "label": "SQLite", "reason": "no concurrent writers" },
    { "label": "MySQL" }
  ] }
```

`question` and `chosen` are required. `rationale` is optional. `alternatives[]`
entries need a `label`; `reason` is optional per-alternative.

### `pill` — an inline status/entity badge

A small inline badge — the same status vocabulary `statusboard` cells use
(`LIVE`/`PARTIAL`/`WIP`/`DEBT`), or a palette-entity-colored tag.

```json
{ "type": "pill", "status": "LIVE", "label": "LIVE" }
```

`label` is the visible text (defaults to empty). Provide `status` for the
status-colored variant, or `ent` (a palette entity key) for an
entity-colored variant instead — not both are required.

### `tabs` — switchable content panels (no JS, radio-driven)

Client-side tab switching implemented with a checked radio input per tab —
works in a frozen, script-free doc.

```json
{ "type": "tabs",
  "id": "gallery-tabs",
  "tabs": [
    { "label": "Alpha", "content": [ { "type": "prose", "text": "Alpha panel content." } ] },
    { "label": "Beta", "content": [ { "type": "prose", "text": "Beta panel content." } ] }
  ] }
```

`id` is optional (namespaces the radio group so multiple `tabs` blocks on one
page don't collide) but recommended when a doc has more than one `tabs`
block. Each entry in `tabs[]` has a `label` and a `content` compose array;
the first tab renders checked/active by default.

### `split` — a two-column layout

Two independently-composed columns, side by side (stacks on narrow
viewports). Use for before/after, or any paired content that reads better
side by side than stacked.

```json
{ "type": "split",
  "seam": true,
  "left":  { "content": [ { "type": "prose", "text": "Left column." } ] },
  "right": { "content": [ { "type": "prose", "text": "Right column, divided by a seam gutter." } ] } }
```

`left.content` and `right.content` are each a `compose` array. `seam`
(optional, boolean) adds a divider line and tighter gutter between the
columns.

### `presence` — who is in this document right now

A row of reader chips, colored by state. Degrades to nothing when there are
no readers — a solo doc shows no chrome. (Presentation-only fixture data in
v0.11; W2/W3 bind this to the live CRDT session.)

```json
{ "type": "presence",
  "readers": [
    { "name": "Ada", "state": "here" },
    { "name": "Grace", "state": "idle" },
    { "name": "Hedy", "state": "away" }
  ] }
```

`readers[]` entries need a `name`; `state` is one of `here` / `idle` / `away`
(unrecognized values fall back to `away` styling). An empty or absent
`readers[]` renders nothing.

### `sincelast` — what changed since the reader looked away

A small change digest — an optional `when` caption plus a list of changes,
each kind-colored and kind-iconed.

```json
{ "type": "sincelast",
  "when": "2 min ago",
  "changes": [
    { "kind": "added", "what": "a new section", "who": "Ada" },
    { "kind": "edited", "what": "the intro paragraph", "who": "Grace" },
    { "kind": "removed", "what": "a stale note" },
    { "kind": "commented", "what": "on the diagram", "who": "Hedy" }
  ] }
```

`changes[]` entries need a `what`; `kind` is one of `added` / `edited` /
`removed` / `commented` (unrecognized values fall back to `edited` styling)
and `who` is optional per-change. An empty or absent `changes[]` renders
nothing.

### `attribution` — a compact "whose is this" marker

An inline badge for pinning authorship next to a comment or block — who,
optionally what kind of action, optionally when.

```json
{ "type": "attribution", "who": "Ada", "kind": "edited", "when": "just now" }
```

`who` is required; `kind` and `when` are both optional.

<<<<<<< HEAD
## Catalog — batch 1 from the corpus scout (stddoc-primitive-scout)

Mined from a 161-file pre-std-doc HTML corpus (`the primitive-candidate scout notes`
on `stddoc-primitive-scout`'s branch) by doc-count × expressive-gain. All eight
are pure data-templates, verified live in `examples/primitive-gallery/`.

### `stats-bar` — big-numeral headline stat tiles (30 corpus docs — highest doc-count of any candidate)

The report-opening hero row: "47 findings, 12 critical" as bold numerals over
small uppercase labels. Distinct from `badges` (small key:val text pills) —
stats-bar is the visual-weight headline.

```json
{ "type": "stats-bar", "stats": [
  { "value": "47", "label": "Findings" },
  { "value": "12", "label": "Critical", "kind": "bad" }
] }
```

`kind` (optional, per-stat) tints the numeral through `palette_var`.

### `legend` — swatch + label key for a color-coded diagram (14 docs)

```json
{ "type": "legend", "items": [
  { "kind": "hot", "label": "01 Personality" },
  { "kind": "good", "label": "02 Harnesses" }
] }
```

### `table-list` — compact name/note list, lighter than `table` (3 docs)

A `<ul>` styled to read as two-column tabular data, no header row.

```json
{ "type": "table-list", "items": [
  { "name": "chart_of_accounts", "note": "~60 GL codes" }
] }
```

### `schema-grid` — grouped schema boxes, each a colored name pill + table-list (4 docs)

```json
{ "type": "schema-grid", "boxes": [
  { "name": "meta", "kind": "hot", "desc": "Reference data.",
    "tables": [ { "name": "chart_of_accounts", "note": "~60 GL codes" } ] }
] }
```

Note for extenders: `schema-grid`'s inner list is hand-inlined (not a
`compose` of `table-list` blocks), so its CSS duplicates `table-list`'s rules
under `.schema-box .table-list` in `primitive_css.json` — the CSS-per-type
collector only emits a primitive's CSS when a block of that exact `type`
appears on the page, so a nested-but-never-standalone list needs its styling
folded into the parent's CSS entry, not just referenced by class name.

### `phase-strip` — auto-fit grid of risk-banded plan phases (5+ docs)

A build sequence / migration plan, each phase a bordered card colored by risk.
Distinct from `pipeline` (a connected left-to-right flow) — phase-strip is an
unconnected grid, no "active" state.

```json
{ "type": "phase-strip", "phases": [
  { "num": "Phase 0", "name": "Pre-flight emergencies",
    "desc": "Drain the backlog.", "effort": "3-5 shifts", "kind": "bad" }
] }
```

### `verdict-box` — a capstone judgment block (8 docs)

Lighter than `decision` (a structured question/chosen/rationale record) —
verdict-box is a label + short verdict phrase + free prose payoff.

```json
{ "type": "verdict-box", "label": "Plane verdict",
  "verdict": "appropriate_but_chaotic", "kind": "good",
  "text": "The canon WORKS. See [notes](https://example.com/n) for detail." }
```

`text` flows through `rich` (markdown links render); `kind` sets the border
color via `palette_var`.

### `disclosure` — native `<details>/<summary>`, zero JS (survey-flagged gap, 0 hand-authored instances)

Collapsed-by-default deep detail — the "summarize, click through to depth"
thesis (the project conventions §3.V), literally. No custom CSS needed; freeze-safe by
construction (a native browser element).

```json
{ "type": "disclosure", "summary": "Full stack trace", "open": false,
  "content": [ { "type": "prose", "text": "..." } ] }
```

`content` is a `compose` slot, same pattern as `showcase`/`split`.

### `tag` — bare inline colored uppercase stamp (11 docs, temperature words)

Lighter than `chip` (which carries a background/border accent chrome meant
for block or tag-row usage) — `tag` is the mid-sentence "the `hot` lane..."
stamp with no icon or entity decoration beyond the color itself.

```json
{ "type": "tag", "kind": "hot", "label": "hot" }
```

**Deliberately not built this batch** (scout-flagged as already covered,
recorded here so the next builder doesn't reopen them): `gauge-box` (a
two-column verdict+detail layout — already expressible as `split` wrapping a
`badges`+`prose` pair; no new primitive needed) and `opposed-pair` (old/new,
wrong/right, coupling/contract framing — already expressible via `compare`'s
existing `left`/`right` `title`+`pill`+`items`+`accent` fields).

### `landscape-ascii` — a box-drawing ASCII diagram with per-segment semantic color (5 corpus docs — SURVEY-NOTES F5, "CANONICAL — not a one-off")

Flagged "needs-Go (borderline)" in the original candidate writeup: the
existing `ascii` primitive escapes the whole diagram as one opaque string
(`{"esc": "ascii"}`) by design, so no inline span can cross that boundary —
a colored-segment diagram needs a genuinely different data shape. Turned out
to be **data-only** after all — a nested `each` (lines → segments) is already
supported by the template interpreter; each segment's own `kind` resolves
correctly (not the parent line's) because the interpreter's env-frame stack
shadows `@item` per nesting level.

```json
{ "type": "landscape-ascii",
  "lines": [
    [ { "text": "┌───┐", "kind": "frozen" } ],
    [ { "text": "│ " }, { "text": "01 PERSONALITY", "kind": "frozen" }, { "text": " │" } ],
    [ { "text": "│ " }, { "text": "↳ ghost", "kind": "bad" }, { "text": " │" } ]
  ] }
```

Each line is an array of segments; a segment with no `kind` renders as bare
escaped text (no `<span>` at all — proven by the empty-degrades test), a
segment with `kind` gets its own `--c` accent via `palette_var`, exactly like
`pill`/`callout`. Lines join with a real newline inside one `<pre>`, so
monospace alignment is preserved. Every `kind` used must be a palette entity
the doc actually declares — the security gate refuses to render an
undeclared one (confirmed live: the gallery sample initially omitted
`frozen` from its palette and got a loud, correct render error instead of a
silent drop).

## Catalog — batch 3/4 from the corpus scout (sweep complete, 22 candidates total)

The scout's sweep of all 161 corpus files finished across 4 batches. These
four close out the highest-value remaining candidates.

### `finding` — the atomic unit of a findings-driven detective report (the scout's own "single highest-value candidate in the whole scout")

id + severity + headline + optional file:line `where` + optional nested
`evidence` sub-block. Before this, std-doc had no way to express
severity-colored prose outside the wrong-shaped `tree` primitive (a
hierarchical decision cascade, not a flat findings list) — `callout` came
close but has no `id` slot, no `where` sub-line, and no nested evidence
block: three missing structural pieces, not a styling variant.

```json
{ "type": "finding", "id": "F1", "severity": "high",
  "headline": "FIXER COMPOSITION BUG — load-bearing architectural flaw",
  "where": "lib/base.py:149",
  "evidence": "MEASURED. Root cause confirmed via direct trace." }
```

`severity` colors both the left border and the `id` chip through
`palette_var`; `where`/`evidence` flow through `rich` so markdown links
render.

### `enrich-steps` — a dense micro-grid of numbered steps (3 corpus docs)

Confirmed distinct from `flow` by inspecting its template: `flow` is
hardcoded to a connected linear sequence (arrow/dot connectors between
steps), no grid layout option exists. `enrich-steps` is the unconnected
auto-fit grid version — 3-5 short steps as small cards in a row.

```json
{ "type": "enrich-steps", "steps": [
  { "num": "STEP 1", "name": "Parse", "desc": "Tokenize the raw input." }
] }
```

### `pattern-header` — a bordered section-level chapter header (Dialect B canonical vocabulary)

Confirmed distinct from `hero` by inspecting its template: `hero` is a bare
`text`+`sub` pair with zero border/box framing — page-opening statement, not
a repeatable section marker. `pattern-header` is the bordered box with a
small uppercase "era" eyebrow above an `<h2>` and a description below,
marking "you are entering a new major section."

```json
{ "type": "pattern-header", "era": "Rebuild Era · 2026",
  "title": "The Seven Planes",
  "desc": "How the architecture divides into seven planes." }
```

### `timeline-infographic` — a vertical numbered walk connected by a drop-line (SURVEY-NOTES F7, the SwiftServe diagram gallery)

Heavier/more presentational than `howto`/`flow` — built for an
executive-friendly explanation of a sequential process. Each step: a
numbered circle, title, description, optional icon row, optional timing.
**Built without auto-alternation** (the original corpus CSS uses
`nth-child(even)` for a two-tone left-to-right sway) — the template
interpreter has no modulo/parity condition op (confirmed by reading
`evalCond`'s full op list in `go/internal/template/template.go`: truthy,
falsy, eq, and, or, not, any, in, eqp, isdict — no mod), so each step's
color is an explicit author-set `kind` field instead, matching the scout's
own documented fallback ("less magic, more portable across the
interpreter's current feature set").

```json
{ "type": "timeline-infographic", "steps": [
  { "num": 1, "title": "Client Sends Request", "desc": "Picks a transport.",
    "icons": ["🐍", "🐹"], "timing": "~1ms", "kind": "glow" }
] }
```

**Deliberately not built** (scout-flagged, single-document evidence, low
marginal value per the brief's own doc-count × expressive-gain ranking):
`overlap-matrix`, `ghost`, `lifecycle-step`, `pre.seq`, `pyramid-card`
interior, `grid.three/four/wide-narrow` column variants — each a small
mechanical extension of an already-shipped pattern (matrix-row, callout,
badge coloring, cardgrid columns), not a new expressive idea. Also not
built: 3 of the SwiftServe gallery's other 5 diagram patterns are
CDN-dependent (fail the freeze covenant outright), 1 is bespoke one-off SVG
art (use `figure` instead), and `radial` (hub + ring nodes) and
`layered-integration` are plausible future candidates needing real design
scoping, not mechanical extraction.

## Leaf-vocabulary extensions — closing the template GAPS worklist

Two independent strategists measured that std-doc's CONTAINER vocabulary
(page-layout arrangement) converges — three layout modes permanently close
arrangement — while the LEAF vocabulary (a primitive's own rendered shape)
does not: a 22.3x gap between the two convergence curves. `GAPS.md`
(`stddoc-template-scout`'s branch) names five LEAF gaps, evidenced by
building real template families. This section closes the two most
load-bearing ones.

### `panel` — extended with a palette-validated `kind` (gap #6)

Dialect B's 9-variant panel (`.warn`/`.bad`/`.good`/`.info`/`.hot`/`.warm`/
`.cold`/`.frozen`/`.evol`) is load-bearing in every Dialect B corpus doc.
`panel` previously took only `variant` (a free CSS-class-suffix string, NOT
palette-validated) + `lead` + `body` — no color-coding hook at all. Two
strategists hit this exact seam (`panel.frozen`) independently, on the same
afternoon, from opposite directions.

```json
{ "type": "panel", "variant": "hairline", "kind": "frozen",
  "lead": "01 Personality", "body": "Frozen at LOAD_BEARING." }
```

**Load-bearing implementation note:** the accent (`--c` custom property +
`border-left`) is emitted ENTIRELY via an inline `style=` attribute, with
ZERO change to `primitive_css.json`. `panel` is already used on
golden-pinned pages (`conformance/cases/self-doc`, `conformance/cases/
m2-extends`) — CSS is registered per-TYPE, statically, in
`go/internal/registry/registry.go`, with no per-instance or "earn your own
CSS" mechanism. The first attempt at this feature added a
`.panel.pn-kind{...}` rule to `primitive_css.json` and it broke both golden
fixtures' bytes immediately (MEASURED), even though neither fixture's
existing `panel` blocks use `kind` — because CSS is collected once per type
present on the page, unconditionally. If you extend an EXISTING,
golden-pinned primitive with new visual behavior, prefer inline `style=`
over growing its registered CSS string, unless you're prepared to
deliberately regenerate the affected goldens.

### `richcode` — a new interpreter op for inline code spans (gap #2)

The scout's own words: "backticks in prose render as literal characters;
there is no `<code>` anywhere in the render path" — filed as the single
highest-value fix for the Domain/System Reference template family, whose
prose is mostly file:line and symbol citations threaded inline.

```json
{ "type": "finding", "id": "F1", "severity": "high", "headline": "...",
  "where": "the block's `type` field selects the handler — `lib/base.py:149`",
  "evidence": "MEASURED. Confirmed by reading `PreToolUseContext.tool_input` directly." }
```

Single backticks become `<code>` chips; markdown links `[text](url)` still
work in the same field (richcode is a superset of `rich`, not a
replacement). No custom CSS was added — inline `<code>` renders through the
browser's own UA stylesheet (monospace), matching the `kbd` precedent
already in `body.css`.

**Load-bearing implementation note — why a NEW op instead of extending
`rich`:** this repo's own self-hosting corpus (`self-doc/source.json`,
pinned into `conformance/cases/self-doc`) already contains abundant
single-backtick prose (`` `stddoc publish` ``, `` `type` ``, …) written
*before* this feature existed, in ordinary `rich`/`esc` fields. Wiring
code-span parsing directly into the shared `richInline`/`richText` functions
(the first attempt) flipped 11 self-doc/m2-extends pages' bytes — a real,
MEASURED collision, not hypothetical. So the fix ships as a **separate**
function pair (`richInlineCode`/`richTextCode` in `go/internal/core/util.go`)
reached only through a **new** template node, `{"richcode": "field"}`,
distinct from `{"rich": "field"}`. Every existing `rich`/`esc` template field
is byte-for-byte untouched; only fields that explicitly opt in (so far:
`finding.where`, `finding.evidence`) get code-span support. Extend this
list additively as more leaf gaps want it — never widen `rich` itself
without first grepping the corpus for literal backticks in already-pinned
`rich` fields (grep the golden doc-source JSON for literal backtick characters
before touching `richInline`/`richText`).

### `cardgrid` — extended with an `owner` (lane-identity) slot (gap #8)

The corpus's `lane l01`..`l10` classes (LEO_ARCHITECTURE.html "The 10
lanes"; SURVEY-NOTES.md Finding F8) are a dedicated component: a card
carrying an owner/lane-number identity distinct from a generic title+body.
The scout's own writeup rated this lower-confidence than gaps #2/#6 —
`cardgrid`'s existing `eyebrow` field substitutes adequately, so this
wasn't proven to be a hard block, just a named concept the substitution
loses.

```json
{ "type": "cardgrid", "cards": [
  { "owner": "Lane 03 · IndexService", "ent": "glow",
    "title": "Query routing", "body": "Owns the read path." }
] }
```

`owner` renders as a distinct uppercase identity line above the title
(visually different weight from `eyebrow`, which can still be used
alongside it). Same inline-style-only implementation as `panel.kind`:
`cardgrid` is already used on golden-pinned pages
(`conformance/cases/cardgrid-variants`, `conformance/cases/self-doc`), so
the CSS-per-type trap applies identically — no growth to
`primitive_css.json`'s `cardgrid` entry.

### gap #7 — `pattern-header`, resolved before this pass started

GAPS.md gap #7 ("no `pattern-header`: framed chapter-opening h2") was
already closed by the batch-3 primitive sweep (`e01ee4d`, this repo's own
history) — the `pattern-header` primitive (era eyebrow + title + desc,
bordered box) matches the gap's exact ask. No further work needed; noted
here so a future pass doesn't reopen it.

### Leaf-gap status after this pass

Of GAPS.md's five LEAF gaps: **#2, #6, #7, #8 are closed.** Gap #1 and #3
are CONTAINER gaps (the layout language's problem, not a primitive's).
Gap #4 is also CONTAINER (a captain/detective dual-view of one node). No
further LEAF gaps are open as of this writing — the leaf-vocabulary
backlog GAPS.md handed off is exhausted to the evidence `GAPS.md` itself
provided; new leaf gaps would need a fresh corpus pass (the scout's sweep
that produced GAPS.md is separately marked complete on their branch).

## Leaf shapes from the leaf-gap worklist (stddoc-html-first-strategist)

A second, independently-measured leaf-gap worklist (document-frequency-ranked
over a 73-doc deduplicated corpus, `the leaf-gap worklist`,
`stddoc-html-first-strategist`'s branch) surfaced three real gaps plus three
more name-mismatches. Batch 1 of that split:

### `quote` — an italic pull-quote with an optional attribution (8 docs)

```json
{ "type": "quote", "text": "The kingdom CAN do everything it needs.",
  "who": "the detective's headline" }
```

### `kv` — a key/value grid row, distinct from `table-list` (6 docs)

Corpus shape: EACH row is its own `.kv` grid div (`grid-template-columns:
200px 1fr`), sibling rows — not one `.kv` wrapping many. `v` flows through
`richcode` (the corpus's own `kv` usage already threads inline `` `code` ``
through its values).

```json
{ "type": "kv", "rows": [
  { "k": "Engine", "v": "Plain `str.replace` for `{{ placeholder }}`" }
] }
```

### `synthesis-note` — a tinted callout with a fixed bold lead-in (10 docs)

```json
{ "type": "synthesis-note", "text": "Predecessor made 32 tool calls. Killed at write step." }
```

`label` is optional and defaults to `"Synthesis note:"` — note the
implementation trap: the bold lead-in must render UNCONDITIONALLY (with a
default), not be gated behind `{"if": {"truthy": "label"}}`, or an absent
label renders nothing at all instead of falling back. `esc`'s `"default"`
only fires when the resolved value is `nil`, not on an explicit empty
string — caught by PROVEN RED on the first attempt.

### Three worklist entries that are name-mismatches, not gaps

- **`pill-lane`** — the corpus's own markup is `class="pill pill-lane"`: an
  existing `pill` usage with a fixed silver/neutral color, not a new shape.
  Already expressible via `pill`'s palette-validated `ent` field with a
  declared neutral/lane entity.
- **`comment`** (and its sibling `keyword`) — code-syntax-highlighting span
  classes inside a `<pre>` block, already covered by the `code` primitive's
  `t-comment`/`t-keyword` spans under different names.
- **`phase`** — the inner card class of `.phase-strip`, already built this
  shift as the `phase-strip` primitive (`phase-strip .phase`).

### Which primitives accept tone today (load-bearing for anyone building a utility-class layer)

`callout`, `panel`, `pill`, and `prose` all set `color:` directly on their
own content element at specificity (0,2,0) or higher — a bare utility class
at (0,1,0) LOSES that specificity contest and silently does nothing (the
exact "class in the DOM, rule on the page, colour didn't apply" pixel-only
trap). Retrofitting those four to accept an external tone utility is a
default-as-utility refactor that CHANGES rendered output for every existing
page using them — a deliberate re-baseline decision, not something to take
on initiative. `table`, `chip`, and `badges` set no color of their own and
are additive-safe for a tone layer to target.

## Bug fix — the `text` page atom silently dropped composed content

Found by `stddoc-lint-hardener`'s reachability diff: the `text` page atom
(`go/stddoc-lib/page_atoms.json`) was `{"esc": "s"}` only — but authored docs
use `text` in TWO shapes, a leaf span (`{"type":"text","s":"..."}`, reads
`s`) and a paragraph-level container composing inline runs
(`{"type":"text","content":[{"type":"text","s":".."},{"type":"code","s":".."}]}`
— the same pattern `kicker`/`heading` already use for their own `content`).
The atom never read `content` at all, so every container-shaped `text` block
rendered as a literally empty string. Hit in production:
`examples/starter-no-nav/source.json` (all its body paragraphs) and, per the
finding, `style-interview/demo/source.json` — the onboarding tutorial, the
first thing a stranger sees.

**Fix:** `text` now composes `content` in addition to escaping `s`:

```json
[ {"richcode": "s"}, {"compose": "content"} ]
```

Safe for the leaf usage (the overwhelming majority of `text` atom usage):
`compose` on an absent `content` field resolves to `nil`, which renders as
`""` — confirmed in `go/internal/template/template.go`'s compose handler —
so every existing leaf span renders byte-identically. The `s` field was also
switched from `esc` to `richcode` (backtick → `<code>`), confirmed safe by
grepping every golden fixture's `text`-atom leaf strings for literal
backticks (none found).

**A second bug surfaced once the fix let the content through and the page
was actually rendered and looked at** (not just grepped): `content[]` arrays
nesting `{"type":"code","s":"..."}` rendered as an EMPTY styled box. Cause:
`install.go` deliberately keeps `code` out of the small collision-free atom
allowlist (`text`/`strong`/`soft`/`kbd`) used by the ordinary (non-`layout:
"page"`) doc-tree registry, specifically to avoid clobbering the
block-level `code` primitive (spans/mode/caption) of the same name — so a
nested `code` *atom* silently resolves to the block *primitive* instead,
which has no `spans` data and renders nothing. Fixed at the authoring layer
(not the engine): `examples/starter-no-nav/source.json`'s nested
`{"type":"code","s":"..."}` spans were rewritten as inline backtick markup
inside the surrounding `text` block's own `s` field, which now renders them
as `<code>` via `richcode` — no nested atom, no collision, in either
context. `style-interview/demo/source.json` was checked and does not
exhibit this shape (its `text`/`kbd` composition already worked, being leaf
usage inside `callout.lead_content`/`hint_content` — `kbd` IS in the safe
allowlist).

Test: `text_atom_content_bug_test.go` — the container form must render
non-empty (proves the fix), the leaf form must render byte-identically
(proves it's additive). PROVEN RED (reverted to `{"esc":"s"}` only,
reproduced the exact empty-string production bug, restored). Golden-master
hash unchanged.

## The page layout language — `row`, `grid`, `band` (the layout-language design note)

std-doc shipped exactly ONE content column in every layout (`250px 1fr`
default; `no-nav`/`top-nav`/`hero` all `1fr`) and forced every doc through
`node -> sections -> numbered §-cards -> items`. The only multi-column
construct anywhere was the per-block `split`. Three new containers close
that gap — a page-level composition axis, not another primitive. All three
are pure `templates.json` + `primitive_css.json` data, zero new Go for
rendering: they only ever call `Registry.Render` on their children (the same
entry point the page walk uses), so a container never needs to know about a
primitive that doesn't exist yet, and vice versa.

```
container  := band | row | grid
band  := { type:"band",  label?, title?, tone?, content: blockstream }
row   := { type:"row",   w?, gap?, align?, seam?, cols: [ blockstream, … ] }
grid  := { type:"grid",  min? | across?, gap?, content: blockstream }
blockstream := block | [ block, … ]
```

- **`row`** — N columns across, with weights (`w:"2fr 1fr"`, default equal
  `1fr` tracks). A column is a block OR an array of blocks — **the terseness
  trick**: `compose` already accepts either shape with no wrapper object
  (`{"each":"cols","body":[...,{"compose":"@item"}]}`), so a two-column row
  is 4 lines, and a column needing several blocks is just a bare array.
- **`grid`** — auto-flow: `across:4` (`repeat(4,1fr)`) or `min:280`
  (`repeat(auto-fill,minmax(280px,1fr))`). `content` is FLAT (no per-cell
  wrapper) — auto-flow means the author is explicitly not choosing
  placement, which is the whole semantic difference from `row.cols`.
- **`band`** — a labeled vertical region: a small all-caps `label`, optional
  larger `title`, optional `tone` (palette-var tint, same mechanism as
  `callout`), and a free `content` block stream. `band` is also the **TOC
  anchor** for the `reference` layout (below) — a bare stack with no label
  is fine too.

Grammar note paid for in a real crash: `row.cols` is a LIST of columns;
`grid.across` is an INTEGER count. They were both named `cols` in an early
draft until a measurement script hit `TypeError: 'int' object is not
iterable`. Keep them distinct — a tool (or a person) walking the doc-tree
will hit the same collision.

Worked example, `band > row > grid`, all one JSON tree:

```json
{"type":"band","label":"THE PLANES","tone":"glow","content":[
  {"type":"prose","text":"Seven planes, one substrate."},
  {"type":"row","w":"2fr 1fr","cols":[
    {"type":"panel","lead":"Left","body":"…"},
    {"type":"panel","lead":"Right","body":"…"}]},
  {"type":"grid","across":3,"content":[
    {"type":"panel","lead":"A","body":"…"},
    {"type":"panel","lead":"B","body":"…"},
    {"type":"panel","lead":"C","body":"…"}]}]}
```

**Nothing is replaced.** `sections[]` keeps working, byte for byte, forever
— containers are just authored blocks, legal everywhere a block already was
(including `at:"lead"`, which hoists a container exactly like a leaf
primitive). A document can migrate one region at a time. `split` is not
deprecated either: it is `row`'s two-column special case, it is in the
conformance goldens, and it costs nothing to keep.

**The TOC fix (the part that makes the language worth using).** The
`reference` layout's "on this page" aside used to derive only from
`sections[].name` (`renderOnThisPage`, `go/internal/core/page.go`). If the
expressive path cost its author their TOC, nobody would ever reach for it —
Covenant III ("great design is efficient") inverted inside the engine
itself. `collectTOCLabels` (`go/internal/core/labels.go`) now walks the
SAME adapted block stream the page body renders, in ONE pass, collecting
`sections[].name` (unchanged) plus `band.label`/`band.title` at any depth.
One pass matters: `adaptNode` hoists `at:"lead"` blocks BEFORE the synthetic
`sections` entry, so a lead band's TOC label must precede every section
name — a collector built from two separate loops (sections, then bands)
gets this backwards. Each band gets a stable anchor id
(`<slug>-band-<ordinal>`, `assignBandAnchorIDs` in `blocks.go`, mirroring
`assignCanvasBoardIDs`) stamped before render, routed through
`walkNestedBlocks` from the start so a band nested inside another container
is never missed. A document with no `band` gets a byte-identical aside to
before this fix existed.

Test: `go/internal/core/layout_language_test.go`. PROVEN RED — the TOC
tests were run with `collectTOCLabels`'s band branch disabled (a `return`
inserted before the type check) and confirmed to fail before the wiring was
restored; the assertions are scoped to the `<aside class='otp'>…</aside>`
substring specifically, because a band's own label div in the page BODY
contains the same text and an unscoped `Contains` check would pass even
with the wiring fully broken.

**A false-positive found and fixed along the way.** The lint reachability
probe (`lint_reachability.go`) re-renders a block in isolation to see what
it actually composes. Its `ctx.Palette` was `nil` — harmless until `band`,
the first primitive to pair `tone` (a `palette_var` reference) with
composed content in the SAME template. `palette_var` on a nil palette
returns a loud error, which aborted the template BEFORE reaching the
`each`/`compose` that walks `band.content`, and the probe read that as
"authored but never rendered". Fixed by threading the doc's real palette
into the probe (`lintDoc` builds it once, threads it through `lintBlocks` ->
`lintReachability`) instead of leaving it nil — an empty palette would still
error loudly on an undeclared key (that's correct, undeclared palette keys
are a real authoring mistake), it just no longer confuses "undeclared" with
"unreachable".

### `stamp` — a document-header signature block (leaf-gap-worklist batch 2, 5 docs)

Right-aligned monospace date + N colored role attributions on one line, an
optional plain caption line below. Distinct from the existing `attribution`
primitive (a single-line inline "who [kind] [when]" chip, not a
document-level 2-line header with multiple palette-colored role spans).

```json
{ "type": "stamp", "date": "2026-05-14",
  "roles": [
    { "name": "Captain Codefactory", "kind": "accent" },
    { "name": "Mr. Dragon", "kind": "hot" }
  ],
  "caption": "kingdom architecture · synthesis pass" }
```

**Implementation trap caught by PROVEN RED (empty-degrades test):** the
`&middot;` separator between date and roles must be conditional on BOTH
being present (`{"and": [{"truthy":"date"},{"truthy":"roles"}]}`), not just
on `date` — the first attempt emitted a trailing `&middot;` with nothing
after it whenever roles was absent.

### Tier 2 worklist entries closed WITHOUT a new primitive

- **`card-title`/`card-body`** — semantically the same title-over-body card
  shape `cardgrid` already renders, just under different corpus class names
  (`.card`/`.card-title`/`.card-body` vs. `cardgrid`'s `.ent-card`/
  `.ec-title`/`.ec-body`). A `cardgrid` with one card in `cards[]` already
  covers this.
- **`issue-title`** — the Gitea-export dialect (`out-*.html`, auto-rendered
  from Gitea API data), the same "not human-authored" category
  SURVEY-NOTES already flagged as out-of-scope (the same evidence class
  that made `disclosure`'s corpus precedent zero-hand-authored).
- **`sig`** — plain multi-line monospace prose with no other chrome (5
  docs, near-identical to what `prose` already renders with a mono
  font-family). Too low-value/low-differentiation from existing prose to
  justify a dedicated primitive at this doc count.

This closes the Tier 2 split from `the leaf-gap worklist`
assigned to the leaf-vocabulary owner.

### `subtitle` — the deck line under a heading

A standfirst: one or two sentences under the title that tell the reader what
the page is before the body starts. **MEASURED: the most-shared shape in the
corpus — 56 of 73 content-unique documents use it** and nothing emitted it
until now (`the leaf-gap worklist`, Tier 1).

```json
{ "type": "subtitle", "text": "What this page is, in one line." }
{ "type": "subtitle", "text": "A warning deck.", "tone": "amber" }
{ "type": "subtitle", "text": "A quiet aside.", "tone": "dim", "tight": true }
```

`text` is required. `tone` is optional and accepts exactly
`amber` · `green` · `red` · `purple` · `gold` · `lavender` · `dim` · `quiet`.
`tight` is an optional boolean that closes the vertical space.

### `stats` — a row of value+label tiles

The KPI/measurement strip. **MEASURED: one shape behind seven different corpus
class names** (`stat` · `stats` · `stats-bar` · `stat-val` · `stat-lbl` ·
`stat-label` · `stat-num`), used in 45 of 73 content-unique documents — the
densest single gap in the corpus after `subtitle`.

```json
{ "type": "stats", "items": [
  { "value": "10",  "label": "lanes" },
  { "value": "99+", "label": "actor declarations in Core" },
  { "value": "16",  "label": "CLI commands", "tone": "amber" },
  { "value": "10 s", "label": "replan interval", "tone": "green", "note": "p50" }
] }
```

Each item takes `value` and `label`; `tone` and `note` are optional. The row
reflows by default (engine-chosen proportions); `"across": 4` pins an explicit
column count (2–6).

## The utility layer — tone as an orthogonal axis

`tone` above is not special to `subtitle`. It is the first consumer of a
**utility layer** that exists because of a corpus measurement: after
`subtitle`, the most-shared vocabulary in the corpus is a set of bare tone
modifiers applied to arbitrary elements (`green` in 27 documents, `amber` 25,
`purple` 23, `red` 20, `tight` 12). **No primitive can absorb that, because a
tone is not a thing — it is a property of any thing.**

The layer lives in `go/stddoc-lib/utility_css.json` and obeys three rules that
are enforced by tests in `go/internal/core/utility_test.go`, not by convention:

1. **Every rule binds to a palette token**, never a literal colour, so
   `--style` swaps the whole look. A hard-coded colour fails the build.
   Every `var(--token)` used must be defined by *all three* shipped styles —
   also a test, so a utility can never silently render unstyled under one theme.
2. **Emission is usage-scanned.** A page receives CSS only for the utility
   classes it actually contains; a page using none receives **zero bytes**.
   That is what keeps every pre-existing conformance golden byte-identical.
   (`body.css` could not be used: it is inlined into every page, so a rule
   there would re-baseline every golden.)
3. **Authors never supply a raw class.** A template maps an author *token*
   through a whitelist lookup — the `code` primitive's established pattern — so
   the only classes that can reach a page are keys of `utility_css.json`. The
   author declares intent; the engine emits the markup.

To give a new primitive tone support, copy the `subtitle` template's lookup
block. To add a new utility, add one key to `utility_css.json` — it is data,
and the tests will tell you if it is not themeable.

### Which primitives accept `tone` today

`subtitle` (whole line) · `stats` (per item) · `table` (per cell — the dict
cell form `{ "text": "DEAD", "tone": "red" }`). A cell with no `tone` renders
exactly the `<td>` it always did, so the addition is byte-identical for every
existing page.

**Why not `callout` / `panel` / `pill` / `prose` yet:** each of them sets
`color:` on its own content element at specificity 0,2,0, which beats a tone
utility (0,1,0) — see the specificity trap below. Adding tone there requires
the same default-as-utility refactor `subtitle` uses, and that *changes
existing rendered output*, so it is not additive and needs its own deliberate
re-baseline decision. Do not bolt tone onto them without doing that work.

### The specificity trap — read this before adding tone to a primitive

**A primitive must not set `color:` on the element that carries the tone
class.** `stats` originally shipped `.stats .stat-val{…color:var(--text)…}`
(specificity 0,2,0) on the toned element, and `.u-amber` is 0,1,0 — so the
primitive won. The author's `"tone":"amber"` was accepted, the `u-amber` class
was in the DOM, the `.u-amber` rule was on the page, **and the value still
rendered in the default colour.** Every string-level check passed. Only the
rendered pixels and the computed style revealed it.

The fix is not "remove the colour" — it is **make the default a utility too**.
`subtitle` emits `u-quiet` when no tone is given, which is the same
`var(--text-2)` it always had. The primitive then declares no colour at all,
there is no specificity contest, and default and toned output are produced by
one uniform mechanism.

`TestUtilityLayer_PrimitivesDoNotOverrideTone` derives the toned element's
class from `templates.json` and fails the build if that primitive's CSS sets
`color:` on it. It also fails if it finds *no* tone-capable primitive, so the
guard can never silently protect nothing.

## When a primitive is core-owned (Go) instead

A few primitives are **not** pure HTML-templating and live in `go/internal/core`
rather than the data library: `sections` (core numbering + anchors), `evidence`
(the collapsed `<details>` drill-down), `diagrams` (a per-item dispatcher), and
the diagram primitives `swimlane` / `statetrack` / `tree` (d2 rendered
**in-process**, native Go — no shell-out — with mermaid as the fallback). These
register through the same boundary the data-templates do; everything else should
be a data-template.

## Where things live

| piece | path |
|---|---|
| the library (templates + CSS, as data) | `go/stddoc-lib/templates.json`, `primitive_css.json` |
| the template interpreter | `go/internal/template/` |
| registry (dispatch + error boundary) | `go/internal/registry/` |
| core (numbering, anchors, blocks stream, palette, d2, gate) | `go/internal/core/`, `go/internal/palette/`, `go/internal/gate/` |
| the format spec | `protocol/declarative-format.md` |
| conformance (byte-identical golden master) | `conformance/`, `go/internal/core/conformance_test.go` |
