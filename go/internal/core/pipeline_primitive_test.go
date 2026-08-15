package core

import (
	"strings"
	"testing"
)

// TestPipelinePrimitive covers P1 #4: `pipeline` — cards joined by arrow
// connectors, with a done/active/pending state per stage. Static (no JS);
// distinct from the existing `action` primitive, which is a JS-driven runner
// simulator (acb-* classes) rather than a plain phase-strip.
func TestPipelinePrimitive(t *testing.T) {
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
				"type": "pipeline",
				"stages": [
					{"label": "Design", "state": "done"},
					{"label": "Build", "state": "active", "note": "in progress"},
					{"label": "Ship"}
				]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "class='pl-stage pl-done'") {
		t.Error("pipeline: expected the done-state class")
	}
	if !strings.Contains(h, "class='pl-stage pl-active'") {
		t.Error("pipeline: expected the active-state class")
	}
	if !strings.Contains(h, "class='pl-stage pl-pending'") {
		t.Error("pipeline: expected state to default to pending when absent")
	}
	if strings.Count(h, "class='pl-arrow'") != 2 {
		t.Errorf("pipeline: expected exactly 2 arrow connectors between 3 stages, got %d",
			strings.Count(h, "class='pl-arrow'"))
	}
	if !strings.Contains(h, "in progress") {
		t.Error("pipeline: expected the optional per-stage note to render")
	}
	for _, want := range []string{"Design", "Build", "Ship"} {
		if !strings.Contains(h, want) {
			t.Errorf("pipeline: expected label %q in output", want)
		}
	}
}
