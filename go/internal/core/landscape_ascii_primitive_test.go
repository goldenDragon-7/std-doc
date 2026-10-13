package core

import (
	"strings"
	"testing"
)

// TestLandscapeAsciiPrimitive covers the scout's batch-1 follow-up:
// landscape-ascii — a box-drawing ASCII diagram where segments need
// per-span semantic coloring (SURVEY-NOTES F5, 5 corpus files, "CANONICAL —
// not a one-off"). Flagged "needs-Go (borderline)" in the candidate writeup
// because the existing `ascii` primitive escapes the whole diagram as one
// opaque string ({"esc": "ascii"}) — no inline span is possible there by
// design (the esc/no-raw security invariant). This turned out to be
// data-only after all: a nested `each` over lines[]→segments[] is already
// supported by the template interpreter (each's body can contain another
// each referencing "@item"), so no interpreter change was needed.
func TestLandscapeAsciiPrimitive(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"frozen": {"color": "#a78bfa"}, "bad": {"color": "#ef4444"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{
				"type": "landscape-ascii",
				"lines": [
					[{"text": "┌───┐", "kind": "frozen"}],
					[{"text": "│  "}, {"text": "01 PERSONALITY", "kind": "frozen"}, {"text": "  │"}],
					[{"text": "│  "}, {"text": "↳ ghost", "kind": "bad"}, {"text": "  │"}]
				]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	start := strings.Index(h, "<pre class='landscape'>")
	if start == -1 {
		t.Fatal("landscape-ascii: expected pre.landscape wrapper")
	}
	end := strings.Index(h[start:], "</pre>")
	if end == -1 {
		t.Fatal("landscape-ascii: expected a closing </pre>")
	}
	block := h[start : start+end+len("</pre>")]

	if !strings.Contains(block, "01 PERSONALITY") || !strings.Contains(block, "ghost") {
		t.Error("landscape-ascii: expected segment text rendered")
	}
	// A colored segment must carry its own --c accent (nested each resolving
	// the segment-level "kind" field, not the line-level one).
	if !strings.Contains(block, "style='--c:var(--ent-frozen)'") || !strings.Contains(block, "style='--c:var(--ent-bad)'") {
		t.Error("landscape-ascii: expected each segment's own kind to resolve its own accent")
	}
	// Plain segments (no kind) render bare text with no span at all, scoped
	// to just this block — proves the per-segment branch, not a blanket wrap.
	if got := strings.Count(block, "<span"); got != 3 {
		t.Errorf("landscape-ascii: expected exactly 3 colored spans (frozen line + frozen + bad segment), got %d", got)
	}
	// Lines join with a real newline inside the <pre> (monospace preserved),
	// and a plain leading segment sits beside its colored sibling untouched.
	if !strings.Contains(block, "│  <span style='--c:var(--ent-frozen)'>01 PERSONALITY</span>  │") {
		t.Error("landscape-ascii: expected the plain leading segment to precede its colored sibling on the same line")
	}
}

// TestLandscapeAsciiPrimitive_EmptyDegradesToNothing proves an empty
// lines[] renders a bare, harmless <pre></pre> with no stray spans.
func TestLandscapeAsciiPrimitive_EmptyDegradesToNothing(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{"type": "landscape-ascii", "lines": []}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "<pre class='landscape'></pre>") {
		t.Error("landscape-ascii: empty lines[] must render an empty <pre>, no stray spans")
	}
}
