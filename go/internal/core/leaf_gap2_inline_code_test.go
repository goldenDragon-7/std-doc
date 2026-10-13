package core

import (
	"strings"
	"testing"
)

// TestRichCodeInlineOp covers leaf gap #2 (the template GAPS worklist,
// stddoc-template-scout): "backticks in prose render as literal characters;
// there is no <code> anywhere in the render path" — filed as the single
// highest-value fix for the Domain/System Reference template family, whose
// prose is mostly file:line and symbol citations threaded inline.
//
// This ships as a NEW interpreter op, `richcode`, deliberately SEPARATE from
// the existing `rich` op rather than an extension of it: this repo's own
// self-doc corpus (conformance/cases/self-doc, self-doc/source.json) already
// has pinned-golden prose containing literal backticks (`` `type` ``,
// `` `stddoc publish` ``, …) written before this feature existed. Wiring
// code-span parsing into the shared richInline/richText path (MEASURED, first
// attempt) flipped 11 self-doc/m2-extends pages' bytes. `richcode` is opt-in
// per template field, so every existing `rich`/`esc` field — and the
// self-doc/m2-extends goldens — stay untouched.
//
// `finding.where`/`finding.evidence` (this shift's own new primitive) are the
// first consumers, since file:line citations are exactly the shape gap #2
// names.
func TestRichCodeInlineOp(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"high": {"color": "#ef4444"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{"type": "finding", "id": "F1", "severity": "high", "headline": "x",
				 "where": "the block's `+"`type`"+` field selects the handler in `+"`lib/base.py:149`"+`",
				 "evidence": "See `+"`Pipeline/IQLayer.swift:51`"+` for the trace."}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "<code>type</code>") {
		t.Error("richcode: expected a backtick span in `where` to become a <code> chip")
	}
	if !strings.Contains(h, "<code>lib/base.py:149</code>") {
		t.Error("richcode: expected a second backtick span in the same field to also render")
	}
	if !strings.Contains(h, "<code>Pipeline/IQLayer.swift:51</code>") {
		t.Error("richcode: expected `evidence` (a separate richcode field) to also get code-span support")
	}
	// The surrounding prose must still be escaped normally, not swallowed.
	if !strings.Contains(h, "the block&#x27;s") && !strings.Contains(h, "the block's") {
		t.Error("richcode: expected the prose OUTSIDE the backtick spans to render untouched")
	}
}

// TestRichCodeInlineOp_LinksStillWork proves richcode is a superset of rich
// (markdown links keep working alongside code spans in the same field).
func TestRichCodeInlineOp_LinksStillWork(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"high": {"color": "#ef4444"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{"type": "finding", "id": "F1", "severity": "high", "headline": "x",
				"evidence": "See `+"`the.patch`"+` and [the tracker](https://example.com/t) for detail."}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "<code>the.patch</code>") {
		t.Error("richcode: expected the code span to render")
	}
	if !strings.Contains(h, `<a href="https://example.com/t">the tracker</a>`) {
		t.Error("richcode: expected the markdown link to ALSO render — richcode is a superset of rich, not a replacement")
	}
}

// TestRichFieldsRenderBackticksAsCode encodes the CURRENT contract, which is
// the REVERSE of what this test asserted before 2026-09-02.
//
// HISTORY — do not re-derive it, and do not silently flip it back:
//
// This test was originally TestRichCodeInlineOp_ExistingRichFieldsUntouched,
// and it asserted the OPPOSITE: that the `rich` op must leave a literal
// backtick as plain text. That was a deliberate, well-reasoned design choice.
// Wiring inline code into `rich` collided with committed goldens, so the
// builder shipped `richcode` as a separate OPT-IN op instead and left this
// guard to stop anyone undoing it by accident. That reasoning was sound on the
// information available.
//
// It was superseded on 2026-09-02, on measured evidence, on three grounds:
//   - the change is REVERSIBLE — one revert restores literal backticks;
//   - the blast radius is a doc's own rendering, not stored data;
//   - the status quo was itself the defect. std-doc's own self-documentation
//     shipped RAW BACKTICK CHARACTERS to readers ("The block's `type` selects
//     exactly this handler"), because a human who types a backtick in prose
//     MEANS a code chip. An opt-in nobody reaches for while the default emits
//     broken output is not a safer default, only a quieter one.
//
// The re-baseline was verified line by line before landing, NOT waved through:
// 8 golden pages, 14 code chips, literal backticks 28 -> 0, and every single
// changed line accounted for. `richcode` remains available for anything the
// automatic path gets wrong.
//
// So: `rich` now renders backticks as code. If you are here because this test
// failed, the question is not "do the goldens match" — it is "did I mean every
// line of this diff."
func TestRichFieldsRenderBackticksAsCode(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"info": {"color": "#60a5fa"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{"type": "callout", "kind": "info", "body": "the block's `+"`type`"+` field"}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "<code style=") {
		t.Error("rich (callout's op): a backticked span must render as an inline <code> chip — the 2026-09-02 ruling made this the default")
	}
	if !strings.Contains(h, ">type</code>") {
		t.Error("rich (callout's op): expected the backticked content to become the chip's text")
	}
	if strings.Contains(h, "`type`") {
		t.Error("rich (callout's op): literal backtick characters must NOT reach the reader — that was the defect this ruling fixed")
	}
}
