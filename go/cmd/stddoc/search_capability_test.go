package main

// search_capability_test.go — the self-test that stops full-text search from
// being silently re-gutted (the same failure freeze had). Every doc-tree page
// emits <script src='search-index.js'> and renders a #cf-search box; if publish
// doesn't actually emit the index, search 404s and returns zero hits. This
// RUNS the real publish and asserts: whenever a published page references
// search-index.js, publish actually wrote a usable index beside it.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func repoRootCmd(t *testing.T) string {
	t.Helper()
	// go/cmd/stddoc -> ../../.. is the repo root.
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return root
}

// CAPABILITY: published doc-tree pages reference search-index.js → publish emits
// it (and search-index.json), it sets window.CF_SEARCH_INDEX, and it parses as a
// non-empty index.
func TestCapability_SearchIndexIsEmitted(t *testing.T) {
	root := repoRootCmd(t)
	t.Setenv("STDDOC_LIB", filepath.Join(root, "go", "stddoc-lib"))

	src := filepath.Join(root, "examples", "data-derived-example", "source.json")
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("fixture source.json not found: %v", err)
	}
	out := t.TempDir()
	if err := cmdPublish([]string{src, out}); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	// does any published page reference the index? (the contract page.go emits.)
	entries, err := os.ReadDir(out)
	if err != nil {
		t.Fatal(err)
	}
	referencesIndex := false
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".html") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(out, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "search-index.js") {
			referencesIndex = true
			break
		}
	}
	if !referencesIndex {
		t.Skip("no page references search-index.js — nothing to enforce for this fixture")
	}

	// the .js sidecar must exist and set the global the client reads.
	jsPath := filepath.Join(out, "search-index.js")
	js, err := os.ReadFile(jsPath)
	if err != nil {
		t.Fatalf("pages reference search-index.js but publish did not emit it (the gutting regression): %v", err)
	}
	if !strings.HasPrefix(string(js), "window.CF_SEARCH_INDEX=") {
		t.Errorf("search-index.js must set window.CF_SEARCH_INDEX, got prefix %q", first(string(js), 40))
	}

	// the .json sidecar must exist, parse, and be non-empty (one entry per node).
	jsonPath := filepath.Join(out, "search-index.json")
	jb, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatalf("search-index.json missing: %v", err)
	}
	var idx []map[string]any
	if err := json.Unmarshal(jb, &idx); err != nil {
		t.Fatalf("search-index.json must be valid JSON: %v", err)
	}
	if len(idx) == 0 {
		t.Fatal("search index is empty — search would return zero hits (the gutting symptom)")
	}
	// the entries must carry the fields stddoc-lib/search.js consumes.
	for _, e := range idx {
		for _, k := range []string{"url", "title", "text", "sections"} {
			if _, ok := e[k]; !ok {
				t.Errorf("index entry missing %q field the client reads: %v", k, e)
			}
		}
	}

	// the .js body (after the assignment prefix) must equal the .json bytes.
	wantJS := "window.CF_SEARCH_INDEX=" + string(jb) + ";"
	if string(js) != wantJS {
		t.Error("search-index.js payload must equal search-index.json (one source of truth)")
	}
}

func first(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}
