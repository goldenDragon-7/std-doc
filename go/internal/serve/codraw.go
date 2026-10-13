package serve

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	canvasFrameSrc = regexp.MustCompile(`class='canvas-frame' src='[^']*'`)
	canvasDataSrc  = regexp.MustCompile(`data-canvas-src='[^']*'`)
	// canvasBoardMount matches one WHOLE per-board mount (the `data-canvas-board`
	// attribute canvas_primitive.go now always emits, through the iframe's
	// closing tag), capturing the board id. v2 per-mount rewrite (Seam 2) keys
	// on THIS attribute — not on whatever the src currently holds — so it
	// rewrites both the `codraw:<id>` placeholder (the normal, zero-config
	// case) AND an author-EXPLICIT `src` alike: v1's own philosophy was that
	// the authored src is "a fallback that never has to be right" once serve
	// is live; v2 keeps that promise per-board instead of globally.
	canvasBoardMount = regexp.MustCompile(`(?is)<div data-canvas-board='([A-Za-z0-9_-]+)' class='canvas-embed' data-canvas-src='[^']*'>.*?class='canvas-frame' src='[^']*'`)
)

// codraw.go — the auto-started co-drawing surface. When `stddoc serve` finds a
// `canvas` block in the doc, it starts THIS tiny server (a second in-process
// listener) serving the codraw runtime (go/stddoc-lib/lib/codraw/) with Go
// handlers for the shared scene and the feedback inbox. It is a faithful port of
// codraw's server.py — GET/POST /scene (bumping _rev) and POST /feedback — so the
// live canvas needs NO Python and reaches NO third party (Excalidraw is vendored).
//
// Design decision (2026-08-14): serve auto-starts the surface, zero-config.
// The canvas iframe src is rewritten at serve time to point here. Bounded to the
// doc's own canvas — a document, not an app (Covenant V).
//
// v1 scope: one shared surface per served doc (all canvas blocks in the doc mount
// the same board). Per-canvas boards are a later refinement; the scene + feedback
// files live under the doc's feedback/ dir so the agent's existing Monitor sees
// comments.

type codrawServer struct {
	root        string // the codraw runtime dir (<LibRoot>/lib/codraw)
	feedbackDir string // the doc's feedback/ dir — per-board files live here
	sceneFile   string // DEFAULT board's canonical scene state (feedback/canvas-scene.json) — back-compat, id=""
	inboxFile   string // DEFAULT board's typed comments (feedback/canvas-feedback.jsonl) — back-compat, id=""
	mu          sync.Mutex
	port        int
}

// newCodrawServer prepares a surface bound to a doc's feedback dir. It seeds an
// empty dark scene for the DEFAULT board if none exists yet — v1's single
// shared board, still reachable at the server root (no /board/<id>/ prefix)
// for a mount carrying an author-EXPLICIT `src`. v2 per-board boards
// (the canvas v2 per-board design) are seeded lazily, on first
// request to /board/<id>/, by scenePath/inboxPath below.
func newCodrawServer(runtimeRoot, feedbackDir string) *codrawServer {
	cs := &codrawServer{
		root:        runtimeRoot,
		feedbackDir: feedbackDir,
		sceneFile:   filepath.Join(feedbackDir, "canvas-scene.json"),
		inboxFile:   filepath.Join(feedbackDir, "canvas-feedback.jsonl"),
	}
	cs.seedScene(cs.sceneFile)
	return cs
}

// seedScene writes an empty dark Excalidraw scene at path if nothing is there
// yet. Shared by the default board (construction time) and every per-board
// scene (lazily, first request — boards are created on demand, not up front,
// since a doc's canvas-block count isn't known to the server ahead of time).
func (cs *codrawServer) seedScene(path string) {
	if _, err := os.Stat(path); err == nil {
		return
	}
	empty := map[string]any{
		"type": "excalidraw", "version": 2, "source": "codraw-studio",
		"elements": []any{}, "files": map[string]any{},
		"appState": map[string]any{"theme": "dark", "viewBackgroundColor": "#ffffff"},
		"_rev":     0, "_author": "agent",
	}
	if b, err := json.MarshalIndent(empty, "", " "); err == nil {
		_ = os.WriteFile(path, b, 0o644)
	}
}

