package core

// sections_validator_test.go — proof that an unreadable field in a section or
// item is REPORTED rather than silently dropped.

import (
	"strings"
	"testing"

	"stddoc/internal/wire"
)

func validateSections(t *testing.T, nodeJSON string) []string {
	t.Helper()
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	node, err := wire.ParseOrderedJSON([]byte(nodeJSON))
	if err != nil {
		t.Fatalf("parse node: %v", err)
	}
	var msgs []string
	for _, f := range reg.Validate("sections", node) {
		msgs = append(msgs, f.Level+": "+f.Message)
	}
	return msgs
}

// TestSectionsValidatorCatchesTheAuthoringMistake is the regression that
// motivated this: a section authored with `blocks:` instead of
// `summary:`/`items:` rendered an empty heading and dropped every word.
// `blocks` is not a near-miss of either word, so the near-miss rule alone would
// never have caught it.
func TestSectionsValidatorCatchesTheAuthoringMistake(t *testing.T) {
	msgs := validateSections(t, `{"slug":"n","sections":[
		{"name":"Why a third column","blocks":[{"type":"prose","text":"lost"}]}]}`)
	if len(msgs) != 1 {
		t.Fatalf("expected exactly 1 finding, got %d: %v", len(msgs), msgs)
	}
	m := msgs[0]
	for _, want := range []string{"warn:", "section 'Why a third column'", "'blocks'", "renders as NOTHING"} {
		if !strings.Contains(m, want) {
			t.Errorf("finding missing %q: %s", want, m)
		}
	}
	// The message must TEACH the fix, not just report the fault.
	if !strings.Contains(m, "summary") || !strings.Contains(m, "items") {
		t.Errorf("finding does not name the correct fields: %s", m)
	}
}

// TestSectionsValidatorCatchesItemFields — an unreadable key on an ITEM must be
// reported too, not just on the section.
func TestSectionsValidatorCatchesItemFields(t *testing.T) {
	msgs := validateSections(t, `{"slug":"n","sections":[
		{"name":"S","summary":"s","items":[
			{"name":"The item","desc":"d","body":"dropped"}]}]}`)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 finding, got %d: %v", len(msgs), msgs)
	}
	for _, want := range []string{"item 1", "The item", "'body'"} {
		if !strings.Contains(msgs[0], want) {
			t.Errorf("finding missing %q: %s", want, msgs[0])
		}
	}
}

// TestSectionsValidatorAllowsEvidence guards a correction made during the fix:
// `evidence` on an item IS read (ctx.RenderEvidence, content.go:221). I first
// mis-read it as a silent drop, which would have shipped a false positive on
// examples/data-derived-example/source.json. A warning that cries wolf on a
// valid shipped doc is worse than no warning at all.
func TestSectionsValidatorAllowsEvidence(t *testing.T) {
	msgs := validateSections(t, `{"slug":"n","sections":[
		{"name":"Rendering","summary":"s","items":[
			{"name":"render_node","desc":"d","evidence":{"kind":"trace"}}]}]}`)
	if len(msgs) != 0 {
		t.Fatalf("flagged a field the renderer DOES read: %v", msgs)
	}
}

// TestSectionsValidatorSilentOnValidDocs — every field the 23 shipped
// source.json files actually use must pass without a peep, or the warning is
// noise and authors will learn to ignore it.
func TestSectionsValidatorSilentOnValidDocs(t *testing.T) {
	msgs := validateSections(t, `{"slug":"n","title":"T","status":"LIVE","group":"G",
		"tagline":"t","updated":"2026-09-01","blocks":[{"type":"prose","text":"ok"}],
		"sections":[{"name":"S","icon":"x","tag":"concept","summary":"s",
			"citations":[{"file":"a.go","line":1}],
			"items":[{"name":"i","desc":"d","citations":[{"file":"b.go"}]}]}]}`)
	if len(msgs) != 0 {
		t.Fatalf("valid doc produced warnings (noise): %v", msgs)
	}
}

// TestSectionsValidatorIgnoresNodeFields — the "sections" block is synthetic and
// carries the WHOLE node, so the node's own legitimate fields must never be
// flagged. Guarding this explicitly because getting it wrong would fire a
// warning on literally every page.
func TestSectionsValidatorIgnoresNodeFields(t *testing.T) {
	msgs := validateSections(t, `{"slug":"n","title":"T","status":"LIVE",
		"group":"G","tagline":"t","blocks":[],"diagrams":[],"facets":{},
		"sections":[{"name":"S","summary":"s"}]}`)
	if len(msgs) != 0 {
		t.Fatalf("node-level fields were flagged: %v", msgs)
	}
}

// TestSectionsValidatorNoSections — a node with no sections is not an error.
func TestSectionsValidatorNoSections(t *testing.T) {
	if msgs := validateSections(t, `{"slug":"n","blocks":[]}`); len(msgs) != 0 {
		t.Fatalf("section-less node produced findings: %v", msgs)
	}
}

// TestSectionsValidatorReachedByLint is the test that actually matters, and it
// exists because the obvious one did not.
//
// `sections` is a SYNTHETIC node-level block — it never appears in blocks[], so
// lintBlocks (which walks blocks[]) can never reach its validator. Registering
// the validator was necessary but NOT sufficient: publish stayed completely
// silent while every unit test above passed, because those call reg.Validate
// directly and so test the validator in isolation from the path that invokes it.
//
// A mutation confirmed the gap: deleting the lint-path call left the whole suite
// green. This test goes through lintDoc — the real path — so the wiring itself
// is covered, not just the function.
func TestSectionsValidatorReachedByLint(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	doc, err := wire.ParseOrderedJSON([]byte(`{
		"title":"T","generated_date":"2026-09-01","groups":["G"],
		"root":{"summary":"s"},
		"nodes":[{"slug":"n","group":"G","title":"N","blocks":[],
			"sections":[{"name":"Why","blocks":[{"type":"prose","text":"lost"}]}]}]}`))
	if err != nil {
		t.Fatalf("parse doc: %v", err)
	}
	var got string
	for _, f := range lintDoc(doc, reg) {
		if strings.Contains(f.Message, "renders as NOTHING") {
			got = f.Level + "/" + f.Slug + ": " + f.Message
		}
	}
	if got == "" {
		t.Fatal("lint did NOT surface the dropped section field — the validator is registered but unreachable from the lint path")
	}
	if !strings.HasPrefix(got, "warn/n:") {
		t.Errorf("finding should be a warn scoped to the node slug, got: %s", got)
	}
}
