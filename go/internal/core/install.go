package core

import (
	"encoding/json"
	"fmt"
	"sort"

	"stddoc/internal/library"
	"stddoc/internal/registry"
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
	for _, t := range names {
		tmpl := templates[t]
		reg.Register(t, func(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
			return template.Render(tmpl, block, ctx)
		}, cssMap[t])
	}

	reg.Register("sections", sectionsRender, cssMap["sections"])
	reg.Register("diagrams", diagramsRender, cssMap["diagrams"])
	reg.Register("statetrack", statetrackRender, cssMap["statetrack"])
	reg.Register("swimlane", swimlaneRender, cssMap["swimlane"])
	reg.Register("tree", treeRender, cssMap["tree"])
	// diagram — raw-source diagram with best-engine-per-type routing (the
	// diagram team's vetted standard, shipped as data in diagram_engines.json).
	// Purely additive; complements the structured swimlane/tree/statetrack.
	reg.Register("diagram", diagramRenderWith(loadDiagramEngineTable(lib.DiagramEnginesJSON)), cssMap["diagram"])
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
