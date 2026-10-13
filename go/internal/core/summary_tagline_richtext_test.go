package core

// summary_tagline_richtext_test.go — root `summary` and node `tagline` are
// PROSE, and prose is prose everywhere.
//
// THE OLD BEHAVIOUR (page.go :100 / :177, until 2026-09-02): both fields went
// through esc() directly and never through richText, so they were silently
// excluded from every prose feature the rest of the renderer gained — markdown
// links (2026-08-12), **bold** (2026-09-01), and inline `code` chips
// (2026-09-02, ae480b6). std-doc's own self-doc shipped raw backticks in the
// first sentence a reader sees.
//
// THE DECISION: fix it. This does not extend the inline-code change, it
// FINISHES it — the two fields were excluded from "prose" by accident, and
// "prose is prose, except in two fields nobody can remember" is worse than
// either alternative. The change is reversible (two lines + regenerate).
//
// MEASURED before deciding, across the 41 authored input.json/source.json in
// the tree: 567 tagline/summary values, 213 carry ` or **, and `](` appears in
// ZERO — so the markdown-link hazard this risked has no instance in any
// current doc.
//
// SCOPE, deliberately not widened: ascii / code / pre content keeps its
// literal backticks (different render path) and must. Two literal backticks
// remain in the golden set after this change, both inside a <pre> diagram —
// that is correct, not residue.

import (
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/library"
	"stddoc/internal/wire"
)

func TestSummaryAndTaglineRenderAsProse(t *testing.T) {
	root := repoRoot(t)
	lib, err := library.Load(filepath.Join(root, "go", "stddoc-lib"))
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	src := `{
	  "title": "Prose Doc",
	  "root": {"summary": "root says ` + "`code`" + ` and **bold** and [link](https://example.com)"},
	  "nodes": [{
	    "slug": "alpha", "title": "Alpha",
	    "tagline": "node says ` + "`code`" + ` and **bold** and [link](https://example.com)",
	    "sections": [{"name": "Overview", "summary": "s", "items": [{"name": "i", "desc": "d"}]}]
	  }]
	}`
	doc, err := wire.ParseOrderedJSON([]byte(src))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}

	for _, tc := range []struct{ page, field string }{
		{"index.html", "root.summary"},
		{"alpha.html", "node.tagline"},
	} {
		html, ok := pages[tc.page]
		if !ok {
			t.Fatalf("%s: page not produced", tc.page)
		}
		tagline := taglineOf(t, html, tc.page)
		if !strings.Contains(tagline, "<code") {
			t.Errorf("%s (%s): backticks did not become a code chip: %s", tc.page, tc.field, tagline)
		}
		if !strings.Contains(tagline, "<strong>bold</strong>") {
			t.Errorf("%s (%s): **bold** did not render: %s", tc.page, tc.field, tagline)
		}
		if !strings.Contains(tagline, `href="https://example.com"`) &&
			!strings.Contains(tagline, `href='https://example.com'`) {
			t.Errorf("%s (%s): markdown link did not render: %s", tc.page, tc.field, tagline)
		}
		if strings.Contains(tagline, "`") {
			t.Errorf("%s (%s): literal backtick survived in prose: %s", tc.page, tc.field, tagline)
		}
	}
}

// taglineOf returns the contents of the FIRST <p class='tagline'> on a page —
// the element both fields render into.
func taglineOf(t *testing.T, html, page string) string {
	t.Helper()
	const open = "<p class='tagline'>"
	i := strings.Index(html, open)
	if i < 0 {
		t.Fatalf("%s: no tagline paragraph rendered", page)
	}
	rest := html[i+len(open):]
	j := strings.Index(rest, "</p>")
	if j < 0 {
		t.Fatalf("%s: unterminated tagline paragraph", page)
	}
	return rest[:j]
}
