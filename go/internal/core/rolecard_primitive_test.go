package core

import (
	"strings"
	"testing"
)

// TestRolecardPrimitive covers P1 #5: `rolecard` — a color-bordered
// role/entity card with inline pills, distinct from the existing plain
// `namecard` (no accent, no pills). Accent uses the same palette_var
// mechanism `compare` already relies on for its per-instance accent color.
func TestRolecardPrimitive(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"glow": {"color": "#22d3ee"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{
				"type": "rolecard",
				"name": "Captain Codefactory",
				"role": "Orchestration",
				"accent": "glow",
				"summary": "Coordinates citizens across the fleet.",
				"pills": ["tmux", "hk", "postgres"]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "class='rolecard' style='--c:") {
		t.Error("rolecard: expected the --c accent custom property when accent is set")
	}
	if !strings.Contains(h, "Captain Codefactory") || !strings.Contains(h, "Orchestration") {
		t.Error("rolecard: expected name and role rendered")
	}
	if !strings.Contains(h, "Coordinates citizens across the fleet.") {
		t.Error("rolecard: expected summary rendered")
	}
	for _, pill := range []string{"tmux", "hk", "postgres"} {
		if !strings.Contains(h, "<span class='rc-pill'>"+pill+"</span>") {
			t.Errorf("rolecard: expected pill %q rendered", pill)
		}
	}

	// no accent -> no inline style attribute at all.
	doc2 := parseDoc(t, `{
		"title": "x",
		"nodes": [{"slug": "a", "title": "A", "blocks": [{"type": "rolecard", "name": "Someone"}]}]
	}`)
	buildTree(doc2)
	n2 := bySlug(doc2, "a")
	h2 := renderNode(n2, doc2, reg, "", lib)
	if strings.Contains(h2, "style='--c:") {
		t.Error("rolecard: no style attribute expected when accent is absent")
	}
	if strings.Contains(h2, "<div class='rc-pills'>") {
		t.Error("rolecard: no pills wrapper expected when pills is absent")
	}
}
