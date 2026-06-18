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
