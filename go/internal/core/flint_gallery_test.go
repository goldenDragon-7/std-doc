package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// flint_gallery_test.go — the full Flint Gallery (examples/flint-gallery/
// source.json) is a self-hosting std-doc that renders all ~34 Flint catalog
// charts live, each followed by its copy-paste source (the primitive-gallery
// "view source" pattern). This test locks it as a living conformance
// fixture: every one of the 34 catalog dtypes shipped in stddoc-lib/flint/
// has a gallery page and renders a live inline SVG with zero std-doc-error.
func TestFlintGallery_All34ChartsRenderCleanly(t *testing.T) {
	root := repoRoot(t)
	lib := loadLib(t)

	srcPath := filepath.Join(root, "examples", "flint-gallery", "source.json")
	data, err := os.ReadFile(srcPath)
	if err != nil {
		t.Fatalf("read flint-gallery source.json: %v", err)
	}
	doc := parseDoc(t, string(data))

	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish flint gallery: %v", err)
	}

	// Every catalog SVG in stddoc-lib/flint/ must have a gallery page named
	// f-<dtype-with-hyphens>.html — the "all 34" completeness invariant.
	flintDir := filepath.Join(root, "go", "stddoc-lib", "flint")
	entries, err := os.ReadDir(flintDir)
	if err != nil {
		t.Fatalf("read stddoc-lib/flint: %v", err)
	}
	dtypes := []string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".svg") {
			continue
		}
		dtypes = append(dtypes, strings.TrimSuffix(e.Name(), ".svg"))
	}
	if len(dtypes) == 0 {
		t.Fatalf("no .svg catalog charts found in %s", flintDir)
	}

	missing := []string{}
	for _, dt := range dtypes {
		slug := "f-" + strings.ReplaceAll(dt, "_", "-") + ".html"
		html, ok := pages[slug]
		if !ok {
			missing = append(missing, dt)
			continue
		}
		if !strings.Contains(html, "<svg") {
			t.Errorf("gallery page %s: no live <svg> embedded for dtype %s", slug, dt)
		}
		if !strings.Contains(html, "class='showcase'") {
			t.Errorf("gallery page %s: sample is not wrapped in the LIVE RENDER showcase box", slug)
		}
	}
	if len(missing) > 0 {
		t.Errorf("gallery is missing a page for catalog dtype(s): %v", missing)
	}

	// No gallery page may carry a std-doc render error — a wrong sample on
	// the discoverability surface itself is a lie about the catalog.
	for name, html := range pages {
		if strings.Contains(html, "std-doc-error") {
			t.Errorf("gallery page %s carries a std-doc-error — fix the sample block", name)
		}
	}
}
