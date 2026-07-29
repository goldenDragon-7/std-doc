package serve

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The design error these tests exist to prevent:
//
// `serve` used to kill itself the moment it was orphaned. Every documented way
// of starting it — setup.sh, `nohup … &`, an agent's run_in_background — puts a
// throwaway wrapper shell in the parent slot, and that shell exits as soon as it
// has launched the server. So the server read "my parent exited" as "my reader
// is gone" and shut down ~5 seconds later, typically before the human had
// clicked the URL setup.sh had just printed. Every user hit it; every user was
// told afterwards that the docs had warned them.
//
// The rule now: parentage is not a liveness signal. Being TOUCHED is.

// TestServerOutlivesItsParentByDefault is the regression guard for the bug
// itself. A server that believes it has been orphaned must keep serving.
func TestServerOutlivesItsParentByDefault(t *testing.T) {
	s := &server{artifactDir: t.TempDir(), feedbackDir: t.TempDir()}
	s.touch()

	// watchParent=false is the new default. Pretend we have already been
	// reparented to init — the exact condition that used to be fatal.
	if got := s.exitReason(3600, false, true); got != "" {
		t.Fatalf("an orphaned server must keep serving by default; got shutdown reason %q", got)
	}
}

// TestExitWithParentIsStillAvailable proves the old behaviour survives as a
// deliberate opt-in, for a doc that genuinely should die with its session.
func TestExitWithParentIsStillAvailable(t *testing.T) {
	s := &server{artifactDir: t.TempDir(), feedbackDir: t.TempDir()}
	s.touch()

	if got := s.exitReason(3600, true, true); got == "" {
		t.Fatal("--exit-with-parent must still shut down an orphaned server")
	}
}

// TestUntouchedServerEventuallyExits proves the replacement signal actually
// fires — the fix must not turn every doc into an immortal process.
func TestUntouchedServerEventuallyExits(t *testing.T) {
	s := &server{artifactDir: t.TempDir(), feedbackDir: t.TempDir()}
	// Last touched two hours ago.
	s.lastActivity.Store(time.Now().Add(-2 * time.Hour).UnixNano())

	if got := s.exitReason(3600, false, false); got == "" {
		t.Fatal("a document untouched for longer than its idle timeout must shut down")
	}
	// ...but not while it is still inside the window.
	if got := s.exitReason(24*3600, false, false); got != "" {
		t.Fatalf("a document touched 2h ago must survive a 24h timeout; got %q", got)
	}
}

// TestEditingTheDocCountsAsATouch is the half of "touch" that HTTP traffic
// cannot cover: the author edits the doc with no browser tab open. Without
// this, a doc being actively worked on could time out mid-edit.
func TestEditingTheDocCountsAsATouch(t *testing.T) {
	dir := t.TempDir()
	page := filepath.Join(dir, "index.html")
	if err := os.WriteFile(page, []byte("<h1>before</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := &server{artifactDir: dir, feedbackDir: t.TempDir()}
	s.scanContent() // baseline, as run.go does at startup

	// Go quiet for a long time — no requests at all.
	stale := time.Now().Add(-2 * time.Hour)
	s.lastActivity.Store(stale.UnixNano())

	// Now the author edits the page.
	if err := os.WriteFile(page, []byte("<h1>after</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Ensure the mtime is observably newer than the baseline.
	future := time.Now().Add(time.Second)
	if err := os.Chtimes(page, future, future); err != nil {
		t.Fatal(err)
	}

	s.scanContent()

	if s.idleSeconds() > 60 {
		t.Fatalf("editing the served files must count as a touch; still idle for %.0fs", s.idleSeconds())
	}
}

// TestBaselineScanIsNotATouch guards the obvious way to get the above wrong:
// if the first mtime observation counted as a change, every server would touch
// itself once at startup and the distinction would be meaningless.
func TestBaselineScanIsNotATouch(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &server{artifactDir: dir, feedbackDir: t.TempDir()}
	stale := time.Now().Add(-2 * time.Hour)
	s.lastActivity.Store(stale.UnixNano())

	s.scanContent() // first look — establishes the baseline only

	if s.idleSeconds() < 60 {
		t.Fatal("the first content scan is a baseline, not a change; it must not reset the idle clock")
	}
}

// TestCleanupRemovesPortMarker proves we stop leaving a .port file pointing at
// a port we no longer hold. A stale marker is how a launcher or an agent ends
// up handing a human a URL that nothing is listening on — which reads exactly
// like "the server came up on a bad port".
func TestCleanupRemovesPortMarker(t *testing.T) {
	fb := t.TempDir()
	portFile := filepath.Join(fb, ".port")
	if err := os.WriteFile(portFile, []byte("33333"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := &server{artifactDir: t.TempDir(), feedbackDir: fb}
	s.cleanup()

	if _, err := os.Stat(portFile); !os.IsNotExist(err) {
		t.Fatal(".port must be removed on shutdown so nobody is left holding a dead URL")
	}
}

// TestNeverExitsWhenIdleTimeoutDisabled keeps --idle-timeout 0 meaning what it
// says, now that it is no longer the default.
func TestNeverExitsWhenIdleTimeoutDisabled(t *testing.T) {
	s := &server{artifactDir: t.TempDir(), feedbackDir: t.TempDir()}
	s.lastActivity.Store(time.Now().Add(-30 * 24 * time.Hour).UnixNano())

	if got := s.exitReason(0, false, true); got != "" {
		t.Fatalf("--idle-timeout 0 must never exit, even after a month; got %q", got)
	}
}

// TestPollContentIsRateLimited guards the cost of the touch signal. The
// watchdog ticks every 5s, but re-walking the document tree that often for the
// life of the server is waste — the only consumer is a 24h deadline.
func TestPollContentIsRateLimited(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &server{artifactDir: dir, feedbackDir: t.TempDir()}

	s.pollContent()
	first := s.lastContentPoll.Load()
	if first == 0 {
		t.Fatal("the first pollContent must actually scan")
	}

	s.pollContent() // immediately again — must be skipped, not re-walked
	if s.lastContentPoll.Load() != first {
		t.Fatal("pollContent must not re-walk the tree on every 5s watchdog tick")
	}
}

// TestWalkSkipsNoiseDirectories keeps the scan proportional to the DOCUMENT.
// node_modules and dot-dirs are never the doc, and they are exactly what makes
// a naive walk expensive.
func TestWalkSkipsNoiseDirectories(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	baseline := newestMTime(dir)
	if baseline == 0 {
		t.Fatal("expected to see the page")
	}

	// A far-future file buried in node_modules must NOT register.
	noise := filepath.Join(dir, "node_modules", "pkg")
	if err := os.MkdirAll(noise, 0o755); err != nil {
		t.Fatal(err)
	}
	buried := filepath.Join(noise, "huge.js")
	if err := os.WriteFile(buried, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(48 * time.Hour)
	if err := os.Chtimes(buried, future, future); err != nil {
		t.Fatal(err)
	}

	if got := newestMTime(dir); got != baseline {
		t.Fatal("node_modules must be skipped; a dependency's mtime is not the document being edited")
	}
}

// TestDefaultIdleTimeoutIs24Hours pins the documented number so it cannot drift
// away from what setup.sh and SKILL.md promise the reader.
func TestDefaultIdleTimeoutIs24Hours(t *testing.T) {
	if DefaultIdleTimeout != 24*60*60 {
		t.Fatalf("DefaultIdleTimeout must be 24h in seconds; got %d", DefaultIdleTimeout)
	}
}
