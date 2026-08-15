package core

import (
	"strings"
	"testing"

	"stddoc/internal/registry"
)

// suggest_test.go — v0.11 S3: lint-suggestions. Proves the hard rules
// (the maintainer, 2026-08-15): notes only, never errors, conservative curated
// triggers, and — the load-bearing separation — LintSuggest's output is a
// wholly separate stream from Lint's, so it can never affect an exit code.

func mustSuggest(t *testing.T, docJSON string) []registry.Finding {
	t.Helper()
	doc := parseDoc(t, docJSON)
	out, err := LintSuggest(doc, nil)
	if err != nil {
		t.Fatalf("LintSuggest: %v", err)
	}
	return out
}

func findSuggest(fs []registry.Finding, substr string) *registry.Finding {
	for i := range fs {
		if strings.Contains(fs[i].Message, substr) {
			return &fs[i]
		}
	}
	return nil
}

func TestLintSuggest_AllFindingsAreSuggestLevel(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"table","columns":["Status"],"groups":[]}
	]}]}`)
	if len(out) == 0 {
		t.Fatal("expected at least one suggestion")
	}
	for _, f := range out {
		if f.Level != "suggest" {
			t.Errorf("LintSuggest must NEVER emit a non-suggest level, got %q", f.Level)
		}
	}
}

func TestLintSuggest_TableStatusColumn(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"table","columns":["Area","Status"],"groups":[]}
	]}]}`)
	if findSuggest(out, "statusboard") == nil {
		t.Error("expected a statusboard suggestion for a table with a Status column")
	}
}

func TestLintSuggest_TableNoStatusColumn_NoSuggestion(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"table","columns":["Area","Owner"],"groups":[]}
	]}]}`)
	if findSuggest(out, "statusboard") != nil {
		t.Error("must NOT suggest statusboard for a table with no Status column — conservative trigger only")
	}
}

func TestLintSuggest_FlowThreeSteps(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"flow","steps":[{"head":"1"},{"head":"2"},{"head":"3"}]}
	]}]}`)
	if findSuggest(out, "pipeline") == nil {
		t.Error("expected a pipeline suggestion for a flow with 3+ steps")
	}
}

func TestLintSuggest_FlowTwoSteps_NoSuggestion(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"flow","steps":[{"head":"1"},{"head":"2"}]}
	]}]}`)
	if findSuggest(out, "pipeline") != nil {
		t.Error("must NOT suggest pipeline for a 2-step flow — gated at 3+ steps")
	}
}

func TestLintSuggest_CallTwoOptions(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"call","title":"V","options":[{"key":"a","text":"x"},{"key":"b","text":"y"}]}
	]}]}`)
	if findSuggest(out, "decision") == nil {
		t.Error("expected a decision suggestion for a call box with 2+ options")
	}
}

func TestLintSuggest_CleanDocNoSuggestions(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"prose","text":"just a paragraph"}
	]}]}`)
	if len(out) != 0 {
		t.Errorf("expected zero suggestions for a plain doc, got %v", out)
	}
}

// CAPABILITY: LintSuggest's output must NEVER be countable as an error or a
// warning by the functions that gate exit codes — the hard-rule separation
// that makes "never blocks publish" actually true rather than aspirational.
func TestLintSuggest_NeverCountsAsErrorOrWarn(t *testing.T) {
	out := mustSuggest(t, `{"title":"x","nodes":[{"slug":"a","title":"A","blocks":[
		{"type":"table","columns":["Status"],"groups":[]},
		{"type":"flow","steps":[{"head":"1"},{"head":"2"},{"head":"3"}]},
		{"type":"call","title":"V","options":[{"key":"a","text":"x"},{"key":"b","text":"y"}]}
	]}]}`)
	if len(out) != 3 {
		t.Fatalf("expected all 3 triggers to fire, got %d", len(out))
	}
	if n := CountErrors(out); n != 0 {
		t.Errorf("CountErrors must be 0 for suggest-only findings, got %d", n)
	}
	if n := CountWarns(out); n != 0 {
		t.Errorf("CountWarns must be 0 for suggest-only findings, got %d", n)
	}
}
