package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// readLibFile reads a file from the repo's own stddoc-lib/lib/.
func readLibFile(t *testing.T, name string) string {
	t.Helper()
	p := filepath.Join(repoRootForTest(t), "go", "stddoc-lib", "lib", name)
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(b)
}

// TestApplyStyleStamp pins the contract style-lock.js depends on: the published
// style must appear ON the <html> tag, so the injected lock defaults to the
// doc's own voice instead of repainting it techno-dark.
func TestApplyStyleStamp(t *testing.T) {
	cases := []struct {
		name  string
		html  string
		style string
		want  string // substring that must be present
		unch  bool   // input must come back byte-identical
	}{
		{
			name:  "renderer tag gets the stamp",
			html:  "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n</head>\n<body></body>\n</html>\n",
			style: "surge-light",
			want:  `<html lang="en" data-style-default="surge-light">`,
		},
		{
			name:  "bare html tag gets the stamp",
			html:  "<html>\n<head></head>\n</html>",
			style: "parchment-light",
			want:  `<html data-style-default="parchment-light">`,
		},
		{
			name:  "standalone sentinel",
			html:  "<html lang=\"en\">x</html>",
			style: pageOwnStyle,
			want:  `data-style-default="_page"`,
		},
		{
			name:  "idempotent — a second publish does not double-stamp",
			html:  `<html lang="en" data-style-default="playful">x</html>`,
			style: "techno-dark",
			unch:  true,
		},
		{
			name:  "empty style is a no-op",
			html:  `<html lang="en">x</html>`,
			style: "",
			unch:  true,
		},
		{
			name:  "no html tag is a no-op (fragment stays a fragment)",
			html:  "<div>just a fragment</div>",
			style: "playful",
			unch:  true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := applyStyleStamp(c.html, c.style)
			if c.unch {
				if got != c.html {
					t.Fatalf("expected unchanged input\n got: %q\nwant: %q", got, c.html)
				}
				return
			}
			if !strings.Contains(got, c.want) {
				t.Fatalf("missing stamp\n got: %q\nwant substring: %q", got, c.want)
			}
			// Exactly one stamp, always.
			if n := strings.Count(got, "data-style-default="); n != 1 {
				t.Fatalf("want exactly 1 stamp, got %d: %q", n, got)
			}
		})
	}
}

// TestStyleLockHonorsThePageDefault is the guard on the OTHER half of the fix.
// A unit test cannot run the browser, so it pins the two properties of
// style-lock.js that the measured browser failure came from: it must read
// data-style-default, and it must NOT carry a hardcoded three-name whitelist.
func TestStyleLockHonorsThePageDefault(t *testing.T) {
	js := readLibFile(t, "style-lock.js")
	if !strings.Contains(js, "data-style-default") {
		t.Error("style-lock.js must default to the page's published style (data-style-default)")
	}
	// The old whitelist is what rejected custom style names.
	if strings.Contains(js, "ALLOWED") {
		t.Error("style-lock.js must not whitelist style names — an unknown name is " +
			"exactly how a custom style keeps its own :root")
	}
}
