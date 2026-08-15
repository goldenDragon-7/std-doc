package core

// canvas_primitive_test.go — SELF-TESTING harness for the `canvas` primitive:
// the living-surface pattern's canvas renderer (a co-drawing surface embedded in
// a doc). These are the executable form of the documented capability; if the
// primitive drops, stops emitting the sandboxed iframe mount, or stops degrading
// loud on misconfiguration, `go test` goes red instead of waiting for a human.

import (
	"strings"
	"testing"

	"stddoc/internal/palette"
	"stddoc/internal/wire"
)

// renderCanvas builds a real registry + ctx and renders one `canvas` node.
func renderCanvas(t *testing.T, nodeJSON string) string {
	t.Helper()
	reg, err := buildRegistry(loadLib(t))
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	node, err := wire.ParseOrderedJSON([]byte(nodeJSON))
	if err != nil {
		t.Fatalf("parse node: %v", err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := reg.Render("canvas", node, ctx)
	if err != nil {
		t.Fatalf("render canvas: %v", err)
	}
	return out
}

// CAPABILITY: the canvas primitive is registered (a dropped primitive fails).
func TestCapability_CanvasPrimitiveRegistered(t *testing.T) {
	reg, err := buildRegistry(loadLib(t))
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	if !reg.Has("canvas") {
		t.Fatal("primitive \"canvas\" must be registered")
	}
}

// CAPABILITY: a canvas with a src emits a sandboxed iframe mount to that surface,
// carrying the freeze-bake marker the gate keys on.
func TestCapability_CanvasEmitsSandboxedMount(t *testing.T) {
	out := renderCanvas(t, `{"type":"canvas","src":"http://localhost:8747/","label":"sketch"}`)
	for _, want := range []string{
		"iframe class='canvas-frame'",
		"src='http://localhost:8747/'",
		"sandbox='allow-scripts allow-same-origin'",
		"data-canvas-src='http://localhost:8747/'", // freeze-bake anchor (Slice 3)
		"render: canvas",
		"sketch",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("canvas mount missing %q\n got: %s", want, out)
		}
	}
}

// CAPABILITY: the `height` override is honored — regression guard for the
// json.Number coercion (UseNumber makes numbers arrive as json.Number; a naive
// float64-only switch silently dropped the override back to the default).
func TestCapability_CanvasHeightOverrideHonored(t *testing.T) {
	out := renderCanvas(t, `{"type":"canvas","src":"http://x/","height":480}`)
	if !strings.Contains(out, "height:480px") {
		t.Errorf("canvas height override not honored (json.Number coercion?)\n got: %s", out)
	}
	def := renderCanvas(t, `{"type":"canvas","src":"http://x/"}`)
	if !strings.Contains(def, "height:520px") {
		t.Errorf("canvas default height (520) not applied\n got: %s", def)
	}
}

// CAPABILITY: a misconfigured canvas (no src) degrades LOUD, never a silent blank
// (Covenant VI — a faked feature is the expensive divergence).
func TestCapability_CanvasDegradesLoudWithoutSrc(t *testing.T) {
	out := renderCanvas(t, `{"type":"canvas","label":"oops"}`)
	if !strings.Contains(out, "canvas-degraded") || !strings.Contains(out, "canvas not mounted") {
		t.Errorf("canvas without src must degrade loud\n got: %s", out)
	}
	if strings.Contains(out, "<iframe") {
		t.Errorf("degraded canvas must NOT emit an iframe\n got: %s", out)
	}
}
