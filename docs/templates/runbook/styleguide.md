# Template: Runbook / Operational Procedure

## When you reach for this template

Someone is going to follow this **under time pressure**, possibly mid-incident,
possibly at 3am, possibly having never seen the system before. Use this shape
for any step-by-step operational procedure — recovery, migration, cutover,
rollback — where the reader needs to know *what's safe to re-run*, *what
changes state*, and *what to verify before walking away*. Don't reach for
this for a narrative postmortem (that wants a timeline, not a procedure) or
a reference doc (this is for doing, not for understanding).

## The shape

```
kicker  →  "RUNBOOK-NN · Operational procedure"
hero    →  what happened + what this doc does about it, as one sentence each
badges  →  blast-radius facts up front: scope, expected downtime
tag ×N  →  the severity vocabulary for THIS doc, stated before it's used
legend  →  what each tag color actually MEANS — never assume the reader
           already knows your color convention
phase-strip → the procedure itself, numbered, each phase colored by its
              own risk level (not all phases are the same risk)
callout(gold) → the one step that changes state — called out explicitly,
                separate from the phase strip, so it can't be skimmed past
table-list → the exact commands/calls, one per phase, in execution order
verdict-box → what "done" looks like — not "phase 4 ran" but "phase 4
              confirmed the fix"
callout(cyan) → the follow-up that's explicitly OUT of scope — don't let
                the runbook's own boundary blur
```

The **legend must come before the phase-strip**, not after. A reader
skimming top-to-bottom needs the color vocabulary decoded before they hit
the first colored phase, or the colors are just noise.

## Which primitives realise each part

| Part | Primitive | Fields that carry the weight |
|---|---|---|
| ID + type | `kicker` | `text` |
| The headline | `hero` | `text` (what happened), `sub` (what this doc does) |
| Blast radius | `badges` | `badges: {key: value}` — free-form key:value pairs |
| Severity vocabulary | `tag` | `kind` (palette entity), `label` — one per severity level used below |
| Color decode | `legend` | `items[{kind, label}]` — pairs each `kind` with what it means in prose |
| The procedure | `phase-strip` | `phases[{num, name, desc, kind, effort}]` — `kind` colors the phase by its own risk, `effort` sets expectations |
| The state-change warning | `callout` | `kind:"gold"` — isolate the one destructive step from the rest |
| Exact commands | `table-list` | `items[{name, note}]` — `name` is the command/call, `note` is what it does and why |
| Definition of done | `verdict-box` | `kind`, `label`, `verdict` (short), `text` (the longer honest caveat) |
| Explicit scope boundary | `callout` | any declared entity — say what this runbook does NOT fix |

## Anti-patterns

- **A phase-strip where every phase is the same color.** If nothing in your
  procedure is riskier than anything else, you probably haven't looked hard
  enough — re-arming state, deleting something, or a step with no undo is
  almost always present somewhere in a real runbook.
- **Tags/legend declared but never explained in prose.** A color swatch
  without the sentence next to it that says what it means is decoration,
  not information — the `legend` primitive exists specifically so this
  never happens by accident.
- **A `verdict-box` that means "the last command ran."** "Done" for an
  operational procedure means *verified*, not *executed* — say so in the
  `text` field, explicitly, the way this exemplar's callout does.
- **Skipping the palette declaration for tag/legend `kind` values.** Same
  trap as every other template family — `red`/`gold`/`cyan` must be declared
  at doc root or the primitive fails loudly.
- **Letting the runbook's scope creep.** The final callout exists so a
  reader doesn't walk away thinking one recovery step is a permanent fix.
  If your procedure has a known follow-up, name it and stop — don't try to
  solve it inside the runbook.

## Pre-flight checklist

- [ ] Legend declared before the phase-strip that uses its colors
- [ ] At least one phase/step is visibly higher-risk than the others (if
      truly none are, that's worth a second look at the procedure itself)
- [ ] The state-changing step has its own callout, not just a phase-strip entry
- [ ] `verdict-box` defines "done" as verified, not just executed
- [ ] Palette declared for every custom `kind` used in `tag`/`legend`/`callout`
- [ ] `stddoc publish` → open in a browser → zero render-error blocks, zero
      literal backticks, nothing silently dropped
- [ ] `stddoc freeze` → `external-ref leaks (must be 0): 0`

## Gotcha specific to this build (save yourself the loop)

If a **freshly `go build`'d** `stddoc` binary appears to hang or get
silently killed (exit 137) on *any* command — even `publish` on a trivial
one-node doc — before assuming a code regression, check whether the binary
is ad-hoc codesigned: `codesign -s - -f <path-to-binary>`. An unsigned
freshly-compiled arm64 binary on macOS can be killed by the OS shortly
after launch; codesigning fixes it instantly and is not a std-doc bug. Cost
about 45 minutes of false-positive investigation the first time; recording
it here so the next builder doesn't re-pay it.

## What this shape cannot express yet (loss-list for the layout language)

1. **The phase-strip wants inline sub-steps** — real runbooks often have a
   phase that's actually 2-3 sub-commands, and today those have to be
   pushed down into the `table-list` below, disconnected from the phase
   card that introduces them. A `phase-strip` phase that could host a
   nested `table-list` (or any block) would let the procedure and its
   exact commands live in the same visual unit instead of two separate
   primitives the reader has to mentally re-align.
2. **No inline conditional branching** — "if X, do phase 3a; if Y, do phase
   3b" is common in real recovery procedures (this exemplar sidesteps it by
   keeping the procedure linear) and today would require either two
   separate runbooks or prose that says "see below," neither of which is
   as clear as an actual branch/fork primitive would be.