// scenePath/inboxPath resolve a board id to its per-board files. id=""
// resolves to the DEFAULT board's historical filenames (cs.sceneFile/
// cs.inboxFile) — the v1 shape, so the root (non-/board/-prefixed) endpoints
// stay byte-for-byte what they always were.
func (cs *codrawServer) scenePath(id string) string {
	if id == "" {
		return cs.sceneFile
	}
	return filepath.Join(cs.feedbackDir, "canvas-"+id+"-scene.json")
}

func (cs *codrawServer) inboxPath(id string) string {
	if id == "" {
		return cs.inboxFile
	}
	return filepath.Join(cs.feedbackDir, "canvas-"+id+"-feedback.jsonl")
}

func (cs *codrawServer) readScene(sceneFile string) (map[string]any, error) {
	b, err := os.ReadFile(sceneFile)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// boardPrefix splits a v2 "/board/<id>/<rest>" path into (id, "/<rest>"); ok
// is false for any path that isn't board-routed, in which case the caller
// falls through to the v1 default-board behavior (Seam 3: path routing,
// the canvas v2 per-board design).
func boardPrefix(path string) (id, rest string, ok bool) {
	if !strings.HasPrefix(path, "/board/") {
		return "", "", false
	}
	trimmed := strings.TrimPrefix(path, "/board/")
	slash := strings.IndexByte(trimmed, '/')
	if slash < 0 {
		return trimmed, "/", true
	}
	return trimmed[:slash], trimmed[slash:], true
}

func (cs *codrawServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store")

	// v2: route /board/<id>/... to that board's own files, then handle the
	// (now board-relative) rest of the path exactly like the v1 handlers below
	// — Seam 3, "path routing". A board's files are seeded lazily on first
	// touch, same shape as the default board at construction time.
	id, rest := "", r.URL.Path
	if bid, brest, ok := boardPrefix(r.URL.Path); ok {
		id, rest = bid, brest
		cs.seedScene(cs.scenePath(id))
	}
	sceneFile, inboxFile := cs.scenePath(id), cs.inboxPath(id)

	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(rest, "/scene"):
		cs.mu.Lock()
		defer cs.mu.Unlock()
		m, err := cs.readScene(sceneFile)
		if err != nil {
			cs.json(w, 500, map[string]any{"error": err.Error()})
			return
		}
		cs.json(w, 200, m)
	case r.Method == http.MethodPost && strings.HasPrefix(rest, "/scene"):
		cs.mu.Lock()
		defer cs.mu.Unlock()
		var incoming map[string]any
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			incoming = map[string]any{}
		}
		rev := 1
		if cur, err := cs.readScene(sceneFile); err == nil {
			rev = toIntLoose(cur["_rev"]) + 1
		}
		incoming["_rev"] = rev
		if _, ok := incoming["_author"]; !ok {
			incoming["_author"] = "human"
		}
		if b, err := json.MarshalIndent(incoming, "", " "); err == nil {
			tmp := sceneFile + ".tmp"
			if os.WriteFile(tmp, b, 0o644) == nil {
				_ = os.Rename(tmp, sceneFile)
			}
		}
		cs.json(w, 200, map[string]any{"_rev": rev})
	case r.Method == http.MethodPost && strings.HasPrefix(rest, "/feedback"):
		var msg map[string]any
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			msg = map[string]any{}
		}
		entry := map[string]any{
			"ts":   time.Now().Format("2006-01-02T15:04:05"),
			"text": strings.TrimSpace(fmt.Sprint(msg["text"])),
			"ref":  msg["ref"],
			"rev":  msg["rev"],
		}
		if id != "" {
			entry["board"] = id // Seam 5: agent Monitor tells boards apart by this field
		}
		if b, err := json.Marshal(entry); err == nil {
			if f, err := os.OpenFile(inboxFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
				_, _ = f.Write(append(b, '\n'))
				_ = f.Close()
			}
		}
		cs.json(w, 200, map[string]any{"ok": true})
	case r.Method == http.MethodGet:
		// static: index.html + vendor/ from the codraw runtime dir. Shared —
		// one copy of the vendored client for every board (Seam 3); the
		// client's OWN requests are relative (Seam 4), so being served under
		// /board/<id>/ is what scopes them back to this same id.
		cs.serveStatic(w, r, rest)
	default:
		cs.json(w, 404, map[string]any{"error": "not found"})
	}
}

