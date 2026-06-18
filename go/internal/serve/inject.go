// Package serve implements the native Go `serve` command: it injects the
// feedback library into a directory of HTML pages and runs a tiny stdlib-only
// HTTP server that accepts reader comments and keeps a presence heartbeat — a
// behavior-compatible replacement for engine/lib/server.py + scripts/inject.py
// + scripts/watch.py. ZERO Python: no os/exec, no interpreter, ever.
package serve

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// The exact tag forms inject writes. Mirrors engine/scripts/inject.py so a doc
// wired by either tool is byte-identical and re-running stays idempotent.
const (
	cssTag = `<link rel="stylesheet" href="/lib/feedback.css">`
	jsTag  = `<script src="/lib/feedback.js" defer></script>`

	// style-lock — the voice chosen on the style_ab page follows the reader to
	// every page. The CSS supplies all three voice palettes (scoped under
	// [data-style]); the JS reads the reader's pick from localStorage and stamps
	// <html data-style="…"> SYNCHRONOUSLY in <head> (no defer) so the palette
	// swaps before first paint, with zero flash.
	styleLockCSSTag = `<link rel="stylesheet" href="/lib/style-lock.css">`
	styleLockJSTag  = `<script src="/lib/style-lock.js"></script>`

	mermaidJSTag = `<script src="/lib/mermaid.js" defer></script>`

	// mermaidHeadMarker / mermaidJSMarker detect the injected TAG, not a bare
	// path, so prose that merely mentions /lib/mermaid.* doesn't suppress wiring.
	mermaidHeadMarker = `href="/lib/mermaid.css"`
	mermaidJSMarker   = `src="/lib/mermaid.js"`
)

// mermaidHeadTags is the <head> block added when a page actually uses mermaid.
// Note the two-space indent before continuation lines, matching inject.py so
// the bytes are identical.
const mermaidHeadTags = `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
  <link rel="stylesheet" href="/lib/mermaid.css">`

// A page "uses mermaid" if it contains a class="mermaid" block.
var mermaidUseRE = regexp.MustCompile(`(?i)class\s*=\s*["'][^"']*\bmermaid\b`)

// injectOne adds the feedback (and conditional mermaid) tags to one file,
// idempotently. Returns a human-readable status string mirroring inject.py.
func injectOne(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	text := string(raw)
	changed := false
	var notes []string

	cssPresent := strings.Contains(text, cssTag)
	jsPresent := strings.Contains(text, jsTag)

	if !cssPresent {
		if strings.Contains(text, "</head>") {
			text = strings.Replace(text, "</head>", "  "+cssTag+"\n</head>", 1)
			changed = true
		} else {
			notes = append(notes, "no </head>")
		}
	}
	if !jsPresent {
		if strings.Contains(text, "</body>") {
			text = strings.Replace(text, "</body>", "  "+jsTag+"\n</body>", 1)
			changed = true
		} else {
			notes = append(notes, "no </body>")
		}
	}

	// style-lock: palette CSS + the synchronous apply-on-load script, both into
	// <head>, so the reader's chosen voice follows them across every page.
	if !strings.Contains(text, styleLockCSSTag) {
		if strings.Contains(text, "</head>") {
			text = strings.Replace(text, "</head>", "  "+styleLockJSTag+"\n  "+styleLockCSSTag+"\n</head>", 1)
			changed = true
		} else {
			notes = append(notes, "no </head> for style-lock")
		}
	}

	// mermaid kit — only when the page contains a class="mermaid" block.
	if mermaidUseRE.MatchString(text) {
		if !strings.Contains(text, mermaidHeadMarker) {
			if strings.Contains(text, "</head>") {
				text = strings.Replace(text, "</head>", "  "+mermaidHeadTags+"\n</head>", 1)
				changed = true
			} else {
				notes = append(notes, "no </head> for mermaid")
			}
		}
		if !strings.Contains(text, mermaidJSMarker) {
			if strings.Contains(text, "</body>") {
				text = strings.Replace(text, "</body>", "  "+mermaidJSTag+"\n</body>", 1)
				changed = true
			} else {
				notes = append(notes, "no </body> for mermaid")
			}
		}
	}

	var status string
	if changed {
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			return "", err
		}
		status = "injected"
	} else if cssPresent && jsPresent {
		status = "skipped (already wired)"
	} else {
		status = "skipped (cannot wire)"
	}
	if len(notes) > 0 {
		status += " [" + strings.Join(notes, ", ") + "]"
	}
	return status, nil
}

// findHTML returns the *.html files to wire. Non-recursive returns the top
// level only (sorted); recursive walks subdirs but skips anything under a
// feedback/ path component (matching inject.py's "feedback" not in p.parts).
func findHTML(root string, recursive bool) ([]string, error) {
	var out []string
	if recursive {
		err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			if !strings.HasSuffix(p, ".html") {
				return nil
			}
			rel, rerr := filepath.Rel(root, p)
			if rerr != nil {
				return rerr
			}
			for _, part := range strings.Split(rel, string(filepath.Separator)) {
				if part == "feedback" {
					return nil
				}
			}
			out = append(out, p)
			return nil
		})
		if err != nil {
			return nil, err
		}
	} else {
		entries, err := os.ReadDir(root)
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".html") {
				continue
			}
			out = append(out, filepath.Join(root, e.Name()))
		}
	}
	sort.Strings(out)
	return out, nil
}

// ensureFeedbackDir creates <root>/feedback with an empty inbox.jsonl and a
// history.json initialized to "[]" — the files the server writes to. Idempotent.
func ensureFeedbackDir(root string) error {
	fb := filepath.Join(root, "feedback")
	if err := os.MkdirAll(fb, 0o755); err != nil {
		return err
	}
	inbox := filepath.Join(fb, "inbox.jsonl")
	if _, err := os.Stat(inbox); os.IsNotExist(err) {
		if err := os.WriteFile(inbox, nil, 0o644); err != nil {
			return err
		}
	}
	history := filepath.Join(fb, "history.json")
	if _, err := os.Stat(history); os.IsNotExist(err) {
		if err := os.WriteFile(history, []byte("[]"), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// Inject wires the feedback library into every *.html under root and ensures
// the feedback dir exists. Printed output mirrors inject.py for familiarity.
func Inject(root string, recursive bool) error {
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("%s is not a directory", root)
	}
	htmls, err := findHTML(root, recursive)
	if err != nil {
		return err
	}
	if len(htmls) == 0 {
		fmt.Printf("No *.html files found in %s\n", root)
		return nil
	}
	fmt.Printf("Injecting tags into %d file(s) under %s:\n", len(htmls), root)
	for _, p := range htmls {
		rel, _ := filepath.Rel(root, p)
		status, ierr := injectOne(p)
		if ierr != nil {
			return ierr
		}
		fmt.Printf("  %s: %s\n", rel, status)
	}
	if err := ensureFeedbackDir(root); err != nil {
		return err
	}
	fmt.Printf("\nFeedback dir ready: %s\n", filepath.Join(root, "feedback"))
	return nil
}
