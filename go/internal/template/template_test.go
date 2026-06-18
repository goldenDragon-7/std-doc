package template

import (
	"encoding/json"
	"os"
	"testing"

	"stddoc/internal/wire"
)

// blockToOMap re-encodes a decoded test block into source-data shape
// (*wire.OrderedMap), the way real source.json arrives.
func blockToOMap(t *testing.T, block any) *wire.OrderedMap {
	t.Helper()
	raw, err := json.Marshal(block)
	if err != nil {
		t.Fatal(err)
	}
	m, err := wire.ParseOrderedJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// TestBatteryParity proves the interpreter reproduces the Python engine's bytes
// for hero / decisionmatrix / descent — the three hardest shapes (interpolation,
// nested iteration, look-ahead + reduction). Goldens seeded from the reference.
func TestBatteryParity(t *testing.T) {
	tmplRaw, err := os.ReadFile("../../stddoc-lib/templates.json")
	if err != nil {
		t.Fatal(err)
	}
	templates, err := LoadTemplates(tmplRaw)
	if err != nil {
		t.Fatal(err)
	}
	batRaw, err := os.ReadFile("testdata/battery.json")
	if err != nil {
		t.Fatal(err)
	}
	var battery []struct {
		Type     string `json:"type"`
		Block    any    `json:"block"`
		Expected string `json:"expected"`
	}
	if err := json.Unmarshal(batRaw, &battery); err != nil {
		t.Fatal(err)
	}
	ctx := &Ctx{}
	for i, c := range battery {
		tmpl, ok := templates[c.Type]
		if !ok {
			t.Fatalf("no template %q", c.Type)
		}
		got, err := Render(tmpl, blockToOMap(t, c.Block), ctx)
		if err != nil {
			t.Fatalf("[%d %s] render error: %v", i, c.Type, err)
		}
		if got != c.Expected {
			t.Errorf("[%d %s] drift:\n got: %q\nwant: %q", i, c.Type, got, c.Expected)
		}
	}
}

// TestScopeRuleNoFallthrough pins the load-bearing rule (template.py:71-81): a
// bare field resolves against the nearest @item only, never the parent scope.
func TestScopeRuleNoFallthrough(t *testing.T) {
	data := blockToOMap(t, map[string]any{
		"name": "outer",
		"rows": []any{map[string]any{"label": "inner"}},
	})
	// `each` over rows; inside, bare `name` is absent on the inner item and must
	// render EMPTY (not "outer"). `@root.name` reaches outward explicitly.
	tmpl := []any{
		map[string]any{
			"each": "rows",
			"body": []any{
				"[", map[string]any{"esc": "label"},
				"|", map[string]any{"esc": "name"}, // bare -> empty (no fall-through)
				"|", map[string]any{"esc": "@root.name"}, // explicit -> "outer"
				"]",
			},
		},
	}
	got, err := Render(tmpl, data, &Ctx{})
	if err != nil {
		t.Fatal(err)
	}
	if want := "[inner||outer]"; got != want {
		t.Errorf("scope rule: got %q, want %q", got, want)
	}
}

// TestEachLookahead exercises @first/@last/@next/@index in a join.
func TestEachLookahead(t *testing.T) {
	data := blockToOMap(t, map[string]any{"xs": []any{"a", "b", "c"}})
	tmpl := []any{map[string]any{
		"each": "xs", "join": ",",
		"body": []any{
			map[string]any{"esc": "@index"}, ":", map[string]any{"esc": "@item"},
			map[string]any{"if": map[string]any{"truthy": "@last"}, "then": []any{"$"}},
		},
	}}
	got, err := Render(tmpl, data, &Ctx{})
	if err != nil {
		t.Fatal(err)
	}
	if want := "0:a,1:b,2:c$"; got != want {
		t.Errorf("each lookahead: got %q, want %q", got, want)
	}
}

// TestLookupAndDefault covers closed-table lookup (trusted token, not escaped),
// upper flag, and the loud miss.
func TestLookupAndDefault(t *testing.T) {
	data := blockToOMap(t, map[string]any{"s": "live"})
	tmpl := []any{map[string]any{
		"lookup": "s", "upper": true,
		"table": map[string]any{"LIVE": "b-live"}, "default": "b-wip",
	}}
	got, _ := Render(tmpl, data, &Ctx{})
	if got != "b-live" {
		t.Errorf("lookup upper: got %q", got)
	}
	// miss -> default
	miss := blockToOMap(t, map[string]any{"s": "other"})
	got2, _ := Render(tmpl, miss, &Ctx{})
	if got2 != "b-wip" {
		t.Errorf("lookup default: got %q", got2)
	}
}
