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

// assignCanvasBoardIDs gives every `canvas` block in the stream a stable board
// id before render (v2 per-canvas boards, Seam 1 of the canvas v2 per-board
// design). An authored `id` field wins; otherwise it derives
// `<slug>-canvas-<ordinal>` (page-relative slug + ordinal within the page, per
// the PRD) — deterministic across rebuilds and unique even when a page has
// several canvas blocks with no author-supplied id, so "zero-config still
// works". Mutates each canvas block's OrderedMap in place (adaptNode's Data
// pointers alias the authored block, matching how anchorAttr/lint already
// read/write block fields elsewhere in this package).
func assignCanvasBoardIDs(blocks []streamBlock, slug string) {
	ordinal := 0
	assign := func(b *wire.OrderedMap) {
		if id, ok := b.Get("id"); ok {
			if s, ok2 := id.(string); ok2 && strings.TrimSpace(s) != "" {
				ordinal++
				return
			}
		}
		b.Set("id", slug+"-canvas-"+itoa(ordinal))
		ordinal++
	}
	for _, sb := range blocks {
		if sb.Type == "canvas" && sb.Data != nil {
			assign(sb.Data)
		}
		// The FOURTH caller of the shared walker (blocks.go doc comment on
		// walkNestedBlocks). This loop used to see only the TOP-LEVEL stream, so
		// a canvas COMPOSED inside a container (style_ab's voices[].preview[],
		// and any future container primitive) never got a board id at all —
		// latent today (no shipped doc nests a canvas yet) but a live silent
		// drop the moment one does, same class as the lint recursion this
		// worktree exists to fix. Mirrors collectBlockCSS's own guard: only walk
		// AUTHORED block data (Data["type"] == sb.Type), never a synthetic
		// node-level block whose Data is the whole node.
		if sb.Data != nil {
			if t, ok := sb.Data.Get("type"); ok {
				if ts, _ := t.(string); ts == sb.Type {
					// Walk the block's OWN FIELDS (never the block itself — it was
					// already handled above, and re-visiting it here would double-
					// assign its id and skew the ordinal for every canvas after it).
					for _, k := range sb.Data.Keys() {
						if k == "type" {
							continue
						}
						val, _ := sb.Data.Get(k)
						walkNestedBlocks(val, func(node *wire.OrderedMap, typ string) {
							if typ == "canvas" {
								assign(node)
							}
						})
					}
				}
			}
		}
	}
}

// bandAnchorID derives a stable TOC-linkable id for a band block:
// "<slug>-band-<ordinal>" (page-relative slug + ordinal within the page).
// Mirrors assignCanvasBoardIDs's own id-derivation scheme.
func bandAnchorID(slug string, ordinal int) string {
	return slug + "-band-" + itoa(ordinal)
}

