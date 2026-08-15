package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/library"
)

// primitives_test.go — v0.11 S2: `stddoc primitives` reads templates.json at
// runtime, so it can never drift from what actually renders. This test locks
// that: every key in templates.json (except the structural "children") must
// appear in the command's output, and every name it prints must be a REAL
// templates.json key (no phantom/typo'd primitive names).

func repoRootForTest(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return dir
}

func TestPrimitives_ListsEveryTemplateKey_NoDrift(t *testing.T) {
	root := repoRootForTest(t)
	libRoot := filepath.Join(root, "go", "stddoc-lib")
	lib, err := library.Load(libRoot)
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	var templates map[string]any
	if err := json.Unmarshal(lib.TemplatesJSON, &templates); err != nil {
		t.Fatalf("parse templates.json: %v", err)
	}

	t.Setenv("STDDOC_LIB", libRoot)
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	err = cmdPrimitives(nil)
	w.Close()
	os.Stdout = old
	if err != nil {
		t.Fatalf("cmdPrimitives: %v", err)
	}
	var buf bytes.Buffer
	buf.ReadFrom(r)
	out := buf.String()

	for typ := range templates {
		if typ == "children" {
			continue
		}
		if !strings.Contains(out, typ) {
			t.Errorf("stddoc primitives is missing templates.json key %q — the list must never drift from templates.json", typ)
		}
	}

	// Every declarative primitive line must point at a gallery page that
	// ACTUALLY exists on disk — a dangling "→ see gallery" pointer would be a
	// lie on the discoverability surface itself. Exception: "showcase" (R2
	// pixel-review G1) is a CHROME primitive — the gallery's own "LIVE
	// RENDER" box wrapping every OTHER sample — so it never gets a page of
	// its own, same as "children".
	for typ := range templates {
		if typ == "children" || typ == "showcase" {
			continue
		}
		slug := "p-" + strings.ReplaceAll(typ, "_", "-") + ".html"
		want := "examples/primitive-gallery/" + slug
		if !strings.Contains(out, want) {
			t.Errorf("expected a gallery pointer for %q (%s) in output", typ, want)
			continue
		}
		if _, statErr := os.Stat(filepath.Join(root, "examples", "primitive-gallery", slug)); statErr != nil {
			t.Errorf("gallery pointer for %q points at a file that doesn't exist: %s", typ, want)
		}
	}

	// G4: `canvas` is structural (not in templates.json) but IS a primitive,
	// and now has a gallery page — the CLI must point at it too.
	if !strings.Contains(out, "examples/primitive-gallery/p-canvas.html") {
		t.Error("expected a gallery pointer for canvas (G4 — structural but still a primitive)")
	}
	if _, statErr := os.Stat(filepath.Join(root, "examples", "primitive-gallery", "p-canvas.html")); statErr != nil {
		t.Errorf("p-canvas.html doesn't exist on disk: %v", statErr)
	}
}
