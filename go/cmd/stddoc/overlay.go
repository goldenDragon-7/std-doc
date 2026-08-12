package main

import "strings"

// applyOverlay inlines a reader's preference CSS into a rendered page, AFTER the
// doc's own style block so the last rule wins — no !important, no knowledge of
// the page's selectors. It is inlined (not linked) so it survives freeze: a
// frozen doc reaches out to nothing (Covenant IV), and a <link> would break in
// the cave.
//
// This is deliberately a POST-render concatenation in the publish command, not a
// change to core.Publish — so the byte-identical conformance goldens (which test
// core.Publish directly) are untouched by construction, and a publish with no
// overlay produces exactly today's bytes.
//
// Placement: immediately before </body> — the LAST possible position, after
// every style block whether it lives in <head> or (as some pages do) inline in
// <body>. That makes "last rule wins" hold for any overlay, not just ones that
// happen not to collide with a body-level block. Falls back to before </head>,
// then to append.
func applyOverlay(html, css string) string {
	block := "<style id=\"stddoc-overlay\">\n" + css + "\n</style>\n"
	if i := lastIndexFold(html, "</body>"); i >= 0 {
		return html[:i] + block + html[i:]
	}
	if i := lastIndexFold(html, "</head>"); i >= 0 {
		return html[:i] + block + html[i:]
	}
	return html + "\n" + block
}

// lastIndexFold is a case-insensitive strings.LastIndex (HTML tags may be cased
// either way; the renderer uses lowercase, but a plugin page might not).
func lastIndexFold(s, sub string) int {
	return strings.LastIndex(strings.ToLower(s), strings.ToLower(sub))
}
