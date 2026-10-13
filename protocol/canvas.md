# Canvas — a co-drawing surface, inside a document

std-doc's living-surface pattern has three parts: **canonical state in a file**, a
**tiny server** that serves edits and collects comments, and an **agent that
watches the inbox and edits the artifact in place**. Swap the renderer and you get
a different surface: prose → a living *document*; arbitrary HTML → a living *page*;
a canvas → this. The `canvas` primitive embeds a **shared Excalidraw surface**
(the companion **codraw** runtime, `go/stddoc-lib/lib/codraw/`) directly in a
std-doc page, so the reader and the agent draw on one `scene.json` — the exact way
they comment on prose, but with a pen each.

> **THE LAW.** *A canvas is LIVE.* Its meaning is a shared, editable scene served
> by a running server — it reaches *out* to that server to exist. Everything below
> follows: it embeds as a sandboxed iframe, it defaults dark, its charts are baked
> for display but SVG at rest, and it **cannot ship live in a frozen doc**.

## Author shape (`source.json`)

```json
{ "type":     "canvas",
  "id":       "arch",                   // optional board id (v2 per-canvas boards); auto-derived when absent
  "src":      "http://localhost:8747/", // codraw mount URL (optional — serve auto-wires it per-board)
  "label":    "architecture sketch",    // optional caption chip
  "height":   520,                       // optional iframe height in px (default 520)
  "snapshot": "<svg …>…</svg>" }         // optional inline SVG of the finalized drawing (freeze uses it)
```

`src` is optional in practice: `stddoc serve` auto-starts a codraw surface and
rewrites every mount's `src` to it (Decision 2), so the authored value is only a
fallback. **`id` is optional too** — the doc-tree renderer always assigns one
(`<slug>-canvas-<ordinal>` when absent), so zero-config still works even with
several canvas blocks on one page.

