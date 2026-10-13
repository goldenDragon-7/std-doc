package core

import (
	"strings"
	"testing"
)

// TestCardgridOwner covers leaf gap #8 (the template GAPS worklist,
// stddoc-template-scout): "no lane-card/lanes-grid (owner-identified
// parallel-track card)." The corpus's `lane l01`..`l10` classes
// (LEO_ARCHITECTURE.html "The 10 lanes"; SURVEY-NOTES.md Finding F8) are a
// dedicated component: a card carrying an owner/lane-number identity
// distinct from a generic title+body. The scout's own writeup: "cardgrid
// substitutes adequately (used eyebrow for the lane number) but has no
// first-class owner/lane-identity slot" — flagged lower-confidence than
// gaps #2/#6 because it wasn't proven cardgrid actually breaks down, just
// that the substitution loses a named concept.
//
// Ships as an optional `owner` field on cardgrid's existing card shape (not
// a new primitive — cardgrid already covers the grid/card mechanics; only
// the identity slot was missing), rendered ENTIRELY via inline style, same
// as panel.kind: cardgrid is already used on golden-pinned pages
// (conformance/cases/cardgrid-variants, conformance/cases/self-doc), so any
// growth to primitive_css.json's "cardgrid" entry would break both
// regardless of whether their existing cards use `owner`.
func TestCardgridOwner(t *testing.T) {
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
				"type": "cardgrid",
				"cards": [
					{"owner": "Lane 03 · IndexService", "title": "Query routing", "body": "Owns the read path."},
					{"title": "No owner", "body": "A plain card, no identity slot."}
				]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if !strings.Contains(h, "class='ec-owner'") || !strings.Contains(h, "Lane 03 · IndexService") {
		t.Error("cardgrid: expected the owner identity slot rendered with its text")
	}
	if !strings.Contains(h, "Query routing") {
		t.Error("cardgrid: expected title still rendered alongside owner")
	}
	// The card without `owner` must carry NO ec-owner div at all.
	plainIdx := strings.Index(h, "No owner")
	if plainIdx == -1 {
		t.Fatal("cardgrid: plain card not found")
	}
	cardStart := strings.LastIndex(h[:plainIdx], "<div class='ent-card")
	if strings.Contains(h[cardStart:plainIdx], "ec-owner") {
		t.Error("cardgrid: a card with no owner field must not emit an ec-owner div")
	}
}

// TestCardgridOwner_EmptyDegradesToNothing proves the field is additive: no
// owner anywhere in the doc leaves cardgrid rendering exactly as before.
func TestCardgridOwner_EmptyDegradesToNothing(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{"type": "cardgrid", "cards": [{"title": "T", "body": "B"}]}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	if strings.Contains(h, "ec-owner") {
		t.Error("cardgrid: no card declares owner, so ec-owner must never appear")
	}
}
