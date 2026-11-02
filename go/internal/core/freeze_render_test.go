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
	"os"
	"path/filepath"
	"testing"

	"stddoc/internal/gate"
)

// freezableCase returns a diagram-bearing conformance case that actually EXISTS
// in this tree.
//
// Why this is not a constant: prd-python-prep is pruned from the public source
// bundle by DIST_EXCLUDE, so hard-coding it meant `go test ./...` FAILED for
// every stranger who downloaded a release — three tests, on a missing file,
// with nothing wrong in the code. MEASURED 2026-10-13 against the published
// v0.13.0 bundle. The internal tree can never reproduce it, which is exactly
// why it survived: test inside the extracted tarball, not the repo.
//
// self-doc is deliberately NOT a candidate — it documents the gate itself, so
// it contains a `url(https:` in PROSE and a live mermaid demo div, both of
// which the gate correctly refuses.
func freezableCase(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"prd-python-prep", "flow-code"} {
		p := filepath.Join(repoRoot(t), "conformance", "cases", name, "input.json")
		if _, err := os.Stat(p); err == nil {
			return name
		}
	}
	t.Fatal("no diagram-bearing conformance case found (looked for prd-python-prep, flow-code) — " +
		"this test cannot prove Covenant IV without one; do not let it pass quietly")
	return ""
}

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
	for _, name := range []string{freezableCase(t)} {
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
	caseName := freezableCase(t)
	for _, s := range namedStyles {
		t.Run(s, func(t *testing.T) {
			pages, err := Publish(loadCaseDoc(t, caseName), s, lib)
			if err != nil {
				t.Fatalf("Publish %s style %s: %v", caseName, s, err)
			}
			if err := gate.Enforce(pages); err != nil {
				t.Errorf("style %s must render a self-contained doc; gate leaks: %v", s, err)
			}
		})
	}
}
