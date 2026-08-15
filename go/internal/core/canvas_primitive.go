package core

import (
	"strconv"
	"strings"

	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// canvas_primitive.go — the `canvas` primitive: embed a live co-drawing surface
// (Excalidraw, served by the companion codraw server) INSIDE a std-doc page, so
// the reader and the agent draw on one shared scene the same way they comment on
// prose. It is the canvas renderer of std-doc's living-surface pattern: canonical
// state in a file (scene.json, sibling to source.json), a tiny server, and a
// feedback inbox the agent Monitors.
//
// THE TWO MODES (Covenant IV — freeze means frozen):
//   - serve (live):   emit an <iframe> mount to the codraw surface. The iframe is
//     sandboxed so Excalidraw's React/globals/CSS cannot collide
//     with the page's palette tokens.
//   - freeze (snap):  a live canvas reaches out to a server, so it CANNOT ship in
//     a frozen doc as-is. The freeze gate bakes it to an inline
//     SVG snapshot of the last scene (Slice 3). Until that lands,
//     freezing a canvas doc fails LOUD at the security gate (an
//     iframe src is an external reach) rather than shipping broken
//     — which is the honest behavior.
//
// Charts as citizens: our library renders any diagram/chart to SVG; a chart is
// delivered onto the board as an Excalidraw image element whose file is the SVG,
// which the codraw page auto-bakes to PNG for display (canon/freeze keep the SVG).
// That baking lives in the codraw runtime (go/stddoc-lib/lib/codraw), not here.
//
// Node schema:
//
//	{ "type":   "canvas",
//	  "id":     "arch",                   // optional board id (v2 per-board boards); auto-derived when absent
//	  "src":    "http://localhost:8747/", // optional EXPLICIT mount URL override; normally omitted
//	  "label":  "architecture sketch",    // optional caption chip
//	  "height": 520 }                      // optional iframe height in px (default 520)
//
// v2 — per-canvas boards (prd/canvas-primitive/v2-per-canvas-boards.md, Seam 1):
// v1 served one shared board per doc — every canvas block mounted the SAME
// codraw scene. v2 gives each block its own board: renderNode assigns every
// canvas block a stable `id` before this function ever runs (see
// assignCanvasBoardIDs in blocks.go — zero-config still works, no author
// action required), and this function emits BOTH `data-canvas-board='<id>'`
// (the routing key serve/codraw.go keys per-board scene/inbox files on) and,
// when the author left `src` unset (the normal case), a `codraw:<id>`
// PLACEHOLDER as the iframe src. serve rewrites each mount's placeholder to
// its own `http://localhost:PORT/board/<id>/` at request time (per-mount, not
// the old single global rewrite) — see rewriteCanvasBoards in codraw.go. An
// explicit authored `src` is still honored verbatim as an override/fallback,
// exactly as v1 did.
const canvasDefaultHeight = 520

// canvasRender emits the live iframe mount for a co-drawing surface. Purely
// additive — no existing page uses `canvas`, so conformance is untouched.
func canvasRender(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	label := strings.TrimSpace(getOr(block, "label", ""))
	id := strings.TrimSpace(str(block, "id"))
	src := strings.TrimSpace(str(block, "src"))
	if src == "" {
		if id == "" {
			// Should not happen for a doc-tree render (assignCanvasBoardIDs always
			// sets one first) — but this function is also reachable standalone
			// (tests, layout:page composition), so degrade loudly rather than
			// mount a boardless placeholder no server will ever route.
			return canvasDegraded(label, "no `src` and no board `id` — point it at a running codraw surface (e.g. http://localhost:8747/) or let the doc-tree renderer assign a board id"), nil
		}
		src = "codraw:" + id
	}

	height := canvasDefaultHeight
	if hv, ok := block.Get("height"); ok {
		if n, ok2 := toInt64(hv); ok2 && n > 0 {
			height = int(n)
		}
	}

	cap := ""
	if label != "" {
		cap = "<span class='dc-label'>" + wire.HTMLEscape(label) + "</span>"
	}

	// Author-time snapshot (Decision 1): an inline SVG of the last drawing, captured
	// where a browser exists (finalize) and stored in source.json. Carried hidden in
	// the live page; the freeze gate inlines it in place of the iframe, so a frozen
	// canvas shows the REAL drawing — with zero freeze-time toolchain.
	snapshot := ""
	if s := strings.TrimSpace(str(block, "snapshot")); s != "" {
		snapshot = "<div class='canvas-snapshot' hidden>" + s + "</div>"
	}

	// board id attribute goes FIRST, before class — freeze.go's canvasBlock
	// regex matches the literal substring "class='canvas-embed'
	// data-canvas-src='...'>" with nothing in between, so any new attribute
	// must land outside that span (freeze needs no change — PRD "what does
	// NOT change"). sandbox: scripts + same-origin so Excalidraw runs and the
	// page can talk to its own server; forms/popups off. The data-canvas-src
	// marker is the anchor the freeze gate keys on to bake this iframe to the
	// snapshot (or a placeholder).
	boardAttr := ""
	if id != "" {
		boardAttr = "data-canvas-board='" + wire.HTMLEscape(id) + "' "
	}
	return "<div " + boardAttr + "class='canvas-embed' data-canvas-src='" + wire.HTMLEscape(src) + "'>" +
		"<div class='dc-top'>" + cap +
		"<span class='dc-render' title='live co-drawing surface — freezes to an inline SVG snapshot'>render: canvas</span>" +
		"<button class='fz-btn'>&#x26F6; fullscreen</button></div>" + snapshot +
		"<iframe class='canvas-frame' src='" + wire.HTMLEscape(src) + "' " +
		"style='height:" + strconv.Itoa(height) + "px' " +
		"sandbox='allow-scripts allow-same-origin' " +
		"title='" + wire.HTMLEscape(labelOr(label, "co-drawing canvas")) + "'></iframe>" +
		"</div>", nil
}

// canvasDegraded is the loud skip note when the canvas is misconfigured — never a
// silent blank (Covenant VI: MEASURED > CLAIMED; a faked feature is the expensive
// divergence).
func canvasDegraded(label, reason string) string {
	return "<div class='canvas-embed canvas-degraded'><div class='dc-top'>" +
		"<span class='dc-label'>" + wire.HTMLEscape(labelOr(label, "canvas")) + "</span>" +
		"<span class='dc-render'>render: canvas</span>" +
		"<span class='dc-skip' style='color:#b58900;font-weight:600'>" +
		"&#9888; canvas not mounted (" + wire.HTMLEscape(reason) + ")</span>" +
		"</div></div>"
}

// labelOr returns label when non-empty, else fallback.
func labelOr(label, fallback string) string {
	if strings.TrimSpace(label) == "" {
		return fallback
	}
	return label
}
