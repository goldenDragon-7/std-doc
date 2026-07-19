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
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/flintbake"
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
		// engine #3 (Slice 0): the quantitative/statistical family neither D2
		// nor Mermaid draws — routes to Flint (microsoft/flint-chart).
		"histogram": "flint",
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

// CAPABILITY (engine #3, Slice 0): a Flint-routed type (the quantitative/
// statistical family) embeds the author's pre-rendered Vega-Lite SVG directly,
// carries the 'render: flint' chip, and is FREEZE-SAFE — zero external refs, and
// NO Node/JS bake in the core binary. This is the whole-family-embeddable
// guarantee: histogram routes to flint, the supplied SVG lands inline, the gate
// is clean. (Live spec->SVG rendering is the deferred Slice 1 Node dependency.)
func TestCapability_DiagramFlintEmbedsPrerenderedSVGFreezeSafe(t *testing.T) {
	// A minimal freeze-clean inline SVG stands in for a real flint chart.
	out := renderDiagram(t, `{"type":"diagram","dtype":"histogram","label":"dist","flint":"<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10'/></svg>"}`)
	if !strings.Contains(out, "<svg") || !strings.Contains(out, "<rect") {
		t.Fatalf("histogram must embed the supplied flint SVG inline; got:\n%s", out)
	}
	if !strings.Contains(out, "render: flint") {
		t.Errorf("Flint route must carry the generated 'render: flint' engine chip; got:\n%s", out)
	}
	if leaks := gate.Scan(out); len(leaks) != 0 {
		t.Errorf("frozen-safe invariant: an embedded flint SVG must have zero external refs; gate found: %v", leaks)
	}
}

// CAPABILITY (engine #3, catalog): an author NAMES a chart via dtype (no pasted
// SVG) and std-doc embeds its pre-rendered chart from the library catalog
// (stddoc-lib/flint/*.svg) — the mechanism→feature line. boxplot with no source
// must still render an inline SVG, the flint chip, and stay freeze-clean.
func TestCapability_DiagramFlintCatalogNamesAChart(t *testing.T) {
	out := renderDiagram(t, `{"type":"diagram","dtype":"boxplot","label":"dist"}`)
	if !strings.Contains(out, "<svg") {
		t.Fatalf("boxplot (dtype-only) must embed its catalog SVG; got:\n%s", out)
	}
	if !strings.Contains(out, "render: flint") {
		t.Errorf("catalog-named flint chart must carry the 'render: flint' chip; got:\n%s", out)
	}
	if strings.Contains(out, "not rendered") {
		t.Errorf("boxplot must resolve from the catalog, not degrade; got:\n%s", out)
	}
	if leaks := gate.Scan(out); len(leaks) != 0 {
		t.Errorf("a catalog flint chart must be freeze-clean; gate found: %v", leaks)
	}
}

// CAPABILITY (drift guard): EVERY type routed to flint in the vetted table must
// have a matching pre-rendered SVG in the library catalog — so adding a flint
// row without shipping its chart (or renaming an SVG) fails the build instead of
// degrading silently at publish time.
func TestCapability_DiagramFlintCatalogCoversEveryRoute(t *testing.T) {
	lib := loadLib(t)
	table := loadDiagramEngineTable(lib.DiagramEnginesJSON)
	if len(lib.FlintSVGs) == 0 {
		t.Fatal("flint catalog (stddoc-lib/flint/*.svg) must ship — engine #3 Slice 0")
	}
	n := 0
	for dtype, rule := range table.Types {
		if rule.Engine != "flint" {
			continue
		}
		n++
		if flintLookup(lib.FlintSVGs, dtype) == "" {
			t.Errorf("flint route %q has no catalog SVG (stddoc-lib/flint/%s.svg) — drift", dtype, strings.ReplaceAll(dtype, "-", "_"))
		}
	}
	if n < 34 {
		t.Errorf("expected the full Flint family (34 routes), found %d flint routes in the table", n)
	}
}

// CAPABILITY (engine #3, Slice 1 — honest degrade): when a live `spec` bake
// fails (no Node, no toolchain, bad spec), the primitive degrades LOUDLY with
// the reason — never a silent blank. Deterministic: a stub baker that errors, so
// this guards the honest-failure contract without needing the Node toolchain.
func TestCapability_DiagramFlintLiveBakeDegradesLoud(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	fn := diagramRenderWith(loadDiagramEngineTable(lib.DiagramEnginesJSON), lib.FlintSVGs,
		func([]byte) (string, error) { return "", fmt.Errorf("node not found") })
	node, err := wire.ParseOrderedJSON([]byte(`{"type":"diagram","dtype":"histogram","engine":"flint","spec":{"data":{"values":[{"x":1}]}}}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := fn(node, ctx)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out, "not rendered") || !strings.Contains(out, "node not found") {
		t.Fatalf("a failed live bake must degrade loudly with the reason; got:\n%s", out)
	}
}

// CAPABILITY (engine #3, Slice 1 — live bake): when the optional Node toolchain
// is present, a diagram carrying a live Flint `spec` bakes to an inline SVG
// (flint-chart → vega-lite → vega) with the flint chip, and stays freeze-clean.
// Skips when the toolchain is absent (it is OPTIONAL — Slice-0 embed needs none).
// Uses the version-controlled example so the spec is known-good.
func TestCapability_DiagramFlintLiveBakeRendersFromSpec(t *testing.T) {
	lib := loadLib(t)
	if !flintbake.Available(lib.Root) {
		t.Skip("optional live-Flint toolchain absent (node + npm install in stddoc-lib/flint/bake) — Slice-0 embed needs none")
	}
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "examples", "flint-live", "source.json"))
	if err != nil {
		t.Skipf("live example not present: %v", err)
	}
	doc, err := wire.ParseOrderedJSON(raw)
	if err != nil {
		t.Fatalf("parse example: %v", err)
	}
	// nodes[0].blocks[0] is the live-spec diagram.
	nodes, _ := doc.Get("nodes")
	nl, _ := nodes.([]any)
	n0, _ := nl[0].(*wire.OrderedMap)
	blocks, _ := n0.Get("blocks")
	bl, _ := blocks.([]any)
	block, _ := bl[0].(*wire.OrderedMap)

	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := reg.Render("diagram", block, ctx)
	if err != nil {
		t.Fatalf("render live diagram: %v", err)
	}
	if !strings.Contains(out, "<svg") || !strings.Contains(out, "render: flint") {
		t.Fatalf("a live Flint spec must bake to an inline flint SVG; got first 300:\n%.300s", out)
	}
	if strings.Contains(out, "not rendered") {
		t.Fatalf("live bake must succeed with the toolchain present, not degrade; got:\n%.300s", out)
	}
	if leaks := gate.Scan(out); len(leaks) != 0 {
		t.Errorf("a live-baked flint SVG must be freeze-clean (0 external refs); gate: %v", leaks)
	}
}
