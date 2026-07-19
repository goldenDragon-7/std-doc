package core

import (
	"encoding/json"
	"strings"

	"stddoc/internal/template"
	"stddoc/internal/wire"

	"oss.terrastruct.com/d2/d2themes/d2themescatalog"
)

// diagram_primitive.go — the `diagram` primitive: embed a raw-source diagram of
// any semantic type and let the library route it to the BEST engine per the
// diagram team's vetted standard (go/stddoc-lib/diagram_engines.json).
//
// THE LAW (from the knowledge-pack, 22/22 PASS, 2026-07-15): D2 encodes a
// quantity as SIZE and renders IN-PROCESS (pure Go, always browser-free, even
// at freeze). Mermaid encodes a quantity as POSITION and is genuinely better
// for the ~5 quantitative/positional/temporal types; a Mermaid diagram freezes
// to an inline SVG (browser-free artifact) but requires mmdc/npx at freeze time.
//
// Purely additive: this complements the structured diagram primitives
// (swimlane, tree, statetrack) which BUILD D2 source from data. This one takes
// source the author already has and routes+renders+freezes it.
//
// Node schema:
//
//	{ "type": "diagram",
//	  "dtype":   "class",          // semantic type — routed via diagram_engines.json
//	  "engine":  "auto",           // optional override: "d2" | "mermaid" | "flint" | "auto"
//	  "label":   "My class model", // optional; defaults to dtype
//	  "theme":   200,              // optional D2 theme ID override (default DarkMauve=200)
//	  "d2":      "<d2 source>",     // source used when the D2 route is chosen
//	  "mermaid": "<mermaid source>",// source used when the Mermaid route is chosen
//	  "flint":   "<pre-rendered svg>",// freeze-clean Vega-Lite SVG for the Flint route (engine #3, Slice 0)
//	  "chart":   "boxplot",          // OR name a chart from the library catalog (flint/*.svg) — beats pasting
//	  "spec":    { … } }             // OR a live Flint spec baked to SVG via Node (Slice 1; needs the bake toolchain)

// darkD2ThemeID is the diagram team's vetted default dark theme for structural
// diagrams (DarkMauve, ID 200) — so a routed D2 diagram matches the vetted
// quality on the dark default page, instead of the neutral theme-0 oracle used
// by the byte-identical structured primitives.
var darkD2ThemeID = d2themescatalog.DarkMauve.ID

// diagramTypeRule is one row of the routing table.
type diagramTypeRule struct {
	Engine   string `json:"engine"`
	Family   string `json:"family"`
	OpaqueBG bool   `json:"opaque_bg"`
}

// diagramEngineTable is the parsed best-engine-per-type routing standard.
type diagramEngineTable struct {
	DefaultEngine string                     `json:"default_engine"`
	Types         map[string]diagramTypeRule `json:"types"`
}

// loadDiagramEngineTable parses diagram_engines.json. A nil/blank/invalid blob
// yields a minimal table (default engine d2, no per-type routing) so the
// primitive still works — explicit `engine` overrides always function, and
// unrouted types fall back to whichever source the author supplied. A missing
// file is NOT an error (backward-compat with older library trees).
func loadDiagramEngineTable(raw []byte) *diagramEngineTable {
	t := &diagramEngineTable{DefaultEngine: "d2", Types: map[string]diagramTypeRule{}}
	if len(raw) == 0 {
		return t
	}
	var parsed diagramEngineTable
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return t // never let a malformed table break the build
	}
	if parsed.DefaultEngine != "" {
		t.DefaultEngine = parsed.DefaultEngine
	}
	if parsed.Types != nil {
		t.Types = parsed.Types
	}
	return t
}

// route decides which engine renders a diagram of dtype, honoring an explicit
// override, then the routing table, then the table default. The returned engine
// is "d2", "mermaid", or "flint".
func (t *diagramEngineTable) route(dtype, override string) string {
	switch override {
	case "d2", "mermaid", "flint":
		return override
	}
	if rule, ok := t.Types[strings.ToLower(strings.TrimSpace(dtype))]; ok {
		if rule.Engine == "d2" || rule.Engine == "mermaid" || rule.Engine == "flint" {
			return rule.Engine
		}
	}
	if t.DefaultEngine == "mermaid" {
		return "mermaid"
	}
	return "d2"
}

