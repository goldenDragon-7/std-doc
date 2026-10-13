package core

import (
	"encoding/json"
	"fmt"
	"sort"

	"stddoc/internal/flintbake"
	"stddoc/internal/library"
	"stddoc/internal/registry"
	"stddoc/internal/sanitize"
	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// buildRegistry installs every primitive: ALL declarative template-driven ones
// (rendered through the interpreter) and the hand-coded ones (sections,
// evidence, diagrams, statetrack, swimlane, tree). CSS for all types comes from
// the verbatim extracted dump.
//
// Template primitives are DATA the engine consumes: every entry in
// templates.json is registered automatically, so a new web-page behavior ships
// as a new template entry — never a Go edit and never a hardcoded allowlist
// (which is exactly how action/ask/prose/reveal got silently dropped before).
func buildRegistry(lib *library.Library) (*registry.Registry, error) {
	templates, err := template.LoadTemplates(lib.TemplatesJSON)
	if err != nil {
		return nil, err
	}
	var cssMap map[string]string
	if err := json.Unmarshal(lib.PrimitiveCSSJSON, &cssMap); err != nil {
		return nil, fmt.Errorf("core: primitive_css.json: %w", err)
	}

	reg := registry.New()
	// Register every declarative primitive the data provides — no allowlist.
	// Sorted for deterministic registration order.
	names := make([]string, 0, len(templates))
	for t := range templates {
		names = append(names, t)
	}
	sort.Strings(names)
	// Field names are derived from each template so a misspelled field is a
	// near-miss warning instead of a silent render-as-nothing.
	rawTmpl, err := rawTemplates(lib.TemplatesJSON)
	if err != nil {
		return nil, fmt.Errorf("core: templates.json (field derivation): %w", err)
	}
	for _, t := range names {
		tmpl := templates[t]
		reg.Register(t, func(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
			return template.Render(tmpl, block, ctx)
		}, cssMap[t])
		if raw, ok := rawTmpl[t]; ok {
			fv := fieldValidator(t, raw)
			if sel, isVariant := detectVariantSelector(raw); isVariant {
				vv := variantValidator(t, sel)
				reg.RegisterValidator(t, func(b *wire.OrderedMap) []registry.Finding {
					return append(fv(b), vv(b)...)
				})
			} else {
				reg.RegisterValidator(t, fv)
			}
		}
	}

	reg.Register("sections", sectionsRender, cssMap["sections"])
	// Hand-coded primitives derive no field names from templates.json, so they
	// had NO validator — an unknown key inside a section or item was dropped in
	// silence. See sections_validator.go.
	reg.RegisterValidator("sections", sectionsValidator)
	reg.Register("diagrams", diagramsRender, cssMap["diagrams"])
	reg.Register("statetrack", statetrackRender, cssMap["statetrack"])
	reg.Register("swimlane", swimlaneRender, cssMap["swimlane"])
	reg.Register("tree", treeRender, cssMap["tree"])
	// Collapse + link styling ride as VARIANT css: emitted only for trees that
	// use them, so every existing tree page stays byte-identical.
	reg.RegisterVariantCSS("tree", treeVariantCSS)
	// diagram — raw-source diagram with best-engine-per-type routing (the
	// diagram team's vetted standard, shipped as data in diagram_engines.json).
	// Purely additive; complements the structured swimlane/tree/statetrack.
	reg.Register("diagram", diagramRenderWith(loadDiagramEngineTable(lib.DiagramEnginesJSON), lib.FlintSVGs, flintbake.Renderer(lib.Root)), cssMap["diagram"])
	// canvas — a live co-drawing surface (codraw/Excalidraw) embedded in the page.
	// Additive; live emits a sandboxed iframe mount, freeze bakes it to inline SVG.
	reg.Register("canvas", canvasRender, cssMap["canvas"])
	// html — the bounded-value ESCAPE HATCH, and the only untrusted slot in a
	// std-doc. Core-owned rather than a data-template for one reason: it is
	// the only primitive that runs a security gate, and a gate expressed as
	// data could be disabled by editing data. A nil policy makes it refuse.
	htmlPolicy, perr := sanitize.LoadPolicy(lib.HTMLWhitelistJSON)
	if perr != nil && len(lib.HTMLWhitelistJSON) > 0 {
		return nil, fmt.Errorf("core: %w", perr)
	}
	reg.Register("html", htmlBlockRenderWith(htmlPolicy), cssMap["html"])
	reg.Register("evidence", func(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
		return ctx.RenderEvidence(block), nil
	}, cssMap["evidence"])

	// Collision-free inline emphasis atoms (text/strong/soft/kbd) — NOT the full
	// page_atoms set, whose block atoms (kicker/code/…) would clobber library
	// primitives of the same name. These let reveal/callout compose escaped inline
	// runs (the inline-atom registration; kbd = an inline key chip).
	atoms, err := template.LoadTemplates(lib.PageAtomsJSON)
	if err != nil {
		return nil, fmt.Errorf("core: page_atoms.json: %w", err)
	}
	for _, t := range []string{"text", "strong", "soft", "kbd"} {
		body, ok := atoms[t]
		if !ok {
			return nil, fmt.Errorf("core: inline atom %q missing from page_atoms.json (library loaded from %q — it may be stale or wrong; set STDDOC_LIB or --plugins to the correct stddoc-lib/)", t, lib.Root)
		}
		tmpl := body
		reg.Register(t, func(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
			return template.Render(tmpl, block, ctx)
		}, "")
	}

	return reg, nil
}

// buildPageRegistry is the layout:page registry: the full library plus the
// raw-free page atoms family. Atoms are declarative
// templates rendered through the interpreter; their styling rides in the theme,
// so they carry no css().
func buildPageRegistry(lib *library.Library) (*registry.Registry, error) {
	reg, err := buildRegistry(lib)
	if err != nil {
		return nil, err
	}
	atoms, err := template.LoadTemplates(lib.PageAtomsJSON)
	if err != nil {
		return nil, fmt.Errorf("core: page_atoms.json: %w", err)
	}
	for t, body := range atoms {
		tmpl := body
		reg.Register(t, func(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
			return template.Render(tmpl, block, ctx)
		}, "")
	}
	return reg, nil
}
