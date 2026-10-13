package core

// layout_language_test.go — the page layout language (see the
// layout-language design note): the `row`/`grid`/`band` containers, and the fix that
// makes them worth using — the reference layout's TOC must see band labels,
// not just sections[].name, or the expressive path costs its author their
// TOC and nobody ever reaches for it (Covenant III, inverted inside our own
// engine — see the design doc §4.3, §7 call #1).
//
// PROVEN RED discipline: TestTOCBlindToBandLabelsWithoutWiring below asserts
// the WIRING, not just collectTOCLabels as a pure function — it fails if
// renderOnThisPage ever stops calling collectTOCLabels, the same class of
// gap that let a registered-but-unreachable validator ship green (2462bae,
// TestSectionsValidatorReachedByLint).

import (
	"strings"
	"testing"
)

// asideOf isolates the "on this page" aside from a rendered page, so a check
// for a label there cannot be satisfied by that SAME text rendered in the
// page BODY (a band's own label div, or a section heading) — the exact
// false-pass this file's PROVEN RED check exists to catch.
func asideOf(t *testing.T, page string) string {
	t.Helper()
	i := strings.Index(page, "<aside class='otp'>")
	if i < 0 {
		return ""
	}
	j := strings.Index(page[i:], "</aside>")
	if j < 0 {
		t.Fatalf("unterminated aside in page:\n%s", page)
	}
	return page[i : i+j+len("</aside>")]
}

// TestContainersRenderAndComposeArbitraryTypes proves the terseness trick
// (design §2.1): a row column authored as a bare array of blocks renders
// BOTH blocks in one .row-col, with no wrapper object and no interpreter
// change — the single riskiest claim in the design.
func TestContainersRenderAndComposeArbitraryTypes(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[
	   {"type":"row","w":"2fr 1fr","cols":[
	     [{"type":"prose","text":"First in column."},{"type":"prose","text":"Second in same column."}],
	     {"type":"panel","lead":"Budget","body":"120ms p99."}
	   ]},
	   {"type":"grid","across":4,"content":[
	     {"type":"prose","text":"cell one"},
	     {"type":"prose","text":"cell two"}
	   ]},
	   {"type":"band","label":"THE PLANES","content":[
	     {"type":"prose","text":"banded prose"}
	   ]}
	 ]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	if strings.Contains(page, "std-doc-error") {
		t.Fatalf("render error in page:\n%s", page)
	}
	if !strings.Contains(page, "grid-template-columns:2fr 1fr") {
		t.Errorf("row weights missing")
	}
	if !strings.Contains(page, "First in column.") || !strings.Contains(page, "Second in same column.") {
		t.Errorf("bare-array column did not render both blocks")
	}
	if !strings.Contains(page, "grid-template-columns:repeat(4,1fr)") {
		t.Errorf("grid across=4 missing")
	}
	if !strings.Contains(page, "band-label") || !strings.Contains(page, "THE PLANES") {
		t.Errorf("band label missing")
	}
	if !strings.Contains(page, "banded prose") {
		t.Errorf("band content missing")
	}
}

// TestTOCSeesBandLabels is the whole bet (design §4.3, §7 call #1): the
// reference layout's aside must derive from band.label/band.title too, not
// only sections[].name.
func TestTOCSeesBandLabels(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01","layout":"reference",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N",
	   "sections":[{"name":"First","summary":"a"}],
	   "blocks":[{"type":"band","label":"THE TRADE","content":[
	     {"type":"prose","text":"body"}
	   ]}]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	aside := asideOf(t, page)
	if aside == "" {
		t.Fatalf("no aside on the page:\n%s", page)
	}
	// Scoped to the ASIDE specifically — a band's own label div in the page
	// BODY also contains this text, so a body-wide Contains would pass even
	// with the TOC wiring fully disabled. That false pass is exactly what
	// this test exists to rule out.
	if !strings.Contains(aside, ">THE TRADE<") {
		t.Fatalf("band label missing from TOC aside:\n%s", aside)
	}
	// Every aside link must resolve to a real id on the page — a TOC of dead
	// anchors (design §4.3c) is worse than no TOC.
	for _, frag := range anchorHrefs(page) {
		if !strings.Contains(page, "id='"+frag+"'") {
			t.Errorf("aside links to #%s but no such id on the page", frag)
		}
	}
}

