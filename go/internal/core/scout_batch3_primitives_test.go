package core

import (
	"strings"
	"testing"
)

// TestScoutBatch3Primitives covers the scout's remaining batch-3/4
// candidates from the primitive-candidate scout notes: `finding` (the scout's own
// "single highest-value candidate in the whole scout" — the atomic unit of
// every Dialect-A detective report: id + severity + headline + where +
// evidence, currently only expressible via the wrong-shaped `tree`
// primitive), `enrich-steps` (a dense micro-grid of numbered steps, distinct
// from `flow`'s connected linear sequence — confirmed by inspecting flow's
// template, which is hardcoded to an arrow/dot connector chain with no grid
// option), `pattern-header` (a bordered section-level header — confirmed
// distinct from `hero`, which is a bare text+sub pair with no border/eyebrow
// framing at all), and `timeline-infographic` (a vertical alternating-side
// numbered walk — built WITHOUT auto-alternation since the template
// interpreter has no modulo/parity op, matching the scout's own documented
// fallback: an explicit author-set `kind` field colors each step instead of
// nth-child(even) magic).
func TestScoutBatch3Primitives(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"high": {"color": "#ef4444"}, "med": {"color": "#f59e0b"}, "glow": {"color": "#22d3ee"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{"type": "finding", "id": "F1", "severity": "high",
				 "headline": "FIXER COMPOSITION BUG — load-bearing architectural flaw",
				 "where": "lib/base.py:149", "evidence": "MEASURED. Root cause confirmed."},
				{"type": "enrich-steps", "steps": [
					{"num": "STEP 1", "name": "Parse", "desc": "Tokenize the raw input."},
					{"num": "STEP 2", "name": "Render"}
				]},
				{"type": "pattern-header", "era": "Rebuild Era · 2026", "title": "The Seven Planes",
				 "desc": "How the kingdom's architecture divides into seven planes."},
				{"type": "timeline-infographic", "steps": [
					{"num": 1, "title": "Client Sends Request", "desc": "Picks a transport.",
					 "icons": ["🐍", "🐹"], "timing": "~1ms", "kind": "glow"},
					{"num": 2, "title": "Router Validates"}
				]}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	// finding
	if !strings.Contains(h, "class='finding'") || !strings.Contains(h, "class='finding-id'") {
		t.Error("finding: expected the box + id chip rendered")
	}
	if !strings.Contains(h, ">F1</span>") || !strings.Contains(h, "FIXER COMPOSITION BUG") {
		t.Error("finding: expected id + headline rendered")
	}
	if !strings.Contains(h, "class='finding-where'") || !strings.Contains(h, "lib/base.py:149") {
		t.Error("finding: expected the where sub-line rendered")
	}
	if !strings.Contains(h, "class='finding-evidence'") || !strings.Contains(h, "MEASURED. Root cause confirmed.") {
		t.Error("finding: expected the evidence sub-block rendered")
	}

	// enrich-steps
	if !strings.Contains(h, "class='enrich-steps'") || !strings.Contains(h, "class='enrich-step'") {
		t.Error("enrich-steps: expected the grid + step card rendered")
	}
	if !strings.Contains(h, "STEP 1") || !strings.Contains(h, "Tokenize the raw input.") {
		t.Error("enrich-steps: expected num + desc rendered")
	}

	// pattern-header
	if !strings.Contains(h, "class='pattern-header'") || !strings.Contains(h, "class='era'") {
		t.Error("pattern-header: expected the box + era eyebrow rendered")
	}
	if !strings.Contains(h, "<h2>The Seven Planes</h2>") {
		t.Error("pattern-header: expected the h2 title rendered")
	}

	// timeline-infographic
	if !strings.Contains(h, "class='tl-infographic'") || !strings.Contains(h, "class='tl-step'") {
		t.Error("timeline-infographic: expected the wrapper + step rendered")
	}
	if !strings.Contains(h, "Client Sends Request") || !strings.Contains(h, "~1ms") {
		t.Error("timeline-infographic: expected title + timing rendered")
	}
	if !strings.Contains(h, "🐍") || !strings.Contains(h, "🐹") {
		t.Error("timeline-infographic: expected both icons rendered")
	}
	if !strings.Contains(h, "style='--c:var(--ent-glow)'") {
		t.Error("timeline-infographic: expected the author-set kind to accent the step (no auto-alternation)")
	}
}

// TestScoutBatch3Primitives_EmptyDegradesToNothing proves each new
// primitive degrades to empty chrome on empty collections.
func TestScoutBatch3Primitives_EmptyDegradesToNothing(t *testing.T) {
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
				{"type": "finding", "id": "F1", "severity": "high", "headline": "x"},
				{"type": "enrich-steps", "steps": []},
				{"type": "timeline-infographic", "steps": []}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if strings.Contains(h, "class='finding-where'") {
		t.Error("finding: absent where must not emit a finding-where div")
	}
	if strings.Contains(h, "class='finding-evidence'") {
		t.Error("finding: absent evidence must not emit a finding-evidence div")
	}
	if strings.Contains(h, "class='enrich-step'") {
		t.Error("enrich-steps: empty steps[] must not emit a step card")
	}
	if strings.Contains(h, "class='tl-step'") {
		t.Error("timeline-infographic: empty steps[] must not emit a step")
	}
}
