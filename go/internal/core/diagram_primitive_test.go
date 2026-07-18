package core

// diagram_primitive_test.go — the SELF-TESTING harness for the `diagram`
// primitive and the best-engine-per-type routing standard.
//
// These tests are the executable form of the diagram team's vetted standard
// (knowledge-pack, 22/22 PASS, 2026-07-15). If the shipped routing table
// (go/stddoc-lib/diagram_engines.json) ever drifts from the vetted verdict, or a
// route stops rendering / freezing the way the gate proved, `go test` goes red
// instead of waiting for a human to re-read.

import (
	"strings"
	"testing"

	"stddoc/internal/gate"
	"stddoc/internal/palette"
	"stddoc/internal/wire"
)

// renderDiagram builds a real registry + ctx and renders one `diagram` node
// given as JSON. Uses the real in-process D2 and the real mermaid primitive.
func renderDiagram(t *testing.T, nodeJSON string) string {
	t.Helper()
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	node, err := wire.ParseOrderedJSON([]byte(nodeJSON))
	if err != nil {
		t.Fatalf("parse node: %v", err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := reg.Render("diagram", node, ctx)
	if err != nil {
		t.Fatalf("render diagram: %v", err)
	}
	return out
}

// CAPABILITY: the diagram primitive is registered (a dropped primitive fails).
func TestCapability_DiagramPrimitiveRegistered(t *testing.T) {
	reg, err := buildRegistry(loadLib(t))
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	if !reg.Has("diagram") {
		t.Fatal("primitive \"diagram\" must be registered")
	}
}

// CAPABILITY: the vetted routing table ships in the library and parses, and its
// verdicts match the diagram team's best-engine-per-type standard EXACTLY. This
// is the standard-as-a-test: edit diagram_engines.json away from the vetted
// verdict and this goes red.
func TestCapability_DiagramRoutingMatchesVettedStandard(t *testing.T) {
	lib := loadLib(t)
	if len(lib.DiagramEnginesJSON) == 0 {
		t.Fatal("diagram_engines.json must ship in the library (the vetted standard as data)")
	}
	table := loadDiagramEngineTable(lib.DiagramEnginesJSON)
	// The vetted 22-diagram manifest verdict (2026-07-15 regrade).
	want := map[string]string{
		"sequence": "d2", "class": "d2", "erd": "d2", "c4-architecture": "d2",
		"network-topology": "d2", "state-machine": "d2", "dfd": "d2", "tree": "d2",
		"swimlane": "d2", "block": "d2", "requirement": "d2", "venn": "d2",
		"mindmap": "d2", "packet": "d2", "stacked-bands": "d2",
		"gantt": "mermaid", "quadrant": "mermaid", "journey": "mermaid",
		"sankey": "mermaid", "gitgraph": "mermaid",
	}
	for dtype, eng := range want {
		if got := table.route(dtype, ""); got != eng {
			t.Errorf("route(%q) = %q, want %q (vetted best-engine-per-type standard)", dtype, got, eng)
		}
	}
	// mindmap is the load-bearing one: Mermaid's mindmap is dark-on-dark broken,
	// so it MUST stay on D2 no matter what.
	if table.route("mindmap", "") != "d2" {
		t.Fatal("mindmap must route to D2 — Mermaid's mindmap is broken (dark-on-dark)")
	}
}

// CAPABILITY: a structural type renders IN-PROCESS via D2 to an inline SVG with
// the generated engine chip — and is FREEZE-SAFE (no external refs). This is the
// browser-free-freeze guarantee for structural diagrams.
func TestCapability_DiagramStructuralRendersD2InlineAndFreezeSafe(t *testing.T) {
	out := renderDiagram(t, `{"type":"diagram","dtype":"class","label":"Model","d2":"a: A\nb: B\na -> b"}`)
	if !strings.Contains(out, "<svg") {
		t.Fatalf("class diagram must render an inline <svg> in-process; got:\n%s", out)
	}
	if !strings.Contains(out, "render: d2") {
		t.Errorf("D2 route must carry the generated 'render: d2' engine chip; got:\n%s", out)
	}
	// Freeze-safety measured by the REAL gate (whitelists the w3.org SVG
	// namespace URIs, catches actual external fetch/exfil refs).
	if leaks := gate.Scan(out); len(leaks) != 0 {
		t.Errorf("frozen-safe invariant: a rendered D2 diagram must have zero external refs; gate found: %v", leaks)
	}
}

// CAPABILITY: a quantitative type routes to Mermaid (client-render card, baked
// to inline SVG at freeze), carrying the engine chip.
func TestCapability_DiagramQuantitativeRoutesToMermaid(t *testing.T) {
	out := renderDiagram(t, `{"type":"diagram","dtype":"gantt","mermaid":"gantt\n title X\n section S\n task: 2026-01-01,1d"}`)
	if !strings.Contains(out, "class='mermaid'") {
		t.Fatalf("gantt must route to the Mermaid card (class='mermaid'); got:\n%s", out)
	}
	if !strings.Contains(out, "render: mermaid") {
		t.Errorf("Mermaid route must carry the generated 'render: mermaid' engine chip; got:\n%s", out)
	}
}

// CAPABILITY: an explicit engine override beats the routing table (the author
// knob the dossier asked for — both engines always available).
func TestCapability_DiagramEngineOverrideWins(t *testing.T) {
	// dtype=class routes to d2 by default, but engine=mermaid must win.
	out := renderDiagram(t, `{"type":"diagram","dtype":"class","engine":"mermaid","mermaid":"classDiagram\n class A"}`)
	if !strings.Contains(out, "class='mermaid'") {
		t.Fatalf("explicit engine=mermaid must override the class->d2 default; got:\n%s", out)
	}
}

// CAPABILITY: forgiving fallback — if the routed engine has no source but the
// other engine does (and no explicit override), honor the source supplied.
func TestCapability_DiagramForgivingSourceFallback(t *testing.T) {
	// gantt routes to mermaid, but only a d2 source is provided -> render D2.
	out := renderDiagram(t, `{"type":"diagram","dtype":"gantt","d2":"a: A\nb: B\na -> b"}`)
	if !strings.Contains(out, "<svg") || !strings.Contains(out, "render: d2") {
		t.Fatalf("with only a d2 source, a gantt should fall back to the D2 render; got:\n%s", out)
	}
}
