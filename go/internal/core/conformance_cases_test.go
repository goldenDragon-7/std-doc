package core

// conformance_cases_test.go — table-driven byte-identity sweep over every
// conformance fixture the dedicated TestStyleAB/TestPager tests don't cover.
// Before 2026-06-18 only style-ab + pager were exercised in Go; the other case
// dirs were orphaned from the deleted Python run.py. They are now all wired in
// as real golden-master coverage (the strangler proof).
//
// Triage that got them here (all were stale Python-era artifacts, NOT bugs):
//   - fourlevel/golden/tree/twolevel: goldens carried dead .facets CSS the Go
//     renderer correctly prunes (no markup uses it) + a refreshed .tagline —
//     regenerated from current Go output.
//   - prd-python-prep: input used the renamed `crux` block type → fixed to
//     `call`, regenerated.
//   - page-atoms-demo: PRUNED — obsolete pre-doctree schema (layout/blocks,
//     not nodes); lint correctly rejected it.

import (
	"os"
	"path/filepath"
	"testing"

	"stddoc/internal/library"
	"stddoc/internal/wire"
)

func TestConformanceCases_ByteIdentical(t *testing.T) {
	cases := []string{
		"callout-variants", "cardgrid-variants", "figure", "flat",
		"flow-code", "fourlevel", "golden", "howto", "m2-extends",
		"prd-python-prep", "self-doc", "tree", "twolevel",
	}
	root := repoRoot(t)
	lib, err := library.Load(filepath.Join(root, "go", "stddoc-lib"))
	if err != nil {
		t.Fatalf("load library: %v", err)
	}

	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			caseDir := filepath.Join(root, "conformance", "cases", name)
			raw, err := os.ReadFile(filepath.Join(caseDir, "input.json"))
			if err != nil {
				t.Fatalf("read input.json: %v", err)
			}
			doc, err := wire.ParseOrderedJSON(raw)
			if err != nil {
				t.Fatalf("parse input.json: %v", err)
			}
			pages, err := Publish(doc, "", lib)
			if err != nil {
				t.Fatalf("Publish: %v", err)
			}
			entries, err := os.ReadDir(filepath.Join(caseDir, "expected"))
			if err != nil {
				t.Fatalf("read expected/: %v", err)
			}
			for _, e := range entries {
				want, err := os.ReadFile(filepath.Join(caseDir, "expected", e.Name()))
				if err != nil {
					t.Fatalf("read expected/%s: %v", e.Name(), err)
				}
				got, ok := pages[e.Name()]
				if !ok {
					t.Errorf("Go output missing page %s", e.Name())
					continue
				}
				if got != string(want) {
					t.Errorf("page %s: Go output differs from golden (first diff ~byte %d)",
						e.Name(), firstDiffByte(got, string(want)))
				}
			}
		})
	}
}
