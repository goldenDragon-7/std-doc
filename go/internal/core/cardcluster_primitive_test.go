package core

import (
	"strings"
	"testing"
)

// TestCardclusterPrimitive covers P1 #6: `cardcluster` — grouped card-grid
// (cluster header + cards), distinct from the existing flat `cardgrid` (no
// grouping/header). Self-contained CSS (.cc-*), not coupled to cardgrid's
// nested `.cardgrid .ent-card` selectors.
func TestCardclusterPrimitive(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"amber": {"color": "#f59e0b"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{
				"type": "cardcluster",
				"groups": [
					{"label": "Core", "cards": [
						{"title": "Gateway", "body": "MCP entrypoint", "ent": "amber"},
						{"title": "Doctor", "body": "health probes"}
					]},
					{"label": "Support", "cards": [{"title": "Beam", "body": "file transport"}]}
				]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	for _, want := range []string{"Core", "Support", "Gateway", "MCP entrypoint", "Doctor", "Beam"} {
		if !strings.Contains(h, want) {
			t.Errorf("cardcluster: expected %q in output", want)
		}
	}
	if strings.Count(h, "class='cc-group'") != 2 {
		t.Errorf("cardcluster: expected 2 group wrappers, got %d", strings.Count(h, "class='cc-group'"))
	}
	if strings.Count(h, "class='cc-card") != 3 {
		t.Errorf("cardcluster: expected 3 cards across both groups, got %d", strings.Count(h, "class='cc-card"))
	}
	if !strings.Contains(h, "class='cc-card accent' style='--c:") {
		t.Error("cardcluster: expected accent class + --c custom property when a card declares ent")
	}
}
