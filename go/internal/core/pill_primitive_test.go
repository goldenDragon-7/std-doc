package core

import (
	"strings"
	"testing"
)

// TestPillPrimitive covers P2: the pill/callout consolidation slice.
//
// Detective finding (report-detective-2.md #8): std-doc had 3 near-duplicate
// "colored pill" implementations — `badges` (status-lookup coloring, .b-live
// etc.), `chip` (per-instance entity accent via palette_var), and `compare`'s
// inline .cmp-pill. Investigation (this slice) also confirmed the OTHER half
// of the finding — "4-color callout boxes" (report-detective-3.md) — was
// ALREADY consolidated: `callout` is a single kind-parameterized primitive
// (kind/style/variant fields), not 4 hardcoded copies. No work needed there.
//
// For the pills: rewriting badges/chip/compare in place to share one
// implementation would change the CSS bytes those primitives already emit —
// which breaks conformance goldens AND, more importantly, would silently
// reflow the visual appearance of every EXISTING doc using them (the hard
// constraint: "don't change existing docs"). So this slice does NOT touch
// badges/chip/compare's cmp-pill — their old class names and CSS are
// preserved byte-for-byte, verified by TestConformanceCases_ByteIdentical.
//
// Instead: `pill` is a NEW kind-parameterized primitive (status lookup OR
// entity accent, same two colorings badges/chip already do) that future
// primitives should build on, per the maintainer's "don't reinvent" note. It is
// purely additive.
func TestPillPrimitive(t *testing.T) {
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
			"blocks": [
				{"type": "pill", "status": "LIVE", "label": "LIVE"},
				{"type": "pill", "ent": "amber", "label": "beta"}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "class='pill b-live'>LIVE</span>") {
		t.Error("pill: expected status-kind pill mapped to b-live")
	}
	if !strings.Contains(h, "class='pill pill-ent' style='--c:") {
		t.Error("pill: expected entity-kind pill with the pill-ent modifier + --c accent")
	}
	if !strings.Contains(h, ">beta</span>") {
		t.Error("pill: expected the entity pill's label rendered")
	}
}
