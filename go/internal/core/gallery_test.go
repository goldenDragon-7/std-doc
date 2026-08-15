package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// gallery_test.go — v0.11 "discoverability release" S1: the Living Primitive
// Gallery (examples/primitive-gallery/source.json) is a self-hosting std-doc
// that renders EVERY primitive live with its source.json beside it (the
// "view source" pattern). This test locks it as a living conformance
// fixture: every one of the 37 declarative primitives in templates.json
// renders without a std-doc render error, and none is silently missing from
// the gallery. If a future primitive addition forgets to update the gallery,
// or a template regression breaks one, this goes red.
func TestGallery_AllPrimitivesRenderCleanly(t *testing.T) {
	root := repoRoot(t)
	lib := loadLib(t)

	srcPath := filepath.Join(root, "examples", "primitive-gallery", "source.json")
	data, err := os.ReadFile(srcPath)
	if err != nil {
		t.Fatalf("read gallery source.json: %v", err)
	}
	doc := parseDoc(t, string(data))

	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish gallery: %v", err)
	}

	// Every declarative primitive in templates.json must have a gallery page
	// (slug "p-<type>", underscores dashed) — the "all ~37" completeness
	// invariant, catching a future primitive that ships without a gallery entry.
	var templateMap map[string]any
	if err := json.Unmarshal(lib.TemplatesJSON, &templateMap); err != nil {
		t.Fatalf("parse templates.json: %v", err)
	}
	missing := []string{}
	for typ := range templateMap {
		switch typ {
		case "children":
			continue // node-structural auto-block, never authored directly
		case "showcase":
			// The R2 pixel-review "LIVE RENDER" box (the maintainer, G1): a CHROME
			// primitive that wraps every OTHER sample on the gallery — it's
			// meta, not a thing to demo standalone, so it's exempt from
			// needing its own p-showcase.html the same way `children` is.
			continue
		}
		slug := "p-" + strings.ReplaceAll(typ, "_", "-") + ".html"
		if _, ok := pages[slug]; !ok {
			missing = append(missing, typ)
		}
	}
	if len(missing) > 0 {
		t.Errorf("gallery is missing a page for: %v (every templates.json primitive needs one)", missing)
	}

	// G4 (the maintainer's R2 pixel-review): `canvas` is structural (not in
	// templates.json) but IS a primitive — the gallery must cover it too.
	if _, ok := pages["p-canvas.html"]; !ok {
		t.Error("gallery is missing p-canvas.html — canvas is structural but still a primitive (G4)")
	}

	// G1: every sample must be wrapped in the "LIVE RENDER" showcase box, not
	// left to render as an orphaned block with nothing visually containing it.
	for slug, html := range pages {
		if !strings.HasPrefix(slug, "p-") {
			continue // group-nav pages aren't primitive-sample pages
		}
		if !strings.Contains(html, "class='showcase'") {
			t.Errorf("gallery page %s: sample is not wrapped in the LIVE RENDER showcase box (G1)", slug)
		}
	}

	// No gallery page may carry a std-doc render error — a wrong sample in the
	// gallery is a lie ON the discoverability surface itself.
	for name, html := range pages {
		if strings.Contains(html, "std-doc-error") {
			t.Errorf("gallery page %s carries a std-doc-error — fix the sample block", name)
		}
	}
}
