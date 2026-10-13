package core

import (
	"strings"
	"testing"
)

// TestScoutBatch1Primitives covers the first batch of data-only primitives
// mined by stddoc-primitive-scout from the pre-std-doc HTML corpus
// (the primitive-candidate scout notes): stats-bar (30 docs), legend (14),
// table-list (3, unblocks schema-grid), schema-grid (4), phase-strip (5+),
// verdict-box (8), disclosure (survey-flagged gap), tag (11, temperature
// stamps — a lighter inline sibling of chip). All pure data templates in
// templates.json/primitive_css.json — no Go render code, per the project conventions
// "add a primitive, never a private renderer."
func TestScoutBatch1Primitives(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"bad": {"color": "#ef4444"}, "good": {"color": "#22c55e"}, "hot": {"color": "#f97316"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{"type": "stats-bar", "stats": [
					{"value": "47", "label": "Findings"},
					{"value": "12", "label": "Critical", "kind": "bad"}
				]},
				{"type": "legend", "items": [
					{"kind": "bad", "label": "01 Personality"},
					{"kind": "good", "label": "02 Harnesses"}
				]},
				{"type": "table-list", "items": [
					{"name": "chart_of_accounts", "note": "~60 GL codes"}
				]},
				{"type": "schema-grid", "boxes": [
					{"name": "meta", "kind": "hot", "desc": "Reference data.",
					 "tables": [{"name": "entities", "note": "personal, business"}]}
				]},
				{"type": "phase-strip", "phases": [
					{"num": "Phase 0", "name": "Pre-flight", "desc": "Drain the backlog.",
					 "effort": "3-5 shifts", "kind": "bad"}
				]},
				{"type": "verdict-box", "label": "Plane verdict", "verdict": "appropriate_but_chaotic",
				 "kind": "good", "text": "The canon WORKS. See [notes](https://example.com/n)."},
				{"type": "disclosure", "summary": "Full stack trace", "open": false,
				 "content": [{"type": "prose", "text": "deep detail"}]},
				{"type": "tag", "kind": "hot", "label": "hot"}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	// stats-bar
	if !strings.Contains(h, "class='stats-bar'") || !strings.Contains(h, "class='stat-val'") {
		t.Error("stats-bar: expected bar + stat-val rendered")
	}
	if !strings.Contains(h, ">47</div>") || !strings.Contains(h, "Findings") {
		t.Error("stats-bar: expected value+label rendered")
	}

	// legend
	if !strings.Contains(h, "class='legend'") || !strings.Contains(h, "class='swatch'") {
		t.Error("legend: expected legend row + swatch rendered")
	}
	if !strings.Contains(h, "01 Personality") {
		t.Error("legend: expected item label rendered")
	}

	// table-list
	if !strings.Contains(h, "class='table-list'") || !strings.Contains(h, "chart_of_accounts") {
		t.Error("table-list: expected list + name rendered")
	}

	// schema-grid
	if !strings.Contains(h, "class='schema-grid'") || !strings.Contains(h, "class='schema-box'") {
		t.Error("schema-grid: expected grid + box rendered")
	}
	if !strings.Contains(h, "Reference data.") || !strings.Contains(h, "entities") {
		t.Error("schema-grid: expected desc + nested table-list rendered")
	}

	// phase-strip
	if !strings.Contains(h, "class='phase-strip'") || !strings.Contains(h, "class='phase'") {
		t.Error("phase-strip: expected strip + phase card rendered")
	}
	if !strings.Contains(h, "Pre-flight") || !strings.Contains(h, "3-5 shifts") {
		t.Error("phase-strip: expected name + effort rendered")
	}

	// verdict-box
	if !strings.Contains(h, "class='verdict-box'") || !strings.Contains(h, "appropriate_but_chaotic") {
		t.Error("verdict-box: expected box + verdict text rendered")
	}
	if !strings.Contains(h, `<a href="https://example.com/n">notes</a>`) {
		t.Error("verdict-box: expected text field to flow through rich (markdown link)")
	}

	// disclosure
	if !strings.Contains(h, "<details>") || !strings.Contains(h, "<summary>Full stack trace</summary>") {
		t.Error("disclosure: expected native details/summary, closed by default")
	}
	if !strings.Contains(h, "deep detail") {
		t.Error("disclosure: expected composed content rendered inside the body")
	}

	// tag
	if !strings.Contains(h, "class='tag'") || !strings.Contains(h, ">hot</span>") {
		t.Error("tag: expected bare inline colored tag rendered")
	}
}

// TestScoutBatch1Primitives_EmptyDegradesToNothing proves each new primitive
// degrades to structurally-empty chrome (no data leaks a stray label/heading)
// when given empty collections — the "empty input emits nothing, not chrome"
// half of the definition-of-done.
func TestScoutBatch1Primitives_EmptyDegradesToNothing(t *testing.T) {
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
				{"type": "stats-bar", "stats": []},
				{"type": "legend", "items": []},
				{"type": "table-list", "items": []},
				{"type": "schema-grid", "boxes": []},
				{"type": "phase-strip", "phases": []},
				{"type": "disclosure", "summary": "x", "content": []}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	// The wrapper shells still render (they're the block itself), but none of
	// them should emit a stray per-item element — the each loops over empty.
	if strings.Contains(h, "class='stat'") {
		t.Error("stats-bar: empty stats[] must not emit a .stat tile")
	}
	if strings.Contains(h, "class='swatch'") {
		t.Error("legend: empty items[] must not emit a .swatch")
	}
	if !strings.Contains(h, "<ul class='table-list'></ul>") {
		t.Error("table-list: empty items[] must render an empty list, no <li>")
	}
	if strings.Contains(h, "class='schema-box'") {
		t.Error("schema-grid: empty boxes[] must not emit a .schema-box")
	}
	if strings.Contains(h, "class='phase'>") {
		t.Error("phase-strip: empty phases[] must not emit a .phase card")
	}
}