**v2 — per-canvas boards** (`the canvas v2 per-board design`): each
canvas block gets its OWN board — its own `scene.json` and its own feedback inbox
— routed by `id`, not shared with every other canvas block in the doc (that was
v1's constraint: one board, period). One codraw *server* still serves the whole
doc — path-routed by board id, not one listener per board — so a document stays a
document, not a fleet of servers (Covenant V).

A canvas with neither an `id` nor a `src` **degrades loud** — a labeled skip card,
never a silent blank (Covenant VI). In practice this only happens outside the
doc-tree renderer (a hand-authored fixture calling the primitive directly); every
doc-tree canvas gets an `id`. `render: canvas` is a generated chip, like
`diagram`'s engine chip, so the surface always names itself from the render
decision.

## The two modes — Covenant IV made mechanical

| Mode | The `canvas` block becomes |
|---|---|
| **serve (live)** | a sandboxed `<iframe>` mount (`sandbox='allow-scripts allow-same-origin'`) — reader and agent co-draw; typed feedback flows to the agent's Monitor |
| **freeze (snapshot)** | the **author-time snapshot** — an inline SVG of the last drawing, captured when you finalize — inlined in place of the iframe. If no snapshot was captured, an honest static placeholder card. Either way the iframe (an external reach) is **stripped**, so the frozen doc has zero external refs |

The iframe **isolates** Excalidraw's React/globals/CSS so they cannot collide
with the page's palette tokens — that is why the mechanism is an iframe and not an
inline mount. A tab or section is only *placement*; the iframe is the *mechanism*.

The freeze transform lives in `freeze.FreezeCanvas` (mirrors `BakeMermaid`).

**Author-time snapshot (the freeze bake, decided 2026-08-14).** A canvas block may
carry a `snapshot` field — an inline SVG of the finalized drawing. The engine
emits it *hidden* under the live iframe; at freeze, `FreezeCanvas` unhides it in
place of the iframe, so the frozen doc shows the **real drawing** with **zero
freeze-time toolchain**. This is the same thesis as the chart bake: capture where
a browser already exists (the live canvas), not at freeze where none does.

To capture: while the canvas is live (a browser is open), export the scene to SVG
(Excalidraw's `exportToSvg` — the board's **SVG** button does exactly this) and
write that SVG into the block's `snapshot` field in `source.json`, then
re-publish. No snapshot? Freeze falls back to an honest placeholder card
(*"this was a live co-drawing surface; open in serve mode to draw"*). Either way,
zero external references.

## Charts as citizens of the canvas

Our whole diagram/chart library renders to **SVG**, and an Excalidraw scene holds
`image` elements. So a chart is delivered onto the board as an image element whose
file *is* the SVG — a first-class, draggable shape that rides along in the
canvas's SVG/PNG export.

The one seam that needs care: **Excalidraw's `image` elements cannot decode an SVG
dataURL** (they show a broken-image placeholder) — they need raster PNG. So the
codraw runtime **auto-bakes** every `image/svg+xml` file to PNG on load
(`bakeSvgFiles`, in-browser), *for display only*:

```
library primitive ──render──▶ SVG (canon, freeze-clean) ──rasterize──▶ PNG (display)
```

This resolves the Go-native-vs-Node raster question by sidestepping it: rasterize
only where a browser is already present (a live canvas). Two consequences the
runtime enforces:

- **Canon stays SVG.** The human auto-save restores the original SVG for baked
  files (`svgCanon` stash) so `scene.json` keeps the SVG, never the display PNG —
  JSON is canon (Covenant I).
- **`scene.json` is a canonical-state file**, sibling to `source.json`. Reply to
  canvas feedback by editing the scene and re-saving, never by patching pixels.

## Dark by default

Every drawing surface opens **dark**, to match std-doc's techno-dark soul, via
Excalidraw's `theme:"dark"`. That theme is an **invert filter**, so:

- the *authored* `viewBackgroundColor` stays **light** (`#ffffff`) and the theme
  inverts it to dark (`#121212`) — setting a dark value here double-inverts to grey;
- **image elements are counter-inverted** by Excalidraw, so our charts keep their
  true colors on the dark surface.

The chart raster bake uses a **transparent** background so charts composite onto
the dark canvas cleanly instead of carrying a white box.

## The feedback channel

The canvas carries the same two channels the rest of std-doc does: the human drags
/ types on the board (flows through `scene.json`), and types comments in the
widget (flows to `feedback.jsonl`, which the agent **Monitors**). A comment can
ride `ref` ids of selected shapes, so the agent knows which shapes are meant.
*The canvas is the conversation.*

**v2 — per-board files.** Each board writes its own
`feedback/canvas-<id>-scene.json` and `feedback/canvas-<id>-feedback.jsonl`
(the v1 shared board keeps its original filenames, `canvas-scene.json` /
`canvas-feedback.jsonl`, unprefixed — the id="" default). The agent now
Monitors a **glob**, `feedback/canvas-*-feedback.jsonl` (plus the legacy
unprefixed file for old-style docs), not one fixed path. Every per-board
feedback entry carries a `"board"` field naming which surface it came from, so
one Monitor loop can tell multiple boards apart without per-board plumbing.

## Where it lives

| Piece | Path |
|---|---|
| primitive (Go core) | `go/internal/core/canvas_primitive.go` |
| board id assignment (v2) | `go/internal/core/blocks.go` (`assignCanvasBoardIDs`) |
| runtime (codraw assets) | `go/stddoc-lib/lib/codraw/` |
| serve auto-wiring + per-board routing (v2) | `go/internal/serve/codraw.go`, `go/internal/serve/server.go` |
| freeze degrade | `go/internal/freeze/freeze.go` (`FreezeCanvas`) |
| self-tests | `go/internal/core/canvas_primitive_test.go`, `go/internal/core/canvas_v2_boards_test.go`, `go/internal/serve/codraw_v2_boards_test.go`, `go/internal/freeze/freeze_test.go` |
| design + findings | `the canvas design note`, `the canvas v2 per-board design` |
