package main

// stylestamp_capability_test.go — the end-to-end guard for the style-honoring
// fix (2026-10-13).
//
// THE BUG: `publish --style X` bakes X's tokens into the page's :root, then
// `serve` injects style-lock.{js,css} at the END of <head>. Specificity ties
// (:root is 0,1,0, [data-style] is 0,1,0), so source order decides and the
// injected lock WINS. style-lock.js had no way to learn the doc's style, so it
// stamped "techno-dark" unconditionally — silently discarding --style for every
// served doc. MEASURED in Chrome before the fix: a doc published --style
// parchment-light computed --bg #0a0e17 instead of #faf8f3; a BYO surge-light
// doc computed #0a0e17 instead of its #abcdef.
//
// WHY THIS TEST EXISTS SEPARATELY: conformance/run_go.sh now NORMALIZES the
// stamp away (expected/ is a core.Publish golden shared with internal/core's
// byte-identical test, which never sees the stamp). So the shell gate can no
// longer catch a regression in this attribute — this test is where that
// coverage lives. Do not delete it without moving the assertion somewhere that
// runs the real publish command.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// CAPABILITY: the real publish command stamps the doc's published style onto
// <html>, for every page, for the default style and an explicit one alike.
func TestCapability_PublishStampsThePublishedStyle(t *testing.T) {
	root := repoRootCmd(t)
	t.Setenv("STDDOC_LIB", filepath.Join(root, "go", "stddoc-lib"))
	src := filepath.Join(root, "examples", "data-derived-example", "source.json")
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("fixture source.json not found: %v", err)
	}

	cases := []struct {
		name string
		args func(out string) []string
		want string
	}{
		{
			name: "explicit --style is what gets stamped",
			args: func(out string) []string { return []string{src, out, "--style", "parchment-light"} },
			want: `data-style-default="parchment-light"`,
		},
		{
			name: "no --style stamps the resolved default, not nothing",
			args: func(out string) []string { return []string{src, out} },
			want: `data-style-default="techno-dark"`,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := t.TempDir()
			if err := cmdPublish(c.args(out)); err != nil {
				t.Fatalf("publish failed: %v", err)
			}
			entries, err := os.ReadDir(out)
			if err != nil {
				t.Fatal(err)
			}
			pages := 0
			for _, e := range entries {
				if !strings.HasSuffix(e.Name(), ".html") {
					continue
				}
				pages++
				b, rerr := os.ReadFile(filepath.Join(out, e.Name()))
				if rerr != nil {
					t.Fatal(rerr)
				}
				html := string(b)
				if !strings.Contains(html, c.want) {
					t.Errorf("%s: missing %s — serve's style-lock will repaint this page techno-dark", e.Name(), c.want)
				}
				if n := strings.Count(html, "data-style-default="); n != 1 {
					t.Errorf("%s: want exactly 1 stamp, got %d", e.Name(), n)
				}
			}
			// A test that asserts over zero pages is a test that cannot fail.
			if pages == 0 {
				t.Fatal("published no .html pages — the assertion above was vacuous")
			}
			t.Logf("asserted the stamp on %d page(s)", pages)
		})
	}
}

// CAPABILITY: the normalization that conformance/run_go.sh relies on must stay
// exact. If the stamp's rendered form ever drifts from ` data-style-default="…"`
// the shell gate's sed stops matching and conformance goes red for a reason
// that has nothing to do with the renderer. Pin the form here.
func TestCapability_StampFormMatchesConformanceNormalizer(t *testing.T) {
	got := applyStyleStamp(`<html lang="en">x</html>`, "parchment-light")
	const want = `<html lang="en" data-style-default="parchment-light">x</html>`
	if got != want {
		t.Fatalf("stamp form drifted — update conformance/run_go.sh's sed too\n got: %q\nwant: %q", got, want)
	}
}
