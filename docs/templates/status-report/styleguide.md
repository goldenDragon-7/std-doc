# Template: Status / Progress Report

## When you reach for this template

You're sending a **recurring** update — weekly, per-release-train, per-sprint
— to people who were not in the room. Use this shape when the job is "where
are we, what's on track, what's at risk, what's next," and the reader needs
the answer in the first ten seconds, with the detail available below for
whoever wants it. Don't reach for this for a one-off decision (that's the
RFC/decision-doc family) or a post-incident writeup (that wants a timeline
and a root cause, not a scoreboard).

## The shape

```
kicker  →  "Week of … · Status report" — dates the report immediately
hero    →  the ONE headline fact, stated as a sentence, not a title
pipeline → where each workstream sits on its own path (done/here/pending)
statusboard → the scoreboard — every tracked item × every day/period, at a glance
callout(gold) → the one thing at risk — named honestly, with why it doesn't
                (or does) threaten the larger commitment
spectrum → optional — use only when progress is genuinely a position on an
           axis (a maturity ladder), not just a percentage
table   → the detail row: area × this-period × next-period
callout(cyan) → what's next — the forward-looking close
```

The **hero states the one-sentence takeaway**, not a section title. A reader
who stops after the hero should already know the headline. Everything below
is for the reader who wants to verify it or drill into one workstream.

## Which primitives realise each part

| Part | Primitive | Fields that carry the weight |
|---|---|---|
| Date + cadence | `kicker` | `text` |
| The headline | `hero` | `text` (the one-sentence takeaway), `sub` (the qualifier) |
| Workstream position | `pipeline` | `stages[{label, state:"done"\|"here"\|"pending", note}]` |
| The scoreboard | `statusboard` | `columns[]` (the periods), `groups[{label, rows[{label, cells[{status}]}]}]` — `status` accepts `LIVE`/`PARTIAL`/`WIP`/`DEBT` and is colored automatically, no palette declaration needed for those four |
| The risk, named | `callout` | `kind:"gold"`, `lead`, `body` — say what it threatens AND what it doesn't |
| A maturity axis (optional) | `spectrum` | `stops[{label, note}]` — 3 stops read best; more than 4 gets cramped |
| The detail table | `table` | `columns[]`, `groups[{rows[[...]]}]` — omit `name` on the single group to skip a group-header row |
| The close | `callout` | `kind:"cyan"` (or any declared entity) — keep it short, forward-looking |

## Anti-patterns

- **A hero that's a section title, not a sentence.** "Status Update — Week
  37" tells the reader nothing they didn't already know from the page title.
  "Three of four workstreams are green" tells them the actual news.
- **A statusboard with more than ~5 columns.** It's meant to be scanned in
  one glance; a wide grid defeats that. Roll up to weeks instead of days if
  your cadence is longer than a work-week.
- **No at-risk callout when something IS at risk.** Silence reads as "nothing
  to report," which is a worse failure than naming the risk plainly — a
  reader who finds out later that something was quietly slipping loses trust
  in every subsequent green scoreboard.
- **Using `spectrum` for a literal percentage.** Spectrum is for a
  qualitative position on an axis (flat → structured → ideal); a numeric
  percent belongs in a `table` or a dedicated stat, not a 3-stop gradient
  stretched to imply false precision.
- **Skipping the palette for custom `status` values.** The four canonical
  statusboard/badge values (`LIVE`/`PARTIAL`/`WIP`/`DEBT`) are colored
  automatically. Any custom `kind`/`ent` value elsewhere on the page (like
  `"cyan"` here) still needs the top-level `palette` declaration or it fails
  loudly.

## Pre-flight checklist

- [ ] Hero is a one-sentence takeaway, not a section title
- [ ] Every workstream in `pipeline` has an honest `state`, not all "done"
- [ ] At-risk callout present whenever anything is genuinely at risk
- [ ] Custom `kind`/`ent`/`accent` palette values declared at doc root
- [ ] `stddoc publish` → open in a browser → zero render-error blocks, zero
      literal backticks, nothing silently dropped
- [ ] `stddoc freeze` → `external-ref leaks (must be 0): 0`

## What this shape cannot express yet (loss-list for the layout language)

1. **The statusboard and the pipeline both want to sit side-by-side** near
   the top — "where are we on the timeline" and "what's the scoreboard" are
   two views of the same status, and a reader benefits from seeing them
   together rather than stacked top-to-bottom. Today the engine's node →
   blocks stack has no two-up layout primitive for arbitrary block pairs
   (the `split` primitive exists but composes pre-authored HTML fragments,
   not two full primitive blocks — worth checking with
   `stddoc-primitive-builder` whether `split` can host two block references).
2. **The at-risk callout has no severity gradient** — this report has one
   risk that's genuinely low-stakes ("does not block the release"), but the
   `gold` callout kind is the same visual weight whether the risk is minor
   or existential. A `callout` severity field (`low`/`med`/`high` driving
   border weight or an icon) would let a report carry more than one flagged
   item without them all reading as equally urgent.
