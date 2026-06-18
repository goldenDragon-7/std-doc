package palette

import (
	"testing"

	"stddoc/internal/wire"
)

func build(t *testing.T, js string) *Palette {
	t.Helper()
	m, err := wire.ParseOrderedJSON([]byte(js))
	if err != nil {
		t.Fatal(err)
	}
	return New(m)
}

func TestCSSDeclaredOrder(t *testing.T) {
	p := build(t, `{"captain":{"label":"Captain","color":"#e0b341"},"eic":{"label":"Editor","color":"#4f9cf9"}}`)
	want := ":root{--ent-captain:#e0b341;--ent-eic:#4f9cf9;}"
	if got := p.CSS(); got != want {
		t.Errorf("CSS = %q, want %q", got, want)
	}
}

func TestEmptyPaletteNoRoot(t *testing.T) {
	p := New(nil)
	if got := p.CSS(); got != "" {
		t.Errorf("empty palette CSS = %q, want empty", got)
	}
}

func TestMissingColorInherits(t *testing.T) {
	p := build(t, `{"x":{"label":"X"}}`)
	if got := p.CSS(); got != ":root{--ent-x:inherit;}" {
		t.Errorf("CSS = %q", got)
	}
}

func TestVarAndUndeclaredLoud(t *testing.T) {
	p := build(t, `{"captain":{"color":"#fff"}}`)
	if v, err := p.Var("captain"); err != nil || v != "var(--ent-captain)" {
		t.Errorf("Var(captain) = %q, %v", v, err)
	}
	if _, err := p.Var("ghost"); err == nil {
		t.Error("Var(ghost) should be a loud PaletteError")
	}
}

func TestExpandChips(t *testing.T) {
	p := build(t, `{"captain":{"color":"#fff"}}`)
	got, err := p.ExpandChips("hi {{ent:captain}}Cap & co{{/}} <end>")
	if err != nil {
		t.Fatal(err)
	}
	if want := "hi <span class='ent-chip' style='--c:var(--ent-captain);background:color-mix(in srgb, var(--c) 18%, transparent);border:1px solid var(--c);color:var(--c);padding:.05em .45em;border-radius:.7em;font-weight:600'>Cap &amp; co</span> &lt;end&gt;"; got != want {
		t.Errorf("ExpandChips =\n%q\nwant\n%q", got, want)
	}
}
