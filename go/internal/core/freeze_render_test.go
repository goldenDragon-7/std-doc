package core

// freeze_render_test.go — GAP 3 of the harness audit (2026-06-20): freeze does
// not BAKE, it VERIFIES — the renderer already emits inline d2 SVG + embedded
// CSS/JS, and `stddoc freeze` runs gate.Enforce over the published dir to prove
// Covenant IV (a frozen doc reaches out to nothing). gate_test.go tests the
// SCANNER on synthetic strings; nothing tested that REAL renderer output — the
// path freeze actually runs in production, diagrams and all — is self-contained.
// This closes that: render the diagram-bearing conformance cases and assert the
// freeze gate finds zero external references.

import (
	"testing"

	"stddoc/internal/gate"
)

// CAPABILITY (Covenant IV, executable): a real rendered doc — including an
// in-process d2 diagram and the embedded body CSS / search JS — passes the
// freeze gate with zero leaks. If a future primitive ever emits an external
// <script src>, a remote @font-face, or an un-baked <div class="mermaid">,
// freeze would fail loudly in prod — and now here first.
//
// NOTE on case choice: prd-python-prep is a real diagram-bearing doc that is
// genuinely freezable. The self-doc case is deliberately NOT asserted here —
// it documents the gate itself (so it contains a `url(https:` in PROSE) and a
// live mermaid demo div, both of which the gate correctly refuses. Those are
// surfaced as findings A/B (2026-06-20 harness audit), pending a decision on
// whether to refine the gate's prose-vs-CSS detection and/or neutralize the
// self-doc demos. Don't add self-doc back until that's resolved.
func TestFreeze_RealRenderedDocIsSelfContained(t *testing.T) {
	lib := loadLib(t)
	for _, name := range []string{"prd-python-prep"} {
		t.Run(name, func(t *testing.T) {
			pages, err := Publish(loadCaseDoc(t, name), "", lib)
			if err != nil {
				t.Fatalf("Publish %s: %v", name, err)
			}
			if err := gate.Enforce(pages); err != nil {
				t.Errorf("rendered %s must be self-contained (freeze Covenant IV); "+
					"gate found external references: %v", name, err)
			}
		})
	}
}

// CAPABILITY: the freeze gate is rendered-output aware across EVERY named style —
// a style token that ever introduced a remote url() (e.g. a CDN webfont in
// --sans) would break the zero-network covenant on freeze. Render under each
// style and enforce.
func TestFreeze_AllStylesSelfContained(t *testing.T) {
	lib := loadLib(t)
	for _, s := range namedStyles {
		t.Run(s, func(t *testing.T) {
			pages, err := Publish(loadCaseDoc(t, "prd-python-prep"), s, lib)
			if err != nil {
				t.Fatalf("Publish prd-python-prep style %s: %v", s, err)
			}
			if err := gate.Enforce(pages); err != nil {
				t.Errorf("style %s must render a self-contained doc; gate leaks: %v", s, err)
			}
		})
	}
}
