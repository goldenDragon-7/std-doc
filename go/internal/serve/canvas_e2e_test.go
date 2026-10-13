package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"stddoc/internal/core"
	"stddoc/internal/library"
	"stddoc/internal/wire"
)

var dataCanvasBoardRe = regexp.MustCompile(`data-canvas-board='([A-Za-z0-9_-]+)'`)

// repoRoot walks up from go/internal/serve/ to the repo root (mirrors
// core.repoRoot — same directory depth, no cross-package test helper import).
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return dir
}

// TestCanvasE2E_TwoBlocksTwoIndependentBoards is the S4 self-test the PRD asks
// for: "a self-test asserting two canvas blocks in one doc produce two
// independent scene files" (the canvas v2 per-board design,
// Suggested slicing, S4). Exercises the REAL pipeline — core.Publish renders
// the doc-tree (assigning board ids), then the codrawServer serves each
// board's own scene — not just the unit-level pieces (already covered by
// TestAssignCanvasBoardIDs_* in core and TestCodrawServer_PerBoardIsolation
// here).
func TestCanvasE2E_TwoBlocksTwoIndependentBoards(t *testing.T) {
	libRoot := filepath.Join(repoRoot(t), "go", "stddoc-lib")
	lib, err := library.Load(libRoot)
	if err != nil {
		t.Fatalf("load library: %v", err)
	}

	doc, err := wire.ParseOrderedJSON([]byte(`{
		"title": "Canvas doc",
		"nodes": [{
			"slug": "arch", "title": "Architecture",
			"blocks": [
				{"type": "canvas", "label": "flow"},
				{"type": "canvas", "label": "topology"}
			]
		}]
	}`))
	if err != nil {
		t.Fatalf("parse doc: %v", err)
	}

	pages, err := core.Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	html, ok := pages["arch.html"]
	if !ok {
		t.Fatalf("no arch.html in Publish output; pages: %v", keysOf(pages))
	}

	ids := dedupe(dataCanvasBoardRe.FindAllStringSubmatch(html, -1))
	if len(ids) != 2 {
		t.Fatalf("expected 2 distinct board ids for 2 canvas blocks, got %v", ids)
	}

	// Serve the doc for real: rewrite the mounts, then drive the codrawServer
	// exactly as `stddoc serve` would.
	feedbackDir := t.TempDir()
	cs := newCodrawServer(filepath.Join(libRoot, "lib", "codraw"), feedbackDir)
	rewritten := string(rewriteCanvasBoards([]byte(html), "http://localhost:9/"))
	for _, id := range ids {
		if !strings.Contains(rewritten, "http://localhost:9/board/"+id+"/") {
			t.Errorf("mount for board %q was not rewritten to its own board url:\n%s", id, rewritten)
		}
	}

	post := func(id, elements string) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/board/"+id+"/scene",
			strings.NewReader(`{"elements":["`+elements+`"],"_author":"agent"}`))
		cs.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("POST board %s scene: %d %s", id, rr.Code, rr.Body.String())
		}
	}
	get := func(id string) []any {
		rr := httptest.NewRecorder()
		cs.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/board/"+id+"/scene", nil))
		var scene map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &scene)
		els, _ := scene["elements"].([]any)
		return els
	}

	post(ids[0], "shapeA")
	post(ids[1], "shapeB")

	elsA, elsB := get(ids[0]), get(ids[1])
	if len(elsA) != 1 || elsA[0] != "shapeA" {
		t.Errorf("board %s scene wrong or contaminated: %v", ids[0], elsA)
	}
	if len(elsB) != 1 || elsB[0] != "shapeB" {
		t.Errorf("board %s scene wrong or contaminated: %v", ids[1], elsB)
	}

	// The two boards' scene files are genuinely separate files on disk.
	sceneFileA := filepath.Join(feedbackDir, "canvas-"+ids[0]+"-scene.json")
	sceneFileB := filepath.Join(feedbackDir, "canvas-"+ids[1]+"-scene.json")
	if _, err := os.Stat(sceneFileA); err != nil {
		t.Errorf("expected a scene file for board %s: %v", ids[0], err)
	}
	if _, err := os.Stat(sceneFileB); err != nil {
		t.Errorf("expected a scene file for board %s: %v", ids[1], err)
	}
	bA, _ := os.ReadFile(sceneFileA)
	bB, _ := os.ReadFile(sceneFileB)
	if string(bA) == string(bB) {
		t.Error("board scene files must diverge after independent edits — found byte-identical")
	}
}

func dedupe(matches [][]string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range matches {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

func keysOf(m map[string]string) []string {
	var ks []string
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}
