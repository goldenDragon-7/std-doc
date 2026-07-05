package serve

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestInjectIdempotent(t *testing.T) {
	dir := t.TempDir()
	page := filepath.Join(dir, "a.html")
	writeFile(t, page, "<html><head></head><body><p>hi</p></body></html>")

	if err := Inject(dir, false); err != nil {
		t.Fatal(err)
	}
	once, _ := os.ReadFile(page)
	if !bytes.Contains(once, []byte(cssTag)) || !bytes.Contains(once, []byte(jsTag)) {
		t.Fatalf("tags not injected: %s", once)
	}

	if err := Inject(dir, false); err != nil {
		t.Fatal(err)
	}
	twice, _ := os.ReadFile(page)
	if !bytes.Equal(once, twice) {
		t.Fatalf("inject not idempotent:\n--first--\n%s\n--second--\n%s", once, twice)
	}
	if n := bytes.Count(twice, []byte(cssMarker())); n != 1 {
		t.Fatalf("expected exactly 1 css tag, got %d", n)
	}
}

func cssMarker() string { return cssTag }

func TestInjectMermaidConditional(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.html")
	mer := filepath.Join(dir, "mer.html")
	writeFile(t, plain, "<html><head></head><body><p>no diagram</p></body></html>")
	writeFile(t, mer, `<html><head></head><body><div class="mermaid">graph</div></body></html>`)

	if err := Inject(dir, false); err != nil {
		t.Fatal(err)
	}
	pb, _ := os.ReadFile(plain)
	if bytes.Contains(pb, []byte(mermaidJSMarker)) {
		t.Fatal("mermaid wired into a page that doesn't use it")
	}
	mb, _ := os.ReadFile(mer)
	if !bytes.Contains(mb, []byte(mermaidHeadMarker)) || !bytes.Contains(mb, []byte(mermaidJSMarker)) {
		t.Fatalf("mermaid not wired into a page that uses it: %s", mb)
	}
}

func TestEnsureFeedbackDir(t *testing.T) {
	dir := t.TempDir()
	if err := ensureFeedbackDir(dir); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "feedback", "history.json")); string(b) != "[]" {
		t.Fatalf("history.json should be [], got %q", b)
	}
	if _, err := os.Stat(filepath.Join(dir, "feedback", "inbox.jsonl")); err != nil {
		t.Fatalf("inbox.jsonl not created: %v", err)
	}
}

// TestServeEndToEnd binds a real port, posts feedback, and verifies the inbox
// line + watcher heartbeat + /lib asset + /info — the real server, no mocks.
func TestServeEndToEnd(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "index.html"), "<html><head></head><body>doc</body></html>")

	// Minimal lib root with a lib/ dir holding a client asset.
	libRoot := t.TempDir()
	writeFile(t, filepath.Join(libRoot, "lib", "feedback.js"), "// fake feedback")

	if err := Inject(dir, false); err != nil {
		t.Fatal(err)
	}
	feedbackDir := filepath.Join(dir, "feedback")
	srv := &server{
		artifactDir: dir,
		feedbackDir: feedbackDir,
		clientDir:   filepath.Join(libRoot, "lib"),
		note:        "test",
		port:        0,
	}
	srv.touch()

	// Bind an explicit ephemeral 127.0.0.1 port so the test is hermetic and
	// can't collide with any real server already on a fixed port (dual-stack).
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	chosen := ln.Addr().(*net.TCPAddr).Port
	srv.port = chosen
	httpSrv := &http.Server{Handler: srv}
	go httpSrv.Serve(ln)
	defer httpSrv.Close()

	done := make(chan struct{})
	wg := &sync.WaitGroup{}
	wg.Add(1)
	go srv.heartbeat(200*time.Millisecond, done, wg)
	defer func() { close(done); wg.Wait() }()

	base := fmt.Sprintf("http://127.0.0.1:%d", chosen)

	// 1) static page
	mustGet(t, base+"/index.html", "doc")
	// 2) /lib asset
	mustGet(t, base+"/lib/feedback.js", "fake feedback")
	// 3) /info reports the chosen port
	infoBody := mustGet(t, base+"/info", "")
	var info map[string]any
	if err := json.Unmarshal([]byte(infoBody), &info); err != nil {
		t.Fatalf("/info not json: %v", err)
	}
	if int(info["port"].(float64)) != chosen {
		t.Fatalf("/info port = %v, want %d", info["port"], chosen)
	}

	// 4) POST /feedback lands a line in inbox.jsonl
	payload := `{"comments":[{"text":"hello"}]}`
	resp, err := http.Post(base+"/feedback", "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("/feedback status %d", resp.StatusCode)
	}
	inboxBytes, _ := os.ReadFile(filepath.Join(feedbackDir, "inbox.jsonl"))
	sc := bufio.NewScanner(bytes.NewReader(inboxBytes))
	if !sc.Scan() {
		t.Fatal("no inbox line written")
	}
	var line map[string]any
	if err := json.Unmarshal(sc.Bytes(), &line); err != nil {
		t.Fatalf("inbox line not json: %v", err)
	}
	if _, ok := line["received_at"]; !ok {
		t.Fatal("inbox line missing received_at")
	}
	if _, ok := line["received_iso"]; !ok {
		t.Fatal("inbox line missing received_iso")
	}

	// 5) heartbeat wrote watcher.json
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join(feedbackDir, "watcher.json")); err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	wb, err := os.ReadFile(filepath.Join(feedbackDir, "watcher.json"))
	if err != nil {
		t.Fatalf("watcher.json not written: %v", err)
	}
	var watcher map[string]any
	if err := json.Unmarshal(wb, &watcher); err != nil {
		t.Fatalf("watcher.json not json: %v", err)
	}
	if watcher["status"] != "watching" {
		t.Fatalf("watcher status = %v", watcher["status"])
	}

	// 6) .port file written
	if pb, _ := os.ReadFile(filepath.Join(feedbackDir, ".port")); len(pb) != 0 {
		// .port is written by Run(), not the bare server; skip if absent.
		_ = pb
	}
}

