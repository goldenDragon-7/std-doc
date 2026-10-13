package core

// reference_layout_test.go — the `reference` layout mode: rail + content +
// a derived aside. std-doc shipped exactly one content column in every prior
// layout (default `250px 1fr`; no-nav/top-nav/hero all `1fr`), so this is the
// first page-level composition axis the system has had.
//
// The promise these tests hold: the mode is INERT unless a doc names it.

import (
	"strings"
	"testing"

	"stddoc/internal/library"
	"stddoc/internal/wire"
)

func publishDoc(t *testing.T, docJSON string) map[string]string {
	t.Helper()
	lib := loadLib(t)
	doc, err := wire.ParseOrderedJSON([]byte(docJSON))
	if err != nil {
		t.Fatalf("parse doc: %v", err)
	}
	pages, err := Publish(doc, "", lib)
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	out := map[string]string{}
	for name, body := range pages {
		out[name] = string(body)
	}
	return out
}

var _ = library.Library{}

const refDocTemplate = `{
 "title":"T","generated_date":"2026-09-01",%s
 "groups":["G"],
 "root":{"summary":"s"},
 "nodes":[{"slug":"n","group":"G","title":"N","status":"LIVE","updated":"2026-09-01",
   "sections":[{"name":"First","summary":"a"},{"name":"Second","summary":"b"}],
   "blocks":[]}]
}`

// TestReferenceLayoutEmitsThirdColumn proves the mode does what it claims.
func TestReferenceLayoutEmitsThirdColumn(t *testing.T) {
	pages := publishDoc(t, strings.Replace(refDocTemplate, "%s", `"layout":"reference",`, 1))
	page, ok := pages["n.html"]
	if !ok {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	if !strings.Contains(page, "reference-shell") {
		t.Errorf("shell class missing")
	}
	if !strings.Contains(page, "grid-template-columns:250px minmax(0,1fr) 232px") {
		t.Errorf("three-column grid missing")
	}
	if !strings.Contains(page, "<aside class='otp'>") {
		t.Errorf("aside missing")
	}
	// The TOC is DERIVED from sections — both must appear, in order.
	i1, i2 := strings.Index(page, ">First<"), strings.Index(page, ">Second<")
	if i1 < 0 || i2 < 0 || i1 > i2 {
		t.Errorf("derived TOC entries missing or out of order (%d,%d)", i1, i2)
	}
	if !strings.Contains(page, "<dt>Status</dt><dd>LIVE</dd>") {
		t.Errorf("status metadata missing")
	}
	// Every aside link must point at an id that exists on the page — a TOC of
	// dead anchors is worse than no TOC.
	for _, frag := range anchorHrefs(page) {
		if !strings.Contains(page, "id='"+frag+"'") {
			t.Errorf("aside links to #%s but no such id on the page", frag)
		}
	}
}

// TestReferenceLayoutInertWhenUnnamed is the strangler proof for this mode:
// a doc that does not ask for it must show no trace of it.
func TestReferenceLayoutInertWhenUnnamed(t *testing.T) {
	pages := publishDoc(t, strings.Replace(refDocTemplate, "%s", "", 1))
	for name, page := range pages {
		for _, needle := range []string{"reference-shell", "otp", "On this page", "232px"} {
			if strings.Contains(page, needle) {
				t.Errorf("%s: layout-less doc leaked %q", name, needle)
			}
		}
	}
}

// TestReferenceLayoutOtherModesUnaffected guards the neighbours.
func TestReferenceLayoutOtherModesUnaffected(t *testing.T) {
	for _, mode := range []string{"no-nav", "top-nav", "hero"} {
		pages := publishDoc(t, strings.Replace(refDocTemplate, "%s", `"layout":"`+mode+`",`, 1))
		for name, page := range pages {
			if strings.Contains(page, "<aside class='otp'>") {
				t.Errorf("mode %s (%s) grew an aside", mode, name)
			}
		}
	}
}

// TestReferenceAsideOmittedWhenEmpty — an aside with nothing in it is chrome.
func TestReferenceAsideOmittedWhenEmpty(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01","layout":"reference",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[]}]}`)
	if strings.Contains(pages["n.html"], "<aside class='otp'>") {
		t.Fatalf("emitted an empty aside")
	}
}

func keysOf(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// anchorHrefs pulls the fragment ids the aside links to.
func anchorHrefs(page string) []string {
	var out []string
	rest := page
	for {
		i := strings.Index(rest, "<li><a href='#")
		if i < 0 {
			return out
		}
		rest = rest[i+len("<li><a href='#"):]
		j := strings.Index(rest, "'")
		if j < 0 {
			return out
		}
		out = append(out, rest[:j])
	}
}
