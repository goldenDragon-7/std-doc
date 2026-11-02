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
	root := repoRoot(t)
	// DISCOVERED, not hard-coded. The old literal list named prd-python-prep,
	// which DIST_EXCLUDE prunes from the public source bundle — so this test
	// FAILED on a missing file for every stranger who downloaded a release
	// (MEASURED against published v0.13.0). It also silently skipped `pager`
	// and `style-ab`, which have lived in the tree untested because nobody
	// updated the literal.
	//
	// The floor below is the other half: a suite that quietly discovers fewer
	// cases prints no failures and reads exactly like a passing one.
	casesDir := filepath.Join(root, "conformance", "cases")
	entries, err := os.ReadDir(casesDir)
	if err != nil {
		t.Fatalf("read conformance cases dir: %v", err)
	}
	var cases []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(casesDir, e.Name(), "input.json")); err != nil {
			continue
		}
		cases = append(cases, e.Name())
	}
	const minCases = 12
	if len(cases) < minCases {
		t.Fatalf("discovered only %d conformance case(s) in %s — expected >= %d. "+
			"A suite that stopped finding cases is not a passing suite.",
			len(cases), casesDir, minCases)
	}
	t.Logf("conformance cases discovered: %d", len(cases))
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