// TestTOCOrdersLeadBandBeforeSections locks the ordering bug the design doc
// caught in its own first sketch (§4.3(b)): adaptNode hoists `at:"lead"`
// blocks BEFORE the synthetic "sections" entry, so a lead band's label MUST
// precede every section name in the aside. A collector built from two
// separate loops (sections, then bands) gets this backwards; one pass over
// the adapted stream gets it right by construction.
func TestTOCOrdersLeadBandBeforeSections(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01","layout":"reference",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N",
	   "sections":[{"name":"First Section","summary":"a"}],
	   "blocks":[{"type":"band","label":"LEAD BAND","at":"lead","content":[
	     {"type":"prose","text":"lead body"}
	   ]}]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	// Scoped to the ASIDE — both labels also appear in the page body (the
	// band's own label div, the rendered section heading), so an unscoped
	// index comparison would pass even with the TOC wiring fully disabled.
	aside := asideOf(t, page)
	if aside == "" {
		t.Fatalf("no aside on the page:\n%s", page)
	}
	iBand := strings.Index(aside, ">LEAD BAND<")
	iSection := strings.Index(aside, ">First Section<")
	if iBand < 0 || iSection < 0 {
		t.Fatalf("TOC entries missing (band=%d, section=%d):\n%s", iBand, iSection, aside)
	}
	if iBand > iSection {
		t.Errorf("lead band label (%d) must precede the section name (%d) in the TOC, matching document order", iBand, iSection)
	}
}

// TestTOCUnaffectedByBandOutsideReferenceLayout is the strangler proof for
// this fix: a layout mode other than "reference" never calls
// renderOnThisPage at all, so a band's presence must leave zero trace of an
// aside anywhere else.
func TestTOCUnaffectedByBandOutsideReferenceLayout(t *testing.T) {
	for _, mode := range []string{"", "no-nav", "top-nav", "hero"} {
		layoutField := ""
		if mode != "" {
			layoutField = `"layout":"` + mode + `",`
		}
		pages := publishDoc(t, `{
		 "title":"T","generated_date":"2026-09-01",`+layoutField+`
		 "groups":["G"],"root":{"summary":"s"},
		 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[
		   {"type":"band","label":"SHOULD NOT TOC","content":[{"type":"prose","text":"x"}]}
		 ]}]}`)
		page := pages["n.html"]
		if strings.Contains(page, "<aside class='otp'>") {
			t.Errorf("mode %q: band grew an aside outside the reference layout", mode)
		}
	}
}

// TestSectionsUnaffectedByContainers is the ADDITIVE guarantee (design §4):
// a doc using only sections[], with no container anywhere, renders
// byte-identical to how it always has — the TOC's step 2 (band labels)
// contributes nothing.
func TestSectionsUnaffectedByContainers(t *testing.T) {
	withoutBand := publishDoc(t, strings.Replace(refDocTemplate, "%s", `"layout":"reference",`, 1))
	page := withoutBand["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(withoutBand))
	}
	if strings.Contains(page, "class='band") {
		t.Errorf("a sections-only doc must carry zero band markup")
	}
}

// TestBandTitleFeedsTOCAndBareBandIsExcluded closes two more coverage gaps
// found by the same audit that caught the row-width and seam bugs: every
// prior TOC test used `label`, never the `title` fallback
// (firstNonEmpty(label,title) in collectTOCLabels), and no test proved a
// label-less/title-less band (design §2.4's "bare stack") is correctly
// left OUT of the aside rather than appearing as an empty entry.
func TestBandTitleFeedsTOCAndBareBandIsExcluded(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01","layout":"reference",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N",
	   "sections":[{"name":"A Section","summary":"a"}],
	   "blocks":[
	     {"type":"band","title":"TITLE ONLY","content":[{"type":"prose","text":"x"}]},
	     {"type":"band","content":[{"type":"prose","text":"bare stack, no label or title"}]}
	   ]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	aside := asideOf(t, page)
	if aside == "" {
		t.Fatalf("no aside on the page:\n%s", page)
	}
	if !strings.Contains(aside, ">TITLE ONLY<") {
		t.Errorf("band.title did not feed the TOC (only label is tested elsewhere); aside:\n%s", aside)
	}
	// The aside must have exactly two entries: "TITLE ONLY" and "A Section" —
	// the bare-stack band contributes nothing.
	entries := strings.Count(aside, "<li><a href=")
	if entries != 2 {
		t.Errorf("expected 2 TOC entries (band title + section), got %d; aside:\n%s", entries, aside)
	}
}