// assignBandAnchorIDs gives every `band` block in the stream a stable anchor
// id before render, so the reference layout's "on this page" aside
// (collectTOCLabels, labels.go) has something to link to. An authored `id`
// wins, matching assignCanvasBoardIDs's own precedent.
//
// Routes through walkNestedBlocks from the start — unlike assignCanvasBoardIDs,
// which the design doc (§4.3c) flagged as having only gained this via a later
// fix. Written once, correctly, so band never repeats that history: a band
// nested inside a row inside a grid inside another band still gets an id.
func assignBandAnchorIDs(blocks []streamBlock, slug string) {
	ordinal := 0
	assign := func(b *wire.OrderedMap) {
		if id, ok := b.Get("id"); ok {
			if s, ok2 := id.(string); ok2 && strings.TrimSpace(s) != "" {
				ordinal++
				return
			}
		}
		ordinal++
		b.Set("id", bandAnchorID(slug, ordinal))
	}
	for _, sb := range blocks {
		if sb.Type == "band" && sb.Data != nil {
			assign(sb.Data)
		}
		// Walk the block's OWN FIELDS (never the block itself — handled above)
		// for a band nested arbitrarily deep inside this block's composed data.
		if sb.Data != nil {
			if t, ok := sb.Data.Get("type"); ok {
				if ts, _ := t.(string); ts == sb.Type {
					for _, k := range sb.Data.Keys() {
						if k == "type" {
							continue
						}
						val, _ := sb.Data.Get(k)
						walkNestedBlocks(val, func(node *wire.OrderedMap, typ string) {
							if typ == "band" {
								assign(node)
							}
						})
					}
				}
			}
		}
	}
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
	// Variant CSS runs as a SECOND pass, after all static CSS, so a page that
	// opts into no variants emits byte-for-byte what it emitted before variants
	// existed. Deduped by (type, css) — two collapsible trees contribute once.
	seenVar := map[string]bool{}
	addVar := func(t string, b *wire.OrderedMap) {
		fn := reg.VariantCSS(t)
		if fn == nil || b == nil {
			return
		}
		css := fn(b)
		if css == "" || seenVar[t+"\x00"+css] {
			return
		}
		seenVar[t+"\x00"+css] = true
		out.WriteString(css)
	}
	for _, sb := range blocks {
		if sb.Data == nil {
			continue
		}
		if t, ok := sb.Data.Get("type"); ok {
			if ts, _ := t.(string); ts == sb.Type {
				addVar(sb.Type, sb.Data)
				collectNestedVariantCSS(sb.Data, addVar)
			}
		}
	}
	return out.String()
}

// collectNestedVariantCSS mirrors collectNestedCSS for data-conditional CSS,
// so a variant-using primitive composed INSIDE another primitive still gets
// its styling (the same lesson .figure-balloon taught for static CSS).
func collectNestedVariantCSS(v any, addVar func(string, *wire.OrderedMap)) {
	switch x := v.(type) {
	case *wire.OrderedMap:
		for _, k := range x.Keys() {
			val, _ := x.Get(k)
			if k == "type" {
				if ts, ok := val.(string); ok {
					addVar(ts, x)
				}
			}
			collectNestedVariantCSS(val, addVar)
		}
	case []any:
		for _, e := range x {
			collectNestedVariantCSS(e, addVar)
		}
	}
}

// collectNestedCSS walks arbitrary block data, calling add for every "type"
// it finds on a nested object — the data-driven way to style composed primitives.
func collectNestedCSS(v any, add func(string)) {
	walkNestedBlocks(v, func(_ *wire.OrderedMap, typ string) { add(typ) })
}

// walkNestedBlocks is THE shared recursive walker over arbitrary authored block
// data (protocol/library.md composition). It is the single answer to "what
// counts as a child" — every caller that needs to find nested typed objects
// (CSS collection, lint recursion, and future callers like a TOC-label
// collector) must route through this, not hand-roll its own walk. Drift between
// independently-written walks is exactly how a silent-drop bug re-appears in a
// new place.
//
// What counts as a child: ANY *wire.OrderedMap reachable by walking every field
// of v (through nested objects and arrays, unbounded depth) that itself carries
// a "type" key with a non-empty string value. visit is called with that object
// and its type string. The walk does not stop at the first match — it continues
// into that object's other fields too, so a container-of-containers (e.g. the
// layout language's band > row > grid > band > panel) is found at any depth.
//
// visit does not get to prune the walk (unlike collectNestedCSS's old inlined
// version, which had the same shape); every reachable object is visited. A
// caller that only cares about known-registered types filters on the return
// side (see lintNestedBlocks), which keeps the walker itself simple and total.
func walkNestedBlocks(v any, visit func(node *wire.OrderedMap, typ string)) {
	switch x := v.(type) {
	case *wire.OrderedMap:
		for _, k := range x.Keys() {
			val, _ := x.Get(k)
			if k == "type" {
				if ts, ok := val.(string); ok && ts != "" {
					visit(x, ts)
				}
			}
			walkNestedBlocks(val, visit)
		}
	case []any:
		for _, e := range x {
			walkNestedBlocks(e, visit)
		}
	}
}
