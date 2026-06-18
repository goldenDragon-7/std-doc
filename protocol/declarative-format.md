# Declarative render format — primitives as data

> A primitive's render logic is expressed as *structured data* interpreted by ONE
> small engine (`go/internal/template`). Because the primitives are data, the whole
> library is portable, auditable, and swappable without touching the core. This is
> **not** a string mini-language and **not** a user-facing component system (both
> rejected in the PRD's locked decisions); it is a closed instruction set of dicts.

## The safety property (why there is no `raw`)

Authored template chrome is the **only** source of literal HTML. Every value
pulled from a (possibly stranger-written) `source.json` flows through `esc` or a
**closed `lookup` table** — there is no `raw` op, by design. A `compose` can only
nest *other safe primitive blocks*. So a stranger composing primitives can never
inject markup or script: the injection truck-route the `raw()` trap opened (PRD
"the raw() trap") simply does not exist in this format. This is the §6 security
mission expressed as a data shape.

## The instruction set

A **template** is a list of **nodes**, concatenated. A node is one of:

| node | meaning |
|---|---|
| `"literal html"` | authored chrome — emitted verbatim (trusted) |
| `{"esc": path, "default": …}` | escaped value from the data (`None` → `default`, else `""`) — wire-spec §1 |
| `{"lookup": path, "table": {…}, "default": "…", "upper": false}` | closed map → trusted token/class (not escaped); `upper` upper-cases the key first; miss with no `default` is a loud error |
| `{"palette_var": path}` | entity key → `var(--ent-<key>)` via the declared palette; loud (`PaletteError`) if undeclared — wire-spec §5 |
| `{"count": path, "min": N}` | list length (clamped to floor `N`) as a number |
| `{"if": cond, "then": [..], "else": [..]}` | conditional (`else` optional) |
| `{"each": path, "body": [..], "join": ""}` | list iteration (body sees `@item`/`@index`/`@first`/`@last`/`@len`/`@next`/`@prev`) |
| `{"each_pairs": path, "body": [..]}` | dict iteration in insertion order (body sees `@key`/`@val`/`@index`/`@first`/`@last`/`@len`) |
| `{"compose": path}` | render nested primitive block(s) through the registry |
| `{"anchor": path}` | core block-anchor attr for the data at path (page mode) |

### Paths

Dotted strings resolved against a scope chain (innermost loop frame first, root
last). A leading token is either a plain field on the current object or one of:

| token | value |
|---|---|
| `@item` | current object / loop item |
| `@index` | 0-based loop index |
| `@first` / `@last` | boolean position flags |
| `@len` | length of the list being iterated |
| `@next` / `@prev` | neighbour items (or `None` at the ends) — for look-ahead |
| `@root` | the top-level data object |

A missing leg resolves to `None` (rendered as empty) — never a crash.

**Scope rule (load-bearing for a port):** a bare field name resolves against the
**nearest** data object only — the innermost `@item`. It does **not** fall
through to an enclosing scope, so a field absent on the current loop item renders
empty, never the parent's value. To reach an enclosing scope from inside a loop,
use an explicit token: `@root.<field>` (or `@next`/`@prev` for neighbours). A
port that lets bare lookups fall through to the parent will diverge (the
conformance oracle caught exactly this).

### Conditions

`{"truthy": p}` · `{"falsy": p}` · `{"eq": [p, value]}` · `{"eqp": [pA, pB]}`
(two resolved paths equal) · `{"in": [p, [choices]]}` · `{"and": [..]}` ·
`{"or": [..]}` · `{"not": c}` · `{"any": {"in": p, "field": f}}` (true if any
item in the list at `p` has a truthy `f`) · `{"isdict": p}` (the value at `p` is
a dict).

## What renders from data vs. core-owned

**Most primitive types render from data** — their template lives in
`go/stddoc-lib/templates.json` and the interpreter emits the HTML, byte-identity
locked by the conformance gate: hero, decisionmatrix, descent, call, endpoint,
callout, chip, compare, spectrum, badges, threeaxes, ascii, mermaid, control,
cardgrid, table, and more.

A handful are **core-owned in Go** (`go/internal/core`) because they are not pure
HTML-templating:

| primitive | why it's core-owned |
|---|---|
| `diagrams` | a thin dispatcher — picks `mermaid`/`ascii` per item; not its own HTML |
| `evidence` | a core adapter: renders the collapsed `<details>` drill-down |
| `sections` | core numbering + anchor generation — core-owned, not library content |
| `statetrack`, `swimlane`, `tree` | diagram primitives — **d2 renders in-process** (native Go, no shell-out) and inlines the SVG; mermaid is the fallback |

So the data format covers every pure HTML-structure primitive; the core owns the
numbering, anchors, and the in-process diagram engines.

## Worked example — `decisionmatrix`

```json
[
  "<div class='dm-wrap'><table class='dm'><thead><tr><th class='corner'></th>",
  {"each": "columns", "body": ["<th>", {"esc": "@item"}, "</th>"]},
  "</tr></thead><tbody>",
  {"each": "rows", "body": [
    "<tr><td class='lbl'>", {"esc": "label"}, "</td>",
    {"each": "cells", "body": [
      "<td class='cell ",
      {"lookup": "verdict",
       "table": {"miss": "c-miss", "have": "c-have", "part": "c-part"},
       "default": "c-part"},
      "'>", {"esc": "text"}, "</td>"]},
    "</tr>"]},
  "</tbody></table></div>"
]
```

The three shapes that prove expressiveness (conformance-locked byte-identical in
`go/internal/core`):

- **hero** — interpolation + one conditional
- **decisionmatrix** — header + nested row/cell iteration + lookup-with-default
- **descent** — iteration with `@last`, look-ahead via `@next`, and an
  `any()`-reduction (`is_here = flagged ? here : last`)

## How a primitive uses a template

A data-template primitive *is* its entry in `go/stddoc-lib/templates.json` (keyed
by `type`) plus its CSS in `primitive_css.json`. The core looks up the template by
the block's `type`, runs it through the interpreter (`go/internal/template`), and
wraps the result in the block anchor. There is no per-primitive code to write —
adding a visual is adding data (see `primitives.md`).

The conformance gate (`conformance/`) guarantees the bytes don't move when the
library changes — that is the strangler proof.
