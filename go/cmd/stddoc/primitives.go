package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"stddoc/internal/library"
)

// primitives.go — `stddoc primitives`: v0.11 "the discoverability release" S2.
// Lists every primitive with a one-line description and a pointer to its live
// entry in the Living Primitive Gallery (S1, examples/primitive-gallery/).
//
// The LIST of primitives is read from templates.json at runtime (lib.TemplatesJSON)
// — never hardcoded — so it can NEVER drift from what the engine actually
// registers: buildRegistry (internal/core/install.go) auto-registers every
// templates.json entry with no allowlist, and this command reads the exact same
// source data. Add a primitive to templates.json and it appears here for free;
// delete one and it disappears here too — zero double-bookkeeping.
//
// Descriptions are curated prose (oneLiners below) since templates.json carries
// no human-readable summary field. A type with no curated description still
// prints — with a generic fallback — so this command can never silently DROP a
// primitive just because nobody wrote a blurb for it yet.
func cmdPrimitives(args []string) error {
	plugins := ""
	for i := 0; i < len(args); i++ {
		if args[i] == "--plugins" && i+1 < len(args) {
			plugins = args[i+1]
			i++
		}
	}
	root, err := resolveLibRoot(plugins)
	if err != nil {
		return err
	}
	lib, err := library.Load(root)
	if err != nil {
		return err
	}

	var templates map[string]any
	if err := json.Unmarshal(lib.TemplatesJSON, &templates); err != nil {
		return fmt.Errorf("primitives: parse templates.json: %w", err)
	}

	names := make([]string, 0, len(templates))
	for t := range templates {
		switch t {
		case "children":
			continue // node-structural auto-block; never authored directly
		case "showcase":
			continue // CHROME primitive (the gallery's own "LIVE RENDER" box); listed separately below, no gallery page of its own
		}
		names = append(names, t)
	}
	sort.Strings(names)

	fmt.Println("Declarative primitives (data-driven — templates.json + primitive_css.json):")
	for _, t := range names {
		printPrimitiveLine(t, true)
	}

	fmt.Println()
	fmt.Println("Structural primitives (hand-coded Go RenderFunc — richer/composite shapes):")
	for _, t := range structuralPrimitives {
		printPrimitiveLine(t, t == "canvas") // canvas got a gallery page in R2 (G1/G4 fixes); the rest didn't
	}

	fmt.Println()
	fmt.Println("Chrome primitives (composition helpers — no standalone gallery page):")
	printPrimitiveLine("showcase", false)

	fmt.Println()
	fmt.Println("→ see every primitive live, with copy-paste source.json, in the gallery:")
	fmt.Println("  examples/primitive-gallery/  (stddoc serve examples/primitive-gallery)")
	return nil
}

func printPrimitiveLine(t string, hasGalleryPage bool) {
	desc, ok := oneLiners[t]
	if !ok {
		desc = "(no description yet — see templates.json)"
	}
	fmt.Printf("  %-16s %s\n", t, desc)
	if hasGalleryPage {
		slug := "p-" + strings.ReplaceAll(t, "_", "-")
		fmt.Printf("  %-16s → see gallery: examples/primitive-gallery/%s.html\n", "", slug)
	}
}

// structuralPrimitives are the hand-coded (non-templates.json) primitives
// registered in buildRegistry (internal/core/install.go). Kept as a short,
// hand-maintained list here — unlike the declarative set above, these have no
// single runtime data source to read, since each is its own Go RenderFunc.
var structuralPrimitives = []string{
	"sections", "diagrams", "statetrack", "swimlane", "tree", "diagram", "canvas", "evidence",
}

// oneLiners are curated one-line descriptions, keyed by primitive type. Every
// declarative primitive SHOULD have one; a missing entry degrades to a generic
// fallback rather than hiding the primitive (see cmdPrimitives above).
var oneLiners = map[string]string{
	"prose":          "a plain paragraph of body text",
	"kicker":         "a small emphasized opening line",
	"callout":        "a kind-parameterized colored note box (solid/gradient/dashed/framed)",
	"gradient-band":  "a full-bleed gradient statement band",
	"hero":           "a page-opening hero statement",
	"pill":           "a small colored label — status lookup OR entity accent",
	"badges":         "a row of key:value + status badges",
	"chip":           "an inline entity-accented label",
	"cardgrid":       "a flat responsive grid of accent-bordered cards",
	"cardcluster":    "a grouped card-grid with a cluster header per group",
	"namecard":       "a lead/name/sub identity card",
	"rolecard":       "a color-bordered role/entity card with inline pills",
	"panel":          "a softly-lifted content panel",
	"compare":        "a two-column good/bad or left/right item comparison",
	"split":          "two columns of arbitrary composed content, optional seam gutter",
	"decisionmatrix": "a have/miss/partial verdict grid",
	"decision":       "a static decision-record card (question/chosen/rationale/alternatives)",
	"spectrum":       "a labeled gradient scale with stops",
	"threeaxes":      "a 3-axis computed/blind capability grid",
	"statusboard":    "a grouped-row grid with per-cell status color",
	"pipeline":       "phase-strip cards joined by arrow connectors, with active state",
	"tabs":           "CSS-only tab switching (radio+label trick), no client JS",
	"figure":         "a named inline SVG illustration",
	"ascii":          "a captioned monospace ASCII diagram",
	"endpoint":       "an HTTP endpoint sketch (ASCII art + caption)",
	"mermaid":        "a client-rendered mermaid diagram",
	"flow":           "a numbered step sequence with connectors",
	"descent":        "a layered rewrite/reuse/keep decision cascade",
	"code":           "a syntax-flavored code block (command/filename/snippet modes)",
	"table":          "a grouped, columned data table",
	"howto":          "a numbered how-to with an intro line and an optional code block",
	"call":           "a call-to-action box with weighed options",
	"action":         "a JS-driven runner simulator (pipeline stages + run button)",
	"control":        "a live reader-facing radio/select/text input (feedback widget)",
	"ask":            "a live reader-facing feedback-widget question",
	"style_ab":       "a tabbed A/B comparison of named visual styles",
	"reveal":         "an animated-in reveal paragraph with tone-colored gradient",
	"showcase":       "a labeled 'LIVE RENDER' box wrapping other composed content, with a CSS fade-in",

	// Structural (hand-coded) primitives — no gallery page (composite/heavy;
	// see their own docs), but still listed so `stddoc primitives` never
	// silently omits a real registered type.
	"sections":   "node children rendered as nested sub-sections",
	"diagrams":   "a node's root.diagrams array rendered inline",
	"statetrack": "a state-machine track diagram",
	"swimlane":   "a multi-actor swimlane diagram",
	"tree":       "a decision/dependency tree (keep/refactor/rewrite/trash)",
	"diagram":    "a raw-source diagram, routed to the best rendering engine per type",
	"canvas":     "a live co-drawing surface (Excalidraw), per-canvas boards (v2)",
	"evidence":   "an additive evidence drill-down for a node/item",
}
