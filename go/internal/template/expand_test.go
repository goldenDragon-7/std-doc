package template

import (
	"strings"
	"testing"

	"stddoc/internal/wire"
)

// mustData parses a JSON source-data object into the *wire.OrderedMap shape the
// expander binds against (same decoder the engine uses for source.json).
func mustData(t *testing.T, js string) *wire.OrderedMap {
	t.Helper()
	om, err := wire.ParseOrderedJSON([]byte(js))
	if err != nil {
		t.Fatalf("parse data: %v", err)
	}
	return om
}

// mustSpec parses an assembly spec (template-node JSON) the way page_templates
// are loaded.
func mustSpec(t *testing.T, js string) []any {
	t.Helper()
	v, err := DecodeNodes([]byte(js))
	if err != nil {
		t.Fatalf("decode spec: %v", err)
	}
	l, ok := v.([]any)
	if !ok {
		t.Fatalf("spec is %T, want []any", v)
	}
	return l
}

func blockTypes(blocks []*wire.OrderedMap) []string {
	var out []string
	for _, b := range blocks {
		t, _ := b.Get("type")
		s, _ := t.(string)
		out = append(out, s)
	}
	return out
}

// Expand turns friendly node DATA + a data-driven assembly SPEC into a real
// primitive blocks[] stream — the whole point of layer 2. This is the proof it
// works end to end: a decision-board-shaped spec over board-shaped data must
// emit stats + per-section callouts + an ask, with fields BOUND from the data.
func TestExpand_DecisionBoardShape(t *testing.T) {
	data := mustData(t, `{
      "kpis": [
        {"v": "2", "cls": "p", "l": "need your call"},
        {"v": "1", "cls": "go", "l": "parked"}
      ],
      "sections": [
        {"heading": "Release gates",
         "cards": [{"class": "good", "lead": "Three ways it stops.", "paras": ["Only one is a gate."]}],
         "question": {"id": "d01", "prompt": "Does it stand?",
                      "options": [{"value": "yes", "label": "It stands."}]}},
        {"heading": "Offsite backup",
         "cards": [{"class": "hold", "lead": "No copy off-site.", "paras": ["Costs nothing until it costs everything."]}]}
      ]
    }`)

	spec := mustSpec(t, `[
      {"block": "stats",
       "set": {"items": {"list": "kpis",
                          "set": {"value": {"@": "v"},
                                  "tone": {"map": "cls", "table": {"p": "purple", "go": "gold"}},
                                  "label": {"@": "l"}}}}},
      {"foreach": "sections", "do": [
        {"block": "callout", "set": {"variant": "info", "lead": {"@": "heading"}}},
        {"foreach": "cards", "do": [
          {"block": "callout",
           "set": {"variant": {"map": "class", "table": {"good": "ok", "hold": "warn"}},
                   "lead": {"@": "lead"},
                   "body": {"join": "paras", "sep": "\n\n"}}}
        ]},
        {"when": {"truthy": "question"}, "do": [
          {"block": "ask",
           "set": {"id": {"@": "question.id"},
                   "prompt": {"@": "question.prompt"},
                   "control": "radio",
                   "choices": {"list": "question.options",
                               "set": {"value": {"@": "value"}, "label": {"@": "label"}}}}}
        ]}
      ]}
    ]`)

	blocks, err := Expand(spec, data)
	if err != nil {
		t.Fatalf("Expand: %v", err)
	}

	got := blockTypes(blocks)
	// stats, then §1: heading-callout + 1 card-callout + ask, then §2: heading-callout + 1 card-callout (no question).
	want := []string{"stats", "callout", "callout", "ask", "callout", "callout"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("block types:\n got  %v\n want %v", got, want)
	}

	// The stats block must carry 2 bound items with tone mapped p->purple.
	items, _ := blocks[0].Get("items")
	il, _ := items.([]any)
	if len(il) != 2 {
		t.Fatalf("stats items = %d, want 2", len(il))
	}
	first, _ := il[0].(*wire.OrderedMap)
	if tone, _ := first.Get("tone"); tone != "purple" {
		t.Fatalf("kpi[0].tone = %v, want purple (mapped from cls=p)", tone)
	}
	if val, _ := first.Get("value"); val != "2" {
		t.Fatalf("kpi[0].value = %v, want 2", val)
	}

	// The card callout must have variant mapped good->ok and body joined from paras.
	card := blocks[2]
	if v, _ := card.Get("variant"); v != "ok" {
		t.Fatalf("card variant = %v, want ok (mapped from class=good)", v)
	}
	if lead, _ := card.Get("lead"); lead != "Three ways it stops." {
		t.Fatalf("card lead = %v", lead)
	}

	// The ask must have choices bound from question.options.
	ask := blocks[3]
	ch, _ := ask.Get("choices")
	cl, _ := ch.([]any)
	if len(cl) != 1 {
		t.Fatalf("ask choices = %d, want 1", len(cl))
	}
}

// A spec that names an op the expander does not know must fail LOUDLY with a
// message that names the bad op — never silently emit nothing (the exact
// silent-drop class this layer exists to kill).
func TestExpand_UnknownOpIsLoud(t *testing.T) {
	data := mustData(t, `{"x": 1}`)
	spec := mustSpec(t, `[{"blokc": "callout"}]`)
	_, err := Expand(spec, data)
	if err == nil {
		t.Fatal("expected a loud error for an unknown emit op, got nil")
	}
	if !strings.Contains(err.Error(), "blokc") {
		t.Fatalf("error should name the bad op %q, got: %v", "blokc", err)
	}
}
