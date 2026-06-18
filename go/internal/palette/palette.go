// Package palette compiles a doc's named-entity palette to CSS custom
// properties and resolves references to var(--ent-<key>). Port of
// engine/core/palette.py; contract: wire-spec §5.
//
// Referencing an undeclared entity is a LOUD error (PaletteError) — a typo must
// never silently render a colorless component.
package palette

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"stddoc/internal/wire"
)

// PaletteError is returned when a primitive references an entity not in the
// declared palette.
type PaletteError struct {
	Key      string
	Declared []string
}

func (e *PaletteError) Error() string {
	return fmt.Sprintf("unknown palette entity %q; declared: %v", e.Key, e.Declared)
}

// Palette is an insertion-ordered set of named entities, each {label, color}.
type Palette struct {
	spec *wire.OrderedMap // key -> *wire.OrderedMap{label,color}
}

// New builds a Palette from the root.palette object (may be nil/empty).
func New(spec *wire.OrderedMap) *Palette {
	if spec == nil {
		spec = wire.NewOrderedMap()
	}
	return &Palette{spec: spec}
}

// Has reports whether key is declared.
func (p *Palette) Has(key string) bool {
	_, ok := p.spec.Get(key)
	return ok
}

// Keys returns declared entity keys in insertion order.
func (p *Palette) Keys() []string { return p.spec.Keys() }

func (p *Palette) entity(key string) (*wire.OrderedMap, error) {
	v, ok := p.spec.Get(key)
	if !ok {
		declared := append([]string(nil), p.spec.Keys()...)
		sort.Strings(declared) // Python reports sorted(self.spec)
		return nil, &PaletteError{Key: key, Declared: declared}
	}
	ent, _ := v.(*wire.OrderedMap)
	return ent, nil
}

// Color returns the entity's color (default "" when absent), matching
// Palette.color() in the reference.
func (p *Palette) Color(key string) (string, error) {
	ent, err := p.entity(key)
	if err != nil {
		return "", err
	}
	return omStr(ent, "color", ""), nil
}

// Label returns the entity's label, defaulting to the key (Palette.label()).
func (p *Palette) Label(key string) (string, error) {
	ent, err := p.entity(key)
	if err != nil {
		return "", err
	}
	return omStr(ent, "label", key), nil
}

// Var returns the CSS reference var(--ent-<key>); loud if undeclared.
func (p *Palette) Var(key string) (string, error) {
	if _, err := p.entity(key); err != nil {
		return "", err
	}
	return "var(--ent-" + key + ")", nil
}

// CSS compiles the palette to :root{--ent-<key>:<color>;...} in declared order.
// An empty palette yields "" (no stray :root block). Missing color -> inherit.
func (p *Palette) CSS() string {
	if p.spec.Len() == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(":root{")
	for _, k := range p.spec.Keys() {
		v, _ := p.spec.Get(k)
		ent, _ := v.(*wire.OrderedMap)
		b.WriteString("--ent-")
		b.WriteString(k)
		b.WriteByte(':')
		b.WriteString(omStr(ent, "color", "inherit"))
		b.WriteByte(';')
	}
	b.WriteString("}")
	return b.String()
}

var chipPat = regexp.MustCompile(`(?s)\{\{ent:([A-Za-z0-9_-]+)\}\}(.*?)\{\{/\}\}`)

// ExpandChips expands inline {{ent:key}}label{{/}} markup into colored chip
// spans. Surrounding text and labels are HTML-escaped; an undeclared entity is
// a loud PaletteError. Port of expand_chips().
func (p *Palette) ExpandChips(text string) (string, error) {
	var out strings.Builder
	pos := 0
	for _, m := range chipPat.FindAllStringSubmatchIndex(text, -1) {
		out.WriteString(wire.HTMLEscape(text[pos:m[0]]))
		key := text[m[2]:m[3]]
		label := text[m[4]:m[5]]
		v, err := p.Var(key)
		if err != nil {
			return "", err
		}
		out.WriteString("<span class='ent-chip' style='--c:" + v + ";" +
			"background:color-mix(in srgb, var(--c) 18%, transparent);" +
			"border:1px solid var(--c);color:var(--c);" +
			"padding:.05em .45em;border-radius:.7em;font-weight:600'>" +
			wire.HTMLEscape(label) + "</span>")
		pos = m[1]
	}
	out.WriteString(wire.HTMLEscape(text[pos:]))
	return out.String(), nil
}

func omStr(m *wire.OrderedMap, key, def string) string {
	if m == nil {
		return def
	}
	if v, ok := m.Get(key); ok {
		if s, ok := v.(string); ok {
			return s
		}
		return wire.PyStr(v)
	}
	return def
}
