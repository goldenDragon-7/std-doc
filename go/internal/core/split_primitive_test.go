package core

import (
	"strings"
	"testing"
)

// TestSplitPrimitive covers P1 #2: `split` — two columns of ARBITRARY composed
// content (unlike `compare`, which is fixed to a good/bad item-list layout),
// with an optional seam gutter divider (`seam:true`).
func TestSplitPrimitive(t *testing.T) {
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
				"type": "split",
				"seam": true,
				"left": {"content": [{"type": "prose", "text": "left side"}]},
				"right": {"content": [{"type": "prose", "text": "right side"}]}
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "class='split seam'") {
		t.Error("split: expected the seam modifier class when seam:true")
	}
	if !strings.Contains(h, "left side") || !strings.Contains(h, "right side") {
		t.Error("split: expected both columns' composed content present")
	}
	if !strings.Contains(h, "class='split-col split-left'") || !strings.Contains(h, "class='split-col split-right'") {
		t.Error("split: expected both column wrapper divs")
	}

	// seam absent -> no modifier class.
	doc2 := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{
				"type": "split",
				"left": {"content": [{"type": "prose", "text": "l"}]},
				"right": {"content": [{"type": "prose", "text": "r"}]}
			}]
		}]
	}`)
	buildTree(doc2)
	n2 := bySlug(doc2, "a")
	h2 := renderNode(n2, doc2, reg, "", lib)
	if strings.Contains(h2, "class='split seam'") {
		t.Error("split: seam class must NOT appear when seam is absent")
	}
	if !strings.Contains(h2, "class='split'") {
		t.Error("split: expected the bare split class when seam is absent")
	}
}
