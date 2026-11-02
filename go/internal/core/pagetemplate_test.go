package core

import (
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/library"
	"stddoc/internal/wire"
)

func capLib(t *testing.T) *library.Library {
	t.Helper()
	// test file lives in go/internal/core/; the library is go/stddoc-lib/.
	root, err := filepath.Abs(filepath.Join("..", "..", "stddoc-lib"))
	if err != nil {
		t.Fatal(err)
	}
	lib, err := library.Load(root)
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	return lib
}

const boardDoc = `{
  "title": "Board",
  "palette": {"green": {"color": "#10b981"}, "gold": {"color": "#fbbf24"}, "purple": {"color": "#a78bfa"}, "accent": {"color": "#22d3ee"}},
  "nodes": [{
    "slug": "board", "title": "Board", "template": "decision-board",
    "lede": "On one page.",
    "kpis": [{"v": "2", "cls": "p", "l": "your call"}],
    "sections": [{
      "n": "01", "heading": "Gates", "intro": "the premise",
      "cards": [{"class": "good", "lead": "Three ways.", "paras": ["Only one is a gate."]}],
      "question": {"id": "d01", "prompt": "Does it stand?",
                   "options": [{"value": "yes", "label": "It stands."}]}
    }]
  }]
}`

// The template path must assemble real primitives from friendly data — proven by
// rendering, the only evidence that counts (Covenant VI).
func TestPublish_DecisionBoardRendersPrimitives(t *testing.T) {
	doc, err := wire.ParseOrderedJSON([]byte(boardDoc))
	if err != nil {
		t.Fatal(err)
	}
	pages, err := Publish(doc, "techno-dark", capLib(t))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	html := pages["board.html"]
	for _, want := range []string{
		"class='stats",            // kpis -> stats
		"pattern-header",          // section heading
		"class='callout",          // lede + card
		"data-cf-control='radio'", // question -> ask
		"var(--ent-green)",        // class=good mapped to the green palette kind
	} {
		if !strings.Contains(html, want) {
			t.Errorf("rendered board missing %q", want)
		}
	}
}

// A node naming a template that does not exist must fail LOUDLY at publish,
// naming the gap and the available set — the pre-run error whose ABSENCE is the
// whole "capability that cannot be found" defect this layer exists to end.
func TestPublish_UnknownTemplateIsLoud(t *testing.T) {
	doc, _ := wire.ParseOrderedJSON([]byte(`{"title":"x","nodes":[{"slug":"p","title":"P","template":"desicion-board"}]}`))
	_, err := Publish(doc, "techno-dark", capLib(t))
	if err == nil {
		t.Fatal("expected a loud error for an unknown template, got nil")
	}
	if !strings.Contains(err.Error(), "desicion-board") {
		t.Fatalf("error must name the bad template; got: %v", err)
	}
}

// REGRESSION (observed RED 2026-11-02): before the lint template-skip, a
// templated node's own fields (n/heading/cards/question) were validated against
// the STANDARD sections[] schema and produced a false "renders as NOTHING"
// warning for every one of them — 17 bogus warnings on the real board. The
// template owns those fields; lint must stay silent on them.
func TestLint_SkipsTemplatedNodeFields(t *testing.T) {
	doc, _ := wire.ParseOrderedJSON([]byte(boardDoc))
	findings, err := Lint(doc, capLib(t))
	if err != nil {
		t.Fatalf("lint: %v", err)
	}
	for _, f := range findings {
		if strings.Contains(f.Message, "renders as NOTHING") {
			t.Errorf("templated node should not trip standard-schema lint: %q", f.Message)
		}
	}
}
