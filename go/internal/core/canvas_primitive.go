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
//                     sandboxed so Excalidraw's React/globals/CSS cannot collide
//                     with the page's palette tokens.
//   - freeze (snap):  a live canvas reaches out to a server, so it CANNOT ship in
//                     a frozen doc as-is. The freeze gate bakes it to an inline
//                     SVG snapshot of the last scene (Slice 3). Until that lands,
//                     freezing a canvas doc fails LOUD at the security gate (an
//                     iframe src is an external reach) rather than shipping broken
//                     — which is the honest behavior.
//
// Charts as citizens: our library renders any diagram/chart to SVG; a chart is
// delivered onto the board as an Excalidraw image element whose file is the SVG,
// which the codraw page auto-bakes to PNG for display (canon/freeze keep the SVG).
// That baking lives in the codraw runtime (go/stddoc-lib/lib/codraw), not here.
//
// Node schema:
//
//	{ "type":   "canvas",
//	  "src":    "http://localhost:8747/", // the codraw mount URL (required for live)
//	  "label":  "architecture sketch",    // optional caption chip
//	  "height": 520 }                      // optional iframe height in px (default 520)

const canvasDefaultHeight = 520

// canvasRender emits the live iframe mount for a co-drawing surface. Purely
// additive — no existing page uses `canvas`, so conformance is untouched.
func canvasRender(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	label := strings.TrimSpace(getOr(block, "label", ""))
	src := strings.TrimSpace(str(block, "src"))
	if src == "" {
		return canvasDegraded(label, "no `src` — point it at a running codraw surface (e.g. http://localhost:8747/)"), nil
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

	// sandbox: scripts + same-origin so Excalidraw runs and the page can talk to
	// its own server; forms/popups off. The data-canvas-src marker is the anchor
	// the freeze gate keys on to bake this iframe to the snapshot (or a placeholder).
	return "<div class='canvas-embed' data-canvas-src='" + wire.HTMLEscape(src) + "'>" +
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
