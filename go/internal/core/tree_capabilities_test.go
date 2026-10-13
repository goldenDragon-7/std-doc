package core

// tree_capabilities_test.go — executable proof for the three additive tree
// capabilities (collapse/expand, open vocabulary, leaf links) AND for the
// promise that guards them: a tree that asks for none of them emits exactly the
// bytes it emitted before they existed.
//
// The page-level strangler proof lives in the conformance gate; this file is
// the primitive-level one, so a regression names the offending feature instead
// of just reporting "golden differs".

import (
	"strings"
	"testing"

	"stddoc/internal/palette"
	"stddoc/internal/wire"
)

// renderTree builds a real registry + ctx and renders one `tree` block given as
// JSON, exactly as a page would.
func renderTree(t *testing.T, blockJSON string) string {
	t.Helper()
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	block, err := wire.ParseOrderedJSON([]byte(blockJSON))
	if err != nil {
		t.Fatalf("parse block: %v", err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := reg.Render("tree", block, ctx)
	if err != nil {
		t.Fatalf("render tree: %v", err)
	}
	return out
}

// treeVariantFor renders the variant CSS a block would contribute.
func treeVariantFor(t *testing.T, blockJSON string) string {
	t.Helper()
	block, err := wire.ParseOrderedJSON([]byte(blockJSON))
	if err != nil {
		t.Fatalf("parse block: %v", err)
	}
	return treeVariantCSS(block)
}

// TestTreeLegacyBytesUnchanged is the strangler proof at the primitive level:
// the pre-capability field set must still produce the pre-capability bytes,
// pinned literally rather than recomputed.
func TestTreeLegacyBytesUnchanged(t *testing.T) {
	got := renderTree(t, `{
		"type":"tree","label":"Cascade","legend":true,
		"nodes":[{"label":"engine","decision":"keep","sublabel":"stdlib",
		          "note":"holds","children":[{"label":"pager","decision":"refactor"}]}]
	}`)
	want := "<div class='tree-wrap'>" +
		"<div class='tree-cap'>Cascade</div>" +
		"<div class='tree-legend'>" +
		"<span class='tl-item td-keep'><span class='tl-dot'></span>KEEP</span>" +
		"<span class='tl-item td-refactor'><span class='tl-dot'></span>REFACTOR</span>" +
		"<span class='tl-item td-rewrite'><span class='tl-dot'></span>REWRITE</span>" +
		"<span class='tl-item td-trash'><span class='tl-dot'></span>TRASH</span>" +
		"</div>" +
		"<ul class='tree'>" +
		"<li class='tnode td-keep'><div class='tn-row'>" +
		"<span class='tn-label'>engine</span>" +
		"<span class='tn-dec'>KEEP</span>" +
		"<span class='tn-sub'>stdlib</span></div>" +
		"<div class='tn-note'>holds</div>" +
		"<ul class='tree-children'>" +
		"<li class='tnode td-refactor'><div class='tn-row'>" +
		"<span class='tn-label'>pager</span>" +
		"<span class='tn-dec'>REFACTOR</span></div></li>" +
		"</ul></li></ul></div>"
	if got != want {
		t.Fatalf("legacy tree bytes drifted.\n got: %s\nwant: %s", got, want)
	}
}

// TestTreeLegacyContributesNoVariantCSS proves the variant channel is silent
// for a tree that opts into nothing — the mechanism that keeps every existing
// page byte-identical.
func TestTreeLegacyContributesNoVariantCSS(t *testing.T) {
	css := treeVariantFor(t, `{"type":"tree","nodes":[{"label":"a","decision":"keep"}]}`)
	if css != "" {
		t.Fatalf("legacy tree contributed variant CSS (breaks strangler proof): %q", css)
	}
}

// TestTreeCollapsible proves capability 1: nodes WITH children fold; leaves do
// not, and the collapse affordance's CSS ships with them.
func TestTreeCollapsible(t *testing.T) {
	block := `{
		"type":"tree","collapsible":true,"legend":false,
		"nodes":[{"label":"root","decision":"keep","open":true,
		          "children":[{"label":"leaf","decision":"trash"}]}]
	}`
	got := renderTree(t, block)
	if !strings.Contains(got, "<details class='tn-det' open><summary class='tn-row'>") {
		t.Errorf("parent node did not fold (or lost its open state): %s", got)
	}
	if !strings.Contains(got, "</summary>") || !strings.Contains(got, "</details>") {
		t.Errorf("unbalanced details markup: %s", got)
	}
	// A childless node must stay a plain row — folding nothing is a dead control.
	if strings.Count(got, "<details") != 1 {
		t.Errorf("expected exactly one <details> (leaf must not fold): %s", got)
	}
	if !strings.Contains(got, "<li class='tnode td-trash'><div class='tn-row'>") {
		t.Errorf("leaf should render as a div row, not a summary: %s", got)
	}
	if css := treeVariantFor(t, block); !strings.Contains(css, ".tn-det[open]>summary::after") {
		t.Errorf("collapsible tree did not ship its affordance CSS: %q", css)
	}
}

// TestTreeCollapsibleOffByDefault proves the capability is opt-in.
func TestTreeCollapsibleOffByDefault(t *testing.T) {
	got := renderTree(t, `{"type":"tree","legend":false,
		"nodes":[{"label":"r","children":[{"label":"c"}]}]}`)
	if strings.Contains(got, "<details") {
		t.Fatalf("tree folded without collapsible:true: %s", got)
	}
}

// TestTreeOpenVocabulary proves capability 2: a declared vocabulary replaces the
// built-in four, drives the legend, and carries its own colors.
func TestTreeOpenVocabulary(t *testing.T) {
	got := renderTree(t, `{
		"type":"tree",
		"decisions":[{"key":"owned","label":"OWNED","color":"#3fb950"},
		             {"key":"orphan"}],
		"nodes":[{"label":"svc","decision":"owned"},{"label":"old","decision":"orphan"}]
	}`)
	if strings.Contains(got, "KEEP") || strings.Contains(got, "TRASH") {
		t.Errorf("built-in vocabulary leaked into a doc that declared its own: %s", got)
	}
	if !strings.Contains(got, "<span class='tl-item td-owned' style='--dc:#3fb950'>") {
		t.Errorf("declared color not applied to legend: %s", got)
	}
	if !strings.Contains(got, "<li class='tnode td-owned' style='--dc:#3fb950'>") {
		t.Errorf("declared color not applied to node: %s", got)
	}
	// A declared key with no explicit label falls back to its uppercased key.
	if !strings.Contains(got, "<span class='tn-dec'>ORPHAN</span>") {
		t.Errorf("label fallback missing: %s", got)
	}
}

// TestTreeUndeclaredDecisionStillRenders is the silent-drop fix: before, an
// unrecognized decision rendered as NOTHING — authored content discarded with
// no error. It must now surface.
func TestTreeUndeclaredDecisionStillRenders(t *testing.T) {
	got := renderTree(t, `{"type":"tree","legend":false,
		"nodes":[{"label":"x","decision":"deprecate"}]}`)
	if !strings.Contains(got, "<span class='tn-dec'>DEPRECATE</span>") {
		t.Fatalf("undeclared decision silently dropped: %s", got)
	}
	if !strings.Contains(got, "class='tnode td-deprecate'") {
		t.Errorf("undeclared decision lost its class hook: %s", got)
	}
}

// TestTreeUnclassifiedDoesNotInheritParentColor is a PIXEL-FOUND regression:
// --dc cascades, so an undeclared decision nested under a colored parent wore
// that parent's color and the page asserted a verdict the data never made.
// Unclassified must read neutral.
func TestTreeUnclassifiedDoesNotInheritParentColor(t *testing.T) {
	got := renderTree(t, `{
		"type":"tree","legend":false,
		"decisions":[{"key":"shared","label":"SHARED","color":"#58a6ff"}],
		"nodes":[{"label":"parent","decision":"shared",
		          "children":[{"label":"stray","decision":"deprecate"}]}]
	}`)
	if !strings.Contains(got, "<li class='tnode td-deprecate' style='--dc:initial'>") {
		t.Fatalf("unclassified node did not neutralize inherited color: %s", got)
	}
	// The declared parent keeps its own color.
	if !strings.Contains(got, "<li class='tnode td-shared' style='--dc:#58a6ff'>") {
		t.Errorf("declared parent lost its color: %s", got)
	}
}

// TestTreeDefaultVocabularyKeepsStylesheetColors guards the fix's blast radius:
// the built-in four are DECLARED, so they must still take their color from the
// stylesheet and emit no style attribute at all.
func TestTreeDefaultVocabularyKeepsStylesheetColors(t *testing.T) {
	got := renderTree(t, `{"type":"tree","legend":false,
		"nodes":[{"label":"a","decision":"keep"}]}`)
	if strings.Contains(got, "style='--dc") {
		t.Fatalf("built-in vocabulary should carry no inline color: %s", got)
	}
}

// TestTreeLeafLinks proves capability 3.
func TestTreeLeafLinks(t *testing.T) {
	block := `{"type":"tree","legend":false,
		"nodes":[{"label":"atlas","href":"cascade.html","decision":"keep"},
		         {"label":"plain"}]}`
	got := renderTree(t, block)
	if !strings.Contains(got, "<span class='tn-label'><a href='cascade.html'>atlas</a></span>") {
		t.Errorf("href not rendered as a link: %s", got)
	}
	if !strings.Contains(got, "<span class='tn-label'>plain</span>") {
		t.Errorf("link-less node should be unchanged: %s", got)
	}
	if css := treeVariantFor(t, block); !strings.Contains(css, ".tn-label a{") {
		t.Errorf("linked tree did not ship link CSS: %q", css)
	}
}

// TestTreeNestedHrefTriggersCSS proves the link CSS follows a link found at
// ANY depth, not just the top level.
func TestTreeNestedHrefTriggersCSS(t *testing.T) {
	css := treeVariantFor(t, `{"type":"tree","nodes":[
		{"label":"r","children":[{"label":"deep","href":"x.html"}]}]}`)
	if !strings.Contains(css, ".tn-label a{") {
		t.Fatalf("nested link did not pull its CSS: %q", css)
	}
}

// TestTreeAuthorValuesCannotEscapeAttributes proves author-supplied keys and
// colors are sanitized — they land in class and style attributes.
func TestTreeAuthorValuesCannotEscapeAttributes(t *testing.T) {
	got := renderTree(t, `{
		"type":"tree","legend":false,
		"decisions":[{"key":"bad key'x","label":"B","color":"red;}body{display:none"}],
		"nodes":[{"label":"n","decision":"bad key'x","href":"a'b.html"}]
	}`)
	if strings.Contains(got, "display:none") {
		t.Errorf("hostile color reached the style attribute: %s", got)
	}
	if strings.Contains(got, "class='tnode td-bad key'x'") {
		t.Errorf("hostile key broke out of the class attribute: %s", got)
	}
	if !strings.Contains(got, "td-badkeyx") {
		t.Errorf("key should be slugged, not dropped: %s", got)
	}
	if strings.Contains(got, "href='a'b.html'") {
		t.Errorf("href not escaped: %s", got)
	}
}
