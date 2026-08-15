package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// CAPABILITY: serve auto-wires a canvas mount — every mount's src is rewritten to
// the live surface, the loud-degrade card (no src) is left alone.
func TestRewriteCanvasSrc(t *testing.T) {
	in := "<div class='canvas-embed' data-canvas-src='http://localhost:8747/'>" +
		"<iframe class='canvas-frame' src='http://localhost:8747/' sandbox='allow-scripts'></iframe></div>" +
		"<div class='canvas-embed canvas-degraded'>no src here</div>"
	got := string(rewriteCanvasSrc([]byte(in), "http://localhost:55555/"))
	if strings.Contains(got, "8747") {
		t.Errorf("authored src not rewritten:\n%s", got)
	}
	if strings.Count(got, "http://localhost:55555/") != 2 {
		t.Errorf("expected both data-canvas-src and iframe src rewritten:\n%s", got)
	}
	if !strings.Contains(got, "canvas-degraded'>no src here") {
		t.Errorf("degrade card must be untouched:\n%s", got)
	}
}

// CAPABILITY: docHasCanvas detects a mount by its marker, cheaply.
func TestDocHasCanvas(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "plain.html"), []byte("<p>no canvas</p>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if docHasCanvas(dir, false) {
		t.Error("plain doc must NOT be detected as having a canvas")
	}
	if err := os.WriteFile(filepath.Join(dir, "c.html"), []byte("<div data-canvas-src='x'></div>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !docHasCanvas(dir, false) {
		t.Error("doc with a canvas mount must be detected")
	}
}

// CAPABILITY: the Go codraw surface bumps _rev on save, returns the scene on GET,
// and appends typed feedback — a faithful port of codraw's server.py (no Python).
func TestCodrawServer_SceneAndFeedback(t *testing.T) {
	fb := t.TempDir()
	cs := newCodrawServer(t.TempDir(), fb)

	// GET the seeded (empty, dark) scene
	rr := httptest.NewRecorder()
	cs.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/scene", nil))
	if rr.Code != 200 {
		t.Fatalf("GET /scene = %d", rr.Code)
	}
	var seeded map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &seeded); err != nil {
		t.Fatal(err)
	}
	if seeded["appState"].(map[string]any)["theme"] != "dark" {
		t.Error("seeded scene must default to dark")
	}

	// POST bumps _rev
	rr = httptest.NewRecorder()
	body := strings.NewReader(`{"elements":[],"_author":"agent"}`)
	cs.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/scene", body))
	var res map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &res)
	if toIntLoose(res["_rev"]) != 1 {
		t.Errorf("first POST must bump _rev to 1, got %v", res["_rev"])
	}

	// feedback appends one JSON line
	rr = httptest.NewRecorder()
	cs.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/feedback", strings.NewReader(`{"text":"make it yellow","ref":["n1"]}`)))
	if rr.Code != 200 {
		t.Fatalf("POST /feedback = %d", rr.Code)
	}
	lines, err := os.ReadFile(cs.inboxFile)
	if err != nil {
		t.Fatalf("feedback file: %v", err)
	}
	if !strings.Contains(string(lines), "make it yellow") {
		t.Errorf("feedback not recorded: %q", string(lines))
	}
}
