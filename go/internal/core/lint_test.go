package core

import (
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"stddoc/internal/library"
	"stddoc/internal/registry"
	"stddoc/internal/wire"
)

// loadLib loads the default library for lint tests.
func loadLib(t *testing.T) *library.Library {
	t.Helper()
	root := repoRoot(t)
	lib, err := library.Load(filepath.Join(root, "go", "stddoc-lib"))
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	return lib
}

// parseDoc parses a JSON literal into the ordered doc-tree.
func parseDoc(t *testing.T, src string) *wire.OrderedMap {
	t.Helper()
	doc, err := wire.ParseOrderedJSON([]byte(src))
	if err != nil {
		t.Fatalf("parse doc: %v", err)
	}
	return doc
}

// findingsBy returns the first finding whose message contains substr, or nil.
func findingBy(fs []registry.Finding, substr string) *registry.Finding {
	for i := range fs {
		if strings.Contains(fs[i].Message, substr) {
			return &fs[i]
		}
	}
	return nil
}

func lintSrc(t *testing.T, src string) []registry.Finding {
	t.Helper()
	fs, err := Lint(parseDoc(t, src), loadLib(t))
	if err != nil {
		t.Fatalf("Lint: %v", err)
	}
	return fs
}

func TestLintClean(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A"},{"slug":"b","title":"B","parent":"a"}]}`
	fs := lintSrc(t, src)
	if len(fs) != 0 {
		t.Fatalf("expected clean, got %v", fs)
	}
}

func TestLintMissingTitle(t *testing.T) {
	fs := lintSrc(t, `{"nodes":[{"slug":"a","title":"A"}]}`)
	f := findingBy(fs, "missing required key: title")
	if f == nil || f.Level != "error" {
		t.Fatalf("expected error for missing title, got %v", fs)
	}
}

func TestLintMissingNodes(t *testing.T) {
	fs := lintSrc(t, `{"title":"T"}`)
	if findingBy(fs, "missing required key: nodes") == nil {
		t.Fatalf("expected error for missing nodes, got %v", fs)
	}
}

func TestLintNodeMissingTitleAndSlug(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"ok","title":"OK"},{"slug":"x"}]}`)
	if findingBy(fs, "missing required key: title") == nil {
		t.Fatalf("expected node missing title, got %v", fs)
	}
}

func TestLintBadSlugShape(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"Bad_Slug","title":"X"}]}`)
	if findingBy(fs, "kebab-case") == nil {
		t.Fatalf("expected kebab-case error, got %v", fs)
	}
}

func TestLintDuplicateSlug(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"a","title":"A"},{"slug":"a","title":"A2"}]}`)
	if findingBy(fs, "duplicate slug") == nil {
		t.Fatalf("expected duplicate slug error, got %v", fs)
	}
}

func TestLintUnresolvedParent(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","parent":"ghost"}]}`)
	if findingBy(fs, "does not resolve") == nil {
		t.Fatalf("expected unresolved parent error, got %v", fs)
	}
}

func TestLintSelfParent(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","parent":"a"}]}`)
	if findingBy(fs, "own parent") == nil {
		t.Fatalf("expected self-parent error, got %v", fs)
	}
}

func TestLintCycle(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","parent":"b"},{"slug":"b","title":"B","parent":"a"}]}`
	fs := lintSrc(t, src)
	if findingBy(fs, "cycle") == nil {
		t.Fatalf("expected cycle error, got %v", fs)
	}
}

func TestLintCitationMissingPath(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"items":[{"citations":[{"evidence":"MEASURED"}]}]}]}]}`
	fs := lintSrc(t, src)
	if findingBy(fs, "citation missing required 'path'") == nil {
		t.Fatalf("expected citation missing path, got %v", fs)
	}
}

func TestLintCitationBadEvidence(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"items":[{"citations":[{"path":"x.go","evidence":"BOGUS"}]}]}]}]}`
	fs := lintSrc(t, src)
	if findingBy(fs, "not one of") == nil {
		t.Fatalf("expected bad evidence error, got %v", fs)
	}
}