// flintLookup finds a pre-rendered chart SVG in the library catalog, tolerating
// the hyphen/underscore split between authored dtypes (bar-chart) and the SVG
// file basenames (bar_chart). Returns "" when absent.
func flintLookup(catalog map[string]string, name string) string {
	if catalog == nil || name == "" {
		return ""
	}
	name = strings.ToLower(strings.TrimSpace(name))
	if svg, ok := catalog[name]; ok {
		return svg
	}
	if svg, ok := catalog[strings.ReplaceAll(name, "-", "_")]; ok {
		return svg
	}
	if svg, ok := catalog[strings.ReplaceAll(name, "_", "-")]; ok {
		return svg
	}
	return ""
}

// diagramRenderWith returns a RenderFunc closed over the parsed routing table,
// the Flint chart catalog (engine #3, Slice 0 — pre-rendered freeze-clean SVGs),
// and the live Flint baker (Slice 1 — spec→SVG via Node; nil when unavailable).
func diagramRenderWith(table *diagramEngineTable, flintCatalog map[string]string, flintBake func([]byte) (string, error)) func(*wire.OrderedMap, *template.Ctx) (string, error) {
	return func(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
		dtype := strings.TrimSpace(str(block, "dtype"))
		label := getOr(block, "label", "")
		if label == "" {
			if dtype != "" {
				label = dtype
			} else {
				label = "diagram"
			}
		}
		d2src := strings.TrimSpace(str(block, "d2"))
		mmsrc := strings.TrimSpace(str(block, "mermaid"))
		// A generic `source` field feeds whichever engine is chosen when a
		// type-specific field is absent.
		generic := strings.TrimSpace(str(block, "source"))

		engine := table.route(dtype, strings.TrimSpace(str(block, "engine")))

		// Forgiving fallback: if the routed engine has no source but the other
		// engine does, honor the source the author actually supplied rather than
		// forcing them to provide both. Explicit `engine` still wins above.
		if engine == "d2" && d2src == "" && generic == "" && mmsrc != "" {
			engine = "mermaid"
		} else if engine == "mermaid" && mmsrc == "" && generic == "" && d2src != "" {
			engine = "d2"
		}

		switch engine {
		case "flint":
			// Slice 0 (engine #3, zero-dep form): Flint charts are authored as
			// Vega-Lite specs and pre-rendered to a freeze-clean inline SVG (all
			// 34 knowledge-pack charts MEASURED 0 external refs). std-doc embeds
			// that supplied SVG DIRECTLY — no Node/JS bake in the core binary, so
			// the whole quantitative/statistical family is embeddable today while
			// the live spec→SVG render (a Node dependency) stays a deferred call.
			// Source order: author-supplied markup (`flint`/`svg`/`source`) wins;
			// then a live `spec` bake (Slice 1); then NAME a chart from the library
			// catalog via `chart`/dtype (Slice 0 — zero-dep). Naming beats pasting.
			fsvg := strings.TrimSpace(str(block, "flint"))
			if fsvg == "" {
				fsvg = strings.TrimSpace(str(block, "svg"))
			}
			if fsvg == "" {
				fsvg = generic
			}
			// Live bake: a `spec` (Flint chart intent) is rendered to SVG via Node
			// (Slice 1). Only reached when no pre-rendered markup was supplied, so
			// the zero-dep paths never touch Node. A bake failure degrades LOUDLY
			// with the reason — never a silent blank.
			if fsvg == "" && flintBake != nil {
				if specV, ok := block.Get("spec"); ok && specV != nil {
					// wire.MarshalCompact serializes the ordered spec faithfully;
					// encoding/json would emit "{}" for a *wire.OrderedMap.
					raw, merr := wire.MarshalCompact(specV)
					if merr == nil && len(raw) > 2 {
						svg, berr := flintBake(raw)
						if berr != nil {
							return diagramDegraded(label, "flint", "live bake: "+berr.Error()), nil
						}
						return diagramCardWithChip(svg, label, "flint"), nil
					}
				}
			}
			if fsvg == "" {
				if chart := strings.TrimSpace(str(block, "chart")); chart != "" {
					fsvg = flintLookup(flintCatalog, chart)
				}
			}
			if fsvg == "" {
				fsvg = flintLookup(flintCatalog, dtype)
			}
			if fsvg == "" {
				return diagramDegraded(label, "flint", "no flint SVG: supply `flint`/`svg` markup or a `chart`/`dtype` in the library catalog"), nil
			}
			return diagramCardWithChip(fsvg, label, "flint"), nil
		case "mermaid":
			src := mmsrc
			if src == "" {
				src = generic
			}
			if src == "" {
				return diagramDegraded(label, "mermaid", "no mermaid source provided"), nil
			}
			// Route through the existing mermaid primitive (client render +
			// freeze-bake to inline SVG via mmdc). mermaidFix makes the source
			// safe for the dark default theme first — matching diagramsRender.
			d := wire.NewOrderedMap()
			d.Set("label", label)
			d.Set("mermaid", mermaidFix(src))
			out, err := ctx.Registry.Render("mermaid", d, ctx)
			if err != nil {
				return "", err
			}
			// Inject the generated engine chip into the mermaid card so routing
			// is visible on BOTH engines. The mermaid card shares the stable
			// `<button class='fz-btn'>` anchor with d2DiagramCard, so a single
			// anchored replace keeps the chip in sync with no markup duplication.
			chip := "<span class='dc-render' title='engine chosen by the best-engine-per-type standard'>render: mermaid</span>"
			return strings.Replace(out, "<button class='fz-btn'>", chip+"<button class='fz-btn'>", 1), nil
		default: // "d2"
			src := d2src
			if src == "" {
				src = generic
			}
			if src == "" {
				return diagramDegraded(label, "d2", "no d2 source provided"), nil
			}
			themeID := darkD2ThemeID
			if tv, ok := block.Get("theme"); ok {
				if n, ok2 := toInt64(tv); ok2 {
					themeID = n
				}
			}
			if svg := renderD2SVGThemed(src, themeID); svg != "" {
				return diagramCardWithChip(svg, label, "d2"), nil
			}
			return d2SourceBlock(src, label, "d2 in-process render failed"), nil
		}
	}
}