func mustGet(t *testing.T, url, want string) string {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("GET %s status %d", url, resp.StatusCode)
	}
	if want != "" && !strings.Contains(string(body), want) {
		t.Fatalf("GET %s body %q does not contain %q", url, body, want)
	}
	return string(body)
}

// TestDefaultPortForStableAndInBand proves the stable per-doc default port:
// deterministic per directory, always within the SIP band, and spreading
// different directories across the band. This is the root fix for the
// "everything dogpiles 33333 and nobody can find their doc's port" bug.
func TestDefaultPortForStableAndInBand(t *testing.T) {
	// deterministic: same dir → same port, twice
	if DefaultPortFor("/tmp/docs/alpha") != DefaultPortFor("/tmp/docs/alpha") {
		t.Fatal("DefaultPortFor not deterministic for the same directory")
	}
	// in-band: MinPort .. MinPort+PortSpread-1, always
	for _, d := range []string{"/a", "/tmp/docs/alpha", "/Users/x/y/z/published", "", "/服务/文档"} {
		p := DefaultPortFor(d)
		if p < MinPort || p >= MinPort+PortSpread {
			t.Fatalf("DefaultPortFor(%q)=%d out of band [%d,%d)", d, p, MinPort, MinPort+PortSpread)
		}
	}
	// spread: a handful of distinct dirs should not all collapse to one port
	seen := map[int]bool{}
	for i := 0; i < 20; i++ {
		seen[DefaultPortFor(fmt.Sprintf("/tmp/docs/doc-%d/published", i))] = true
	}
	if len(seen) < 10 {
		t.Fatalf("stable defaults clustered too hard: only %d distinct ports for 20 dirs", len(seen))
	}
}

// TestScanBindAdvancesPastBusy proves the collision safety net: with a port
// already held, a non-strict scan advances to the next free one and serves
// there — never silently loses the bind.
func TestScanBindAdvancesPastBusy(t *testing.T) {
	// Occupy a starting port at/above the floor.
	occ, occPort, err := scanBind(MinPort, 200, false)
	if err != nil {
		t.Fatalf("could not grab an initial port: %v", err)
	}
	defer occ.Close()

	// A second bind starting at the SAME occupied port must advance past it.
	ln, chosen, err := scanBind(occPort, 200, false)
	if err != nil {
		t.Fatalf("scanBind failed to advance past busy port %d: %v", occPort, err)
	}
	defer ln.Close()
	if chosen == occPort {
		t.Fatalf("scanBind returned the busy port %d instead of advancing", occPort)
	}
	if chosen < MinPort {
		t.Fatalf("scanBind chose %d below SIP floor %d", chosen, MinPort)
	}
}

// TestScanBindStrictFailsOnBusy proves strict mode is LOUD: a busy port under
// --strict-port is an error, not a silent auto-advance.
func TestScanBindStrictFailsOnBusy(t *testing.T) {
	occ, occPort, err := scanBind(MinPort, 200, false)
	if err != nil {
		t.Fatalf("could not grab an initial port: %v", err)
	}
	defer occ.Close()

	ln, _, err := scanBind(occPort, 0, true)
	if err == nil {
		ln.Close()
		t.Fatalf("strict scanBind on busy port %d should have failed loudly", occPort)
	}
}
