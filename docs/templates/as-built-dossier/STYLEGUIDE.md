# As-Built Architecture Dossier

## When you reach for this template
**Multiple people are about to go investigate different parts of ONE system
independently, and need to start from the same picture.** Use this when you
are the phase-1 orientation document that precedes N parallel deep-dives —
LEO_ARCHITECTURE.html's own subtitle says it plainly: "canonical orientation
for the ten lane detectives." It is the single document every subsequent
Detective Findings Report in the set will cite back to.

Don't reach for this for a single system (→ Domain/System Reference), and
don't reach for it as a substitute for the individual lane reports it
precedes — it deliberately stays shallow per-lane so ten detectives can go
deep without duplicating each other's context.

## The document's shape

| # | Section | What it's FOR |
|---|---|---|
| 1 | Hero | States the system AND its purpose as a multi-reader orientation doc |
| 2 | Stat row | Scale before detail — lane count, marquee-finding count, axioms under review |
| 3 | Lede prose | Explicit statement of why this doc exists (shared starting picture, not N independent reconstructions) |
| 4 | Marquee findings callout | The 1-3 things every lane detective needs to know before they start, regardless of which lane they own |
| 5 | Lane card grid | One card per lane/component, entity-colored — this is the map every lane report will assume the reader has seen |
| 6 | Pipeline/flow | The cross-lane flow(s) that touch more than one lane — write path, read path |
| 6.5 | Seam diagram | Draws WHERE lanes touch and WHY it's risky — the seams table (§9) states facts, the diagram shows the shared wrong assumption visually, which a table of two rows cannot |
| 7 | ADR inventory | Decisions already made, with status — so a lane detective doesn't re-litigate them |
| 8 | System-level verdict box | The one axiom/invariant that the WHOLE system depends on, and its current health |
| 9 | Cross-lane seams table | Where two lanes touch, and the risk at that seam — this is where lane detectives should coordinate rather than duplicate |
| 10 | Open questions | Handed to the strategist, same as the findings-report family |

## Primitives used

| Section | Primitive | Notes |
|---|---|---|
| Hero | `hero` | |
| Stats | `stats-bar` | |
| Marquee findings | `callout` | |
| Lane grid | `cardgrid` | now with `cards[].owner` (landed on main `4e74d6d`, closing GAPS.md gap #8) — a real lane-identity slot distinct from `title`/`body`, not the `eyebrow` workaround this template originally used. Confirmed rendering as its own `.ec-owner` element, not folded into the eyebrow. |
| Pipeline | `flow` | lint suggested `pipeline`; kept `flow` for the same reason as the other families — this is a narrated trace, not a phase tracker |
| Seam diagram | `mermaid` | a dashed edge marks the seam-risk itself as distinct from a real call — added in the depth pass, see below |
| ADR inventory | `table` | lint suggested `statusboard` for the status column — checked, and `statusboard` is actually a different shape (entity × environment matrix, see `p-statusboard` gallery example), not a fit for a flat decision-list. Plain `table` was correct here; noting this so the next author doesn't waste the lint round-trip |
| System verdict | `verdict-box` | |
| Cross-lane seams | `table` | |
| Open questions | `prose` | |

## Worked example

`source.json` in this directory (3 lanes, not 10 — enough to prove the shape
without a huge JSON), now with a `mermaid` seam diagram added in a depth
pass per the project conventions §3 Covenant II. Published and **rendered clean** — zero
`std-doc-error` markers, `stddoc lint` clean (2 non-blocking suggestions,
both addressed above).

## Anti-patterns

- **Going deep on any one lane inside the dossier.** `LEO_ARCHITECTURE.html`
  itself resists this well (it's a genuine orientation doc), but the
  temptation is real — if a lane card's `body` needs more than one sentence,
  that content belongs in the lane's own Detective Findings Report, not here.
- **Skipping the marquee-findings callout.** Without it, every lane detective
  independently re-discovers the same system-wide gotcha (here: cron's
  durability assumption) and reports it N times instead of once, shared, up
  front.
- **No cross-lane seams table.** This is the section most often missing in
  the corpus's near-misses — without it, two lane detectives can each
  correctly diagnose their own lane and still miss that the SEAM between them
  is where the real risk lives.

## Evidence (corpus `file:line`)

- `vmshare/docs/v4/LEO_ARCHITECTURE.html` — full shape: "Phase 1 dossier ·
  canonical orientation for the ten lane detectives", "The marquee findings",
  "The 10 lanes" (`lane l01`..`l10` classes), "Write pipeline"/"Read pipeline",
  "ADR inventory", "Transport-irrelevance axiom · system-level verdict",
  "Cross-lane seams", "Open questions handed to the strategist"
- SURVEY-NOTES.md Finding F8 — `lane-card`/`lanes-grid` flagged as a novel
  component to promote; landed as `cardgrid.owner` (main `4e74d6d`) and now
  used in this template's own worked example, above
- Companion evidence: this dossier's lane cards are exactly what
  `captain-synthesis-brief`'s "Cross-lane pointers" closing section points
  back to — the two families are meant to be read together across a real
  multi-lane investigation