// CARRIED-4 (2026-08-12): the evidence vocabulary is the canonical five, not
// three — a five-level grader now matches — and the reject message names the
// effective set so it is discoverable without failing twice.
func TestLintCitationCanonicalEvidence(t *testing.T) {
	for _, lv := range []string{"MEASURED", "CALCULATED", "CITED", "INFERRED", "ESTIMATED", "SPECULATIVE"} {
		src := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"items":[{"citations":[{"path":"x.go","evidence":"` + lv + `"}]}]}]}]}`
		if f := findingBy(lintSrc(t, src), "not one of"); f != nil {
			t.Errorf("canonical evidence %q must be accepted, got: %s", lv, f.Message)
		}
	}
	// the reject message lists the effective set (self-documenting).
	bad := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"items":[{"citations":[{"path":"x.go","evidence":"BOGUS"}]}]}]}]}`
	f := findingBy(lintSrc(t, bad), "not one of")
	if f == nil || !strings.Contains(f.Message, "SPECULATIVE") {
		t.Fatalf("reject must name the effective set, got: %v", f)
	}
}

// CARRIED-4: a doc grading on its own scale declares evidence_levels and lint
// accepts them (extensible, not locked).
func TestLintCitationDeclaredEvidence(t *testing.T) {
	src := `{"title":"T","evidence_levels":["OBSERVED","THEORIZED"],` +
		`"nodes":[{"slug":"a","title":"A","sections":[{"items":[{"citations":[{"path":"x.go","evidence":"OBSERVED"}]}]}]}]}`
	if f := findingBy(lintSrc(t, src), "not one of"); f != nil {
		t.Errorf("doc-declared evidence level must be accepted, got: %s", f.Message)
	}
}

func TestLintAsciiTooWide(t *testing.T) {
	wide := strings.Repeat("x", 90)
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","diagrams":[{"ascii":"` + wide + `"}]}]}`
	fs := lintSrc(t, src)
	f := findingBy(fs, "ascii diagram line")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected ascii width warn, got %v", fs)
	}
}

func TestLintUnknownBlockType(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[{"type":"no-such-primitive"}]}]}`
	fs := lintSrc(t, src)
	f := findingBy(fs, "unknown block type")
	if f == nil || f.Level != "error" {
		t.Fatalf("expected unknown block type error, got %v", fs)
	}
}

// TestLintPrimitiveInSections proves the silent-drop is now loud. A primitive
// authored into sections[] instead of blocks[] renders as nothing and, before
// this check, said nothing — publish exited 0 with the diagrams missing.
func TestLintPrimitiveInSections(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"type":"table","name":"N","columns":["c"],"groups":[]}]}]}`
	fs := lintSrc(t, src)
	f := findingBy(fs, "authored in sections[]")
	if f == nil || f.Level != "error" {
		t.Fatalf("expected misplaced-primitive error, got %v", fs)
	}
}

// TestLintMisspelledField proves a misspelled FIELD inside a primitive is
// caught. `colums:` rendered a table with no headers and said nothing. The
// known-field set is derived from the primitive's own template — no hand-written
// validator per primitive.
func TestLintMisspelledField(t *testing.T) {
	for _, tc := range []struct{ src, want string }{
		{`{"type":"table","name":"N","colums":["c"],"groups":[]}`, "columns"},
		{`{"type":"callout","kind":"green","lead":"L","bodyy":"B"}`, "body"},
		{`{"type":"decision","question":"Q","chosen":"C","alternatievs":[]}`, "alternatives"},
	} {
		src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` + tc.src + `]}]}`
		f := findingBy(lintSrc(t, src), "did you mean '"+tc.want+"'")
		if f == nil || f.Level != "warn" {
			t.Fatalf("expected near-miss field warn naming %q, got %v", tc.want, lintSrc(t, src))
		}
	}
}

// An author's deliberate extra key is NOT a typo and must stay silent —
// otherwise the check becomes noise and gets ignored, which is worse than
// nothing.
func TestLintDeliberateExtraFieldIsClean(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[{"type":"callout","kind":"green","lead":"L","body":"B","internal_note":"kept on purpose","ticket":"#42"}]}]}`
	if f := findingBy(lintSrc(t, src), "did you mean"); f != nil {
		t.Fatalf("deliberate extra key must not warn, got %v", f)
	}
}

