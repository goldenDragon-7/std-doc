package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// codraw_v2_boards_test.go — S1/S2 of prd/canvas-primitive/v2-per-canvas-boards.md:
// per-mount rewrite + path routing to independent per-board scene/inbox files.

// CAPABILITY: rewriteCanvasBoards routes EACH mount to its OWN board url,
// keyed on data-canvas-board — both the zero-config `codraw:<id>` placeholder
// case and the author-explicit-src case (v1's "src is a fallback that never
// has to be right" promise, now kept per-board instead of globally).
func TestRewriteCanvasBoards_PerMount(t *testing.T) {
	in := "<div data-canvas-board='a' class='canvas-embed' data-canvas-src='codraw:a'>" +
		"<iframe class='canvas-frame' src='codraw:a' sandbox='allow-scripts'></iframe></div>" +
		"<div data-canvas-board='b' class='canvas-embed' data-canvas-src='http://example.com/legacy'>" +
		"<iframe class='canvas-frame' src='http://example.com/legacy' sandbox='allow-scripts'></iframe></div>" +
		"<div class='canvas-embed canvas-degraded'>no src here</div>"

	got := string(rewriteCanvasBoards([]byte(in), "http://localhost:55555/"))

	if !strings.Contains(got, "http://localhost:55555/board/a/'") {
		t.Errorf("board a not routed to its own url:\n%s", got)
	}
	if !strings.Contains(got, "http://localhost:55555/board/b/'") {
		t.Errorf("board b (explicit src) not routed to its OWN url — per-board rewrite must key on data-canvas-board, not src content:\n%s", got)
	}
	if strings.Contains(got, "codraw:a") || strings.Contains(got, "example.com/legacy") {
		t.Errorf("original srcs must be fully replaced:\n%s", got)
	}
	if strings.Count(got, "http://localhost:55555/board/a/'") != 2 {
		t.Errorf("expected both data-canvas-src and iframe src rewritten for board a:\n%s", got)
	}
	if !strings.Contains(got, "canvas-degraded'>no src here") {
		t.Errorf("degrade card (no board id) must be untouched:\n%s", got)
	}
}

// CAPABILITY: boardPrefix parses the /board/<id>/<rest> shape and reports ok=false
// for anything else (so the v1 root endpoints keep working unmodified).
func TestBoardPrefix(t *testing.T) {
	cases := []struct {
		path     string
		id, rest string
		ok       bool
	}{
		{"/scene", "", "", false},
		{"/board/arch/scene", "arch", "/scene", true},
		{"/board/arch/", "arch", "/", true},
		{"/board/arch", "arch", "/", true},
		{"/board/arch/vendor/x.js", "arch", "/vendor/x.js", true},
	}
	for _, c := range cases {
		id, rest, ok := boardPrefix(c.path)
		if ok != c.ok || id != c.id || (c.ok && rest != c.rest) {
			t.Errorf("boardPrefix(%q) = (%q,%q,%v), want (%q,%q,%v)", c.path, id, rest, ok, c.id, c.rest, c.ok)
		}
	}
}

// CAPABILITY: two boards under one server are FULLY independent — writing to
// board a's scene must not affect board b's scene, and must not touch the
// default (unprefixed, v1) board either. This is the whole point of S2.
func TestCodrawServer_PerBoardIsolation(t *testing.T) {
	fb := t.TempDir()
	cs := newCodrawServer(t.TempDir(), fb)

	post := func(path, body string) map[string]any {
		rr := httptest.NewRecorder()
		cs.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
		var res map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &res)
		return res
	}
	get := func(path string) map[string]any {
		rr := httptest.NewRecorder()
		cs.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
		var res map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &res)
		return res
	}

	// Board "a": bump _rev to 1.
	resA := post("/board/a/scene", `{"elements":["A"],"_author":"agent"}`)
	if toIntLoose(resA["_rev"]) != 1 {
		t.Fatalf("board a first POST must bump _rev to 1, got %v", resA["_rev"])
	}
	// Board "b": untouched by board a's write — its own first POST must ALSO be _rev 1.
	resB := post("/board/b/scene", `{"elements":["B"],"_author":"agent"}`)
	if toIntLoose(resB["_rev"]) != 1 {
		t.Errorf("board b must be independent of board a (expected _rev 1, got %v) — boards are NOT isolated", resB["_rev"])
	}
	// The default (v1, unprefixed) board must still be at its own seed state —
	// neither board a nor board b's write should have touched it.
	def := get("/scene")
	if toIntLoose(def["_rev"]) != 0 {
		t.Errorf("default board must be untouched by per-board writes (expected _rev 0, got %v)", def["_rev"])
	}

	// Board a's GET reflects board a's own write, not board b's.
	sceneA := get("/board/a/scene")
	els, _ := sceneA["elements"].([]any)
	if len(els) != 1 || els[0] != "A" {
		t.Errorf("board a scene contaminated: %v", sceneA["elements"])
	}

	// Feedback is also per-board and carries the board id.
	post("/board/a/feedback", `{"text":"looks good","ref":["n1"]}`)
	linesB, err := os.ReadFile(cs.inboxPath("a"))
	if err != nil {
		t.Fatalf("board a inbox: %v", err)
	}
	if !strings.Contains(string(linesB), `"board":"a"`) {
		t.Errorf("per-board feedback entry must carry its board id: %q", linesB)
	}
	if _, err := os.Stat(cs.inboxPath("b")); err == nil {
		t.Error("board b inbox must not exist — only board a received feedback")
	}
}
