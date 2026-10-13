# Capability Explainer

## When you reach for this template
**Someone needs to understand what a capability DOES, why it exists, and how
to turn it on — before they'll ever need to audit or reference it.** This is
the "sell it, then show it" register: it opens with the problem/promise (a
pitch), then earns the reader's trust with real numbers and a real
architecture section, then hands them the exact commands to use it. Use it
for a new tool, a new autonomic, a new CLI surface someone needs to adopt.

Don't reach for this once the capability is established and the reader just
needs facts (→ Domain/System Reference, no pitch, no TL;DR) or once something
is wrong with it (→ Detective Findings Report). This family is specifically
for the *adoption* moment — it has a shelf life shorter than the other four.

## The document's shape

| # | Section | What it's FOR |
|---|---|---|
| 1 | Hero | Names the capability with personality — this register tolerates voice/flavor the others don't |
| 2 | Problem & promise callout | The pitch: what hurt before, what this fixes — stated as a claim the rest of the doc will earn |
| 3 | Stat row | Concrete numbers that back the promise (not vanity metrics — "0 false pages" earns trust) |
| 4 | Modes / phases (flow or pipeline) | The mental model a new user needs before touching a command |
| 4.5 | Mode-transition diagram | A `mermaid` state diagram — draws which transitions DON'T exist (no ACTIVE→DRY_RUN) as clearly as which do, a fact prose alone buries |
| 5 | Command + config code blocks | The actual invocation and a realistic config — copy-pasteable, not illustrative pseudocode |
| 6 | "What's live right now" table | Grounds the pitch in current reality — this is what separates a capability explainer from marketing copy |
| 7 | Howto (promotion path) | The specific numbered steps to go from trial to production use |
| 8 | Operational notes (prose) | The caveats a careful adopter needs — retention, dependencies on other capabilities, honest tradeoffs |

## Primitives used

| Section | Primitive | Notes |
|---|---|---|
| Hero | `hero` | |
| Problem/promise | `callout` | `kind:"green"` for confident/positive framing — the only family in this survey where a green callout carries a pitch rather than a "confirmed good" verdict; be deliberate about this so it doesn't read as validated fact when it's a claim |
| Stats | `stats-bar` | |
| Modes | `flow` | narrative enumeration of options, not a sequence — kept over `pipeline` despite the lint hint, same reasoning as other families: these are alternatives, not a trace |
| Mode transitions | `mermaid` (`stateDiagram-v2`) | added in the depth pass — the missing edges are the point, per the project conventions §3 Covenant II's "the beauty of the knowledge is your responsibility" |
| Phases | `pipeline` | THIS is where `pipeline` is the right call — phases genuinely have done/active/pending state, unlike the modes above |
| Command | `code` mode `command` | |
| Config | `code` mode `snippet` | |
| Live status | `table` | |
| Promotion steps | `howto` | intro line + numbered steps + optional code — exact fit, unused in the other four families so far |
| Operational notes | `prose` | |

## Worked example

`source.json` in this directory, now with a `mermaid` mode-transition state
diagram added in a depth pass per the project conventions §3 Covenant II. Published and
**rendered clean** — zero `std-doc-error` markers, `stddoc lint` clean (one
non-blocking suggestion, addressed above: `flow` for modes was deliberate,
`pipeline` was used correctly for the phases that actually have state).

## Anti-patterns

- **Pitch with no grounding.** `tmp-shepherd-capability.html`'s own strength
  is section 9, "What's Live Right Now" — without it, sections 1-2 are just
  marketing. Never ship the problem/promise callout without a live-status
  table nearby to prove it's not aspirational.
- **Command examples that are pseudocode.** If your `code` block command
  wouldn't actually run, you've drifted from explainer into brochure. Copy
  the real invocation.
- **Using `callout kind="green"` here and expecting it to mean the same thing
  it means in a Detective Findings Report.** In that family, green means
  "confirmed correct, evidenced." Here it can mean "this is the claim we're
  about to back up." Same primitive, different epistemic weight — say so if
  your doc might be read by someone used to the other register.

## Evidence (corpus `file:line`)

- `curate/samples/00-existing/tmp-shepherd-capability.html` — full shape:
  "1 · TL;DR", "2 · The Problem & The Promise", "3 · By the Numbers",
  "4 · Architecture", "5 · The Three Modes & the Kill Switch", "6 · The Five
  Phases", "7 · The Captain CLI", "8 · The Policy YAML", "9 · What's Live
  Right Now", "10 · Promoting DRY_RUN → ACTIVE", "11 · Operational Notes"
- `curate/samples/00-existing/tmp-shepherd.html` — the non-capability
  sibling doc; comparing the two confirmed the `-capability` variant is a
  distinct, deliberate register rather than an alternate draft of the same
  content