// Field-name derivation reads the template, so a field the template genuinely
// uses is never flagged.
func TestTemplateFieldNamesDerivation(t *testing.T) {
	raw := map[string]any{
		"a": []any{map[string]any{"esc": "columns"}},
		"b": []any{map[string]any{"each": "groups", "body": []any{map[string]any{"esc": "@item"}}}},
		"c": []any{map[string]any{"if": map[string]any{"truthy": "left.title"}}},
	}
	got := templateFieldNames(raw)
	for _, want := range []string{"columns", "groups", "left"} {
		if !got[want] {
			t.Fatalf("expected %q in derived field set, got %v", want, got)
		}
	}
	if got["@item"] {
		t.Fatalf("loop variable must not be treated as a field: %v", got)
	}
}

// TestLintNearMissContainer proves a mistyped container key is loud. `block:`
// instead of `blocks:` dropped every primitive on the node in silence.
func TestLintNearMissContainer(t *testing.T) {
	for _, tc := range []struct{ key, want string }{
		{"block", "blocks"},
		{"section", "sections"},
		{"child", "children"},
	} {
		src := `{"title":"T","nodes":[{"slug":"a","title":"A","` + tc.key + `":[]}]}`
		f := findingBy(lintSrc(t, src), "did you mean '"+tc.want+"'")
		if f == nil || f.Level != "error" {
			t.Fatalf("key %q: expected near-miss error naming %q, got %v", tc.key, tc.want, lintSrc(t, src))
		}
	}
}

// When both the stray and the real container are present the real one wins, so
// this is a warning (dead weight) rather than an error (lost content).
func TestLintNearMissWithRealContainerIsWarn(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","block":[],"blocks":[]}]}`
	f := findingBy(lintSrc(t, src), "is ignored")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected ignored-key warn, got %v", lintSrc(t, src))
	}
}

// A primitive in children[] renders as nothing — children[] holds child NODES.
func TestLintPrimitiveInChildren(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","children":[{"type":"table","name":"N","columns":["c"],"groups":[]}]}]}`
	f := findingBy(lintSrc(t, src), "authored in children[]")
	if f == nil || f.Level != "error" {
		t.Fatalf("expected primitive-in-children error, got %v", lintSrc(t, src))
	}
}

// A legitimate child NODE in children[] carries no 'type' and must stay silent.
func TestLintRealChildNodeIsClean(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","children":[{"slug":"b","title":"B"}]}]}`
	if f := findingBy(lintSrc(t, src), "children[]"); f != nil {
		t.Fatalf("real child node must not warn, got %v", f)
	}
}

// A prose section carries no 'type' and must stay silent — no false positives
// on the overwhelmingly common case.
func TestLintProseSectionIsClean(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"name":"N","icon":"🎯","summary":"prose"}]}]}`
	if f := findingBy(lintSrc(t, src), "sections[]"); f != nil {
		t.Fatalf("prose section must not warn, got %v", f)
	}
}

// TestLintPerPrimitiveValidate proves the per-primitive Validate dispatch is wired:
// a registered validator's findings surface through Lint.
func TestLintPerPrimitiveValidate(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	reg.RegisterValidator("prose", func(b *wire.OrderedMap) []registry.Finding {
		if str(b, "body") == "" {
			return []registry.Finding{{Level: "error", Slug: "", Message: "prose: empty body"}}
		}
		return nil
	})
	doc := parseDoc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[{"type":"prose"}]}]}`)
	fs := lintDoc(doc, reg)
	if findingBy(fs, "prose: empty body") == nil {
		t.Fatalf("expected per-primitive validate finding, got %v", fs)
	}
}

func TestErrorCount(t *testing.T) {
	fs := []registry.Finding{{Level: "error"}, {Level: "warn"}, {Level: "error"}}
	if n := CountErrors(fs); n != 2 {
		t.Fatalf("expected 2 errors, got %d", n)
	}
}

