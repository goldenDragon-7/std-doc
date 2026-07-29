package serve

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io/fs"
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

// DefaultIdleTimeout is how long a document stays alive after the last time
// anyone touched it — a page load or an edit to its files. 24 hours: long
// enough that a doc you set up in the morning is still there when the reader
// finally opens it that evening, short enough that a laptop doesn't slowly
// silt up with servers for documents everyone has forgotten.
const DefaultIdleTimeout = 24 * 60 * 60

// watchdogInterval is how often the watchdog checks for touches. It also
// bounds how long a doomed server lingers past its deadline.
const watchdogInterval = 5 * time.Second

// MinPort is the SIP floor: std-doc never serves below this. Ports under
// 33333 collide with macOS System Integrity Protection / reserved ranges and
// are off-limits — a low --port is lifted to MinPort (or rejected under
// --strict-port). 33333 is the default std-doc serving floor.
const MinPort = 33333

// PortSpread is the width of the stable-default port band above MinPort.
// A doc served with NO explicit --port gets a default derived from a hash of
// its absolute directory (see DefaultPortFor): MinPort..MinPort+PortSpread-1.
// This spreads concurrent docs across the band instead of dogpiling 33333,
// and makes each doc's port STABLE — the same doc returns to the same port,
// so "which port is my doc on?" is computable, not a launch-order race.
// Auto-advance (scanBind) remains the collision safety net on top of this.
const PortSpread = 200

// DefaultPortFor derives a stable default serving port for a doc directory
// when the caller gave no explicit --port. It hashes the absolute directory
// path into the MinPort..MinPort+PortSpread-1 band. Deterministic: the same
// directory always yields the same port (discoverable), while different
// directories spread across the band (collision-rare). This is only the
// PREFERRED port — scanBind still advances past it if it happens to be busy.
func DefaultPortFor(absDir string) int {
	h := fnv.New32a()
	_, _ = h.Write([]byte(absDir))
	return MinPort + int(h.Sum32()%PortSpread)
}

// Options configures the serve command.
type Options struct {
	Port        int    // preferred port; 0 = auto (stable per-doc default, see DefaultPortFor). Never serves below MinPort.
	StrictPort  bool   // bind exactly Port or fail; no auto-advance
	PortScan    int    // how many ports above Port to try (default 50)
	IdleTimeout int    // exit after this many seconds untouched (0 = never exit). Default DefaultIdleTimeout.
	Recursive   bool   // recurse subdirs when injecting
	Note        string // free-text presence tag written into watcher.json
	LibRoot     string // resolved default-library root; /lib/* served from <LibRoot>/lib

	// ExitWithParent ties the server's life to the process that launched it.
	//
	// OFF by default, and that default is load-bearing. It used to be ON and
	// unconditional, which made every documented launch path self-destruct:
	// setup.sh, `nohup … &`, and an agent's run_in_background all put a
	// TRANSIENT wrapper shell in the parent slot, and that shell exits the
	// instant it has done its job. The server read its own orphaning as "my
	// reader left" and killed itself ~5s later — usually before the human had
	// clicked the link setup.sh had just printed. Parentage says nothing about
	// whether anyone wants the document; being touched does. See IdleTimeout.
	//
	// Turn this ON only for a deliberately ephemeral doc that SHOULD die with
	// the session that made it.
	ExitWithParent bool
}

// server holds the per-process state shared across handlers and watchdogs.
type server struct {
	artifactDir string
	feedbackDir string
	clientDir   string // <LibRoot>/lib — where /lib/<file> resolves
	note        string
	port        int

	lastActivity    atomic.Int64 // unix-nano of the last touch; powers the idle timeout
	lastContent     atomic.Int64 // unix-nano of the newest mtime seen under artifactDir
	lastContentPoll atomic.Int64 // unix-nano of the last tree walk; rate-limits pollContent
}

// touch records "someone wants this document, now". Two things count, and both
// are real signals where parentage was not: a request answered (a reader has
// the page open — the page polls, so an open tab keeps touching), and a change
// to the served files (the author edited the doc, even with no tab open).
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