// toInt64 coerces a JSON number (float64) or int-ish value to int64.
func toInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case int:
		return int64(n), true
	case int64:
		return n, true
	}
	return 0, false
}

// diagramCardWithChip is d2DiagramCard plus a generated `render:` engine chip —
// so the engine actually used is always shown from the routing decision, never
// a hand-typed subtitle that can go stale (dossier §8 stale-metadata discipline).
func diagramCardWithChip(svg, label, engine string) string {
	return "<div class='diagram-card'><div class='dc-top'>" +
		"<span class='dc-label'>" + wire.HTMLEscape(label) + "</span>" +
		"<span class='dc-render' title='engine chosen by the best-engine-per-type standard'>render: " + wire.HTMLEscape(engine) + "</span>" +
		"<button class='fz-btn'>&#x26F6; fullscreen</button></div>" +
		"<div class='diagram-svg'>" + svg + "</div></div>"
}

// diagramDegraded is the loud skip note when no usable source was supplied for
// the routed engine.
func diagramDegraded(label, engine, reason string) string {
	return "<div class='diagram-card diagram-degraded'><div class='dc-top'>" +
		"<span class='dc-label'>" + wire.HTMLEscape(label) + "</span>" +
		"<span class='dc-render'>render: " + wire.HTMLEscape(engine) + "</span>" +
		"<span class='dc-skip' style='color:#b58900;font-weight:600'>" +
		"&#9888; diagram not rendered (" + wire.HTMLEscape(reason) + ")</span>" +
		"</div></div>"
}
