package core

import (
	"strings"
	"testing"
)

// TestTextAtomComposesContent covers a real, MEASURED silent content-loss
// bug found by stddoc-lint-hardener's reachability diff: the `text` page
// atom (go/stddoc-lib/page_atoms.json) was `{"esc": "s"}` only, so authored
// paragraphs shaped as {"type":"text","content":[{"type":"text","s":".."},
// {"type":"code","s":".."}]} — the SAME container-composing-inline-runs
// pattern kicker/heading already use — rendered as literally empty strings.
// Hit in production on two shipped docs: examples/starter-no-nav/source.json
// and style-interview/demo/source.json ("Meet std-doc", the onboarding
// tutorial — the first thing a stranger sees).
//
// Fix: `text` now composes `content` in addition to escaping `s` — matching
// kicker/heading's own pattern. Safe for the LEAF usage (a text atom that
// only ever carries `s`, no `content`): compose on an absent field resolves
// to nil, which the interpreter's compose op renders as "" (see
// go/internal/template/template.go's compose handler, `case nil: blocks =
// nil`), so every existing leaf-text span (the overwhelming majority of
// `text` atom usage across the corpus) renders byte-for-byte unchanged.
func TestTextAtomComposesContent(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildPageRegistry(lib)
	if err != nil {
		t.Fatalf("build page registry: %v", err)
	}
	ctx := makeCtx(nil, reg, nil)

	// Container usage: a paragraph composed of inline text + code runs — the
	// exact shape from examples/starter-no-nav/source.json.
	block := parseDoc(t, `{
		"type": "text",
		"content": [
			{"type": "text", "s": "Set "},
			{"type": "code", "s": "\"layout\": \"no-nav\""},
			{"type": "text", "s": " at the top of source.json."}
		]
	}`)
	out, err := reg.Render("text", block, ctx)
	if err != nil {
		t.Fatalf("render text (container form): %v", err)
	}
	if out == "" {
		t.Fatal("text: container form (content[]) rendered EMPTY — the exact production bug")
	}
	if !strings.Contains(out, "Set ") || !strings.Contains(out, "at the top of source.json.") {
		t.Errorf("text: expected composed inline runs to render, got %q", out)
	}
	if !strings.Contains(out, `<code>&quot;layout&quot;: &quot;no-nav&quot;</code>`) {
		t.Errorf("text: expected the nested code run to render, got %q", out)
	}
}

// TestTextAtom_LeafUsageUnaffected proves the fix is additive: the ordinary
// leaf usage (`{"type":"text","s":"..."}`, no `content` field — the
// overwhelming majority of `text` atom usage in the corpus) renders
// byte-identically to before.
func TestTextAtom_LeafUsageUnaffected(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildPageRegistry(lib)
	if err != nil {
		t.Fatalf("build page registry: %v", err)
	}
	ctx := makeCtx(nil, reg, nil)

	block := parseDoc(t, `{"type": "text", "s": "plain leaf span"}`)
	out, err := reg.Render("text", block, ctx)
	if err != nil {
		t.Fatalf("render text (leaf form): %v", err)
	}
	if out != "plain leaf span" {
		t.Errorf("text: leaf usage must render byte-identically (just esc(s)), got %q", out)
	}
}
