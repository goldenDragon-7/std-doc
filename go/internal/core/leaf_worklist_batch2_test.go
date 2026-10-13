package core

import (
	"strings"
	"testing"
)

// TestStampPrimitive covers the last real gap from
// the leaf-gap worklist's Tier 2 split assigned to me: `stamp`
// (5 docs) — a document-header signature block: right-aligned monospace
// date + N colored role attributions on one line, an optional plain
// caption line below. Distinct from the existing `attribution` primitive
// (a single-line inline "who [kind] [when]" chip, not a document-level
// 2-line header with multiple palette-colored role spans).
//
// This closes the Tier 2 split. The remaining worklist items resolved
// without new primitives (documented in protocol/primitives.md, not
// tested here since nothing was built): `card-title`/`card-body` are
// reachable via the existing `cardgrid` (same title+body shape, different
// class names — a semantic match, not a byte match); `issue-title` is the
// Gitea-export dialect (out-*.html, auto-rendered from Gitea API, already
// flagged out-of-scope by SURVEY-NOTES as "not human-authored", same
// category as the disclosure primitive's evidence); `sig` is plain
// multi-line monospace prose with no other chrome (5 docs, near-identical
// to what `prose` already renders) — too low-value/low-differentiation to
// justify a dedicated primitive.
func TestStampPrimitive(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"palette": {"accent": {"color": "#22d3ee"}, "info": {"color": "#60a5fa"}, "good": {"color": "#22c55e"}},
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{
				"type": "stamp",
				"date": "2026-05-14",
				"roles": [
					{"name": "Captain Codefactory", "kind": "accent"},
					{"name": "Mr. Dragon", "kind": "info"},
					{"name": "Strategist", "kind": "good"}
				],
				"caption": "kingdom architecture · synthesis pass"
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "class='stamp'") {
		t.Fatal("stamp: expected the wrapper rendered")
	}
	if !strings.Contains(h, "2026-05-14") {
		t.Error("stamp: expected the date rendered")
	}
	if !strings.Contains(h, "Captain Codefactory") || !strings.Contains(h, "Mr. Dragon") || !strings.Contains(h, "Strategist") {
		t.Error("stamp: expected all three role names rendered")
	}
	// Each role gets its own accent color via palette_var.
	if !strings.Contains(h, "--c:var(--ent-accent)") || !strings.Contains(h, "--c:var(--ent-info)") || !strings.Contains(h, "--c:var(--ent-good)") {
		t.Error("stamp: expected each role to resolve its own palette accent")
	}
	if !strings.Contains(h, "kingdom architecture") {
		t.Error("stamp: expected the caption line rendered")
	}
	// Roles join with " + ", matching the corpus's own separator.
	if !strings.Contains(h, "</span> + <span") {
		t.Error("stamp: expected roles joined with ' + '")
	}
}

// TestStampPrimitive_EmptyDegradesToNothing proves optional fields degrade
// sanely: no caption emits no caption line, no roles emits no role spans.
func TestStampPrimitive_EmptyDegradesToNothing(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{"type": "stamp", "date": "2026-05-14"}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if strings.Count(h, "<div class='stamp'><div>2026-05-14</div>") != 1 {
		t.Error("stamp: expected the date-only line with no trailing role separator or caption")
	}
}
