package core

// capability_test.go — the SELF-TESTING HARNESS.
//
// An audit MEASURES by reading; this harness MEASURES by running. Every
// capability std-doc documents about itself is exercised here against the real
// renderer/registry, so a future regression (a dropped primitive, an unwired
// validator, a doc that drifts from the code) fails `go test` instead of
// waiting for a human to re-read. This is the executable form of the
// doc-truth + port-parity audits done on 2026-06-18.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/wire"
)

// loadLib + repoRoot are shared helpers from lint_test.go / conformance_test.go.

// CAPABILITY: lint exists, runs, and our own canonical self-doc stays clean.
// (Dogfood — if a self-doc edit introduces a structural error, this goes red.)
func TestCapability_OwnDocLintsClean(t *testing.T) {
	lib := loadLib(t)
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "self-doc", "source.json"))
	if err != nil {
		t.Fatalf("read self-doc: %v", err)
	}
	doc, err := wire.ParseOrderedJSON(raw)
	if err != nil {
		t.Fatalf("parse self-doc: %v", err)
	}
	fs, err := Lint(doc, lib)
	if err != nil {
		t.Fatalf("Lint: %v", err)
	}
	if n := CountErrors(fs); n != 0 {
		t.Fatalf("self-doc/source.json must lint clean, got %d error(s): %v", n, fs)
	}
}

// CAPABILITY: lint FAILS LOUD (PRD P0) — a malformed doc yields >=1 error.
// This guards the lint/validate capability the Python→Go port had dropped.
func TestCapability_LintFailsLoud(t *testing.T) {
	lib := loadLib(t)
	// missing required keys (title, nodes) — the minimal malformed doc.
	doc, err := wire.ParseOrderedJSON([]byte(`{"meta":{"title":"x"},"docs":[{"slug":"a"}]}`))
	if err != nil {
		t.Fatalf("parse malformed: %v", err)
	}
	fs, err := Lint(doc, lib)
	if err != nil {
		t.Fatalf("Lint: %v", err)
	}
	if CountErrors(fs) == 0 {
		t.Fatal("a malformed doc must produce >=1 lint error (fail-loud); got none")
	}
}

// CAPABILITY: every core primitive the port-parity audit confirmed PORTED is
// actually registered. A dropped primitive (the exact fear that started the
// audit) fails here.
func TestCapability_CorePrimitivesPresent(t *testing.T) {
	reg, err := buildRegistry(loadLib(t))
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	// the data-template + core-block primitives the matrix verified present
	want := []string{
		"evidence", "sections", "statetrack", "swimlane", "tree",
		"call", "mermaid", "gradient-band", "decisionmatrix", "spectrum",
	}
	for _, typ := range want {
		if !reg.Has(typ) {
			t.Errorf("primitive %q must be registered (registry.Has) — possible port regression", typ)
		}
	}
}

// CAPABILITY: mermaid_fix neutralizes the dark-theme "bomb icon" triggers.
// Guards the transform set the port had dropped (live Covenant-II regression).
func TestCapability_MermaidFixNeutralizesDarkThemeBombs(t *testing.T) {
	in := "flowchart TD\n  subgraph G[\"🚀 launch\"]\n    A -->|line one\\nline two| B\n  end"
	out := mermaidFix(in)
	if strings.Contains(out, "🚀") {
		t.Errorf("mermaidFix must strip emoji from subgraph labels; still present in:\n%s", out)
	}
	if strings.Contains(out, `\n`) {
		t.Errorf("mermaidFix must replace literal \\n in edge labels; still present in:\n%s", out)
	}
}

// CAPABILITY (doc-truth, executable): the canonical docs must not assert
// surfaces the binary no longer has. This is the doc-truth auditor as a GATE —
// it would have caught every doc bug found on 2026-06-18.
func TestCapability_DocsDoNotLie(t *testing.T) {
	root := repoRoot(t)
	docs := []string{"SKILL.md", "STANDALONE.md", "README.md", "self-doc/source.json"}
	// (string, mustBeAbsent, why)
	banned := []struct{ s, why string }{
		{"5050", "stale port floor — the real floor is 33333 (serve.MinPort)"},
		{"shelve", "retired lifecycle verb — superseded by roll/graduate"},
		{"seal →", "retired lifecycle transition (seal → archive)"},
		{"600s", "inverted idle-timeout claim — Go default is 0 (never idles)"},
		{"SecurityGateError", "Python-era gate type — Go gate exports Scan/Enforce/HasMermaid only (Enforce returns a plain fmt.Errorf)"},
		{"enforce_blocks", "Python-era gate function — absent from the Go gate (two-pass Scan + Enforce)"},
		{"EXTERNAL_REF", "Python-era gate regex name — the Go gate uses reDep + reInlineHTTP (two-pass Scan)"},
	}
	for _, d := range docs {
		raw, err := os.ReadFile(filepath.Join(root, d))
		if err != nil {
			t.Fatalf("read %s: %v", d, err)
		}
		body := string(raw)
		for _, b := range banned {
			if strings.Contains(body, b.s) {
				t.Errorf("%s contains banned string %q (%s)", d, b.s, b.why)
			}
		}
		// the floor MUST be documented in the user-facing docs
		if d != "self-doc/source.json" && !strings.Contains(body, "33333") {
			t.Errorf("%s should document the 33333 port floor", d)
		}
	}
}
