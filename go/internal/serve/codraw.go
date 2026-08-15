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
	root      string // the codraw runtime dir (<LibRoot>/lib/codraw)
	sceneFile string // canonical scene state (feedback/canvas-scene.json)
	inboxFile string // typed comments, one JSON per line (feedback/canvas-feedback.jsonl)
	mu        sync.Mutex
	port      int
}

// newCodrawServer prepares a surface bound to a doc's feedback dir. It seeds an
// empty dark scene if none exists yet.
func newCodrawServer(runtimeRoot, feedbackDir string) *codrawServer {
	cs := &codrawServer{
		root:      runtimeRoot,
		sceneFile: filepath.Join(feedbackDir, "canvas-scene.json"),
		inboxFile: filepath.Join(feedbackDir, "canvas-feedback.jsonl"),
	}
	if _, err := os.Stat(cs.sceneFile); err != nil {
		empty := map[string]any{
			"type": "excalidraw", "version": 2, "source": "codraw-studio",
			"elements": []any{}, "files": map[string]any{},
			"appState": map[string]any{"theme": "dark", "viewBackgroundColor": "#ffffff"},
			"_rev": 0, "_author": "agent",
		}
		if b, err := json.MarshalIndent(empty, "", " "); err == nil {
			_ = os.WriteFile(cs.sceneFile, b, 0o644)
		}
	}
	return cs
}

func (cs *codrawServer) readScene() (map[string]any, error) {
	b, err := os.ReadFile(cs.sceneFile)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (cs *codrawServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/scene"):
		cs.mu.Lock()
		defer cs.mu.Unlock()
		m, err := cs.readScene()
		if err != nil {
			cs.json(w, 500, map[string]any{"error": err.Error()})
			return
		}
		cs.json(w, 200, m)
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/scene"):
		cs.mu.Lock()
		defer cs.mu.Unlock()
		var incoming map[string]any
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			incoming = map[string]any{}
		}
		rev := 1
		if cur, err := cs.readScene(); err == nil {
			rev = toIntLoose(cur["_rev"]) + 1
		}
		incoming["_rev"] = rev
		if _, ok := incoming["_author"]; !ok {
			incoming["_author"] = "human"
		}
		if b, err := json.MarshalIndent(incoming, "", " "); err == nil {
			tmp := cs.sceneFile + ".tmp"
			if os.WriteFile(tmp, b, 0o644) == nil {
				_ = os.Rename(tmp, cs.sceneFile)
			}
		}
		cs.json(w, 200, map[string]any{"_rev": rev})
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/feedback"):
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
		if b, err := json.Marshal(entry); err == nil {
			if f, err := os.OpenFile(cs.inboxFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
				_, _ = f.Write(append(b, '\n'))
				_ = f.Close()
			}
		}
		cs.json(w, 200, map[string]any{"ok": true})
	case r.Method == http.MethodGet:
		// static: index.html + vendor/ from the codraw runtime dir
		cs.serveStatic(w, r)
	default:
		cs.json(w, 404, map[string]any{"error": "not found"})
	}
}

func (cs *codrawServer) serveStatic(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/")
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
func rewriteCanvasSrc(body []byte, url string) []byte {
	s := string(body)
	s = canvasFrameSrc.ReplaceAllString(s, "class='canvas-frame' src='"+url+"'")
	s = canvasDataSrc.ReplaceAllString(s, "data-canvas-src='"+url+"'")
	return []byte(s)
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
