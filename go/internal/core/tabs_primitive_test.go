package core

import (
	"strings"
	"testing"
)

// TestTabsPrimitive covers the new P1 `tabs` primitive (data-driven,
// templates.json + primitive_css.json — no Go RenderFunc, no private
// render.py): CSS-only (radio+label sibling trick) tab switching, so it needs
// no client JS. First tab pre-checked; each block's `id` field scopes the
// radio group name/ids so multiple tabs blocks on one page never collide.
func TestTabsPrimitive(t *testing.T) {
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
				"type": "tabs",
				"id": "demo",
				"tabs": [
					{"label": "Alpha", "content": [{"type": "prose", "text": "alpha body"}]},
					{"label": "Beta", "content": [{"type": "prose", "text": "beta body"}]}
				]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "id='tg-demo-0'") || !strings.Contains(h, "id='tg-demo-1'") {
		t.Error("tabs: expected two uniquely-scoped radio ids (tg-demo-0, tg-demo-1)")
	}
	if !strings.Contains(h, "name='tg-demo'") {
		t.Error("tabs: expected both radios sharing name='tg-demo' (one exclusive group)")
	}
	if strings.Count(h, "name='tg-demo'") != 2 {
		t.Errorf("tabs: expected exactly 2 radios in the group, got %d", strings.Count(h, "name='tg-demo'"))
	}
	if !strings.Contains(h, "id='tg-demo-0' checked") {
		t.Error("tabs: first tab must be pre-checked so the panel is visible with no JS")
	}
	if strings.Contains(h, "id='tg-demo-1' checked") {
		t.Error("tabs: only the first tab may be pre-checked")
	}
	if !strings.Contains(h, ">Alpha</label>") || !strings.Contains(h, ">Beta</label>") {
		t.Error("tabs: expected both tab labels rendered")
	}
	if !strings.Contains(h, "alpha body") || !strings.Contains(h, "beta body") {
		t.Error("tabs: expected both panels' composed content present (CSS hides inactive panels, HTML carries both)")
	}
	if !strings.Contains(h, "class='tabs-panel'") {
		t.Error("tabs: expected tabs-panel wrapper divs")
	}
}
