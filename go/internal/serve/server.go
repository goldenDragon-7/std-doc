package serve

import (
	"encoding/json"
	"fmt"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// MinPort is the SIP floor: std-doc never serves below this. Ports under
// 33333 collide with macOS System Integrity Protection / reserved ranges and
// are off-limits — a low --port is lifted to MinPort (or rejected under
// --strict-port). 33333 is the default std-doc serving floor.
const MinPort = 33333

// Options configures the serve command.
type Options struct {
	Port        int    // preferred port (default MinPort = 33333; never below)
	StrictPort  bool   // bind exactly Port or fail; no auto-advance
	PortScan    int    // how many ports above Port to try (default 50)
	IdleTimeout int    // exit after this many idle seconds (0 = disabled)
	Recursive   bool   // recurse subdirs when injecting
	Note        string // free-text presence tag written into watcher.json
	LibRoot     string // resolved default-library root; /lib/* served from <LibRoot>/lib
}

// server holds the per-process state shared across handlers and watchdogs.
type server struct {
	artifactDir string
	feedbackDir string
	clientDir   string // <LibRoot>/lib — where /lib/<file> resolves
	note        string
	port        int

	lastActivity atomic.Int64 // unix-nano of the last response; powers idle timeout
}

func (s *server) touch() { s.lastActivity.Store(time.Now().UnixNano()) }

func (s *server) idleSeconds() float64 {
	return time.Since(time.Unix(0, s.lastActivity.Load())).Seconds()
}

// withCharset appends "; charset=utf-8" to text-ish content types when missing,
// so emojis / non-ASCII glyphs don't garble (browsers fall back to Latin-1).
func withCharset(ct string) string {
	if ct == "" {
		return ct
	}
	needs := strings.HasPrefix(ct, "text/") ||
		ct == "application/javascript" ||
		ct == "application/json" ||
		ct == "application/xml"
	if needs && !strings.Contains(strings.ToLower(ct), "charset=") {
		return ct + "; charset=utf-8"
	}
	return ct
}

// commonHeaders sets the no-cache + CORS headers applied to every
// response, and pushes back the idle deadline (any response = a live client).
func (s *server) commonHeaders(w http.ResponseWriter) {
	s.touch()
	h := w.Header()
	h.Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	h.Set("Pragma", "no-cache")
	h.Set("Expires", "0")
	h.Set("Access-Control-Allow-Origin", "*")
}

func (s *server) writeJSON(w http.ResponseWriter, status int, payload any) {
	body, _ := json.Marshal(payload)
	s.commonHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
	w.WriteHeader(status)
	w.Write(body)
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		s.commonHeaders(w)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	case http.MethodGet, http.MethodHead:
		s.doGet(w, r)
		return
	case http.MethodPost:
		s.doPost(w, r)
		return
	default:
		s.writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "unknown endpoint"})
	}
}

func (s *server) doGet(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if p == "/info" {
		s.writeJSON(w, http.StatusOK, map[string]any{
			"artifact_dir": s.artifactDir,
			"feedback_dir": s.feedbackDir,
			"lib_dir":      s.clientDir,
			"port":         s.port,
		})
		return
	}
	if strings.HasPrefix(p, "/lib/") {
		s.serveFromLib(w, r, strings.TrimPrefix(p, "/lib/"))
		return
	}
	s.serveStatic(w, r)
}

// serveFromLib serves a client asset from <clientDir>, path-traversal-safe.
func (s *server) serveFromLib(w http.ResponseWriter, r *http.Request, rel string) {
	base, err := filepath.Abs(s.clientDir)
	if err != nil {
		http.Error(w, "404 not found", http.StatusNotFound)
		return
	}
	target := filepath.Join(base, filepath.Clean("/"+rel))
	// Confine to clientDir (Join+Clean already strips .., but verify defensively).
	if target != base && !strings.HasPrefix(target, base+string(os.PathSeparator)) {
		http.Error(w, "403 forbidden", http.StatusForbidden)
		return
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		http.Error(w, "404 not found", http.StatusNotFound)
		return
	}
	body, err := os.ReadFile(target)
	if err != nil {
		http.Error(w, "404 not found", http.StatusNotFound)
		return
	}
	ct := mime.TypeByExtension(filepath.Ext(target))
	if ct == "" {
		ct = "application/octet-stream"
	}
	ct = withCharset(ct)
	s.commonHeaders(w)
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// serveStatic serves a file from the artifact dir (the served doc directory),
// path-traversal-safe, with directory-index fallback to index.html.
func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) {
	base, err := filepath.Abs(s.artifactDir)
	if err != nil {
		http.Error(w, "404 not found", http.StatusNotFound)
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, "/")
	target := filepath.Join(base, filepath.Clean("/"+rel))
	if target != base && !strings.HasPrefix(target, base+string(os.PathSeparator)) {
		http.Error(w, "403 forbidden", http.StatusForbidden)
		return
	}
	info, err := os.Stat(target)
	if err != nil {
		http.Error(w, "404 not found", http.StatusNotFound)
		return
	}
	if info.IsDir() {
		target = filepath.Join(target, "index.html")
		info, err = os.Stat(target)
		if err != nil || info.IsDir() {
			http.Error(w, "404 not found", http.StatusNotFound)
			return
		}
	}
	body, err := os.ReadFile(target)
	if err != nil {
		http.Error(w, "404 not found", http.StatusNotFound)
		return
	}
	ct := mime.TypeByExtension(filepath.Ext(target))
	if ct == "" {
		ct = "application/octet-stream"
	}
	ct = withCharset(ct)
	s.commonHeaders(w)
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}

