package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// onboarding_test.go — v0.11 S4 + the maintainer's pixel-review fixes
// (style-interview/demo/source.json): the tour gained two S4 stops (the
// v0.11 vocabulary tour + the layout-mode picker) and then two more after
// the visual review surfaced a real scope gap — `diagram` (best-engine
// routing) and `canvas` (live codraw, v2 per-board) were entirely missing
// from a tour that's supposed to show off what std-doc does. Locks it the
// same way the gallery is locked: publish for real, no std-doc-error
// anywhere, PLUS a hard regression guard for the exact bug Dragon found —
// a hardcoded "N of 7" progress badge that drifted out of sync with the
// pager's own auto-computed "N / M" once the tour grew past 7 stops. That
// hardcoded field is now REMOVED entirely (the pager already computes it;
// a duplicated computed value is the drift-smell that caused the bug in the
// first place) — this test asserts it can never come back silently.
func TestOnboardingTour_RendersCleanly(t *testing.T) {
	root := repoRoot(t)
	lib := loadLib(t)

	srcPath := filepath.Join(root, "style-interview", "demo", "source.json")
	data, err := os.ReadFile(srcPath)
	if err != nil {
		t.Fatalf("read onboarding source.json: %v", err)
	}
	doc := parseDoc(t, string(data))

	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish onboarding tour: %v", err)
	}
	for _, want := range []string{
		"new-vocabulary.html", "pick-your-shell.html",
		"see-it-draw-itself.html", "draw-with-me.html",
	} {
		if _, ok := pages[want]; !ok {
			t.Errorf("onboarding tour missing stop %q", want)
		}
	}
	for name, html := range pages {
		if strings.Contains(html, "std-doc-error") {
			t.Errorf("onboarding page %s carries a std-doc-error", name)
		}
		// The bug Dragon found: a hardcoded "N of <stale total>" progress
		// string that disagrees with the pager's own auto "N / M" counter.
		// No page may EVER carry a literal " of " progress phrase again —
		// the pager header is the single source of truth for position.
		if strings.Contains(html, " of 7") || strings.Contains(html, " of 9") {
			t.Errorf("onboarding page %s carries a stale hardcoded page-count string — the pager header already computes this; it must never be duplicated as authored text", name)
		}
	}

	// The pager's own auto-computed position must actually match reality:
	// 11 content stops (the cover is separate, "start").
	last, ok := pages["come-build.html"]
	if !ok {
		t.Fatal("expected the tour's final stop, come-build.html")
	}
	if !strings.Contains(last, "11 / 11") {
		t.Error("expected the pager header on the final stop to read '11 / 11' — the tour has 11 content stops")
	}

	// The 4 examples/primitives the tour points to must actually exist.
	for _, ex := range []string{"starter-no-nav", "starter-hero", "primitive-gallery"} {
		if _, err := os.Stat(filepath.Join(root, "examples", ex, "source.json")); err != nil {
			t.Errorf("onboarding points to examples/%s/ but it doesn't exist: %v", ex, err)
		}
	}

	// R2 pixel-review, second pass — O1: "pick your shell" must be an
	// interactive LIVE comparison (tabs), not a static description card.
	shellPage, ok := pages["pick-your-shell.html"]
	if !ok {
		t.Fatal("expected pick-your-shell.html")
	}
	if !strings.Contains(shellPage, "class='tabs'") {
		t.Error("O1: pick-your-shell must use a live tabs comparison, not a static cardgrid")
	}
	for _, mode := range []string{"left-nav (classic)", "no-nav", "top-nav", "hero"} {
		if !strings.Contains(shellPage, mode) {
			t.Errorf("O1: pick-your-shell tabs missing the %q mode", mode)
		}
	}

	// O2: the diagram-routing table must be a real `tree` structure, not
	// prose — every D2 and Mermaid dtype from protocol/diagrams.md's table
	// must appear as an actual tree node.
	diagPage, ok := pages["see-it-draw-itself.html"]
	if !ok {
		t.Fatal("expected see-it-draw-itself.html")
	}
	if !strings.Contains(diagPage, "class='tree-wrap'") {
		t.Error("O2: the diagram routing table must be shown as a `tree` primitive")
	}
	for _, dtype := range []string{"sequence", "class", "erd", "mindmap", "gantt", "sankey", "gitgraph"} {
		if !strings.Contains(diagPage, "class='tn-label'>"+dtype+"<") {
			t.Errorf("O2: routing tree missing dtype %q", dtype)
		}
	}

	// O4: the JSON-canon stop must explicitly say what happens to a
	// drawing canvas (persists to its own scene.json, like feedback.jsonl).
	palacePage, ok := pages["the-palace.html"]
	if !ok {
		t.Fatal("expected the-palace.html")
	}
	if !strings.Contains(palacePage, "scene.json") || !strings.Contains(palacePage, "feedback.jsonl") {
		t.Error("O4: the-palace must explicitly mention canvas persistence (scene.json alongside feedback.jsonl)")
	}
}

// TestOnboardingCanvas_HasStarterScene covers O3 (the maintainer's R2
// pixel-review, high value): the "Draw with me" tour stop's canvas must NOT
// open blank. A pre-authored starter scene ships at
// style-interview/demo/published/feedback/canvas-<id>-scene.json — the exact
// path codrawServer.scenePath resolves for that board id — so it's already
// on disk before the surface is ever served; codrawServer's seedScene only
// writes an empty scene when NOTHING exists at that path yet, so a real
// pre-authored file there is left untouched and IS what the reader sees.
func TestOnboardingCanvas_HasStarterScene(t *testing.T) {
	root := repoRoot(t)
	scenePath := filepath.Join(root, "style-interview", "demo", "published", "feedback", "canvas-tour-canvas-scene.json")
	b, err := os.ReadFile(scenePath)
	if err != nil {
		t.Fatalf("expected a starter scene at %s: %v", scenePath, err)
	}
	var scene map[string]any
	if err := json.Unmarshal(b, &scene); err != nil {
		t.Fatalf("starter scene is not valid JSON: %v", err)
	}
	els, ok := scene["elements"].([]any)
	if !ok || len(els) == 0 {
		t.Error("starter scene must carry at least one element — an empty elements list is the exact blank-canvas Dragon flagged")
	}
	if scene["type"] != "excalidraw" {
		t.Error("starter scene must be a valid excalidraw scene document")
	}
}

// TestStarterHero_ Uses the hero layout and is byte-clean (same shape as
// starter-no-nav's own coverage, S4's third example doc).
func TestStarterHeroExample_RendersCleanly(t *testing.T) {
	root := repoRoot(t)
	lib := loadLib(t)
	data, err := os.ReadFile(filepath.Join(root, "examples", "starter-hero", "source.json"))
	if err != nil {
		t.Fatalf("read starter-hero source.json: %v", err)
	}
	doc := parseDoc(t, string(data))
	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish starter-hero: %v", err)
	}
	html, ok := pages["welcome.html"]
	if !ok {
		t.Fatal("starter-hero missing welcome.html")
	}
	if !strings.Contains(html, "hero-shell") {
		t.Error("starter-hero must use the hero-shell")
	}
	if strings.Contains(html, "<aside") {
		t.Error("starter-hero (layout:hero) must not emit the left-nav aside")
	}
	if !strings.Contains(html, "class='crumb'") {
		t.Error("starter-hero must still carry the breadcrumb (decoupled from sidebar)")
	}
}
