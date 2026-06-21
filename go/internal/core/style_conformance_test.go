package core

// style_conformance_test.go — GAP 2 of the harness audit (2026-06-20): the
// conformance sweep only ever rendered the DEFAULT style (every Publish call
// passed style=""). The three named styles we ship as a headline feature —
// techno-dark, parchment-light, playful — had ZERO coverage, so a token-block
// edit could silently break parchment and nothing would go red.
//
// Rather than freeze a golden per style (3× the golden bytes), this proves the
// stronger, documented invariant directly: CLAUDE.md §4 claims "the body CSS is
// style-agnostic, so --style swaps the whole look without touching the
// structure." We make that claim EXECUTABLE — the sole byte difference between
// any two styles' output is the :root token block. Combined with the existing
// default-style goldens, every style's output is then transitively pinned.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/wire"
)

// loadCaseDoc parses a conformance case's input.json into a fresh OrderedMap.
// Fresh each call: Publish→buildTree mutates the doc in place, so a doc may not
// be republished twice. Shared by the gap-2/3/5 harness tests.
func loadCaseDoc(t *testing.T, name string) *wire.OrderedMap {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "conformance", "cases", name, "input.json"))
	if err != nil {
		t.Fatalf("read %s input.json: %v", name, err)
	}
	doc, err := wire.ParseOrderedJSON(raw)
	if err != nil {
		t.Fatalf("parse %s input.json: %v", name, err)
	}
	return doc
}

var namedStyles = []string{"techno-dark", "parchment-light", "playful"}

// CAPABILITY (Covenant, executable): swapping --style changes ONLY the :root
// token block — never the document structure. For one representative doc we
// render every named style; substituting the base style's :root block with
// another style's :root must reproduce that style's page byte-for-byte. Any
// other difference means structure leaked into the style (a Covenant-II/§4
// regression) and this goes red.
func TestStyle_BodyIsStyleAgnostic(t *testing.T) {
	lib := loadLib(t)

	rendered := map[string]map[string]string{}
	for _, s := range namedStyles {
		pages, err := Publish(loadCaseDoc(t, "flat"), s, lib)
		if err != nil {
			t.Fatalf("Publish style %s: %v", s, err)
		}
		rendered[s] = pages
	}

	roots := map[string]string{}
	for _, s := range namedStyles {
		r, err := lib.Style(s)
		if err != nil {
			t.Fatalf("lib.Style(%s): %v", s, err)
		}
		roots[s] = r
	}

	const base = "techno-dark"
	for _, s := range namedStyles {
		if s == base {
			continue
		}
		if len(rendered[s]) != len(rendered[base]) {
			t.Fatalf("style %s produced %d pages, base produced %d",
				s, len(rendered[s]), len(rendered[base]))
		}
		for name, basePage := range rendered[base] {
			otherPage, ok := rendered[s][name]
			if !ok {
				t.Errorf("style %s missing page %s", s, name)
				continue
			}
			// The ONLY allowed difference: the base :root → style-s :root.
			want := strings.Replace(basePage, roots[base], roots[s], 1)
			if want != otherPage {
				t.Errorf("page %s: %s differs from %s by more than the :root block — "+
					"structure leaked into the style (first diff ~byte %d)",
					name, s, base, firstDiffByte(want, otherPage))
			}
		}
	}
}

// CAPABILITY: the three named styles are genuinely distinct :root blocks (a
// guard against a copy-paste that quietly aliases two styles to the same tokens)
// and each is well-formed (carries a :root selector). Cheap, but it pins the
// premise the agnostic test rests on.
func TestStyle_NamedStylesDistinctAndWellFormed(t *testing.T) {
	lib := loadLib(t)
	seen := map[string]string{}
	for _, s := range namedStyles {
		root, err := lib.Style(s)
		if err != nil {
			t.Fatalf("lib.Style(%s): %v", s, err)
		}
		if !strings.Contains(root, ":root{") {
			t.Errorf("style %s missing :root{ token block", s)
		}
		if prev, dup := seen[root]; dup {
			t.Errorf("style %s is byte-identical to %s — distinct styles expected", s, prev)
		}
		seen[root] = s
	}
}
