# Writing a std-doc render primitive

Adding a new visual to std-doc is **writing one self-contained module against a
frozen contract** — never editing the core. The core walks the doc-tree, owns
numbering / nav / anchors / freeze orchestration / the palette / the security
gate, and dispatches each typed block to a registered primitive. You write the
primitive; the core does everything else.

## The contract — `RenderPrimitive`

`engine/core/primitive.py` defines the one stable contract. Seven members:

| member | shape | who calls it |
|---|---|---|
| `type` | `str` | the registry key / JSON discriminator (set it on the class) |
| `render(block, ctx)` | `-> html` | the core, per block; it wraps the anchor around your output |
| `css()` | `-> str` | the core, once; collected and deduped |
| `assets()` | `-> [Asset]` | the core; declared kit/font deps, wired centrally |
| `freeze(block, ctx)` | `-> html \| None` | the core under `--freeze`; return zero-external output, or `None` if `render()` is already clean |
| `validate(block)` | `-> [error]` | the lint; your schema fragment, assembled so lint ≡ renderer |
| `needs` | `{"network": bool, "kit": bool}` | the security gate |

`render`, `css`, `assets`, `freeze`, `validate` have safe no-op defaults — a
text primitive overrides only `render` (and usually `validate`).

### Invariants you must honor

1. **Anchors are core, never yours.** Emit content only; the core assigns
   `data-cf-anchor`. Never write your own `data-cf-*`.
2. **Freeze = zero external refs.** Your `freeze()` output must contain no
   `http(s)://`, protocol-relative `//host`, or CDN `src`/`href`. The security
   gate (`core/gate.py`) scans it and fails the build naming your `type`.
3. **stdlib only.** No third-party imports (`test_stdlib_only.py` enforces it).
4. **Helpers arrive via `ctx`**, never by importing the core — keeps the
   contract language-agnostic for the future Go port. `ctx` carries `esc`,
   `palette`, `registry`, `anchor`, `render_evidence`, `status_class`.
5. **Be palette-bound where it makes sense.** `ctx["palette"].var(key)` returns
   `var(--ent-<key>)` and raises loudly on an undeclared entity.

## Worked example — a `note` primitive

```python
from core.primitive import RenderPrimitive

class Note(RenderPrimitive):
    type = "note"
    needs = {"network": False, "kit": False}

    def render(self, block, ctx):
        esc = ctx["esc"]
        kind = block.get("kind")                 # optional palette entity
        var = ctx["palette"].var(kind) if kind else "var(--border,#888)"
        return (f"<div class='note' style='--c:{var};border-left:3px solid var(--c);"
                f"padding:.5em .7em'>{esc(block.get('text',''))}</div>")

    def validate(self, block):
        return [] if block.get("text") else ["note: missing 'text'"]
```

Register it in `engine/primitives/__init__.py`'s `install()`:

```python
from . import note
...
for prim in (..., note.Note()):
    registry.register(prim)
```

Author it in a `source.json` node's `blocks[]`:

```json
{ "type": "note", "kind": "writer", "text": "Heads up." }
```

That's the whole loop: drop a module, add one line, use it. No core edit, no
whole-system release. The golden-master test guarantees existing pages stay
byte-identical; your new primitive only appears where a block asks for it.

## Where things live

| piece | path |
|---|---|
| contract | `engine/core/primitive.py` |
| registry (dispatch + error boundary) | `engine/core/registry.py` |
| blocks[] adapter + assembled lint | `engine/core/blocks.py` |
| palette engine | `engine/core/palette.py` |
| D2 helper (diagram degrade) | `engine/core/d2.py` |
| security gate | `engine/core/gate.py` |
| first-party primitives | `engine/primitives/*.py` |
| tests (one per primitive) | `engine/tests/test_*.py` |