// watchdog terminates the process once the document has gone UNTOUCHED for
// idleTimeout seconds — a touch being a request answered or an edit to the
// served files. It no longer treats being orphaned as a reason to die unless
// the caller explicitly opted in (Options.ExitWithParent): the parent is a
// throwaway wrapper shell in every documented launch path, so its exit carried
// no information about the reader and killed docs nobody had opened yet.
//
// os.Exit because a dev server has no graceful-close upside — but we clean up
// .port on the way out so nothing is left pointing at a port we no longer hold.
func (s *server) watchdog(idleTimeout int, initialPPID int, watchParent bool) {
	// A process already orphaned at startup has no parent left to outlive.
	watchParent = watchParent && initialPPID != 1
	for {
		time.Sleep(watchdogInterval)
		s.pollContent()
		reason := s.exitReason(idleTimeout, watchParent, os.Getppid() == 1)
		if reason != "" {
			fmt.Printf("[server] %s; shutting down\n", reason)
			s.cleanup()
			os.Exit(0)
		}
	}
}

// exitReason is the watchdog's whole shutdown policy, as a pure function so it
// can be tested without waiting out real clocks. Empty string means keep going.
//
// Note what is NOT here: being orphaned, on its own, is not a reason to die.
// That check only applies when the caller opted into it.
func (s *server) exitReason(idleTimeout int, watchParent, orphaned bool) string {
	if watchParent && orphaned {
		return "parent process exited (--exit-with-parent)"
	}
	if idleTimeout > 0 && s.idleSeconds() > float64(idleTimeout) {
		return fmt.Sprintf("untouched for >%s (no page loads, no edits)", humanDuration(idleTimeout))
	}
	return ""
}

// contentPollInterval is how often pollContent actually walks the tree. The
// watchdog ticks every 5s, but re-walking a document directory that often, for
// the entire life of the server, is pure waste: the only consumer of this
// signal is a 24-hour deadline, so observing edits to within a minute is far
// more precision than anyone needs. Cheap for a 30-page doc, and still cheap
// for a large one.
const contentPollInterval = time.Minute

// maxWalkEntries bounds a single scan. A served directory is a document, not a
// filesystem, so anything past this is a sign we've been pointed at something
// we shouldn't be recursing — stop rather than burn the CPU every minute.
const maxWalkEntries = 20000

// pollContent touches the server when anything under the served tree has been
// modified since we last looked. This is what makes "the author edited the doc"
// count as life even when no browser tab is open.
//
// Rate-limited to contentPollInterval; call it as often as you like.
func (s *server) pollContent() {
	now := time.Now()
	if last := s.lastContentPoll.Load(); last != 0 &&
		now.Sub(time.Unix(0, last)) < contentPollInterval {
		return
	}
	s.lastContentPoll.Store(now.UnixNano())
	s.scanContent()
}

// scanContent is pollContent without the rate limit — the actual comparison of
// the tree's newest mtime against what we saw last time.
func (s *server) scanContent() {
	newest := newestMTime(s.artifactDir)
	if newest == 0 {
		return
	}
	if prev := s.lastContent.Load(); newest > prev {
		s.lastContent.Store(newest)
		if prev != 0 { // the first observation establishes a baseline, it isn't a change
			s.touch()
		}
	}
}

// newestMTime returns the newest modification time (unix-nano) under root, or 0
// if it cannot be read. Errors are swallowed deliberately: a liveness heuristic
// must never be able to take the server down.
//
// Skips dot-directories and node_modules — they are never the document, and
// they are exactly what makes a naive walk expensive.
func newestMTime(root string) int64 {
	var newest int64
	var seen int
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil //nolint:nilerr // an unreadable entry is not a reason to stop
		}
		if d.IsDir() {
			name := d.Name()
			if path != root && (name == "node_modules" || strings.HasPrefix(name, ".")) {
				return fs.SkipDir
			}
			return nil
		}
		if seen++; seen > maxWalkEntries {
			return fs.SkipAll
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		if t := info.ModTime().UnixNano(); t > newest {
			newest = t
		}
		return nil
	})
	return newest
}

// cleanup removes the .port marker so no launcher, agent, or human is left
// holding a URL for a port this process no longer serves. Best-effort.
func (s *server) cleanup() {
	if s.feedbackDir == "" {
		return
	}
	_ = os.Remove(filepath.Join(s.feedbackDir, ".port"))
}

// humanDuration renders a second count the way a person would say it.
func humanDuration(seconds int) string {
	switch {
	case seconds%3600 == 0 && seconds >= 3600:
		if h := seconds / 3600; h == 1 {
			return "1 hour"
		} else {
			return fmt.Sprintf("%d hours", h)
		}
	case seconds%60 == 0 && seconds >= 60:
		if m := seconds / 60; m == 1 {
			return "1 minute"
		} else {
			return fmt.Sprintf("%d minutes", m)
		}
	default:
		return fmt.Sprintf("%ds", seconds)
	}
}
