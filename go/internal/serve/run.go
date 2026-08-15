package serve

import (
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// heartbeatInterval default cadence (5s).
const heartbeatInterval = 5 * time.Second

// Run injects the feedback library into dir and serves it: a behavior-compatible
// the native inject + serve + heartbeat layer, in one process, zero Python.
func Run(dir string, opt Options) error {
	artifactDir, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	if info, serr := os.Stat(artifactDir); serr != nil || !info.IsDir() {
		return fmt.Errorf("%s does not exist", artifactDir)
	}

	// Idempotent inject + feedback-dir scaffolding (replaces a separate inject step).
	if err := Inject(artifactDir, opt.Recursive); err != nil {
		return err
	}

	feedbackDir := filepath.Join(artifactDir, "feedback")
	clientDir := filepath.Join(opt.LibRoot, "lib")
	if info, serr := os.Stat(clientDir); serr != nil || !info.IsDir() {
		return fmt.Errorf("client assets dir not found: %s (expected <lib-root>/lib with feedback.js etc.)", clientDir)
	}

	// Port 0 = no explicit --port: pick a STABLE per-doc default from the doc
	// path so concurrent docs spread across the band instead of dogpiling
	// 33333, and so the same doc reliably returns to the same port.
	start := opt.Port
	if start == 0 {
		start = DefaultPortFor(artifactDir)
		fmt.Printf("[server] no --port given; stable default for this doc is %d\n", start)
	}

	ln, chosen, err := scanBind(start, opt.PortScan, opt.StrictPort)
	if err != nil {
		if opt.StrictPort {
			fmt.Printf("[server] FATAL: port %d is unavailable and --strict-port was set (%v).\n", start, err)
		} else {
			fmt.Printf("[server] FATAL: no free port in %d..%d (%v).\n", start, start+opt.PortScan, err)
		}
		return err
	}
	if chosen != start {
		fmt.Printf("[server] port %d busy → advanced to free port %d\n", start, chosen)
	}

	srv := &server{
		artifactDir: artifactDir,
		feedbackDir: feedbackDir,
		clientDir:   clientDir,
		note:        opt.Note,
		port:        chosen,
		recursive:   opt.Recursive,
	}
	// Decision 2 — serve auto-starts a codraw surface when the doc has a canvas.
	// A second in-process listener serves the vendored codraw runtime with Go
	// scene/feedback handlers (no Python), and every canvas mount's src is
	// rewritten to it. The authored src becomes a fallback that never has to be right.
	if docHasCanvas(artifactDir, opt.Recursive) {
		runtimeRoot := filepath.Join(clientDir, "codraw")
		if info, serr := os.Stat(filepath.Join(runtimeRoot, "index.html")); serr == nil && !info.IsDir() {
			cs := newCodrawServer(runtimeRoot, feedbackDir)
			if cport, cerr := cs.start(); cerr == nil {
				srv.canvasURL = fmt.Sprintf("http://localhost:%d/", cport)
				fmt.Printf("[server] canvas: co-drawing surface live at %s\n", srv.canvasURL)
				fmt.Printf("[server] canvas: comments → %s (Monitor it)\n", cs.inboxFile)
			} else {
				fmt.Printf("[server] canvas: could not start surface (%v) — mounts fall back to their authored src\n", cerr)
			}
		}
	}

	// Record the actual port (and that we're serving) so launchers/tools read
	// the truth; the marker survives shutdown carrying why it stopped (CARRIED-5).
	srv.writePortState("serving", "")
	srv.touch()
	srv.pollContent() // establish the content-mtime baseline before the watchdog runs

	// Presence heartbeat (folded into the server).
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go srv.heartbeat(heartbeatInterval, done, &wg)

	// Auto-shutdown watchdog: untouched-for-too-long, and parent death only if
	// the caller explicitly asked to be tied to it.
	go srv.watchdog(opt.IdleTimeout, os.Getppid(), opt.ExitWithParent)

	httpSrv := &http.Server{Handler: srv}

	inbox := filepath.Join(feedbackDir, "inbox.jsonl")
	history := filepath.Join(feedbackDir, "history.json")
	fmt.Printf("[server] serving %s\n", artifactDir)
	fmt.Printf("[server] open http://localhost:%d/\n", chosen)
	fmt.Printf("[server] inbox:   %s\n", inbox)
	fmt.Printf("[server] history: %s\n", history)
	fmt.Printf("[server] info:    http://localhost:%d/info\n", chosen)
	switch {
	case opt.IdleTimeout > 0 && opt.ExitWithParent:
		fmt.Printf("[server] auto-shutdown: untouched for %s, OR when the launching process exits (--exit-with-parent)\n", humanDuration(opt.IdleTimeout))
	case opt.IdleTimeout > 0:
		fmt.Printf("[server] auto-shutdown: untouched for %s (a page load or an edit resets the clock). Survives this shell.\n", humanDuration(opt.IdleTimeout))
	case opt.ExitWithParent:
		fmt.Printf("[server] auto-shutdown: when the launching process exits (--exit-with-parent)\n")
	default:
		fmt.Printf("[server] auto-shutdown: never (--idle-timeout 0). Stop it with Ctrl-C or `kill %d`.\n", os.Getpid())
	}
	fmt.Printf("[server] Ctrl-C to stop\n")

	// Clean shutdown on Ctrl-C / SIGTERM: drop the heartbeat (removes watcher.json)
	// so the page's presence dot clears promptly.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Printf("\n[server] stopping\n")
		close(done)
		wg.Wait()
		srv.cleanup("stopped by signal (Ctrl-C/SIGTERM)")
		httpSrv.Close()
	}()

	err = httpSrv.Serve(ln)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
