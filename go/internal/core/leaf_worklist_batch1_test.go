package core

import (
	"strings"
	"testing"
)

// TestLeafWorklistBatch1 covers the first three real gaps from
// the leaf-gap worklist (stddoc-html-first-strategist's
// independently-measured, document-frequency-ranked corpus sweep, corpus
// deduplicated to 73 content-unique files): `quote` (8 docs), `kv` (6 docs),
// `synthesis-note` (10 docs). All three are pure data templates, none used on
// any golden-pinned page yet, so their CSS is added normally (no inline-style
// workaround needed — that trap only applies to EXISTING primitives already
// on a conformance fixture).
//
// Three other worklist entries turned out to be name-mismatches, not real
// gaps (documented in protocol/primitives.md, not built here): `pill-lane`
// is literally `class="pill pill-lane"` in the corpus — an existing `pill`
// usage, not a new shape; `comment`/`keyword` are code-syntax-highlighting
// span classes already covered by the `code` primitive's `t-comment`/
// `t-keyword` spans under different names; `phase` is the inner card class
// of `.phase-strip`, already built this shift as the `phase-strip` primitive.
func TestLeafWorklistBatch1(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{"type": "quote", "text": "The kingdom CAN do everything it needs.",
				 "who": "the detective headline"},
				{"type": "kv", "rows": [
					{"k": "Engine", "v": "Plain `+"`str.replace`"+` for `+"`{{ placeholder }}`"+`"},
					{"k": "Renderer", "v": "src/codefactory/templates/__init__.py"}
				]},
				{"type": "synthesis-note", "text": "Predecessor made 32 tool calls. Killed at write step."}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	// quote
	if !strings.Contains(h, "class='quote'") || !strings.Contains(h, "The kingdom CAN do everything") {
		t.Error("quote: expected the quote box + text rendered")
	}
	if !strings.Contains(h, "class='who'") || !strings.Contains(h, "the detective headline") {
		t.Error("quote: expected the who attribution rendered")
	}

	// kv
	if !strings.Contains(h, "class='kv'") || !strings.Contains(h, "class='k'") || !strings.Contains(h, "class='v'") {
		t.Error("kv: expected the row + key + value classes rendered")
	}
	if !strings.Contains(h, "Engine") || !strings.Contains(h, "Renderer") {
		t.Error("kv: expected both rows' keys rendered")
	}
	if !strings.Contains(h, "<code>str.replace</code>") || !strings.Contains(h, "<code>{{ placeholder }}</code>") {
		t.Error("kv: expected the value field's backtick spans to render as <code> (richcode)")
	}

	// synthesis-note
	if !strings.Contains(h, "class='synthesis-note'") {
		t.Error("synthesis-note: expected the box rendered")
	}
	if !strings.Contains(h, "<strong>Synthesis note:</strong>") {
		t.Error("synthesis-note: expected the default bold label rendered")
	}
	if !strings.Contains(h, "Predecessor made 32 tool calls.") {
		t.Error("synthesis-note: expected the body text rendered")
	}
}

// TestLeafWorklistBatch1_EmptyDegradesToNothing proves each primitive
// degrades sanely on minimal/absent optional fields.
func TestLeafWorklistBatch1_EmptyDegradesToNothing(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{"type": "quote", "text": "No attribution here."},
				{"type": "kv", "rows": []},
				{"type": "synthesis-note", "text": "No custom label."}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if strings.Contains(h, "class='who'") {
		t.Error("quote: absent who must not emit a .who span")
	}
	if strings.Contains(h, "class='k'") {
		t.Error("kv: empty rows[] must not emit any row")
	}
	if !strings.Contains(h, "<strong>Synthesis note:</strong>") {
		t.Error("synthesis-note: an empty label must fall back to the default bold lead-in")
	}
}