// TestLintAsciiWidthCountsColumnsNotBytes — the width rule measures COLUMNS.
//
// It used to use len(), which counts BYTES. Every box-drawing glyph (─ │ ► ◄ ·)
// is 3 bytes in UTF-8, so a diagram made of them was over-measured by roughly a
// third and the warning reported a width no reader ever saw. A 70-column line of
// box-drawing is ~210 bytes and would have been flagged; it must not be.
func TestLintAsciiWidthCountsColumnsNotBytes(t *testing.T) {
	// 70 columns of box-drawing = 210 bytes. Under the 78-col limit, far over it
	// in bytes.
	wide := strings.Repeat("─", 70)
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","diagrams":[{"ascii":"` + wide + `"}]}]}`
	if f := findingBy(lintSrc(t, src), "ascii diagram line"); f != nil {
		t.Fatalf("70 columns must not trip a 78-column limit (byte-counting regression): %v", f)
	}

	// And a genuinely over-wide line still trips, reporting the COLUMN count.
	over := strings.Repeat("─", 90)
	src = `{"title":"T","nodes":[{"slug":"a","title":"A","diagrams":[{"ascii":"` + over + `"}]}]}`
	f := findingBy(lintSrc(t, src), "ascii diagram line")
	if f == nil {
		t.Fatalf("90 columns must trip the limit")
	}
	if !strings.Contains(f.Message, "(90)") {
		t.Fatalf("width must be reported in columns, got: %s", f.Message)
	}
	// The clip is rune-sliced — byte-slicing printed a broken glyph into the msg.
	if !utf8.ValidString(f.Message) {
		t.Fatalf("warning message contains an invalid UTF-8 sequence (byte-sliced clip): %q", f.Message)
	}
}

// styleABWrap composes `inner` (a raw block JSON literal) one level deeper via
// style_ab's `voices[].preview[]` — real production composition (blocks.go's
// collectBlockCSS comment: "the figure/flow/decisionmatrix/ask/reveal nested in
// a style_ab block's voices[].preview[]"), not a synthetic test fixture.
func styleABWrap(inner string) string {
	return `{"type":"style_ab","default":"a","voices":[{"id":"a","label":"A","preview":[` + inner + `]}]}`
}

// badCallout is the exact A/B the strategist ran: `bodyy` for `body`. At depth
// 0 (authored directly in blocks[]) this has always warned; the bug was that
// the identical typo said nothing one container deeper.
const badCallout = `{"type":"callout","kind":"glow","lead":"L","bodyy":"B"}`

// TestLintMisspelledFieldNestedAtDepth is the acceptance test the brief asks
// for verbatim: the SAME misspelled field on a composed primitive must warn at
// depth 0, 1, and 3 — not just at the top level. Depth is real style_ab
// composition, nested style_ab-in-style_ab to reach depth 3, so this exercises
// the actual renderer's composition path, not a stand-in for it.
func TestLintMisspelledFieldNestedAtDepth(t *testing.T) {
	depth0 := badCallout
	depth1 := styleABWrap(badCallout)
	depth3 := styleABWrap(styleABWrap(styleABWrap(badCallout)))

	for _, tc := range []struct {
		name, block string
	}{
		{"depth0", depth0},
		{"depth1", depth1},
		{"depth3", depth3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` + tc.block + `]}]}`
			f := findingBy(lintSrc(t, src), "did you mean 'body'")
			if f == nil || f.Level != "warn" {
				t.Fatalf("%s: expected near-miss 'body' warn to reach a nested callout, got %v", tc.name, lintSrc(t, src))
			}
		})
	}
}

// TestLintNestedRecursionHasNoDepthCap proves the walker does not stop early:
// a misspelled field 5 containers deep (band > row > grid > band > panel is the
// shape the layout-language design note gives as "known to render" — style_ab
// nested 5 deep is the same shape with primitives that exist today) still
// warns.
func TestLintNestedRecursionHasNoDepthCap(t *testing.T) {
	deep := badCallout
	for i := 0; i < 5; i++ {
		deep = styleABWrap(deep)
	}
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` + deep + `]}]}`
	f := findingBy(lintSrc(t, src), "did you mean 'body'")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected the near-miss warn to survive 5 levels of nesting (no depth cap), got %v", lintSrc(t, src))
	}
}

