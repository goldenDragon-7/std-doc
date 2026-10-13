package core

import (
	"strings"
	"testing"
)

// TestPanelKind covers leaf gap #6 (the template GAPS worklist,
// stddoc-template-scout): "panel has no palette-referenced kind (temperature)
// parameter." Dialect B's 9-variant panel (warn/bad/good/info/hot/warm/cold/
// frozen/evol) is load-bearing in every Dialect B corpus doc; std-doc's panel
// only had `variant` (a free CSS-class-suffix string, NOT palette-validated)
// + lead + body. Two independent strategists hit this same seam
// (panel.frozen) from opposite directions on the same afternoon.
//
// The fix is deliberately CSS-free: panel is already used on golden-pinned
// pages (self-doc, m2-extends), and CSS is registered per-TYPE, statically,
// with no per-instance mechanism — so any growth to primitive_css.json's
// "panel" entry breaks those pages' bytes regardless of whether the new
// `kind` field is ever used on them (MEASURED: it did, on the first attempt,
// before this fix moved the accent to a pure inline `style=` attribute).
func TestPanelKind(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"frozen": {"color": "#a78bfa"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{"type": "panel", "kind": "frozen", "lead": "01 Personality", "body": "Frozen at LOAD_BEARING."},
				{"type": "panel", "lead": "No kind", "body": "Plain panel, no temperature."}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "--c:var(--ent-frozen);border-left:3px solid var(--c)") {
		t.Error("panel: expected kind to resolve an inline --c accent + border-left, entirely via style attribute")
	}
	if !strings.Contains(h, "01 Personality") || !strings.Contains(h, "Frozen at LOAD_BEARING.") {
		t.Error("panel: expected lead + body still rendered alongside kind")
	}
	// The plain panel (no kind) must carry NO style attribute at all — proves
	// the feature is additive, not a blanket change to every panel's markup.
	plainIdx := strings.Index(h, "No kind")
	if plainIdx == -1 {
		t.Fatal("panel: plain panel not found in output")
	}
	// Walk backward from "No kind" to its enclosing panel's opening tag and
	// confirm no style= attribute appears between the class and the lead div.
	tagStart := strings.LastIndex(h[:plainIdx], "<div class='panel")
	tagEnd := strings.Index(h[tagStart:], ">") + tagStart
	if strings.Contains(h[tagStart:tagEnd], "style=") {
		t.Error("panel: a panel with no kind must not emit a style= attribute at all")
	}
}

// TestPanelKind_UndeclaredEntityRefused proves the palette-validated promise:
// an author cannot reference a temperature the doc never declared.
func TestPanelKind_UndeclaredEntityRefused(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{"type": "panel", "kind": "nonexistent-entity", "lead": "x", "body": "y"}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "std-doc-error") && !strings.Contains(h, "unknown palette entity") {
		t.Error("panel: an undeclared kind entity must raise loudly (the security gate's promise), not silently drop")
	}
}
