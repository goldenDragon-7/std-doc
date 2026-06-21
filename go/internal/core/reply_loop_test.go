package core

// reply_loop_test.go — GAP 5 of the harness audit (2026-06-20): "the document is
// the conversation." You reply to feedback by editing the canonical JSON and
// re-publishing (Covenant I — JSON is canon, never patch derived HTML). The
// server's INBOUND half (receive feedback → inbox) is integration-tested in
// serve_test.go; the OUTBOUND half — the republish that answers the comment —
// had no coverage.
//
// The mechanical guarantee underneath the loop is SURGICALITY: a single-node
// JSON edit must produce a surgical HTML delta — exactly the affected page
// changes, every other page stays byte-identical. That is what lets the doc
// "walk the reader through exactly what changed" without spurious diffs to
// reconcile (Covenant III — great design is efficient, fewer questions). If an
// edit to one node perturbed unrelated pages, the reply loop's promise would be
// a lie. This proves it holds.

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"stddoc/internal/wire"
)

// CAPABILITY (the reply loop, executable): editing one node's prose in the JSON
// and re-publishing changes ONLY that node's page. "item one" is a desc unique
// to the alpha node (it appears once in input.json and only in alpha.html), so
// editing it must touch alpha.html and nothing else.
func TestReplyLoop_NodeEditIsSurgical(t *testing.T) {
	lib := loadLib(t)
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "conformance", "cases", "flat", "input.json"))
	if err != nil {
		t.Fatalf("read flat input.json: %v", err)
	}

	docBefore, err := wire.ParseOrderedJSON(raw)
	if err != nil {
		t.Fatalf("parse before: %v", err)
	}
	before, err := Publish(docBefore, "", lib)
	if err != nil {
		t.Fatalf("publish before: %v", err)
	}

	// Simulate the reply: edit the canonical JSON (one node's desc), republish.
	edited := bytes.Replace(raw, []byte("item one"), []byte("item one — clarified per your comment"), 1)
	if bytes.Equal(edited, raw) {
		t.Fatal("edit did not change the input — 'item one' not found")
	}
	docAfter, err := wire.ParseOrderedJSON(edited)
	if err != nil {
		t.Fatalf("parse after: %v", err)
	}
	after, err := Publish(docAfter, "", lib)
	if err != nil {
		t.Fatalf("publish after: %v", err)
	}

	// Same page set — no page appears or vanishes from a prose edit.
	if len(before) != len(after) {
		t.Fatalf("page set changed: %d → %d pages", len(before), len(after))
	}

	const target = "alpha.html"
	changed := []string{}
	for name, b := range before {
		a, ok := after[name]
		if !ok {
			t.Errorf("page %s vanished after edit", name)
			continue
		}
		if a != b {
			changed = append(changed, name)
		}
	}

	if len(changed) != 1 || changed[0] != target {
		t.Errorf("edit was not surgical: expected only %s to change, got changed=%v", target, changed)
	}
	// And the change must actually carry the new prose (the edit landed, not a
	// no-op that happened to differ elsewhere).
	if a := after[target]; !contains(a, "clarified per your comment") {
		t.Errorf("%s does not reflect the edited prose", target)
	}
}

// CAPABILITY: republish is DETERMINISTIC — the same canonical JSON renders
// byte-identically twice. The reply loop relies on this: "what changed" is the
// diff between an edit and its predecessor, which is only meaningful if an
// unchanged doc produces an unchanged page (no timestamps, map-order jitter, or
// nondeterminism leaking into the output).
func TestReplyLoop_RepublishIsDeterministic(t *testing.T) {
	lib := loadLib(t)
	first, err := Publish(loadCaseDoc(t, "flat"), "", lib)
	if err != nil {
		t.Fatalf("publish first: %v", err)
	}
	second, err := Publish(loadCaseDoc(t, "flat"), "", lib)
	if err != nil {
		t.Fatalf("publish second: %v", err)
	}
	if len(first) != len(second) {
		t.Fatalf("page count differs across republish: %d vs %d", len(first), len(second))
	}
	for name, a := range first {
		b, ok := second[name]
		if !ok {
			t.Errorf("page %s missing on republish", name)
			continue
		}
		if a != b {
			t.Errorf("page %s not deterministic across republish (first diff ~byte %d)",
				name, firstDiffByte(a, b))
		}
	}
}
