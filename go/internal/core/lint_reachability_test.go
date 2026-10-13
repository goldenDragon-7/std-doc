package core

import (
	"testing"

	"stddoc/internal/registry"
)

// disclosureWrap composes `inner` via `disclosure`'s real `content` compose
// field — a second real container, distinct from style_ab, used here so the
// reachability tests exercise more than one production composition site.
func disclosureWrap(inner string) string {
	return `{"type":"disclosure","summary":"S","content":[` + inner + `]}`
}

// disclosureWrongKey is the actual bug class this check exists for: `items`
// is not a near-miss of `content` (edit distance > 2), so fieldValidator has
// nothing to warn about — the field name itself looks like a perfectly
// reasonable key. The data is simply never composed.
func disclosureWrongKey(inner string) string {
	return `{"type":"disclosure","summary":"S","items":[` + inner + `]}`
}

const goodCallout = `{"type":"callout","kind":"glow","lead":"L","body":"B"}`

// TestLintReachabilityCatchesWrongFieldKey is band.items[] from the report:
// a container field that is NOT a near-miss of the real one. The near-miss
// check (fieldnames.go) is provably silent here (asserted below); the
// reachability diff is the only thing that catches it.
func TestLintReachabilityCatchesWrongFieldKey(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` + disclosureWrongKey(goodCallout) + `]}]}`
	fs := lintSrc(t, src)
	if f := findingBy(fs, "did you mean"); f != nil {
		t.Fatalf("setup invariant broken: 'items' must not be a near-miss of 'content' (test proves nothing otherwise): %v", f)
	}
	f := findingBy(fs, "authored 'callout' block was never rendered")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected the reachability diff to catch the orphaned callout under 'items', got %v", fs)
	}
}

// TestLintReachabilityDeepWrongKey proves the diff isn't limited to the
// top-level container — the same wrong-key mistake several containers deep
// (band.content[] -> band.sections[] in the report) is caught identically,
// via real style_ab composition wrapping the broken disclosure.
func TestLintReachabilityDeepWrongKey(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` +
		styleABWrap(styleABWrap(disclosureWrongKey(goodCallout))) + `]}]}`
	f := findingBy(lintSrc(t, src), "authored 'callout' block was never rendered")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected the reachability diff to survive nesting, got %v", lintSrc(t, src))
	}
}

// TestLintReachabilityCleanForCorrectComposition proves the check does not
// cry wolf on the ordinary case: content authored under the RIGHT field must
// stay silent, at depth and with a genuinely nested primitive inside it.
func TestLintReachabilityCleanForCorrectComposition(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` +
		styleABWrap(disclosureWrap(goodCallout)) + `]}]}`
	if f := findingBy(lintSrc(t, src), "was never rendered"); f != nil {
		t.Fatalf("correctly composed content must not warn: %v", f)
	}
}

// TestLintReachabilityNoDepthCap mirrors TestLintNestedRecursionHasNoDepthCap:
// the orphan 5 containers deep must still be found.
func TestLintReachabilityNoDepthCap(t *testing.T) {
	deep := disclosureWrongKey(goodCallout)
	for i := 0; i < 4; i++ {
		deep = styleABWrap(deep)
	}
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` + deep + `]}]}`
	f := findingBy(lintSrc(t, src), "authored 'callout' block was never rendered")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected the reachability diff to survive 5 levels of nesting, got %v", lintSrc(t, src))
	}
}

// TestLintReachabilityWrongKeyAtSameContainerReportsOnce proves the pruning
// behaviour documented on reachabilityScan: an orphaned container's own
// descendants are not ALSO individually reported — one finding per actual
// root cause, not a cascade.
func TestLintReachabilityWrongKeyAtSameContainerReportsOnce(t *testing.T) {
	// The orphaned disclosure itself contains a further nested style_ab —
	// none of it was ever rendered, but only the outermost orphan (the
	// disclosure under "items") should be reported.
	orphanSubtree := disclosureWrongKey(styleABWrap(goodCallout))
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` + orphanSubtree + `]}]}`
	fs := lintSrc(t, src)
	n := 0
	for _, f := range fs {
		if findingBy([]registry.Finding{f}, "was never rendered") != nil {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("expected exactly ONE never-rendered finding (the outer disclosure, not its unreached descendants too), got %d: %v", n, fs)
	}
}

// TestLintReachabilityWiring is the PROVEN RED mutation test: it proves
// lintBlocks actually calls lintReachability by running lintDoc with the real
// wired path (must warn) versus a hand-rolled copy of lintBlocks missing only
// the lintReachability call (must NOT warn) — the same shape as
// TestLintNestedRecursionReachedByLint, guarding against the exact mistake
// commit 2462bae made: a correct check that is never actually reached.
func TestLintReachabilityWiring(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	doc := parseDoc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[`+disclosureWrongKey(goodCallout)+`]}]}`)

	if f := findingBy(lintDoc(doc, reg), "was never rendered"); f == nil {
		t.Fatalf("expected the wired lint path to catch the orphaned block")
	}

	node, _ := omap(list(doc, "nodes")[0])
	if f := findingBy(lintBlocksTopLevelOnly(node, "a", reg), "was never rendered"); f != nil {
		t.Fatalf("the pre-fix shape must not have this finding (would prove the depth test is coincidental): %v", f)
	}
}

// TestLintReachabilityDoesNotPanicOnMalformedData proves the recover() in
// lintReachability actually protects lint: a hand-coded primitive's own
// render function might not defensively handle every shape, and lint must
// never crash regardless (Lint's own documented contract).
func TestLintReachabilityDoesNotPanicOnMalformedData(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("lint must never panic, even on malformed nested primitive data: %v", r)
		}
	}()
	// A tree block (hand-coded, not template-driven) with a deliberately
	// wrong-shaped nested field, composed inside a real container.
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` +
		styleABWrap(`{"type":"tree","roots":"not-a-list-should-be"}`) + `]}]}`
	_ = lintSrc(t, src) // must not panic regardless of finding contents
}
