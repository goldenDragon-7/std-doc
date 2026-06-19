// Package registry is the clean-room dispatch table: type -> render func, with a
// boundary. An unknown type or a failing primitive yields a visible error block
// (the Sphinx rule), never an exception that breaks the page and never a silent
// drop. CSS for each type rides alongside and
// is deduped/emitted once by the core.
package registry

import (
	"sort"
	"strings"

	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// RenderFunc draws one block of a given type.
type RenderFunc func(block *wire.OrderedMap, ctx *template.Ctx) (string, error)

// Finding is one lint result. Level is "error" (aborts publish) or "warn"
// (reported, never aborts). Slug scopes the finding to the offending node;
// Message is human-readable. Mirrors the Python Finding namedtuple.
type Finding struct {
	Level   string
	Slug    string
	Message string
}

// ValidateFunc is the OPTIONAL per-primitive structural check. It returns
// findings for a malformed block; a nil/empty slice means the block is valid.
// A primitive that registers no validator is simply not validated — exactly
// the contract self-doc documents ("validate (optional)").
type ValidateFunc func(block *wire.OrderedMap) []Finding

// Registry maps a block type to its render func, static CSS, and optional
// validator.
type Registry struct {
	funcs      map[string]RenderFunc
	css        map[string]string
	validators map[string]ValidateFunc
}

// New returns an empty registry.
func New() *Registry {
	return &Registry{
		funcs:      map[string]RenderFunc{},
		css:        map[string]string{},
		validators: map[string]ValidateFunc{},
	}
}

// Register installs a render func (and its CSS, possibly "") under a type.
func (r *Registry) Register(typ string, fn RenderFunc, css string) {
	r.funcs[typ] = fn
	r.css[typ] = css
}

// RegisterValidator installs an optional validator for a type. Calling it more
// than once replaces the prior validator. Wholly optional: a type with no
// validator is never validated.
func (r *Registry) RegisterValidator(typ string, fn ValidateFunc) {
	r.validators[typ] = fn
}

// Validate dispatches to a type's validator, returning its findings. Returns nil
// when the type has no validator installed (not-validated, never an error).
func (r *Registry) Validate(typ string, block *wire.OrderedMap) []Finding {
	fn, ok := r.validators[typ]
	if !ok {
		return nil
	}
	return fn(block)
}

// Has reports whether a type is registered.
func (r *Registry) Has(typ string) bool {
	_, ok := r.funcs[typ]
	return ok
}

// CSS returns the static CSS for a type ("" if none/unknown).
func (r *Registry) CSS(typ string) string { return r.css[typ] }

// Types returns registered types sorted (matches Registry.types()).
func (r *Registry) Types() []string {
	out := make([]string, 0, len(r.funcs))
	for t := range r.funcs {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// Render dispatches with a boundary. It always returns a string and a nil error
// — a failure becomes a visible, self-contained error block, exactly like the
// Python registry, so a plugin can never break (or abort) the page.
func (r *Registry) Render(typ string, block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	fn, ok := r.funcs[typ]
	if !ok {
		return errorBlock("unknown type", typ, ""), nil
	}
	out, err := fn(block, ctx)
	if err != nil {
		return errorBlock("primitive raised", typ, err.Error()), nil
	}
	return out, nil
}

// errorBlock is the registry's error-boundary output.
func errorBlock(kind, typeName, detail string) string {
	msg := "std-doc render error — " + kind + ": block type " + repr(typeName)
	if detail != "" {
		msg += " — " + detail
	}
	return "<div class='std-doc-error' style='border:2px solid #b00;" +
		"background:#fff0f0;color:#900;padding:.6em .8em;margin:.6em 0;" +
		"font-family:monospace;white-space:pre-wrap'>" +
		wire.HTMLEscape(msg) + "</div>"
}

// repr renders a Python repr() of a string (single-quoted) for the error text.
func repr(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "\\'") + "'"
}
