package core

import (
	"strings"
	"testing"

	"stddoc/internal/wire"
)

// TestLayoutNoNav verifies the `layout:"no-nav"` mode drops the left rail, while
// a doc with NO layout field is unchanged (the conformance-safety invariant:
// existing docs must not change — the maintainer 2026-08-15).
func TestLayoutNoNav(t *testing.T) {
	lib := loadLib(t)

	noNav, err := wire.ParseOrderedJSON([]byte(`{"title":"x","layout":"no-nav","nodes":[{"slug":"a","title":"A"}]}`))
	if err != nil {
		t.Fatalf("parse no-nav doc: %v", err)
	}
	h := head("x", noNav, "a", false, "", lib)
	if !strings.Contains(h, "nonav-shell") {
		t.Error("layout:no-nav must use the nonav-shell")
	}
	if strings.Contains(h, "<aside") {
		t.Error("layout:no-nav must NOT emit the left-nav aside")
	}

	// absent layout → default (left-nav) shell, aside present, nonav CSS absent.
	def, err := wire.ParseOrderedJSON([]byte(`{"title":"x","nodes":[{"slug":"a","title":"A"}]}`))
	if err != nil {
		t.Fatalf("parse default doc: %v", err)
	}
	h2 := head("x", def, "a", false, "", lib)
	if strings.Contains(h2, "nonav-shell") {
		t.Error("a doc with no layout field must NOT become nonav (existing docs unchanged)")
	}
	if !strings.Contains(h2, "<aside") {
		t.Error("default doc must still emit the left-nav aside")
	}
}

// TestLayoutTopNavHero covers the S2 modes: top-nav swaps the aside for a sticky
// horizontal bar that KEEPS the search box (cf-search); hero drops the rail for a
// full-bleed header. Both must never fire for a doc with no layout field.
func TestLayoutTopNavHero(t *testing.T) {
	lib := loadLib(t)

	top, _ := wire.ParseOrderedJSON([]byte(`{"title":"x","layout":"top-nav","nodes":[{"slug":"a","title":"A"},{"slug":"b","title":"B"}]}`))
	ht := head("x", top, "a", false, "", lib)
	if !strings.Contains(ht, "topnav-shell") {
		t.Error("layout:top-nav must use topnav-shell")
	}
	if strings.Contains(ht, "<aside") {
		t.Error("layout:top-nav must NOT emit the left-nav aside")
	}
	if !strings.Contains(ht, "class='topnav'") {
		t.Error("layout:top-nav must emit the horizontal topnav bar")
	}
	if !strings.Contains(ht, "id='cf-search'") {
		t.Error("layout:top-nav must keep the search box (decoupled from the sidebar)")
	}

	hero, _ := wire.ParseOrderedJSON([]byte(`{"title":"x","layout":"hero","nodes":[{"slug":"a","title":"A"}]}`))
	hh := head("x", hero, "a", false, "", lib)
	if !strings.Contains(hh, "hero-shell") {
		t.Error("layout:hero must use hero-shell")
	}
	if strings.Contains(hh, "<aside") {
		t.Error("layout:hero must NOT emit the left-nav aside")
	}
}

// TestBreadcrumbDecoupledFromSidebar proves the breadcrumb (Phase A, this
// slice) renders in EVERY layout mode, not just the left-nav default — it
// must not be visually or structurally tied to the .nav aside. renderNode
// calls renderBreadcrumb unconditionally (nav.go), and .crumb styling lives in
// body.css (not nested under .nav), so this holds for free; this test locks
// that invariant against regression.
func TestBreadcrumbDecoupledFromSidebar(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}
	for _, mode := range []string{"", "no-nav", "top-nav", "hero"} {
		js := `{"title":"x"`
		if mode != "" {
			js += `,"layout":"` + mode + `"`
		}
		js += `,"nodes":[{"slug":"a","title":"A"},{"slug":"b","title":"B"}]}`
		doc := parseDoc(t, js)
		buildTree(doc)
		n := bySlug(doc, "b")
		h := renderNode(n, doc, reg, "", lib)
		if !strings.Contains(h, "class='crumb'") {
			t.Errorf("mode %q: breadcrumb missing from rendered node", mode)
		}
	}
}
