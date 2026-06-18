package core

import (
	"os"
	"path/filepath"
	"testing"

	"stddoc/internal/library"
	"stddoc/internal/wire"
)

// repoRoot walks up from this file's directory to find the repo root
// (the directory that contains conformance/).
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return dir
}

// TestStyleABConformance asserts that the Go renderer produces byte-identical
// output to the Python oracle for the style_ab primitive — the first
// interactive primitive (local JS, no external refs). This is the foundational
// Go/Python byte-identity proof for core.
func TestStyleABConformance(t *testing.T) {
	root := repoRoot(t)
	libDir := filepath.Join(root, "go", "stddoc-lib")
	caseDir := filepath.Join(root, "conformance", "cases", "style-ab")

	lib, err := library.Load(libDir)
	if err != nil {
		t.Fatalf("load library: %v", err)
	}

	inputBytes, err := os.ReadFile(filepath.Join(caseDir, "input.json"))
	if err != nil {
		t.Fatalf("read input.json: %v", err)
	}
	doc, err := wire.ParseOrderedJSON(inputBytes)
	if err != nil {
		t.Fatalf("parse input.json: %v", err)
	}

	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}

	expectedDir := filepath.Join(caseDir, "expected")
	entries, err := os.ReadDir(expectedDir)
	if err != nil {
		t.Fatalf("read expected/: %v", err)
	}

	for _, e := range entries {
		name := e.Name()
		want, err := os.ReadFile(filepath.Join(expectedDir, name))
		if err != nil {
			t.Fatalf("read expected/%s: %v", name, err)
		}
		got, ok := pages[name]
		if !ok {
			t.Errorf("Go output missing page %s", name)
			continue
		}
		if got != string(want) {
			t.Errorf("page %s: Go output differs from Python golden\nfirst diff byte at ~%d",
				name, firstDiffByte(got, string(want)))
		}
	}

	// Also assert style_ab structural markers are actually present — guards
	// against a future template silent-empty regression.
	main := pages["pick-a-voice.html"]
	for _, marker := range []string{
		"class='style-ab'",
		"class='sab-tab'",
		"class='sab-world",
		"document.currentScript",
		"localStorage.setItem",
	} {
		if !contains(main, marker) {
			t.Errorf("pick-a-voice.html missing expected marker: %q", marker)
		}
	}
}

func firstDiffByte(a, b string) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return i
		}
	}
	return min(len(a), len(b))
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && func() bool {
		for i := 0; i <= len(s)-len(sub); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	}()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// TestPagerConformance asserts the Go renderer produces byte-identical output to
// the Python oracle for the PAGER layout (nav:"pager") — the guided reading tour
// with a progress header, prev/next, accent/sky atmosphere, and the start-over
// loop. Mirrors TestStyleABConformance; the pager case exercises group-skip,
// number-prefix stripping, per-page accent, and sky:right.
func TestPagerConformance(t *testing.T) {
	root := repoRoot(t)
	lib, err := library.Load(filepath.Join(root, "go", "stddoc-lib"))
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	caseDir := filepath.Join(root, "conformance", "cases", "pager")
	inputBytes, err := os.ReadFile(filepath.Join(caseDir, "input.json"))
	if err != nil {
		t.Fatalf("read input.json: %v", err)
	}
	doc, err := wire.ParseOrderedJSON(inputBytes)
	if err != nil {
		t.Fatalf("parse input.json: %v", err)
	}
	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	expectedDir := filepath.Join(caseDir, "expected")
	entries, err := os.ReadDir(expectedDir)
	if err != nil {
		t.Fatalf("read expected/: %v", err)
	}
	for _, e := range entries {
		name := e.Name()
		want, err := os.ReadFile(filepath.Join(expectedDir, name))
		if err != nil {
			t.Fatalf("read expected/%s: %v", name, err)
		}
		got, ok := pages[name]
		if !ok {
			t.Errorf("Go output missing page %s", name)
			continue
		}
		if got != string(want) {
			t.Errorf("page %s: Go output differs from Python golden\nfirst diff byte at ~%d",
				name, firstDiffByte(got, string(want)))
		}
	}
	// Structural markers — guard against a silent-empty pager regression.
	cover := pages["index.html"]
	for _, marker := range []string{"pager-shell", "pagerbar", "pg-dots", "Begin &rsaquo;"} {
		if !contains(cover, marker) {
			t.Errorf("cover missing pager marker %q", marker)
		}
	}
	last := pages["the-end.html"]
	for _, marker := range []string{"class='pagernav'", "Start over &#8634;", "&lsaquo; Back"} {
		if !contains(last, marker) {
			t.Errorf("last page missing pager marker %q", marker)
		}
	}
	// group nodes are not tour stops → no orphan page
	if _, ok := pages["begin.html"]; ok {
		t.Errorf("group node 'Begin' should not produce a page")
	}
}