// TestGridMinFallsBackToAutoFill covers the `grid.min` path (design §2.3),
// which had zero test coverage — every prior test used `across`. Proves the
// `min` -> `minmax(Npx,1fr)` branch, not just its sibling.
func TestGridMinFallsBackToAutoFill(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[
	   {"type":"grid","min":220,"content":[
	     {"type":"prose","text":"cell"}
	   ]}
	 ]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	if strings.Contains(page, "std-doc-error") {
		t.Fatalf("render error:\n%s", page)
	}
	if !strings.Contains(page, "grid-template-columns:repeat(auto-fill,minmax(220px,1fr))") {
		t.Errorf("grid.min did not produce the auto-fill/minmax track; page:\n%s", page)
	}
	// And the bare default (neither min nor across) falls back to 280, per
	// the design's own worked default.
	pages2 := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[
	   {"type":"grid","content":[{"type":"prose","text":"cell"}]}
	 ]}]}`)
	page2 := pages2["n.html"]
	if !strings.Contains(page2, "grid-template-columns:repeat(auto-fill,minmax(280px,1fr))") {
		t.Errorf("grid default (no min, no across) did not fall back to 280px; page:\n%s", page2)
	}
}

// TestRowSeamHasCSS is a regression test: `seam` (design §2.2, "carried over
// from split's existing .split.seam idiom") was wired as a class on `row`
// but had NO backing CSS rule at all — the class was present in every
// rendered page that used it and did precisely nothing. Unlike split's
// hardcoded 2-column `.split-right` selector, row's version must work for
// N columns, so it targets every column but the first.
func TestRowSeamHasCSS(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[
	   {"type":"row","seam":true,"cols":[
	     {"type":"prose","text":"one"},
	     {"type":"prose","text":"two"},
	     {"type":"prose","text":"three"}
	   ]}
	 ]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	if !strings.Contains(page, "class='row seam'") {
		t.Fatalf("seam class missing from markup:\n%s", page)
	}
	if !strings.Contains(page, ".row.seam") {
		t.Errorf("seam class has no backing CSS rule — the class renders and does nothing")
	}
	if !strings.Contains(page, ".row.seam .row-col:not(:first-child)") {
		t.Errorf("seam CSS does not generalize to N columns (missing the :not(:first-child) divider rule)")
	}
}

// TestRowDefaultWidthScalesToColumnCount is a regression test for a real bug
// found while writing examples/layout-language: a `row` with no `w` field
// rendered `grid-template-columns:1fr` — ONE track — no matter how many
// columns were authored, collapsing every column but the first into the
// same track. The design's own grammar (§2.2) promises "default = equal
// 1fr tracks" (plural), so the default must scale with len(cols), not be a
// single hardcoded literal.
func TestRowDefaultWidthScalesToColumnCount(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[
	   {"type":"row","cols":[
	     {"type":"prose","text":"one"},
	     {"type":"prose","text":"two"},
	     {"type":"prose","text":"three"}
	   ]}
	 ]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	if !strings.Contains(page, "grid-template-columns:1fr 1fr 1fr;") {
		t.Errorf("default row width did not scale to 3 columns; page:\n%s", page)
	}
}

// TestDepthFourContainerCompositionReachesRenderAndCSS is design §6 Phase 7
// — the repo's self-testing-harness capability test — for the specific
// nesting the corpus was measured to actually need (design §1.5): a
// `band > row > grid > panel` tree, four levels deep, still renders every
// leaf AND every leaf's CSS reaches the page. A container only ever calls
// Registry.Render on its children, so nothing here is special-cased — this
// proves that claim at the deepest shape in the corpus rather than trusting
// it by induction from the depth-1/2 cases above.
func TestDepthFourContainerCompositionReachesRenderAndCSS(t *testing.T) {
	pages := publishDoc(t, `{
	 "title":"T","generated_date":"2026-09-01",
	 "groups":["G"],"root":{"summary":"s"},
	 "nodes":[{"slug":"n","group":"G","title":"N","blocks":[
	   {"type":"band","label":"OUTER BAND","content":[
	     {"type":"row","w":"1fr 1fr","cols":[
	       {"type":"grid","across":2,"content":[
	         {"type":"panel","lead":"Deep Panel","body":"four levels down"}
	       ]},
	       {"type":"prose","text":"sibling column"}
	     ]}
	   ]}
	 ]}]}`)
	page := pages["n.html"]
	if page == "" {
		t.Fatalf("no n.html in %v", keysOf(pages))
	}
	if strings.Contains(page, "std-doc-error") {
		t.Fatalf("render error at depth 4:\n%s", page)
	}
	// The leaf rendered.
	if !strings.Contains(page, "Deep Panel") || !strings.Contains(page, "four levels down") {
		t.Errorf("depth-4 panel content missing")
	}
	// Every level's own markup is present, confirming the actual nesting
	// (not e.g. the grid silently flattening into the row).
	for _, needle := range []string{"class='band'", "class='row'", "class='grid'", "class='panel"} {
		if !strings.Contains(page, needle) {
			t.Errorf("missing %s — depth-4 nesting did not render as authored", needle)
		}
	}
	// The leaf's CSS reached the page (design §5.1 Result 2's appearance-gating,
	// exercised at depth instead of depth-1).
	if !strings.Contains(page, ".panel{") {
		t.Errorf("panel CSS did not reach the page from four levels deep")
	}
}
