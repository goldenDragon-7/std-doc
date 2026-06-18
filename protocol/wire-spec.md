# Wire spec — the byte-level rendering contract

> This is the **byte-level rendering contract** — every place where rendering
> could plausibly vary by a byte: escape ordering, key order, number formatting,
> trailing newlines, palette resolution. The conformance gate (`conformance/`)
> proves the *outputs* are byte-identical; this document explains *why*, so the
> rules are reproduced rather than reverse-engineered from a diff. Every rule
> below is **MEASURED** and implemented in `go/internal/wire`, locked by
> `go/internal/core/conformance_test.go`.

## 1. HTML escaping

The engine escapes text exactly as Python's `html.escape(s, quote=True)` does (in `go/internal/wire`). Five
characters are replaced; **everything else passes through unchanged** (no
entity-encoding of non-ASCII — UTF-8 bytes are emitted directly).

| input | output |
|---|---|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` |
| `'` | `&#x27;` |

**Ordering is load-bearing.** `&` is replaced *first*, then `<`, `>`, `"`, `'`.
A port that escapes `<` before `&` would double-escape the `&` it introduces
(`&lt;` → `&amp;lt;`). Replace ampersand first.

`None` is treated as the empty string by the engine's `esc()` wrapper before
`html.escape` ever sees it (so `esc(None) == ""`, never `"None"`).

## 2. Scalar / number formatting

Non-string scalars are stringified with Python-style `str()` formatting (`go/internal/wire`'s `PyStr`) *then* escaped:

| value | rendered |
|---|---|
| `5` (int) | `5` |
| `1.0` (float) | `1.0` |
| `1.5` | `1.5` |
| `True` / `False` (bool) | `True` / `False` |
| `None` | `` (empty) |

The wire layer matches Python's `str()` for these — notably float formatting
(`repr`-style shortest round-trip) and capitalized booleans. JSON sources should
prefer strings for any value whose exact rendering matters; the engine never
reformats a string.

## 3. JSON / dict key order

**Insertion order is preserved end to end.** The JSON parser keeps object key
order (`go/internal/wire.OrderedMap`) and every render loop iterates in that
order (palette `:root{…}` declarations, `render_generic` key/value blocks,
badges, facets). A port MUST parse JSON objects into an order-preserving map and
iterate in document order — never sort keys, never rely on hash order.

## 4. Trailing newline policy

The two render modes differ, and the difference is canonical:

| mode | entrypoint | final bytes |
|---|---|---|
| doc-tree page | `publish.build()` → `render_node` / `render_index` | ends `</html>` — **no** trailing newline |
| standalone page | `core.page.render_page()` (`layout:page`) | ends `</html>\n` — **one** trailing newline |

Emit exactly these bytes. Do not normalize either way.

## 5. Palette token resolution

A doc declares named entities at `root.palette`:

```json
"palette": { "writer": {"label": "Writer()", "color": "#e0b341"} }
```

The engine compiles them to CSS custom properties and resolves references to
`var(--token)`:

- **Compiled block:** `:root{--ent-<key>:<color>;…}`, keys in declared order,
  emitted only when the palette is non-empty (an empty palette emits no `:root`
  block at all).
- **Reference:** a primitive asking for entity `k`'s color gets the literal
  string `var(--ent-<k>)`. The browser does the final color resolution; the
  engine never inlines the hex at a reference site.
- **Missing color:** an entity with no `color` compiles to `--ent-<key>:inherit;`.
- **Undeclared entity:** referencing a key not in the palette is a **loud error**
  (`PaletteError`), never a silent colorless render. A port raises/aborts here.

Inline chip markup `{{ent:key}}label{{/}}` expands to a styled `<span>` with the
surrounding text and the label both HTML-escaped (per §1), and a `var(--ent-key)`
reference inside the `style` attribute.

## 6. What the core owns (not the primitives)

Anchors (`data-cf-anchor` / `data-cf-change`), numbering (`1` / `1.1` / `1.1.1`),
nav, breadcrumb, CSS dedup, and the security gate are **core**, emitted around a
primitive's output. A primitive emits *content only*. The port keeps this split:
the contract is the boundary, not the bodies.