func (s *server) doPost(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch p {
	case "/feedback":
		var data map[string]any
		if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid json"})
			return
		}
		now := time.Now()
		data["received_at"] = float64(now.UnixNano()) / 1e9
		data["received_iso"] = now.Format("2006-01-02T15:04:05")
		line, _ := json.Marshal(data)
		inbox := filepath.Join(s.feedbackDir, "inbox.jsonl")
		f, err := os.OpenFile(inbox, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			s.writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "write failed"})
			return
		}
		f.Write(line)
		f.Write([]byte("\n"))
		f.Close()
		n := 0
		if cs, ok := data["comments"].([]any); ok {
			n = len(cs)
		}
		fmt.Printf("[feedback] batch with %d comment(s) -> %s\n", n, inbox)
		s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	case "/mark-seen":
		var data any
		if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
			data = map[string]any{}
		}
		body, _ := json.MarshalIndent(data, "", "  ")
		os.WriteFile(filepath.Join(s.feedbackDir, "lastseen.json"), body, 0o644)
		s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	default:
		s.writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "unknown endpoint"})
	}
}

// scanBind binds the preferred port, advancing to the next free one when busy
// (unless strict). Returns the listener and the chosen port. The bind is the
// atomic, authoritative occupancy test — no lsof TOCTOU race.
func scanBind(start, scan int, strict bool) (net.Listener, int, error) {
	// Bind IPv4 explicitly (0.0.0.0), using an AF_INET socket.
	// "tcp" would bind the [::] IPv6 socket and SUCCEED even when another
	// process holds 0.0.0.0:port — defeating the busy-port auto-advance and
	// leaving 127.0.0.1 clients routed to the other server.
	bind := func(p int) (net.Listener, error) {
		return net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", p))
	}
	// SIP floor: never serve below MinPort. Under --strict-port a forbidden
	// port is an error (we can't honor it); otherwise lift the start to the
	// floor so the scan only ever considers allowed ports.
	if start < MinPort {
		if strict {
			return nil, 0, fmt.Errorf("port %d is below the SIP floor (%d); std-doc serves on %d or higher", start, MinPort, MinPort)
		}
		start = MinPort
	}
	if strict {
		ln, err := bind(start)
		return ln, start, err
	}
	var last error
	if scan < 1 {
		scan = 1
	}
	for cand := start; cand <= start+scan; cand++ {
		ln, err := bind(cand)
		if err == nil {
			return ln, cand, nil
		}
		last = err
	}
	return nil, 0, fmt.Errorf("no free port in %d..%d: %w", start, start+scan, last)
}

// heartbeat writes watcher.json every interval, folding the presence job
// into the running server. Stops (and removes watcher.json) when done closes.
func (s *server) heartbeat(interval time.Duration, done <-chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	watcher := filepath.Join(s.feedbackDir, "watcher.json")
	beat := func() {
		payload, _ := json.Marshal(map[string]any{
			"status": "watching",
			"ts":     time.Now().Unix(),
			"pid":    os.Getpid(),
			"note":   s.note,
		})
		tmp := watcher + ".tmp"
		if os.WriteFile(tmp, payload, 0o644) == nil {
			os.Rename(tmp, watcher)
		}
	}
	beat()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			os.Remove(watcher)
			return
		case <-ticker.C:
			beat()
		}
	}
}

// watchdog terminates the process when (a) our parent exits — we get reparented
// to PID 1 — or (b) no client has hit us for idleTimeout seconds. Mirrors
// a parent-death watchdog. os.Exit because a dev server has no graceful-close upside.
func (s *server) watchdog(idleTimeout int, initialPPID int) {
	watchParent := initialPPID != 1
	for {
		time.Sleep(5 * time.Second)
		reason := ""
		if watchParent && os.Getppid() == 1 {
			reason = "parent process exited"
		} else if idleTimeout > 0 && s.idleSeconds() > float64(idleTimeout) {
			reason = fmt.Sprintf("idle for >%ds with no clients", idleTimeout)
		}
		if reason != "" {
			fmt.Printf("[server] %s; shutting down\n", reason)
			os.Exit(0)
		}
	}
}
