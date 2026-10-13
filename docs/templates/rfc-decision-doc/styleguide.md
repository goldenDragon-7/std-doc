# Template: RFC / Decision Doc

## When you reach for this template

You have **one open technical question**, you're proposing **one answer**, and
that answer needs to survive an audit six months from now when someone asks
"why did we do it this way?" Use this shape for: an architecture change, a
retire-this-for-that proposal, a "should we adopt X" writeup, any doc whose
job is to end with a recorded, defensible **DECIDED**.

Don't reach for this when you have no chosen answer yet (that's a design
review, not an RFC) or when you're documenting something that already shipped
with no controversy (that's reference material — see a different family).

## The shape

```
kicker  →  "RFC-014 · Proposal mode" — the doc's ID and its mode, up top
hero    →  the question itself, as a headline (not the answer — the question)
decision → the DECIDED answer + why + the alternatives you rejected, together
callout(gold) → "read the shape, not the row count" — orients the reader
                 before the comparison so they don't just skim bullets
compare  → the two-column argument: what you're leaving vs what you're choosing
table    → the numbers that back the argument (cost, latency, risk — grouped)
callout(red, variant:gate) → what this RFC does NOT solve — the honest limit
callout(gold) → open questions left to the implementer, explicitly non-blocking
```

The **decision block comes before the argument**, not after. A reader who
only has ten seconds should see the chosen answer and the rejected
alternatives without scrolling. The compare + table that follow are for the
reader who wants to verify the call, not discover it.

## Which primitives realise each part

| Part | Primitive | Fields that carry the weight |
|---|---|---|
| ID + mode | `kicker` | `text` |
| The question | `hero` | `text` (the question), `sub` (what the doc argues) |
| The recorded call | `decision` | `question`, `chosen`, `rationale`, `alternatives[{label,reason}]` — note **`label`/`reason`**, not `name`/`why_not` |
| Read-me-first framing | `callout` | `kind` (must be a declared palette entity), `lead`, `body` |
| The two-column argument | `compare` | `left`/`right`: each `{title, pill, accent, items[]}` — `accent` must be a declared palette entity |
| The numbers | `table` | `columns[]`, `groups[{name, rows[[...]]}]` |
| The honest limit | `callout` | `kind:"red"`, `variant:"gate"` — the `gate` variant forces the red accent regardless of `kind` |
| What's still open | `callout` | `kind:"gold"` — same primitive as the read-me-first, different placement |

## Anti-patterns

- **Skipping the palette declaration.** `compare.left.accent:"red"` or
  `callout.kind:"gold"` fail loudly (`unknown palette entity "red"`) unless
  the doc root declares `"palette": {"red": {...}, "gold": {...}, ...}`. This
  is correct behaviour — declare the palette, don't work around it.
- **`decision.alternatives` with `name`/`why_not`.** The primitive reads
  `label`/`reason`. Wrong keys are silently dropped in a hand-coded block —
  no validator catches a wrong field name inside a primitive body the way the
  section-container linter catches a wrong container key.
- **Putting the argument before the decision.** The reader should never have
  to scroll to find out what was chosen. Decision block first, always.
- **A compare with more than ~4 items per column.** The two-column shape
  argues by *shape* — a wall of bullets defeats it. If you need more than
  four points per side, that's a sign the table below should carry the extra
  detail instead.
- **Skipping the gate callout.** Every real decision has a boundary — what it
  does not solve. Omitting it isn't neutral; it reads as "we didn't think
  about it," which is worse than naming the gap.

## Pre-flight checklist

- [ ] Palette declared at doc root for every `kind`/`accent` value used
- [ ] `decision.alternatives` uses `label`/`reason`, not `name`/`why_not`
- [ ] The decision block appears before the comparison, not after
- [ ] At least one `callout` names what the decision does **not** solve
- [ ] `stddoc publish` → open in a browser → zero render-error blocks, zero
      literal backticks, nothing silently dropped
- [ ] `stddoc freeze` → `external-ref leaks (must be 0): 0`

## What this shape cannot express yet (loss-list for the layout language)

The engine's data-derived path is currently node → sections/blocks →
top-to-bottom stack. This template loses nothing structurally — every part
above rendered cleanly — but two things were flattened that a native
layout language should restore:

1. **The decision block and the gate callout want to be pinned/sticky** —
   in a long RFC, the reader scrolling through the table and comparison
   loses sight of what was actually decided. Today they're just two more
   blocks in the stack.
2. **The compare's `accent` on both columns used the same visual weight**
   (`accent` class) even though semantically one side is REJECTED and one
   is CHOSEN — the template asks for `bad`/`good` class opinions but the
   `accent` path (used here so the palette could drive the color) doesn't
   carry that semantic split into the CSS the way the two hardcoded classes do.
   Worth a primitive-level fix: let `compare` accept a `verdict:"chosen"|"rejected"`
   per column that composes with an explicit `accent` instead of one
   replacing the other.
