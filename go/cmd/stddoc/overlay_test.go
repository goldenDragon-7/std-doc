package main

import "strings"

import "testing"

func TestApplyOverlayLandsAfterEveryStyle(t *testing.T) {
	html := "<html><head><style>a{}</style></head><body><style>b{}</style><p>x</p></body></html>"
	css := ".wrap{max-width:none}"
	out := applyOverlay(html, css)

	if !strings.Contains(out, `id="stddoc-overlay"`) {
		t.Fatalf("overlay not present: %s", out)
	}
	// The overlay must appear AFTER both style blocks (head and body) so the
	// cascade's last-rule-wins gives the reader's preference precedence.
	iHead := strings.Index(out, "<style>a{}")
	iBody := strings.Index(out, "<style>b{}")
	iOver := strings.Index(out, `id="stddoc-overlay"`)
	if !(iOver > iHead && iOver > iBody) {
		t.Fatalf("overlay must be last: head=%d body=%d overlay=%d", iHead, iBody, iOver)
	}
	// It lands inside the document, before </body>.
	if strings.Index(out, `id="stddoc-overlay"`) > strings.LastIndex(out, "</body>") {
		t.Fatalf("overlay landed after </body>")
	}
}

func TestApplyOverlayFallbackAppend(t *testing.T) {
	// No head/body tags — overlay still gets appended so precedence holds.
	out := applyOverlay("<p>bare</p>", ".x{}")
	if !strings.Contains(out, `id="stddoc-overlay"`) || !strings.HasSuffix(strings.TrimSpace(out), "</style>") {
		t.Fatalf("fallback append failed: %q", out)
	}
}
