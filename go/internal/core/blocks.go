package core

import (
	"strings"

	"stddoc/internal/registry"
	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// NODE_BLOCK_ORDER — the render order the node walk has always emitted.
var nodeBlockBefore = []string{"badges", "diagrams", "children", "sections"}
var nodeBlockAfter = []string{"evidence"}

// streamBlock is one entry in the uniform blocks[] stream.
type streamBlock struct {
	Type string
	Data *wire.OrderedMap
}

// adaptNode maps the friendly node schema -> ordered typed blocks[].
// A block tagged "at":"lead" is hoisted above badges; untagged authored blocks
// slot between sections and evidence.
func adaptNode(node *wire.OrderedMap) []streamBlock {
	authored := list(node, "blocks")
	var lead, body []*wire.OrderedMap
	for _, bv := range authored {
		b, ok := omap(bv)
		if !ok {
			continue
		}
		if str(b, "at") == "lead" {
			lead = append(lead, b)
		} else {
			body = append(body, b)
		}
	}
	var out []streamBlock
	for _, b := range lead {
		out = append(out, streamBlock{Type: str(b, "type"), Data: b})
	}
	for _, t := range nodeBlockBefore {
		out = append(out, streamBlock{Type: t, Data: node})
	}
	for _, b := range body {
		out = append(out, streamBlock{Type: str(b, "type"), Data: b})
	}
	for _, t := range nodeBlockAfter {
		out = append(out, streamBlock{Type: t, Data: node})
	}
	return out
}

// renderBlocks walks the stream and renders each via the registry boundary.
func renderBlocks(blocks []streamBlock, ctx *template.Ctx, reg *registry.Registry) string {
	var b strings.Builder
	for _, sb := range blocks {
		s, _ := reg.Render(sb.Type, sb.Data, ctx)
		b.WriteString(s)
	}
	return b.String()
}

// collectBlockCSS concatenates css() from the primitive types in the stream,
// deduped in appearance order, only when non-empty (publish._collect_block_css).
//
// It also recurses into each authored block's data to collect CSS for primitives
// COMPOSED inside it — e.g. the figure/flow/decisionmatrix/ask/reveal nested in a
// style_ab block's voices[].preview[]. Without this, a composed primitive renders
// its HTML but loses its CSS (the balloon figure blew up to full size because
// .figure-balloon never reached the page). Composition is data, so its styling
// follows the data automatically — no per-primitive special-casing.
func collectBlockCSS(blocks []streamBlock, reg *registry.Registry) string {
	seen := map[string]bool{}
	var out strings.Builder
	add := func(t string) {
		if t == "" || seen[t] || !reg.Has(t) {
			return
		}
		seen[t] = true
		if css := reg.CSS(t); css != "" {
			out.WriteString(css)
		}
	}
	for _, sb := range blocks {
		add(sb.Type)
		// Recurse only into AUTHORED block data (Data is the block itself, so
		// Data["type"] == sb.Type). Synthetic node-level blocks (badges, sections,
		// …) carry the whole node as Data and must not be walked, or they'd pull
		// in sibling blocks' types out of order.
		if sb.Data != nil {
			if t, ok := sb.Data.Get("type"); ok {
				if ts, _ := t.(string); ts == sb.Type {
					collectNestedCSS(sb.Data, add)
				}
			}
		}
	}
	return out.String()
}

// collectNestedCSS walks arbitrary block data, calling add for every "type"
// it finds on a nested object — the data-driven way to style composed primitives.
func collectNestedCSS(v any, add func(string)) {
	switch x := v.(type) {
	case *wire.OrderedMap:
		for _, k := range x.Keys() {
			val, _ := x.Get(k)
			if k == "type" {
				if ts, ok := val.(string); ok {
					add(ts)
				}
			}
			collectNestedCSS(val, add)
		}
	case []any:
		for _, e := range x {
			collectNestedCSS(e, add)
		}
	}
}
