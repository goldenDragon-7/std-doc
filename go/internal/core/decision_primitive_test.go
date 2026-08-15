package core

import (
	"strings"
	"testing"
)

// TestDecisionPrimitive covers P1 #7: `decision` — a static decision-record
// card (question/chosen answer/rationale/alternatives-considered). Distinct
// from the existing `ask` primitive, which renders a LIVE reader-facing
// feedback-widget question (data-cf-control input, radio/select/text) — this
// documents a decision already made, no reader interaction at all.
func TestDecisionPrimitive(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{
				"type": "decision",
				"question": "Which database?",
				"chosen": "Postgres",
				"rationale": "Already deployed fleet-wide.",
				"alternatives": [
					{"label": "SQLite", "reason": "no concurrent writers"},
					{"label": "MySQL"}
				]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	// No live reader-input control should ever appear on a decision card.
	if strings.Contains(h, "data-cf-control") {
		t.Error("decision: must NOT emit a live feedback-widget control (that's `ask`'s job)")
	}
	if !strings.Contains(h, "Which database?") || !strings.Contains(h, "Postgres") {
		t.Error("decision: expected question and chosen answer rendered")
	}
	if !strings.Contains(h, "Already deployed fleet-wide.") {
		t.Error("decision: expected rationale rendered")
	}
	if !strings.Contains(h, "SQLite") || !strings.Contains(h, "no concurrent writers") {
		t.Error("decision: expected an alternative + its reason rendered")
	}
	if !strings.Contains(h, "MySQL") {
		t.Error("decision: expected an alternative with no reason to still render its label")
	}
	if !strings.Contains(h, "class='dec-badge'") {
		t.Error("decision: expected the DECIDED badge")
	}
}
