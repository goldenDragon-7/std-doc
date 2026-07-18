# Diagrams — the best-engine-per-type standard

std-doc renders diagrams two ways, and picking the right one is not taste — it
is a **law discovered by measuring 22 diagrams across both engines** (the diagram
team's knowledge-pack: 22 render-clean, 22 PASS, 0 collisions, graded by eye on
the real dark page, 2026-07-15). This document is that standard, and the
`diagram` primitive is it **executed** — routing baked in, so an author declares
*what* the diagram is and the library picks *how* to draw it.

> **THE LAW.** *D2 encodes a quantity as **SIZE** (width / height / stroke). D2
> cannot encode a quantity as **POSITION** (x / y / radius / angle computed by a
> layout engine).* Everything below follows from that one sentence.

## The two engines

| | **D2** | **Mermaid** |
|---|---|---|
| renders | **in-process** (pure Go, `d2lib`) | in the browser (`mermaid.js`) |
| freeze | **zero external tooling** — always browser-free, even at freeze | bakes to inline SVG via `mmdc`/`npx` — the *frozen artifact* is browser-free, but the *bake* needs `mmdc` present |
| theme | DarkMauve (200), the vetted dark default | dark `themeVariables` (via `mermaid_fix`) |
| best for | structural · relational · flow · **size**-encoded | **position**-encoded · quantitative · temporal |

D2 is the safe default: it never reaches for a browser and never fails a freeze.
Reach for Mermaid only where the diagram's *meaning lives in position* — and pay
the `mmdc`-at-freeze cost knowingly. That is the honest boundary; state it, don't
hide it.

## The routing table — the standard, as data

The verdict per type ships as **data** in `go/stddoc-lib/diagram_engines.json`
(so it is one editable source of truth, and `diagram_primitive_test.go` fails the
build if it ever drifts from the vetted verdict):

| Family | Types | Engine |
|---|---|---|
| **Structural / size-encoded** | sequence · class · erd · c4-architecture · network-topology · state-machine · dfd · tree · swimlane · block · requirement · venn · **mindmap** · packet · stacked-bands | **D2** |
| **Quantitative / position-encoded** | gantt · quadrant · journey · sankey · gitgraph | **Mermaid** |

Two load-bearing calls to remember:

- **mindmap → D2, always.** Mermaid's mindmap renders dark-on-dark and overlaps —
  it is broken on our surface. D2's vertical tree is clean. Never route a mindmap
  to Mermaid.
- **packet → D2.** The bit-grid (nested-container column spans) reads on dark;
  Mermaid's is a valid alternate but D2 won the regrade.

## The `diagram` primitive

A block in a `source.json` node's `blocks` array:

```json
{
  "type": "diagram",
  "dtype": "class",                  // semantic type — routed via the table above
  "label": "User ↔ Order",           // optional; defaults to dtype
  "engine": "auto",                  // optional override: "d2" | "mermaid" | "auto" (default)
  "theme": 200,                      // optional D2 theme ID (default DarkMauve = 200)
  "d2": "…d2 source…",               // used when the D2 route is chosen
  "mermaid": "…mermaid source…"      // used when the Mermaid route is chosen
}
```

How it routes, in order:

1. **Explicit `engine`** (`d2` | `mermaid`) always wins — both engines are always
   available to an author who knows what they want (the dossier's "author knob").
2. Otherwise `dtype` is looked up in the routing table.
3. Otherwise the table default (`d2`).
4. **Forgiving fallback:** if the routed engine has no source but the *other*
   engine does (and there was no explicit override), the supplied source is
   honored — you never have to provide both.

Every rendered card carries a **generated `render:` chip** naming the engine that
actually drew it. It comes from the routing decision, never a hand-typed
subtitle — so it can't go stale the way flipped D2↔Mermaid headers used to
(gitgraph, block, requirement all bit us that way).

You may also give a single `"source"` field instead of `d2`/`mermaid` when the
type unambiguously fixes the engine.

## Authoring the source well (D2)

The structural families are only excellent if you honor the contract the diagram
team paid for in the walk (`knowledge-pack/D2_TECHNIQUES_DOSSIER.md` is the full
dossier; the load-bearing bits):

- **Contrast contract.** `shape: class` / `shape: sql_table` headers are
  **theme-locked** (saturated) regardless of `style.fill`. For full color control
  use the **manual 2-region compartment card** (a container with a header
  sub-node + one body sub-node per row, dark fill + one accent border + light
  text). Blank every container label (`label: ""`) or D2 renders the key as a
  stray row.
- **ERD edges must attach to the key.** Keep `sql_table` for column-anchored FK
  edges + crow's-foot, and add `layout-engine: elk` for 90° orthogonal routing.
- **Right-size both ways.** `grid` folds a long chain into rows (crops the void);
  `direction: down` reshapes a wide sprawl into a legible portrait; give sankey /
  scatter *more* room. Fit the content — shrinking is not the goal.
- **Freeze-safe always.** Icons via `icon: ./local.svg` inline as `data:` URIs.
  The gate greps the frozen SVG for external refs and fails loudly at anything
  that isn't the w3.org namespace.

## Structured primitives are still first-class

Three diagram types are so common that std-doc builds their D2 source **from
structured data** rather than raw text — `swimlane`, `tree`, and `statetrack`
(state-machine). Prefer those when your data is structured; reach for the
`diagram` primitive when you already have engine source, or need a type the
structured trio doesn't cover.

## The honest freeze boundary (Covenant IV)

- A doc with only **structural (D2)** diagrams freezes with **zero tooling** —
  the purest form of "freeze means frozen."
- A doc with any **quantitative (Mermaid)** diagram freezes to inline SVG but
  **requires `mmdc` (or `npx`) at freeze time**. If it isn't there, freeze fails
  loudly rather than shipping a broken page. That is the covenant working, not a
  bug: the frozen artifact still reaches out to nothing.
