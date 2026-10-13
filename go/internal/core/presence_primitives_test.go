package core

import (
	"strings"
	"testing"
)

// TestPresencePrimitives covers W1 Phase 4a: `presence`, `sincelast`,
// `attribution` — the three presentation primitives a multiplayer document
// needs to show who's here, what changed since you looked away, and a
// compact "whose is this" marker. Fixture data only (no CRDT/network yet);
// this guards that a documented capability cannot silently disappear.
func TestPresencePrimitives(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{
					"type": "presence",
					"readers": [
						{"name": "Ada", "state": "here"},
						{"name": "Grace", "state": "idle"},
						{"name": "Hedy", "state": "away"}
					]
				},
				{
					"type": "sincelast",
					"when": "2 min ago",
					"changes": [
						{"kind": "added", "what": "a new section", "who": "Ada"},
						{"kind": "edited", "what": "the intro", "who": "Grace"},
						{"kind": "removed", "what": "a stale note"},
						{"kind": "commented", "what": "on the diagram", "who": "Hedy"}
					]
				},
				{
					"type": "attribution",
					"who": "Ada",
					"kind": "edited",
					"when": "just now"
				}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	// presence
	if !strings.Contains(h, "class='pr-reader pr-here'") {
		t.Error("presence: expected the here-state class")
	}
	if !strings.Contains(h, "class='pr-reader pr-idle'") {
		t.Error("presence: expected the idle-state class")
	}
	if !strings.Contains(h, "class='pr-reader pr-away'") {
		t.Error("presence: expected the away-state class")
	}
	for _, want := range []string{"Ada", "Grace", "Hedy"} {
		if !strings.Contains(h, want) {
			t.Errorf("presence: expected reader name %q in output", want)
		}
	}

	// sincelast
	if !strings.Contains(h, "class='sl-item sl-added'") {
		t.Error("sincelast: expected the added-kind class")
	}
	if !strings.Contains(h, "class='sl-item sl-edited'") {
		t.Error("sincelast: expected the edited-kind class")
	}
	if !strings.Contains(h, "class='sl-item sl-removed'") {
		t.Error("sincelast: expected the removed-kind class")
	}
	if !strings.Contains(h, "class='sl-item sl-commented'") {
		t.Error("sincelast: expected the commented-kind class")
	}
	if !strings.Contains(h, "2 min ago") {
		t.Error("sincelast: expected the optional `when` caption to render")
	}

	// attribution
	if !strings.Contains(h, "class='attribution'") {
		t.Error("attribution: expected the attribution wrapper span")
	}
	if !strings.Contains(h, "<span class='at-who'>Ada</span>") {
		t.Error("attribution: expected the who field to render")
	}
	if !strings.Contains(h, "<span class='at-kind'>edited</span>") {
		t.Error("attribution: expected the optional kind field to render")
	}
	if !strings.Contains(h, "<span class='at-when'>just now</span>") {
		t.Error("attribution: expected the optional when field to render")
	}
}

// TestPresencePrimitives_EmptyDegradesToNothing covers the designed
// degrade behaviour: a solo doc (no readers, no changes) must show no
// presence/sincelast chrome at all — not an empty wrapper div.
func TestPresencePrimitives_EmptyDegradesToNothing(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [
				{"type": "presence", "readers": []},
				{"type": "sincelast", "changes": []}
			]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	// Note: the page's aggregated <style> block always contains the
	// primitive's CSS class names regardless of use, so assert on the
	// actual wrapper markup rather than the bare word.
	if strings.Contains(h, "class='presence'") {
		t.Errorf("presence: expected no chrome at all for an empty readers[], got: %s", h)
	}
	if strings.Contains(h, "class='sincelast'") {
		t.Errorf("sincelast: expected no chrome at all for an empty changes[], got: %s", h)
	}
}