// TestLintNestedUnknownTypeStaysSilent proves the deliberate asymmetry: an
// unregistered "type" found while recursing (e.g. a future data shape that
// reuses "type" for something unrelated) must NOT be flagged as "unknown block
// type" just because it is nested — only known types get validated at depth.
// Flagging every nested "type" key regardless of registration would false-
// positive on real shipped docs (inline content spans already cover the
// registered case; this proves the unregistered case is silent, not loud).
func TestLintNestedUnknownTypeStaysSilent(t *testing.T) {
	inner := `{"type":"not-a-real-primitive","whatever":"x"}`
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[` + styleABWrap(inner) + `]}]}`
	if f := findingBy(lintSrc(t, src), "unknown block type"); f != nil {
		t.Fatalf("a nested unregistered type must not be flagged as an unknown BLOCK type (that check is for authored blocks[] entries only): %v", f)
	}
}

// TestLintNestedRecursionReachedByLint is the WIRING test — the class of
// mistake commit 2462bae shipped: a validator can be fully correct and unit
// tested in isolation while being unreachable from the actual lint path. This
// mutates the real call site (lintBlocks) via a second, hand-rolled copy of the
// old (non-recursive) behavior and proves that copy FAILS the nested case —
// i.e. that TestLintMisspelledFieldNestedAtDepth actually exercises the new
// code, not a no-op.
func TestLintNestedRecursionReachedByLint(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	doc := parseDoc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[`+styleABWrap(badCallout)+`]}]}`)

	// The real, wired path: must warn.
	if f := findingBy(lintDoc(doc, reg), "did you mean 'body'"); f == nil {
		t.Fatalf("expected the wired lint path to catch the nested typo")
	}

	// The old, un-recursive shape (top-level only, mirroring lintBlocks before
	// this change): must NOT warn — proving the new coverage is real, not
	// coincidental with some other check.
	node, _ := omap(list(doc, "nodes")[0])
	oldShape := lintBlocksTopLevelOnly(node, "a", reg)
	if f := findingBy(oldShape, "did you mean 'body'"); f != nil {
		t.Fatalf("top-level-only lint unexpectedly caught a nested typo — the depth test proves nothing: %v", f)
	}
}

// lintBlocksTopLevelOnly is the pre-fix shape of lintBlocks, kept only as the
// mutation baseline for TestLintNestedRecursionReachedByLint above — it must
// never be called from production code.
func lintBlocksTopLevelOnly(node *wire.OrderedMap, slug string, reg *registry.Registry) []registry.Finding {
	var out []registry.Finding
	for _, bv := range list(node, "blocks") {
		b, ok := omap(bv)
		if !ok {
			continue
		}
		typ := str(b, "type")
		if typ == "" || !reg.Has(typ) {
			continue
		}
		for _, f := range reg.Validate(typ, b) {
			if f.Slug == "" {
				f.Slug = slug
			}
			out = append(out, f)
		}
	}
	return out
}

// TestLintFigureUnmatchedNameIsLoud is Job 3: figure's whole template body is
// an if/eq('name', …)/then chain with no else — an unrecognized (or absent-but-
// nonempty) `name` used to render "" with no warning, no error, at any depth.
func TestLintFigureUnmatchedNameIsLoud(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[{"type":"figure","name":"totally-made-up","caption":"C"}]}]}`
	f := findingBy(lintSrc(t, src), "not a recognized value")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected figure's unmatched name to warn, got %v", lintSrc(t, src))
	}
	if !strings.Contains(f.Message, "balloon-playful") {
		t.Fatalf("expected the warning to name the known variant, got: %s", f.Message)
	}
}

// A REGISTERED figure name must stay clean — no false positive on the one
// variant that exists.
func TestLintFigureKnownNameIsClean(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[{"type":"figure","name":"balloon-playful"}]}]}`
	if f := findingBy(lintSrc(t, src), "not a recognized value"); f != nil {
		t.Fatalf("known figure name must not warn: %v", f)
	}
}

// TestVariantSelectorDetectionIsNarrow proves detectVariantSelector does NOT
// fire on the many templates that use if/no-else for ONE optional decoration
// alongside other, unconditional content (the common, safe shape) — only on a
// template whose ENTIRE body is the union. False-positiving here is exactly
// the "cries wolf" failure the gate forbids.
func TestVariantSelectorDetectionIsNarrow(t *testing.T) {
	// One conditional decoration plus unconditional chrome: NOT the pure shape.
	mixed := []any{
		"<div>",
		map[string]any{"if": map[string]any{"eq": []any{"name", "x"}}, "then": []any{"deco"}},
		map[string]any{"esc": "title"},
	}
	if _, ok := detectVariantSelector(mixed); ok {
		t.Fatalf("a template with unconditional content must not be treated as a pure variant selector")
	}
	// figure's real shape (single if/eq/then, no else, nothing else in the body).
	pure := []any{
		map[string]any{"if": map[string]any{"eq": []any{"name", "balloon-playful"}}, "then": []any{"<svg/>"}},
	}
	sel, ok := detectVariantSelector(pure)
	if !ok || sel.field != "name" || !sel.values["balloon-playful"] {
		t.Fatalf("expected figure's real shape to be detected as a pure variant selector, got %+v ok=%v", sel, ok)
	}
}
