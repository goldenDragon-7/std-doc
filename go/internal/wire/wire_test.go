package wire

import (
	"testing"
)

// Mirror of engine/tests/test_wire_spec.py: the escape table, ampersand-first
// (no double-escape), non-ASCII passthrough, and scalar/number/bool/None form.

func TestEscapeTable(t *testing.T) {
	rows := map[string]string{
		"&":  "&amp;",
		"<":  "&lt;",
		">":  "&gt;",
		"\"": "&quot;",
		"'":  "&#x27;",
	}
	for in, want := range rows {
		if got := Esc(in); got != want {
			t.Errorf("Esc(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAmpersandFirstNoDoubleEscape(t *testing.T) {
	if got := Esc("<"); got != "&lt;" {
		t.Errorf("Esc(<) = %q", got)
	}
	if got := Esc("a&b<c"); got != "a&amp;b&lt;c" {
		t.Errorf("Esc(a&b<c) = %q, want a&amp;b&lt;c", got)
	}
}

func TestNonASCIIPassthrough(t *testing.T) {
	if got := Esc("café — §"); got != "café — §" {
		t.Errorf("Esc non-ascii = %q", got)
	}
}

func TestScalarFormatting(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{5, "5"},
		{1.0, "1.0"},
		{1.5, "1.5"},
		{true, "True"},
		{false, "False"},
		{nil, ""},
	}
	for _, c := range cases {
		if got := Esc(c.in); got != c.want {
			t.Errorf("Esc(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// JSON numbers arrive as json.Number; int vs float distinction must survive.
func TestJSONNumberParity(t *testing.T) {
	m, err := ParseOrderedJSON([]byte(`{"i":5,"f":1.0,"g":1.5,"big":1.50,"exp":1e3}`))
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{"i": "5", "f": "1.0", "g": "1.5", "big": "1.5", "exp": "1000.0"}
	for k, want := range cases {
		v, _ := m.Get(k)
		if got := PyStr(v); got != want {
			t.Errorf("PyStr(json %s) = %q, want %q", k, got, want)
		}
	}
}

// OrderedMap must re-emit keys in document order, never sorted.
func TestOrderedMapInsertionOrder(t *testing.T) {
	m, err := ParseOrderedJSON([]byte(`{"zebra":1,"alpha":2,"mid":3,"beta":4}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"zebra", "alpha", "mid", "beta"}
	got := m.Keys()
	if len(got) != len(want) {
		t.Fatalf("keys = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("key[%d] = %q, want %q (sorted? %v)", i, got[i], want[i], got)
		}
	}
}

// Nested objects preserve order at depth.
func TestOrderedMapNested(t *testing.T) {
	m, _ := ParseOrderedJSON([]byte(`{"outer":{"z":1,"a":2},"list":[{"k":1,"j":2}]}`))
	outer, _ := m.Get("outer")
	om, ok := outer.(*OrderedMap)
	if !ok {
		t.Fatalf("nested object not *OrderedMap: %T", outer)
	}
	if k := om.Keys(); len(k) != 2 || k[0] != "z" || k[1] != "a" {
		t.Errorf("nested order = %v, want [z a]", k)
	}
}

func TestTrailingNewlinePolicy(t *testing.T) {
	if got := DocTreePageBytes("x</html>"); got != "x</html>" {
		t.Errorf("doc-tree page should have no trailing newline: %q", got)
	}
	if got := StandalonePageBytes("x</html>"); got != "x</html>\n" {
		t.Errorf("standalone page should end with one newline: %q", got)
	}
	if got := StandalonePageBytes("x</html>\n"); got != "x</html>\n" {
		t.Errorf("standalone page should not double the newline: %q", got)
	}
}
