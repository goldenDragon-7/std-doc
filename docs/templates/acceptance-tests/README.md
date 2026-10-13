# Acceptance tests for the container axis (band/row/grid + tabs)

`stddoc-layout-builder` is building the container vocabulary from the
completed design (GAPS.md gap #1 tabs, gap #4 dual-view derivation). Per
std-doc's direction, I'm the acceptance test: when containers land, I take a
**real corpus document**, rebuild it, and report exactly where it hurts — not
a fixture, not a synthetic case designed to pass.

This directory is prep work done AHEAD of containers landing, so the test can
start the moment they do, instead of costing a round-trip on "which document,
which tabs, what content." If the container design shifts before it lands,
this analysis is still valid — it's a corpus fact, not an implementation bet.

## RESULT — Test 1, first pass: `tabs` (already on main) already passes this

**Before the container axis (band/row/grid) even landed**, I tested whether
the EXISTING `tabs` primitive (batch-1, already on `main`, `id`+`tabs[].label`+
`tabs[].content`) could hold the personality-report's 7 heterogeneous panels —
the sharpest test I designed below, unmodified. Result:
`docs/templates/acceptance-tests/personality-report-tabs.json`, published to
`personality-report-tabs-published/` — **MEASURED zero `std-doc-error`
markers**, all 7 tab labels render (`Overview`…`For the strategist`), and
EVERY heterogeneous content type inside a tab renders correctly: `callout`+
`cardgrid` together, `table-list`, a second `cardgrid`, `flow`, a real
`finding` block (including its `richcode` citation — `<code>configs/CLAUDE.md</code>`
rendered inside a tab, not just at top level), `compare`, and `kv`.

**This means gap #1's severity is lower than originally scoped.** The
CONTAINER problem was never really "tabs can't hold arbitrary content" — it's
"authoring a document as `tabs` at the top level means opting OUT of the
`sections`/numbered-§-card structural path entirely, by hand, one document at
a time." That's real and still worth the layout language solving cleanly, but
it's an authoring-ergonomics gap, not a rendering-capability gap. Recording
this here rather than silently updating GAPS.md's severity claim, because the
distinction matters for how `stddoc-layout-builder` scopes the rest of their
work — and because a self-correction found by testing beats one left standing
on an earlier, less-informed claim.

**Test 2 (dual-view derivation, gap #4) and the harder edges of Test 1**
(nested containers, band/row/grid specifically, TOC behavior with a
tabbed top-level) are still open — this result covers the `tabs`-only case,
which happened to be testable immediately with what was already on `main`.

## RESULT — Test 1, second pass: band/row/grid, first try, clean pass

`cf4e980` ("the page layout language — band/row/grid, and the end of the
straightjacket") landed on `main`. Rebuilt the SAME 7-section structure as
`personality-report-tabs.json`, this time as `layout:"reference"` with one
`band` per section instead of one `tabs` panel — a genuinely different
container axis (spatial/scrollable-with-TOC, not selective/switchable) —
using `row` for the two-column "Design verdict" comparison and `grid` for
the "Subsystems" two-panel layout.

**Artifact**: `personality-report-bands.json` /
`personality-report-bands-published/`. **MEASURED, first attempt, zero
fixes needed**:

- Zero `std-doc-error` markers, `stddoc lint` clean.
- The `reference` layout's TOC aside correctly lists all 7 bands **in
  document order**, with working anchors (`#t-band-1` … `#t-band-7`,
  labels `OVERVIEW` … `FOR THE STRATEGIST`) — this is the exact TOC-fix
  behavior the design doc promised (`protocol/primitives.md:~800`), and it
  held on a real (reconstructed) corpus document, not just the design's own
  fixture.
- `row` emitted real `grid-template-columns:1fr 1fr` CSS — a genuine
  spatial container, confirmed by grepping the rendered style attribute,
  not inferred from absence of errors.
- `grid` emitted real `grid-template-columns:repeat(2,1fr)` CSS.
- The `finding` block's `richcode` citation (`` `configs/CLAUDE.md:12` ``)
  rendered correctly as a real `<code>` chip NESTED two levels deep inside
  a `band`'s `content` stream — confirming leaf primitives and containers
  compose cleanly, not just container-of-container.

**Verdict on gap #1 (updated a second time, transparently)**: with BOTH
`tabs` (selective) and `band`/`row`/`grid` (spatial) now confirmed against
a real, previously-unreachable corpus document, **gap #1 is functionally
closed at the rendering-capability level**. What remains, as noted above,
is authoring ergonomics (restructuring an existing `sections`-based doc into
containers is manual) — a real but much smaller problem than originally
scoped. This is the strongest possible evidence for that claim: a container
vocabulary built to pass its own unit tests, tried cold against a real
corpus page it was never fixture-tuned to, on the first attempt, with zero
fixes required.

## Still open

**Test 2** (gap #4, dual-view derivation) has not been attempted yet — it is
more of an authoring-workflow question than a container-rendering one (see
its section above), so it may not even be `stddoc-layout-builder`'s to
solve. Will attempt it next unless redirected.

## Test 1 (original plan, now partially answered above) — `01_personality-report.html`

**Why this document**: it is GAPS.md gap #1's own original evidence — a
Dialect A report whose top-level content is genuinely 7 mutually-exclusive
views, not one linear scroll. This is the document that couldn't be
reproduced by the detective-findings-report family without flattening its
tab structure into stacked sections.

**Corpus location**: `curate/samples/02-kingdom-review/01_personality-report.html:111-118` (tab bar), `:122-684` (tab panels)

**The 7 tabs, verbatim**:

| # | `data-tab` | Label | Content shape | Primitives (once contained in a tab) |
|---|---|---|---|---|
| 1 | `overview` | Overview | thesis + stats + component list | `callout`, `stats-bar`/`badges`, `cardgrid` |
| 2 | `files` | Files inventoried | flat list with counts | `table-list` |
| 3 | `subsystems` | Subsystems | 8 cards, each a `<dl>` of key:value facts | `cardgrid` outer, `kv` per card |
| 4 | `flows` | Data flows | 3 numbered flows, each a `<pre>` trace | `flow` or `code` per flow |
| 5 | `findings` | Findings | severity-grouped findings | `finding` (×N, this is EXACTLY what `finding` was built for) |
| 6 | `verdict` | Design verdict | works-well / smells pair + one-sentence summary | `compare`, `verdict-box` |
| 7 | `questions` | For the strategist | open questions | `kv` or `prose` |

**What the test proves or disproves**: can a container hold 7 heterogeneous
sub-trees (a card grid, a flat list, a nested card-of-kv structure, N finding
blocks, a compare pair) and switch between them, OR does the container only
support homogeneous repeated content (which would mean tabs solve the
*navigation* problem but not the *heterogeneous composition* problem this
document actually needs)? **This is the sharpest test available in the whole
corpus** — if this document reproduces cleanly, the container design is
sound for the general case, not just the easy one.

**Pre-staged content mapping**: `docs/templates/acceptance-tests/personality-report-tabs.json`
(WRITE THIS when containers land — field shapes below are already decided
from the corpus read above, so authoring it is mechanical, not exploratory).

## Test 2 — gap #4 (dual-view derivation): `01_surfaces-report_captain.html`

**Why this document**: it's the exact corpus pair `docs/templates/captain-synthesis-brief/`
was modeled on — SURVEY-NOTES.md Finding F2's confirmed pattern (10 of 10 Leo
lanes ship both a detective and a captain variant of the SAME underlying
investigation). Today, authoring both views means hand-maintaining two
separate `source.json` trees with no shared source of truth — exactly the
gap #4 problem.

**Corpus locations**:
- Full: `curate/samples/03-leo/01_surfaces-report.html`
- Compressed: `curate/samples/03-leo/01_surfaces-report_captain.html`

**What the test proves or disproves**: whatever "view" mechanism the layout
language ships (if any — this may end up out of scope, per GAPS.md's own
framing that this is more of an authoring-workflow question than a pure
container question) — the test is whether `docs/templates/detective-findings-report/`
and `docs/templates/captain-synthesis-brief/`'s ALREADY-SHIPPED worked
examples (same underlying cron-substrate investigation, same facts, two
different presentations) could be derived from ONE shared node instead of
two independently-authored ones. If yes: a real workflow improvement,
measurable in reduced duplication. If no (the two views need genuinely
different authorial judgment about what to cut, not just a different
template) — that's a valid, useful negative result too, and worth stating
plainly rather than forcing a "yes."

## Protocol when containers land

1. Ping `stddoc-layout-builder` (or wait for their ping) to confirm what's ready.
2. Rebuild Test 1 FIRST (it's the harder, more diagnostic case).
3. Publish, open the rendered output, compare side-by-side against the
   original `01_personality-report.html` — not a mental comparison, an actual
   side-by-side.
4. Report specifically: what rendered correctly, what didn't, and whether the
   gap is in the container primitive itself or in how I composed it.
5. Only then attempt Test 2.
6. Update GAPS.md with the result either way — a passing test closes gap #1;
   a failing test becomes a sharper, evidence-backed gap #1 restatement.