func (cs *codrawServer) serveStatic(w http.ResponseWriter, r *http.Request, path string) {
	rel := strings.TrimPrefix(path, "/")
	if rel == "" {
		rel = "index.html"
	}
	base := filepath.Clean(cs.root)
	target := filepath.Join(base, filepath.Clean("/"+rel))
	if target != base && !strings.HasPrefix(target, base+string(os.PathSeparator)) {
		http.Error(w, "403 forbidden", http.StatusForbidden)
		return
	}
	http.ServeFile(w, r, target)
}

func (cs *codrawServer) json(w http.ResponseWriter, code int, obj any) {
	b, _ := json.Marshal(obj)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(b)
}

// start binds an auto port and serves in a goroutine. Returns the chosen port.
func (cs *codrawServer) start() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	cs.port = ln.Addr().(*net.TCPAddr).Port
	go func() { _ = (&http.Server{Handler: cs}).Serve(ln) }()
	return cs.port, nil
}

// rewriteCanvasSrc points every canvas mount in an HTML body at the live codraw
// surface. It rewrites the iframe's src and the data-canvas-src marker, leaving
// the loud-degrade card (which has neither) untouched.
//
// v1 behavior: ONE url for every mount (all canvas blocks in the doc shared a
// single board). Superseded for the common case by rewriteCanvasBoards below
// (v2 per-canvas boards); kept as the fallback path for a mount carrying an
// author-EXPLICIT `src` (not the `codraw:<id>` placeholder) — see
// rewriteCanvasBoards' doc comment.
func rewriteCanvasSrc(body []byte, url string) []byte {
	s := string(body)
	s = canvasFrameSrc.ReplaceAllString(s, "class='canvas-frame' src='"+url+"'")
	s = canvasDataSrc.ReplaceAllString(s, "data-canvas-src='"+url+"'")
	return []byte(s)
}

// rewriteCanvasBoards is the v2 per-mount rewrite (the canvas v2 per-board
// design, Seam 2): every canvas mount is routed to ITS OWN
// `<baseURL>board/<id>/`, keyed on the `data-canvas-board` attribute
// canvas_primitive.go always emits — so N canvas blocks in one doc mount N
// independent boards instead of v1's single shared one. baseURL must end in
// "/". A mount with no `data-canvas-board` (can't happen for a doc-tree
// render — assignCanvasBoardIDs always sets one — but reachable from a
// hand-authored fixture) is left untouched, same as the loud-degrade card.
func rewriteCanvasBoards(body []byte, baseURL string) []byte {
	return canvasBoardMount.ReplaceAllFunc(body, func(mount []byte) []byte {
		m := canvasBoardMount.FindSubmatch(mount)
		if m == nil {
			return mount
		}
		id := string(m[1])
		boardURL := baseURL + "board/" + id + "/"
		out := canvasDataSrc.ReplaceAll(mount, []byte("data-canvas-src='"+boardURL+"'"))
		out = canvasFrameSrc.ReplaceAll(out, []byte("class='canvas-frame' src='"+boardURL+"'"))
		return out
	})
}

// docHasCanvas reports whether any served HTML under dir carries a canvas mount
// (the data-canvas-src marker the primitive emits). Bounded, cheap scan.
func docHasCanvas(dir string, recursive bool) bool {
	found := false
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			if info != nil && info.IsDir() && !recursive && path != dir {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(path), ".html") {
			return nil
		}
		if b, err := os.ReadFile(path); err == nil && strings.Contains(string(b), "data-canvas-src=") {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

// toIntLoose coerces a JSON number (float64 from encoding/json, or int) to int.
func toIntLoose(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return int(i)
		}
	}
	return 0
}
