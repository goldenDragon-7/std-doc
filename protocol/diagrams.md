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

## Engine #3 — Flint (the quantitative/statistical family)

`microsoft/flint-chart` draws the ~34 **position-encoded data charts** that neither
D2 (SIZE) nor Mermaid draws well — scatter/regression, bars, distributions
(histogram · boxplot · violin · density), lines & areas, circular (pie · radar ·
rose), heatmap/choropleth. Flint authors a chart as a **Vega-Lite JSON spec**.

**Slice 0 (shipped): embed a pre-rendered SVG — zero new bake dependency.** A
Flint chart is rendered to a **freeze-clean inline SVG** (all 34 MEASURED at 0
external refs); std-doc embeds it directly, so the whole family is embeddable
**today**, purely additive, with **no Node/JS toolchain in the core binary** —
the frozen artifact reaches out to nothing.

The 34 vetted charts ship as a **library catalog** (`stddoc-lib/flint/*.svg`), so
you **NAME** a chart with `dtype` instead of pasting SVG. All 34 route to Flint in
`diagram_engines.json` — the six families are Points (scatter · regression ·
connected-scatter · ranged-dot · strip), Bars (bar · grouped-bar · stacked-bar ·
lollipop · waterfall · gantt-chart · bullet), Distributions (histogram · density ·
ecdf · violin · boxplot · pyramid · candlestick), Lines & Areas (line · sparkline ·
bump · slope · area · streamgraph · range-area), Circular (pie · rose · radar), and
Tables & Maps (heatmap · bar-table · kpi-card · map · choropleth).

```json
{ "type": "diagram", "dtype": "boxplot", "label": "value distribution" }
```

The dtype is looked up in the catalog (`boxplot` → `flint/boxplot.svg`;
hyphen/underscore tolerant). To supply your own instead, pass a pre-rendered SVG on
`flint` (or `svg`/`source`), or name one with `chart`. A `render: flint` chip names
the engine; a missing chart degrades loudly, never silently.

**Slice 1 (shipped): live spec→SVG.** Give a block a Flint `spec` (the chart
intent — `{data, semantic_types, chart_spec}`) and std-doc bakes it to an inline
SVG at publish time via the vendored, MIT-licensed pipeline
(`stddoc-lib/flint/bake/render.mjs`: flint-chart `assembleVegaLite` → vega-lite →
vega `toSVG`), in **pure Node — no browser**. The result inlines everything and
reaches out to nothing, so the frozen artifact stays soul-clean.

```json
{ "type": "diagram", "dtype": "histogram", "engine": "flint",
  "spec": { "data": { "values": [ … ] }, "semantic_types": { … }, "chart_spec": { … } } }
```

This is the **honest dependency**: live Flint needs Node.js + the bake deps
(`npm install` in `stddoc-lib/flint/bake/`, which pulls Vega/Vega-Lite). It is a
Mermaid-class bake dependency — the reader who views or freezes the page never
needs it, and a bake failure **degrades loudly** (never a silent blank), pointing
back to the zero-dep catalog path. Precedence in the flint route: author-supplied
`flint`/`svg` markup → live `spec` bake → catalog by `chart`/dtype.

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
